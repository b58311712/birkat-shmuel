// ניהול ספקים והזמנות רכש (סעיף 27-28). מאחורי אימות מנהל.
//   - כרטיס ספק מלא: יצירה, עריכה, השבתה (מחיקה רכה - סעיף 32), מוצרים שהספק מספק (סעיף 25.3, 27.1)
//   - הזמנות רכש: יצירה, עריכה, שליחה לספק במייל, ביטול, קבלת סחורה → מלאי (סעיף 27.2-27.3)
//   - תשלומים לספק לפי הזמנת רכש (סעיף 28.1)
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { requireRole } from '../lib/auth.js';
import {
  packageSnapshot,
  quantityFromPackageInput,
  roundQuantity,
} from '../lib/inventoryPackages.js';
import {
  isDirectEventProcurement,
  purchaseReceiptAffectsStock,
} from '../services/directProcurement.js';
import { isDryRun, sendCustomEmail } from '../services/email.js';
import {
  buildPurchaseOrderEmail,
  PURCHASE_ORDER_TEMPLATE_CODE,
} from '../services/purchaseOrderEmail.js';

const router = Router();

const CHANNELS = ['phone', 'email', 'whatsapp', 'other'];
const PO_STATUSES = ['draft', 'sent', 'partially_received', 'received', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid', 'awaiting_invoice', 'cancelled'];
// אמצעי תשלום - רשימה סגורה, שדה חובה (ראו client/src/lib/status.jsx EXPENSE_PAYMENT_METHOD).
const PAYMENT_METHODS = ['cash', 'check', 'credit', 'bank_transfer', 'other'];
// יעד אספקה בכרטיס הספק (מיגרציה 63): למטבח, או ישירות לאולם של הזמנת הלקוח.
const DELIVERY_DESTINATIONS = ['kitchen', 'event_venue'];

async function auditDelete(req, entityType, entityId, details = null) {
  const { error } = await supabase.from('audit_log').insert({
    entity_type: entityType,
    entity_id: entityId,
    action: 'delete',
    actor_id: req.appUser?.sub || null,
    details,
  });
  if (error) throw error;
}

// בדיקת כתובת מייל בסיסית - מספיקה כדי לתפוס שגיאות הקלדה לפני שליחה לספק.
const EMAIL_RE = /^[^s@,]+@[^s@,]+.[^s@,]+$/;

// רשימת נמענים מופרדת בפסיק → מחרוזת מנורמלת, או שגיאה על כתובת לא תקינה.
function normalizeRecipients(value) {
  const parts = String(value || '')
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const invalid = parts.find((part) => !EMAIL_RE.test(part));
  if (invalid) return { error: `כתובת מייל לא תקינה: ${invalid}` };
  return { value: parts.join(', ') };
}

// המרה בטוחה למספר; מחזיר null אם לא מספר תקין
function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function normalizeOrderLines(lines, purchaseOrderId = null) {
  const itemIds = [...new Set((lines || []).map((line) => line?.inventory_item_id).filter(Boolean))];
  if (itemIds.length === 0) return [];
  const { data: items, error } = await supabase
    .from('inventory_items')
    .select('id, package_label, package_size, procurement_type')
    .in('id', itemIds);
  if (error) throw error;
  const itemById = Object.fromEntries((items || []).map((item) => [item.id, item]));

  const clean = [];
  for (const line of lines || []) {
    const item = itemById[line.inventory_item_id];
    if (!item) continue;
    const quantity = quantityFromPackageInput(line, item.package_size, 'quantity');
    if (!(quantity > 0)) continue;
    const packagePrice = num(line.estimated_package_price);
    const estimatedPrice = packagePrice != null && Number(item.package_size) > 0
      ? packagePrice / Number(item.package_size)
      : num(line.estimated_price);
    clean.push({
      ...(purchaseOrderId ? { purchase_order_id: purchaseOrderId } : {}),
      inventory_item_id: item.id,
      quantity,
      estimated_price: estimatedPrice,
      procurement_type_snapshot: item.procurement_type || 'stock',
      ...packageSnapshot(item),
    });
  }
  return clean;
}

// =============================================================================
// resolveOrderLink - אימות הקישור של הזמנת רכש להזמנת לקוח (מיגרציה 63).
// הזמנת הלקוח קובעת את המועד: shabbat_id של הזמנת הרכש מסונכרן ממנה, כך שכל
// הלוגיקה שנשענת על המועד (רכש ישיר, דוח חוסרים, תיק שבת) ממשיכה לעבוד.
// מחזיר { error } לשגיאת קלט, או { orderId, shabbatId } לשיוך שאושר.
// =============================================================================
async function resolveOrderLink(orderId, requestedShabbatId) {
  if (!orderId) return { orderId: null, shabbatId: requestedShabbatId || null };

  const { data: order, error } = await supabase
    .from('orders').select('id, shabbat_id').eq('id', orderId).maybeSingle();
  if (error) throw error;
  if (!order) return { error: 'הזמנת הלקוח שנבחרה לא נמצאה.' };
  if (!order.shabbat_id) return { error: 'לא ניתן לקשר הזמנת רכש להזמנה שאינה משויכת למועד.' };
  if (requestedShabbatId && requestedShabbatId !== order.shabbat_id)
    return { error: 'הזמנת הלקוח שנבחרה שייכת למועד אחר.' };

  return { orderId: order.id, shabbatId: order.shabbat_id };
}

async function deletePurchaseOrder(poId) {
  const cleanup = await Promise.all([
    supabase.from('inventory_movements').delete().eq('purchase_order_id', poId),
    supabase.from('supplier_payments').delete().eq('purchase_order_id', poId),
    supabase.from('general_expenses').update({ purchase_order_id: null }).eq('purchase_order_id', poId),
  ]);
  const cleanupErr = cleanup.find((r) => r.error)?.error;
  if (cleanupErr) throw cleanupErr;
  return supabase.from('purchase_orders').delete().eq('id', poId).select('id').maybeSingle();
}

async function deleteSupplier(supplierId) {
  const { data: orders, error: ordersErr } = await supabase
    .from('purchase_orders')
    .select('id')
    .eq('supplier_id', supplierId);
  if (ordersErr) throw ordersErr;

  for (const order of orders || []) {
    const del = await deletePurchaseOrder(order.id);
    if (del.error) throw del.error;
  }

  const cleanup = await Promise.all([
    supabase.from('inventory_items').update({ default_supplier_id: null }).eq('default_supplier_id', supplierId),
    supabase.from('supplier_payments').delete().eq('supplier_id', supplierId),
    supabase.from('general_expenses').delete().eq('supplier_id', supplierId),
  ]);
  const cleanupErr = cleanup.find((r) => r.error)?.error;
  if (cleanupErr) throw cleanupErr;

  return {
    ...(await supabase.from('suppliers').delete().eq('id', supplierId).select('id').maybeSingle()),
    deletedOrders: (orders || []).length,
  };
}

// ===========================================================================
// ספקים - כרטיס ספק מלא (סעיף 27.1)
// ===========================================================================

// GET /api/admin/suppliers?active= - רשימת ספקים
router.get('/', asyncHandler(async (req, res) => {
  let q = supabase.from('suppliers').select('*').order('name');
  if (req.query.active === 'true') q = q.eq('is_active', true);
  if (req.query.active === 'false') q = q.eq('is_active', false);
  const { data, error } = await q;
  if (error) throw error;
  res.json(data);
}));

// GET /api/admin/suppliers/:id - כרטיס ספק בודד + מוצרים שהוא מספק + הזמנות רכש אחרונות
router.get('/:id', asyncHandler(async (req, res) => {
  const { data: supplier, error } = await supabase
    .from('suppliers').select('*').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!supplier) return fail(res, 404, 'ספק לא נמצא.');

  // מוצרים שהספק מספק (סעיף 25.3, 27.1) - שילוב item_suppliers + פריטים שהספק שלהם ברירת מחדל
  const { data: links, error: lErr } = await supabase
    .from('item_suppliers')
    .select('inventory_item_id, last_purchase_price, inventory_items:inventory_item_id (id, name, unit, is_active, vat_exempt, package_label, package_size)')
    .eq('supplier_id', req.params.id);
  if (lErr) throw lErr;

  const items = (links || [])
    .filter((l) => l.inventory_items)
    .map((l) => ({
      item_id: l.inventory_item_id,
      name: l.inventory_items.name,
      unit: l.inventory_items.unit,
      is_active: l.inventory_items.is_active,
      vat_exempt: l.inventory_items.vat_exempt,
      package_label: l.inventory_items.package_label,
      package_size: l.inventory_items.package_size,
      last_purchase_price: l.last_purchase_price, // מחיר בסיס (לפני מע"מ)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));

  const { data: orders, error: oErr } = await supabase
    .from('purchase_orders')
    .select('id, po_number, status, expected_delivery_date, estimated_amount, actual_amount, created_at')
    .eq('supplier_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (oErr) throw oErr;

  res.json({ supplier, items, orders });
}));

// POST /api/admin/suppliers - יצירת ספק
router.post('/', asyncHandler(async (req, res) => {
  const {
    name, contact_name, phone, email, preferred_channel, order_notes,
    default_price_includes_vat, delivery_destination,
  } = req.body || {};
  if (!name?.trim()) return fail(res, 400, 'חובה להזין שם ספק.');
  if (preferred_channel && !CHANNELS.includes(preferred_channel))
    return fail(res, 400, 'אמצעי הזמנה לא תקין.');
  if (delivery_destination && !DELIVERY_DESTINATIONS.includes(delivery_destination))
    return fail(res, 400, 'יעד אספקה לא תקין.');
  const { data, error } = await supabase.from('suppliers').insert({
    name: name.trim(),
    contact_name: contact_name?.trim() || null,
    phone: phone?.trim() || null,
    email: email?.trim() || null,
    preferred_channel: preferred_channel || null,
    order_notes: order_notes?.trim() || null,
    default_price_includes_vat: !!default_price_includes_vat, // ברירת מחדל למתג "לפני/כולל" בהזנה
    delivery_destination: delivery_destination || 'kitchen',
  }).select('*').single();
  if (error) throw error;
  res.json({ ok: true, supplier: data });
}));

// PATCH /api/admin/suppliers/:id - עדכון/השבתת ספק
router.patch('/:id', asyncHandler(async (req, res) => {
  const allowed = ['name', 'contact_name', 'phone', 'email', 'preferred_channel', 'order_notes', 'default_price_includes_vat', 'delivery_destination', 'is_active'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  if ('name' in patch && !patch.name?.trim()) return fail(res, 400, 'שם ספק לא יכול להיות ריק.');
  if ('preferred_channel' in patch && patch.preferred_channel && !CHANNELS.includes(patch.preferred_channel))
    return fail(res, 400, 'אמצעי הזמנה לא תקין.');
  if ('delivery_destination' in patch && !DELIVERY_DESTINATIONS.includes(patch.delivery_destination))
    return fail(res, 400, 'יעד אספקה לא תקין.');
  // נרמול מחרוזות ריקות ל-null
  for (const k of ['contact_name', 'phone', 'email', 'order_notes']) {
    if (k in patch) patch[k] = patch[k]?.trim() || null;
  }
  if ('name' in patch) patch.name = patch.name.trim();
  if ('preferred_channel' in patch) patch.preferred_channel = patch.preferred_channel || null;
  if ('default_price_includes_vat' in patch) patch.default_price_includes_vat = !!patch.default_price_includes_vat;
  if (Object.keys(patch).length === 0) return fail(res, 400, 'אין שדות לעדכון.');
  const { data, error } = await supabase.from('suppliers')
    .update(patch).eq('id', req.params.id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'ספק לא נמצא.');
  res.json({ ok: true, supplier: data });
}));

router.delete('/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const result = await deleteSupplier(req.params.id);
  if (result.error) throw result.error;
  if (!result.data) return fail(res, 404, 'ספק לא נמצא.');
  await auditDelete(req, 'supplier', req.params.id, { deleted_purchase_orders: result.deletedOrders });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// מוצרים שהספק מספק (סעיף 25.3) - ניהול item_suppliers מכרטיס הספק
// ---------------------------------------------------------------------------

// PUT /api/admin/suppliers/:id/items - קביעת רשימת המוצרים שהספק מספק
// body: { items: [{ inventory_item_id, last_purchase_price }] }
router.put('/:id/items', asyncHandler(async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items)) return fail(res, 400, 'רשימת מוצרים לא תקינה.');

  const { data: supplier, error: sErr } = await supabase
    .from('suppliers').select('id').eq('id', req.params.id).maybeSingle();
  if (sErr) throw sErr;
  if (!supplier) return fail(res, 404, 'ספק לא נמצא.');

  // מנרמלים ומסירים כפילויות לפי inventory_item_id
  const byItem = new Map();
  for (const it of items) {
    if (!it?.inventory_item_id) continue;
    byItem.set(it.inventory_item_id, {
      supplier_id: req.params.id,
      inventory_item_id: it.inventory_item_id,
      last_purchase_price: num(it.last_purchase_price),
    });
  }
  const rows = [...byItem.values()];

  // מוחקים את כל השיוכים הקיימים לספק ומחליפים ברשימה החדשה (upsert פשוט וברור)
  const { error: dErr } = await supabase.from('item_suppliers').delete().eq('supplier_id', req.params.id);
  if (dErr) throw dErr;
  if (rows.length) {
    const { error: iErr } = await supabase.from('item_suppliers').insert(rows);
    if (iErr) throw iErr;
  }
  res.json({ ok: true, count: rows.length });
}));

// ===========================================================================
// הזמנות רכש (סעיף 27.2-27.3)
// ===========================================================================

// GET /api/admin/suppliers/purchase-orders?supplier_id=&status= - רשימת הזמנות רכש
router.get('/purchase-orders/list', asyncHandler(async (req, res) => {
  let q = supabase
    .from('purchase_orders')
    .select(`*,
      supplier:supplier_id (id, name),
      shabbat:shabbat_id (id, parasha, hebrew_date, gregorian_date),
      order:order_id (id, order_number, venue_name)`)
    .order('created_at', { ascending: false });
  if (req.query.supplier_id) q = q.eq('supplier_id', req.query.supplier_id);
  if (req.query.status) q = q.eq('status', req.query.status);
  const { data, error } = await q;
  if (error) throw error;
  res.json(data);
}));

// GET /api/admin/suppliers/purchase-orders/:id - הזמנת רכש מלאה + שורות + תשלום
router.get('/purchase-orders/:id', asyncHandler(async (req, res) => {
  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select(`*,
      supplier:supplier_id (id, name, phone, email, preferred_channel, default_price_includes_vat, delivery_destination),
      creator:created_by (id, full_name),
      shabbat:shabbat_id (id, parasha, hebrew_date, gregorian_date),
      order:order_id (id, order_number, venue_name, venue_address, customers (full_name))`)
    .eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!po) return fail(res, 404, 'הזמנת רכש לא נמצאה.');

  const { data: lines, error: lErr } = await supabase
    .from('purchase_order_lines')
    .select('*, item:inventory_item_id (id, name, unit, vat_exempt, package_label, package_size, procurement_type)')
    .eq('purchase_order_id', req.params.id)
    .order('created_at');
  if (lErr) throw lErr;

  const { data: payment, error: pErr } = await supabase
    .from('supplier_payments')
    .select('*')
    .eq('purchase_order_id', req.params.id)
    .maybeSingle();
  if (pErr) throw pErr;

  res.json({ purchase_order: po, lines: lines || [], payment: payment || null });
}));

// POST /api/admin/suppliers/purchase-orders - יצירת הזמנת רכש (טיוטה)
// body: { supplier_id, shabbat_id, order_id, expected_delivery_date, notes,
//         lines: [{ inventory_item_id, quantity, estimated_price }] }
router.post('/purchase-orders', asyncHandler(async (req, res) => {
  const { supplier_id, shabbat_id, order_id, expected_delivery_date, notes, lines } = req.body || {};
  if (!supplier_id) return fail(res, 400, 'חובה לבחור ספק.');
  if (!Array.isArray(lines) || lines.length === 0)
    return fail(res, 400, 'חובה להוסיף לפחות פריט אחד.');

  const { data: supplier, error: sErr } = await supabase
    .from('suppliers').select('id').eq('id', supplier_id).maybeSingle();
  if (sErr) throw sErr;
  if (!supplier) return fail(res, 404, 'ספק לא נמצא.');

  // הזמנת לקוח מקושרת גוררת את המועד שלה, ולכן נפתרת לפני בדיקת הרכש הישיר.
  const link = await resolveOrderLink(order_id, shabbat_id);
  if (link.error) return fail(res, 400, link.error);
  const effectiveShabbatId = link.shabbatId;

  const clean = await normalizeOrderLines(lines);
  if (clean.length === 0) return fail(res, 400, 'אין שורות תקינות בהזמנה.');
  if (clean.some((line) => isDirectEventProcurement(line.procurement_type_snapshot)) && !effectiveShabbatId)
    return fail(res, 400, 'מוצר ברכש ישיר מחייב שיוך ההזמנה לאירוע.');
  if (effectiveShabbatId) {
    const { data: shabbat, error: shabbatError } = await supabase
      .from('shabbatot').select('id').eq('id', effectiveShabbatId).maybeSingle();
    if (shabbatError) throw shabbatError;
    if (!shabbat) return fail(res, 404, 'האירוע שנבחר לא נמצא.');
  }

  // מחיר משוער כולל
  const estimated_amount = clean.reduce(
    (sum, l) => sum + (l.estimated_price != null ? l.estimated_price * l.quantity : 0), 0);

  // הקצאת מספר הזמנת רכש (מונה שנתי - RPC)
  const year = new Date().getFullYear();
  const { data: poNumber, error: nErr } = await supabase.rpc('allocate_po_number', { p_year: year });
  if (nErr) throw nErr;

  const { data: po, error: pErr } = await supabase.from('purchase_orders').insert({
    po_number: poNumber,
    supplier_id,
    shabbat_id: effectiveShabbatId,
    order_id: link.orderId,
    status: 'draft',
    expected_delivery_date: expected_delivery_date || null,
    estimated_amount: estimated_amount || null,
    notes: notes?.trim() || null,
    created_by: req.appUser?.sub || null,
  }).select('*').single();
  if (pErr) throw pErr;

  const lineRows = clean.map((l) => ({ ...l, purchase_order_id: po.id }));
  const { error: lErr } = await supabase.from('purchase_order_lines').insert(lineRows);
  if (lErr) throw lErr;

  res.json({ ok: true, purchase_order: po });
}));

// PATCH /api/admin/suppliers/purchase-orders/:id - עדכון פרטי הזמנת רכש (רק בטיוטה)
// body: { shabbat_id, order_id, expected_delivery_date, notes, lines }
// המסך משתמש בזה לעריכה מלאה של טיוטה (סעיף 27.2): מועד, הזמנת לקוח מקושרת,
// תאריך אספקה, הערות ופריטים. הזמנה שכבר נשלחה/התקבלה אינה ניתנת לעריכה.
router.patch('/purchase-orders/:id', asyncHandler(async (req, res) => {
  const { data: po, error } = await supabase
    .from('purchase_orders').select('id, status, shabbat_id, order_id').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!po) return fail(res, 404, 'הזמנת רכש לא נמצאה.');
  if (po.status !== 'draft')
    return fail(res, 400, 'ניתן לערוך פריטים רק בהזמנה בסטטוס טיוטה.');

  const body = req.body || {};
  const { shabbat_id, order_id, expected_delivery_date, notes, lines } = body;
  const patch = {};
  if ('shabbat_id' in body) patch.shabbat_id = shabbat_id || null;
  if ('expected_delivery_date' in body) patch.expected_delivery_date = expected_delivery_date || null;
  if ('notes' in body) patch.notes = notes?.trim() || null;

  // הזמנת לקוח מקושרת גוררת את המועד שלה, ודורסת shabbat_id שנשלח בנפרד
  // (מיגרציה 63) - כך אי אפשר להגיע להזמנת רכש שמצביעה על מועד אחד ועל הזמנה
  // ששייכת למועד אחר.
  if ('order_id' in body) {
    const requestedShabbatId = 'shabbat_id' in patch ? patch.shabbat_id : po.shabbat_id;
    const link = await resolveOrderLink(order_id, order_id ? requestedShabbatId : null);
    if (link.error) return fail(res, 400, link.error);
    patch.order_id = link.orderId;
    if (link.orderId) patch.shabbat_id = link.shabbatId;
  } else if ('shabbat_id' in patch && po.order_id && patch.shabbat_id !== po.shabbat_id) {
    return fail(res, 400, 'לא ניתן לשנות את המועד של הזמנת רכש המקושרת להזמנת לקוח. יש לנתק את הקישור תחילה.');
  }

  if ('shabbat_id' in patch && !patch.shabbat_id) {
    const { data: directLines, error: directLinesError } = await supabase
      .from('purchase_order_lines')
      .select('id')
      .eq('purchase_order_id', po.id)
      .eq('procurement_type_snapshot', 'direct_event')
      .limit(1);
    if (directLinesError) throw directLinesError;
    if ((directLines || []).length > 0)
      return fail(res, 400, 'לא ניתן להסיר שיוך לאירוע מהזמנה הכוללת רכש ישיר.');
  }
  if (patch.shabbat_id) {
    const { data: shabbat, error: shabbatError } = await supabase
      .from('shabbatot').select('id').eq('id', patch.shabbat_id).maybeSingle();
    if (shabbatError) throw shabbatError;
    if (!shabbat) return fail(res, 404, 'האירוע שנבחר לא נמצא.');
  }

  // אם נשלחו שורות - מחליפים אותן ומחשבים מחדש מחיר משוער
  if (Array.isArray(lines)) {
    const clean = await normalizeOrderLines(lines, po.id);
    if (clean.length === 0) return fail(res, 400, 'אין שורות תקינות בהזמנה.');
    const effectiveShabbatId = 'shabbat_id' in patch ? patch.shabbat_id : po.shabbat_id;
    if (clean.some((line) => isDirectEventProcurement(line.procurement_type_snapshot))
      && !effectiveShabbatId) {
      return fail(res, 400, 'מוצר ברכש ישיר מחייב שיוך ההזמנה לאירוע.');
    }
    patch.estimated_amount = clean.reduce(
      (sum, l) => sum + (l.estimated_price != null ? l.estimated_price * l.quantity : 0), 0) || null;

    const { error: dErr } = await supabase.from('purchase_order_lines')
      .delete().eq('purchase_order_id', po.id);
    if (dErr) throw dErr;
    const { error: iErr } = await supabase.from('purchase_order_lines').insert(clean);
    if (iErr) throw iErr;
  }

  if (Object.keys(patch).length) {
    const { error: uErr } = await supabase.from('purchase_orders')
      .update(patch).eq('id', po.id);
    if (uErr) throw uErr;
  }

  const { data: updated, error: gErr } = await supabase
    .from('purchase_orders').select('*').eq('id', po.id).single();
  if (gErr) throw gErr;
  res.json({ ok: true, purchase_order: updated });
}));

router.delete('/purchase-orders/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const { data, error } = await deletePurchaseOrder(req.params.id);
  if (error) throw error;
  if (!data) return fail(res, 404, 'הזמנת רכש לא נמצאה.');
  await auditDelete(req, 'purchase_order', req.params.id);
  res.json({ ok: true });
}));

