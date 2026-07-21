// ניהול ספקים והזמנות רכש (סעיף 27-28). מאחורי אימות מנהל.
//   - כרטיס ספק מלא: יצירה, עריכה, השבתה (מחיקה רכה — סעיף 32), מוצרים שהספק מספק (סעיף 25.3, 27.1)
//   - הזמנות רכש: יצירה, עריכה, שליחה, ביטול, קבלת סחורה → הוספה למלאי (סעיף 27.2-27.3)
//   - תשלומים לספק לפי הזמנת רכש (סעיף 28.1)
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

const CHANNELS = ['phone', 'email', 'whatsapp', 'other'];
const PO_STATUSES = ['draft', 'sent', 'partially_received', 'received', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid', 'awaiting_invoice', 'cancelled'];

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

// המרה בטוחה למספר; מחזיר null אם לא מספר תקין
function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
// ספקים — כרטיס ספק מלא (סעיף 27.1)
// ===========================================================================

// GET /api/admin/suppliers?active= — רשימת ספקים
router.get('/', asyncHandler(async (req, res) => {
  let q = supabase.from('suppliers').select('*').order('name');
  if (req.query.active === 'true') q = q.eq('is_active', true);
  if (req.query.active === 'false') q = q.eq('is_active', false);
  const { data, error } = await q;
  if (error) throw error;
  res.json(data);
}));

// GET /api/admin/suppliers/:id — כרטיס ספק בודד + מוצרים שהוא מספק + הזמנות רכש אחרונות
router.get('/:id', asyncHandler(async (req, res) => {
  const { data: supplier, error } = await supabase
    .from('suppliers').select('*').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!supplier) return fail(res, 404, 'ספק לא נמצא.');

  // מוצרים שהספק מספק (סעיף 25.3, 27.1) — שילוב item_suppliers + פריטים שהספק שלהם ברירת מחדל
  const { data: links, error: lErr } = await supabase
    .from('item_suppliers')
    .select('inventory_item_id, last_purchase_price, inventory_items:inventory_item_id (id, name, unit, is_active, vat_exempt)')
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

// POST /api/admin/suppliers — יצירת ספק
router.post('/', asyncHandler(async (req, res) => {
  const { name, contact_name, phone, email, preferred_channel, order_notes, default_price_includes_vat } = req.body || {};
  if (!name?.trim()) return fail(res, 400, 'חובה להזין שם ספק.');
  if (preferred_channel && !CHANNELS.includes(preferred_channel))
    return fail(res, 400, 'אמצעי הזמנה לא תקין.');
  const { data, error } = await supabase.from('suppliers').insert({
    name: name.trim(),
    contact_name: contact_name?.trim() || null,
    phone: phone?.trim() || null,
    email: email?.trim() || null,
    preferred_channel: preferred_channel || null,
    order_notes: order_notes?.trim() || null,
    default_price_includes_vat: !!default_price_includes_vat, // ברירת מחדל למתג "לפני/כולל" בהזנה
  }).select('*').single();
  if (error) throw error;
  res.json({ ok: true, supplier: data });
}));

// PATCH /api/admin/suppliers/:id — עדכון/השבתת ספק
router.patch('/:id', asyncHandler(async (req, res) => {
  const allowed = ['name', 'contact_name', 'phone', 'email', 'preferred_channel', 'order_notes', 'default_price_includes_vat', 'is_active'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  if ('name' in patch && !patch.name?.trim()) return fail(res, 400, 'שם ספק לא יכול להיות ריק.');
  if ('preferred_channel' in patch && patch.preferred_channel && !CHANNELS.includes(patch.preferred_channel))
    return fail(res, 400, 'אמצעי הזמנה לא תקין.');
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
// מוצרים שהספק מספק (סעיף 25.3) — ניהול item_suppliers מכרטיס הספק
// ---------------------------------------------------------------------------

// PUT /api/admin/suppliers/:id/items — קביעת רשימת המוצרים שהספק מספק
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

// GET /api/admin/suppliers/purchase-orders?supplier_id=&status= — רשימת הזמנות רכש
router.get('/purchase-orders/list', asyncHandler(async (req, res) => {
  let q = supabase
    .from('purchase_orders')
    .select('*, supplier:supplier_id (id, name)')
    .order('created_at', { ascending: false });
  if (req.query.supplier_id) q = q.eq('supplier_id', req.query.supplier_id);
  if (req.query.status) q = q.eq('status', req.query.status);
  const { data, error } = await q;
  if (error) throw error;
  res.json(data);
}));

// GET /api/admin/suppliers/purchase-orders/:id — הזמנת רכש מלאה + שורות + תשלום
router.get('/purchase-orders/:id', asyncHandler(async (req, res) => {
  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select('*, supplier:supplier_id (id, name, phone, email, preferred_channel, default_price_includes_vat), creator:created_by (id, full_name)')
    .eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!po) return fail(res, 404, 'הזמנת רכש לא נמצאה.');

  const { data: lines, error: lErr } = await supabase
    .from('purchase_order_lines')
    .select('*, item:inventory_item_id (id, name, unit, vat_exempt)')
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

// POST /api/admin/suppliers/purchase-orders — יצירת הזמנת רכש (טיוטה)
// body: { supplier_id, expected_delivery_date, notes, lines: [{ inventory_item_id, quantity, estimated_price }] }
router.post('/purchase-orders', asyncHandler(async (req, res) => {
  const { supplier_id, expected_delivery_date, notes, lines } = req.body || {};
  if (!supplier_id) return fail(res, 400, 'חובה לבחור ספק.');
  if (!Array.isArray(lines) || lines.length === 0)
    return fail(res, 400, 'חובה להוסיף לפחות פריט אחד.');

  const { data: supplier, error: sErr } = await supabase
    .from('suppliers').select('id').eq('id', supplier_id).maybeSingle();
  if (sErr) throw sErr;
  if (!supplier) return fail(res, 404, 'ספק לא נמצא.');

  // מנרמלים שורות
  const clean = [];
  for (const l of lines) {
    const qty = num(l.quantity);
    if (!l.inventory_item_id || qty === null || qty <= 0) continue;
    clean.push({
      inventory_item_id: l.inventory_item_id,
      quantity: qty,
      estimated_price: num(l.estimated_price),
    });
  }
  if (clean.length === 0) return fail(res, 400, 'אין שורות תקינות בהזמנה.');

  // מחיר משוער כולל
  const estimated_amount = clean.reduce(
    (sum, l) => sum + (l.estimated_price != null ? l.estimated_price * l.quantity : 0), 0);

  // הקצאת מספר הזמנת רכש (מונה שנתי — RPC)
  const year = new Date().getFullYear();
  const { data: poNumber, error: nErr } = await supabase.rpc('allocate_po_number', { p_year: year });
  if (nErr) throw nErr;

  const { data: po, error: pErr } = await supabase.from('purchase_orders').insert({
    po_number: poNumber,
    supplier_id,
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

// PATCH /api/admin/suppliers/purchase-orders/:id — עדכון פרטי הזמנת רכש (רק בטיוטה)
// body: { expected_delivery_date, notes, lines }
router.patch('/purchase-orders/:id', asyncHandler(async (req, res) => {
  const { data: po, error } = await supabase
    .from('purchase_orders').select('id, status').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!po) return fail(res, 404, 'הזמנת רכש לא נמצאה.');
  if (po.status !== 'draft')
    return fail(res, 400, 'ניתן לערוך פריטים רק בהזמנה בסטטוס טיוטה.');

  const { expected_delivery_date, notes, lines } = req.body || {};
  const patch = {};
  if ('expected_delivery_date' in (req.body || {})) patch.expected_delivery_date = expected_delivery_date || null;
  if ('notes' in (req.body || {})) patch.notes = notes?.trim() || null;

  // אם נשלחו שורות — מחליפים אותן ומחשבים מחדש מחיר משוער
  if (Array.isArray(lines)) {
    const clean = [];
    for (const l of lines) {
      const qty = num(l.quantity);
      if (!l.inventory_item_id || qty === null || qty <= 0) continue;
      clean.push({
        purchase_order_id: po.id,
        inventory_item_id: l.inventory_item_id,
        quantity: qty,
        estimated_price: num(l.estimated_price),
      });
    }
    if (clean.length === 0) return fail(res, 400, 'אין שורות תקינות בהזמנה.');
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

// POST /api/admin/suppliers/purchase-orders/:id/status — שינוי סטטוס (שליחה/ביטול)
// body: { status }  — קבלת סחורה נעשית דרך /receive (לא כאן)
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

// POST /api/admin/suppliers/purchase-orders/:id/receive — קבלת סחורה → הוספה למלאי (סעיף 27.3)
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
    const wantTotal = num(l.quantity_received);
    if (wantTotal === null || wantTotal < 0) continue;
    const already = Number(line.quantity_received);
    const addQty = Number((wantTotal - already).toFixed(4)); // כמה להוסיף עכשיו
    // מדלגים על שורות ללא תוספת חיובית — לא מפחיתים מלאי בקבלה
    // (הפחתה/תיקון של מלאי שנקלט בטעות נעשים דרך שינוי ידני במלאי, סעיף 25.5).
    if (addQty <= 0) continue;
    updates.push({
      line,
      newReceivedTotal: wantTotal,
      addQty,
      actual_price: num(l.actual_price),
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
    if (u.addQty > 0) {
      const before = runningQty[itemId];
      const after = Number((before + u.addQty).toFixed(4));
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

// PUT /api/admin/suppliers/purchase-orders/:id/payment — יצירה/עדכון תשלום להזמנה
// body: { status, invoice_amount, invoice_number, invoice_date, paid_at, payment_method, amount_paid, notes }
router.put('/purchase-orders/:id/payment', asyncHandler(async (req, res) => {
  const { data: po, error } = await supabase
    .from('purchase_orders').select('id, supplier_id, estimated_amount').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!po) return fail(res, 404, 'הזמנת רכש לא נמצאה.');

  const b = req.body || {};
  if (b.status && !PAYMENT_STATUSES.includes(b.status))
    return fail(res, 400, 'סטטוס תשלום לא תקין.');

  const fields = {
    supplier_id: po.supplier_id,
    status: b.status || 'unpaid',
    estimated_amount: num(b.estimated_amount) ?? po.estimated_amount ?? null,
    invoice_amount: num(b.invoice_amount),
    invoice_number: b.invoice_number?.trim() || null,
    invoice_date: b.invoice_date || null,
    paid_at: b.paid_at || null,
    payment_method: b.payment_method?.trim() || null,
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