// POST /api/admin/suppliers/purchase-orders/:id/status - שינוי סטטוס (שליחה/ביטול)
// body: { status }  - קבלת סחורה נעשית דרך /receive (לא כאן)
router.post('/purchase-orders/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!['sent', 'cancelled', 'draft'].includes(status))
    return fail(res, 400, 'שינוי סטטוס לא תקין. קבלת סחורה נעשית דרך מסך הקבלה.');

  const { data: po, error } = await supabase
    .from('purchase_orders').select('id, status').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!po) return fail(res, 404, 'הזמנת רכש לא נמצאה.');
  if (po.status === 'received')
    return fail(res, 400, 'לא ניתן לשנות סטטוס של הזמנה שהתקבלה במלואה.');

  const { data, error: uErr } = await supabase.from('purchase_orders')
    .update({ status }).eq('id', po.id).select('*').single();
  if (uErr) throw uErr;
  res.json({ ok: true, purchase_order: data });
}));

// ===========================================================================
// שליחת ההזמנה לספק במייל (מיגרציה 61)
// ===========================================================================
// עד כה שליחה לספק הייתה סימון ידני בלבד. כאן: תצוגה מקדימה → עריכה → שליחה,
// עם היסטוריית שליחות מלאה ב-email_log ואפשרות לשלוח שוב.

// GET /api/admin/suppliers/purchase-orders/:id/email-preview - הנוסח המוצע לספק
router.get('/purchase-orders/:id/email-preview', asyncHandler(async (req, res) => {
  let preview;
  try {
    preview = await buildPurchaseOrderEmail(req.params.id);
  } catch (e) {
    if (e.notFound) return fail(res, 404, e.message);
    throw e;
  }
  res.json({
    to: preview.to,
    subject: preview.subject,
    body: preview.body,
    supplier: preview.supplier,
    order: preview.order,
    delivery: preview.delivery,
    status: preview.purchase_order.status,
    template_active: preview.template_active,
    dry_run: isDryRun(),
  });
}));

// GET /api/admin/suppliers/purchase-orders/:id/email-log - היסטוריית השליחות
router.get('/purchase-orders/:id/email-log', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('email_log')
    .select('id, to_email, cc_email, subject, status, error, created_at')
    .eq('purchase_order_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  res.json({ log: data || [], dry_run: isDryRun() });
}));

// POST /api/admin/suppliers/purchase-orders/:id/send-email - שליחה לספק
// body: { to, cc, subject, body } - הנוסח שהמנהלת אישרה בתצוגה המקדימה.
// כשל שליחה אינו משנה סטטוס ואינו מחזיר שגיאת HTTP: הוא מתועד ומוחזר כתוצאה,
// כדי שהמסך יציג "נכשל" עם הסיבה ויאפשר שליחה חוזרת.
router.post('/purchase-orders/:id/send-email', asyncHandler(async (req, res) => {
  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select('id, status, email_send_count')
    .eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!po) return fail(res, 404, 'הזמנת רכש לא נמצאה.');
  if (po.status === 'cancelled')
    return fail(res, 400, 'לא ניתן לשלוח לספק הזמנה שבוטלה.');

  const { to, cc, subject, body } = req.body || {};
  const toResult = normalizeRecipients(to);
  if (toResult.error) return fail(res, 400, toResult.error);
  if (!toResult.value) return fail(res, 400, 'יש להזין כתובת מייל של הספק.');
  const ccResult = normalizeRecipients(cc);
  if (ccResult.error) return fail(res, 400, ccResult.error);
  if (!String(subject || '').trim()) return fail(res, 400, 'נושא המייל אינו יכול להיות ריק.');
  if (!String(body || '').trim()) return fail(res, 400, 'גוף המייל אינו יכול להיות ריק.');

  const result = await sendCustomEmail({
    code: PURCHASE_ORDER_TEMPLATE_CODE,
    to: toResult.value,
    cc: ccResult.value || null,
    subject: subject.trim(),
    body,
    purchaseOrderId: po.id,
  });

  // סיכום המצב האחרון על ההזמנה (לתצוגה מהירה ברשימה ובכרטיס).
  const patch = {
    email_sent_at: new Date().toISOString(),
    email_sent_to: [toResult.value, ccResult.value].filter(Boolean).join(', '),
    email_status: result.status,
    email_send_count: Number(po.email_send_count || 0) + 1,
  };
  // טיוטה שנשלחה בפועל עוברת ל"נשלחה לספק"; כשל משאיר אותה בטיוטה.
  if (result.status !== 'failed' && po.status === 'draft') patch.status = 'sent';

  const { data: updated, error: uErr } = await supabase
    .from('purchase_orders').update(patch).eq('id', po.id).select('*').single();
  if (uErr) throw uErr;

  res.json({
    ok: result.status !== 'failed',
    status: result.status,
    error: result.error || null,
    purchase_order: updated,
  });
}));

// POST /api/admin/suppliers/purchase-orders/:id/receive - קבלת סחורה → הוספה למלאי (סעיף 27.3)
// body: { lines: [{ line_id, quantity_received, actual_price }] }
// לכל שורה: מוסיף למלאי את ההפרש בין הכמות שכבר התקבלה לכמות המצטברת החדשה,
// מתעד תנועת 'purchase_receipt', מעדכן last_purchase_price בכרטיס המוצר,
// ומעדכן סטטוס ההזמנה ל-partially_received / received לפי מצב הקבלה.
router.post('/purchase-orders/:id/receive', asyncHandler(async (req, res) => {
  const { lines } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0)
    return fail(res, 400, 'אין שורות לקבלה.');

  const { data: po, error } = await supabase
    .from('purchase_orders').select('id, status').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!po) return fail(res, 404, 'הזמנת רכש לא נמצאה.');
  if (po.status === 'cancelled')
    return fail(res, 400, 'לא ניתן לקבל סחורה בהזמנה שבוטלה.');
  if (po.status === 'received')
    return fail(res, 400, 'ההזמנה כבר התקבלה במלואה.');

  // שולפים את כל שורות ההזמנה
  const { data: poLines, error: lErr } = await supabase
    .from('purchase_order_lines').select('*').eq('purchase_order_id', po.id);
  if (lErr) throw lErr;
  const lineById = Object.fromEntries((poLines || []).map((l) => [l.id, l]));

  // מנרמלים את בקשת הקבלה: quantity_received הוא הכמות המצטברת הרצויה לשורה
  const updates = [];
  for (const l of lines) {
    const line = lineById[l.line_id];
    if (!line) continue;
    const wantTotal = (
      Object.prototype.hasOwnProperty.call(l, 'package_quantity')
      || Object.prototype.hasOwnProperty.call(l, 'loose_quantity')
    )
      ? quantityFromPackageInput(l, line.package_size_snapshot, 'quantity_received')
      : num(l.quantity_received);
    if (wantTotal === null || wantTotal < 0) continue;
    const already = Number(line.quantity_received);
    const addQty = Number((wantTotal - already).toFixed(4)); // כמה להוסיף עכשיו
    // מדלגים על שורות ללא תוספת חיובית - לא מפחיתים מלאי בקבלה
    // (הפחתה/תיקון של מלאי שנקלט בטעות נעשים דרך שינוי ידני במלאי, סעיף 25.5).
    if (addQty <= 0) continue;
    updates.push({
      line,
      newReceivedTotal: wantTotal,
      addQty,
      actual_price: num(l.actual_package_price) != null && Number(line.package_size_snapshot) > 0
        ? num(l.actual_package_price) / Number(line.package_size_snapshot)
        : num(l.actual_price),
    });
  }
  if (updates.length === 0) return fail(res, 400, 'אין שינוי בכמויות שהתקבלו.');

  // שולפים כמות נוכחית לכל הפריטים המושפעים
  const itemIds = [...new Set(updates.map((u) => u.line.inventory_item_id))];
  const { data: items, error: iErr } = await supabase
    .from('inventory_items').select('id, name, quantity_on_hand').in('id', itemIds);
  if (iErr) throw iErr;
  const itemById = Object.fromEntries((items || []).map((i) => [i.id, i]));
  // צוברים תוספות לכל פריט (יכול להופיע כמה שורות לאותו פריט)
  const runningQty = Object.fromEntries((items || []).map((i) => [i.id, Number(i.quantity_on_hand)]));

  const movements = [];
  const receivedItems = [];
  let actualAmount = 0;

  for (const u of updates) {
    const itemId = u.line.inventory_item_id;
    // עדכון שורת ההזמנה: כמות מצטברת שהתקבלה + מחיר בפועל (אם נמסר)
    const linePatch = { quantity_received: u.newReceivedTotal };
    if (u.actual_price != null) linePatch.actual_price = u.actual_price;
    const { error: uErr } = await supabase.from('purchase_order_lines')
      .update(linePatch).eq('id', u.line.id);
    if (uErr) throw uErr;

    // הוספה למלאי רק אם יש כמות חיובית להוסיף כעת
    const entersStock = purchaseReceiptAffectsStock(u.line.procurement_type_snapshot);
    if (u.addQty > 0 && entersStock) {
      const before = runningQty[itemId];
      const after = roundQuantity(before + u.addQty);
      runningQty[itemId] = after;

      const { error: qErr } = await supabase.from('inventory_items')
        .update({ quantity_on_hand: after }).eq('id', itemId);
      if (qErr) throw qErr;

      movements.push({
        inventory_item_id: itemId,
        movement_type: 'purchase_receipt',
        quantity_delta: u.addQty,
        quantity_before: before,
        quantity_after: after,
        purchase_order_id: po.id,
        reason: 'קבלת סחורה מהזמנת רכש',
        performed_by: req.appUser?.sub || null,
      });
      receivedItems.push({ item_id: itemId, name: itemById[itemId]?.name, added: u.addQty, on_hand: after });
    } else if (u.addQty > 0) {
      receivedItems.push({
        item_id: itemId,
        name: itemById[itemId]?.name,
        added: u.addQty,
        on_hand: null,
        stock_updated: false,
      });
    }

    // עדכון מחיר קנייה אחרון בכרטיס המוצר + ב-item_suppliers (אם נמסר מחיר)
    if (u.actual_price != null) {
      await supabase.from('inventory_items')
        .update({ last_purchase_price: u.actual_price }).eq('id', itemId);
    }
    const effPrice = u.actual_price != null ? u.actual_price : Number(u.line.estimated_price || 0);
    actualAmount += effPrice * u.addQty;
  }

  if (movements.length) {
    const { error: mErr } = await supabase.from('inventory_movements').insert(movements);
    if (mErr) throw mErr;
  }

  // קובעים סטטוס חדש: אם כל השורות התקבלו במלואן → received, אחרת partially_received
  const { data: freshLines, error: flErr } = await supabase
    .from('purchase_order_lines').select('quantity, quantity_received').eq('purchase_order_id', po.id);
  if (flErr) throw flErr;
  const fullyReceived = (freshLines || []).every(
    (l) => Number(l.quantity_received) >= Number(l.quantity));
  const anyReceived = (freshLines || []).some((l) => Number(l.quantity_received) > 0);
  const newStatus = fullyReceived ? 'received' : (anyReceived ? 'partially_received' : po.status);

  // מעדכנים actual_amount מצטבר בהזמנה
  const { data: curPo } = await supabase
    .from('purchase_orders').select('actual_amount').eq('id', po.id).single();
  const newActual = Number((Number(curPo?.actual_amount || 0) + actualAmount).toFixed(2));

  const { data: updatedPo, error: puErr } = await supabase.from('purchase_orders')
    .update({ status: newStatus, actual_amount: newActual || null })
    .eq('id', po.id).select('*').single();
  if (puErr) throw puErr;

  res.json({ ok: true, status: newStatus, received: receivedItems, purchase_order: updatedPo });
}));

// ===========================================================================
// תשלום לספק לפי הזמנת רכש (סעיף 28.1)
// ===========================================================================

// PUT /api/admin/suppliers/purchase-orders/:id/payment - יצירה/עדכון תשלום להזמנה
// body: { status, invoice_amount, invoice_number, invoice_date, paid_at, payment_method, amount_paid, notes }
router.put('/purchase-orders/:id/payment', asyncHandler(async (req, res) => {
  const { data: po, error } = await supabase
    .from('purchase_orders').select('id, supplier_id, estimated_amount').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!po) return fail(res, 404, 'הזמנת רכש לא נמצאה.');

  const b = req.body || {};
  if (b.status && !PAYMENT_STATUSES.includes(b.status))
    return fail(res, 400, 'סטטוס תשלום לא תקין.');
  if (!PAYMENT_METHODS.includes(b.payment_method))
    return fail(res, 400, 'יש לבחור אמצעי תשלום.');

  const fields = {
    supplier_id: po.supplier_id,
    status: b.status || 'unpaid',
    estimated_amount: num(b.estimated_amount) ?? po.estimated_amount ?? null,
    invoice_amount: num(b.invoice_amount),
    invoice_number: b.invoice_number?.trim() || null,
    invoice_date: b.invoice_date || null,
    paid_at: b.paid_at || null,
    payment_method: b.payment_method,
    amount_paid: num(b.amount_paid),
    notes: b.notes?.trim() || null,
  };

  // תשלום קיים? עדכון, אחרת יצירה
  const { data: existing, error: eErr } = await supabase
    .from('supplier_payments').select('id').eq('purchase_order_id', po.id).maybeSingle();
  if (eErr) throw eErr;

  let payment;
  if (existing) {
    const { data, error: uErr } = await supabase.from('supplier_payments')
      .update(fields).eq('id', existing.id).select('*').single();
    if (uErr) throw uErr;
    payment = data;
  } else {
    const { data, error: iErr } = await supabase.from('supplier_payments')
      .insert({ ...fields, purchase_order_id: po.id }).select('*').single();
    if (iErr) throw iErr;
    payment = data;
  }
  res.json({ ok: true, payment });
}));

export default router;
