// מכירת מוצרים מהמלאי ללקוח (מיגרציה 55, סעיף 38).
// כל הקריאות מאחורי requireAdmin (נרשם ב-index.js תחת /api/admin/sales).
//
// מבנה: מכירה = שורת orders עם order_kind='product_sale', shabbat_id ריק,
// sale_date מלא, וכל תוכנה order_inventory_lines. המשמעות המעשית - כל מה שתלוי
// ב-order_id עובד למכירה בלי קוד ייעודי:
//   גבייה   - routes/payments.js לפי order_id (אין כאן שום נתיב תשלום)
//   החזרים  - routes/payments.js
//   הנחות   - routes/admin.js /orders/:id/discounts
//   כספים   - routes/finance.js שואב מ-orders ומ-customer_payments
//
// ההבדל מאירוע: המלאי יורד **מיד** ביצירה ולא בניכוי ידני מתיק השבת, והמחיר
// אינו ניתן לדריסה - המחיר הוא מחיר העלות של הפריט כולל מע"מ, בלי רווח.
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { requireRole } from '../lib/auth.js';
import { inventoryLineUnitCost } from '../services/costing.js';
import { round2 } from '../services/pricing.js';
import { buildSaleLines, syncSaleInventory, recomputeSaleAmounts } from '../services/productSale.js';

const router = Router();

const PAYMENT_METHODS = ['bank_transfer', 'cash', 'check'];
const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// ---------------------------------------------------------------------------
// עזרים
// ---------------------------------------------------------------------------

// טוען מכירה. מחזיר null (ומשיב 404) אם אינה קיימת או שאינה מכירת מוצרים -
// כדי שלא ניתן יהיה לערוך הזמנת שבת דרך נתיבי המכירות.
async function loadSale(res, saleId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', saleId)
    .eq('order_kind', 'product_sale')
    .maybeSingle();
  if (error) throw error;
  if (!data) { fail(res, 404, 'מכירה לא נמצאה.'); return null; }
  return data;
}

async function logHistory(orderId, action, changes, actorId) {
  await supabase.from('order_history').insert({
    order_id: orderId, action, changes: changes || null, changed_by: actorId || null,
  });
}

// כותב את שורות המכירה מחדש. ההחלפה מלאה ולא הפרשית: הממשק שולח את הרשימה כפי
// שהיא אחרי העריכה, ואין היסטוריה ברמת השורה שצריך לשמר.
async function replaceLines(orderId, lineRows) {
  const { error: delErr } = await supabase
    .from('order_inventory_lines').delete().eq('order_id', orderId);
  if (delErr) throw delErr;

  if (lineRows.length) {
    const { error } = await supabase.from('order_inventory_lines')
      .insert(lineRows.map((l) => ({ ...l, order_id: orderId })));
    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------
// GET / - רשימת המכירות עם סיכום גבייה
// ---------------------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const { data: sales, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, sale_date, order_status, payment_status, final_amount,
      preferred_payment_method, notes, created_at,
      customers ( id, full_name, phone ),
      order_inventory_lines ( id )
    `)
    .eq('order_kind', 'product_sale')
    .order('sale_date', { ascending: false })
    .order('order_number', { ascending: false });
  if (error) throw error;

  const ids = (sales || []).map((s) => s.id);
  const { data: payments, error: pErr } = ids.length
    ? await supabase.from('customer_payments').select('order_id, amount').in('order_id', ids)
    : { data: [], error: null };
  if (pErr) throw pErr;

  const paidByOrder = {};
  for (const p of payments || []) {
    paidByOrder[p.order_id] = round2((paidByOrder[p.order_id] || 0) + Number(p.amount || 0));
  }

  res.json((sales || []).map((s) => {
    const finalAmount = round2(Number(s.final_amount || 0));
    const paid = paidByOrder[s.id] || 0;
    return {
      id: s.id,
      order_number: s.order_number,
      sale_date: s.sale_date,
      order_status: s.order_status,
      payment_status: s.payment_status,
      preferred_payment_method: s.preferred_payment_method,
      notes: s.notes,
      created_at: s.created_at,
      customer_id: s.customers?.id || null,
      customer_name: s.customers?.full_name || null,
      customer_phone: s.customers?.phone || null,
      items_count: (s.order_inventory_lines || []).length,
      final_amount: finalAmount,
      paid_amount: paid,
      balance: round2(finalAmount - paid),
    };
  }));
}));

// ---------------------------------------------------------------------------
// GET /item-cost - עלות ליחידת הזנה של פריט, לתצוגה מקדימה בממשק
// ---------------------------------------------------------------------------
// חייב להירשם לפני GET /:id, אחרת 'item-cost' ייקלט כמזהה מכירה.
router.get('/item-cost', asyncHandler(async (req, res) => {
  const itemId = String(req.query.item_id || '').trim();
  const unitId = String(req.query.unit_id || '').trim() || null;
  if (!itemId) return fail(res, 400, 'חסר מזהה פריט.');

  const [{ data: item, error }, cost] = await Promise.all([
    supabase.from('inventory_items')
      .select('id, name, unit, unit_id, quantity_on_hand, package_label, package_size, vat_exempt, last_purchase_price')
      .eq('id', itemId).maybeSingle(),
    inventoryLineUnitCost(itemId, unitId),
  ]);
  if (error) throw error;
  if (!item) return fail(res, 404, 'פריט לא נמצא.');

  const { data: conversions, error: cErr } = await supabase
    .from('inventory_unit_conversions')
    .select('from_unit_id, factor_to_base, units:from_unit_id (id, name)')
    .eq('inventory_item_id', itemId);
  if (cErr) throw cErr;

  // כמה יחידות בסיס יש ביחידת ההזנה שנבחרה. הממשק משתמש בזה כדי להשוות את
  // הכמות המבוקשת מול המלאי הזמין ולהזהיר לפני השמירה. האכיפה עצמה ב-RPC.
  const conv = (conversions || []).find((c) => c.from_unit_id === unitId);
  const unitsPerEntry = !unitId || unitId === item.unit_id
    ? 1
    : (conv ? Number(conv.factor_to_base) : null);

  res.json({
    item,
    unit_cost: cost.unit_cost,
    warning: cost.warning,
    requested_unit_id: unitId,
    units_per_entry: unitsPerEntry,
    conversions: (conversions || []).map((c) => ({
      unit_id: c.from_unit_id,
      unit_name: c.units?.name || null,
      factor_to_base: Number(c.factor_to_base),
    })),
  });
}));

// ---------------------------------------------------------------------------
// GET /:id - מכירה מלאה
// ---------------------------------------------------------------------------
router.get('/:id', asyncHandler(async (req, res) => {
  const sale = await loadSale(res, req.params.id);
  if (!sale) return;

  const [linesRes, payRes, custRes, discRes, chargeRes] = await Promise.all([
    supabase.from('order_inventory_lines')
      .select('*, inventory_items(name, unit, unit_id, quantity_on_hand, package_label, package_size), units(name)')
      .eq('order_id', sale.id)
      .order('created_at'),
    supabase.from('customer_payments').select('*').eq('order_id', sale.id).order('paid_at'),
    supabase.from('customers').select('id, full_name, phone, email, address').eq('id', sale.customer_id).maybeSingle(),
    supabase.from('order_discounts').select('*').eq('order_id', sale.id),
    supabase.from('order_manual_charges').select('*').eq('order_id', sale.id),
  ]);
  for (const r of [linesRes, payRes, custRes, discRes, chargeRes]) if (r.error) throw r.error;

  const finalAmount = round2(Number(sale.final_amount || 0));
  const paid = round2((payRes.data || []).reduce((s, p) => s + Number(p.amount || 0), 0));

  res.json({
    sale,
    customer: custRes.data || null,
    lines: linesRes.data || [],
    payments: payRes.data || [],
    discounts: discRes.data || [],
    manual_charges: chargeRes.data || [],
    summary: {
      final: finalAmount,
      paid,
      balance: round2(finalAmount - paid),
      payment_status: sale.payment_status,
    },
  });
}));

// ---------------------------------------------------------------------------
// POST / - יצירת מכירה + ניכוי המלאי
// ---------------------------------------------------------------------------
// הסדר מכוון: ההזמנה והשורות נוצרות ראשונות, וה-RPC אחרון. אין טרנזקציה בין
// קריאות Supabase, ולכן כישלון של הניכוי (בעיקר חוסר מלאי) מנקה את ההזמנה
// במפורש - אחרת הייתה נשארת מכירה שנרשמה בלי שהמלאי ירד.
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const saleDate = String(b.sale_date || '').trim();
  const paymentMethod = String(b.preferred_payment_method || '').trim();

  if (!b.customer_id) return fail(res, 400, 'יש לבחור לקוח.');
  if (!isIsoDate(saleDate)) return fail(res, 400, 'נא לבחור תאריך מכירה תקין.');
  if (paymentMethod && !PAYMENT_METHODS.includes(paymentMethod)) {
    return fail(res, 400, 'אמצעי תשלום לא תקין.');
  }

  const { data: customer, error: custErr } = await supabase
    .from('customers').select('id, full_name').eq('id', b.customer_id).maybeSingle();
  if (custErr) throw custErr;
  if (!customer) return fail(res, 400, 'הלקוח לא נמצא.');

  const built = await buildSaleLines(b.lines);
  if (built.error) return fail(res, 400, built.error);

  const year = new Date(saleDate).getFullYear();
  const { data: orderNumber, error: numErr } = await supabase
    .rpc('allocate_order_number', { p_year: year });
  if (numErr) throw numErr;

  // המכירה נוצרת מאושרת: היא נרשמת במשרד ברגע שהמוצר עובר לידי הלקוח, ואין
  // כאן שלב אישור כמו בהזמנה שהלקוח שלח.
  const { data: sale, error: ordErr } = await supabase.from('orders').insert({
    order_number: orderNumber,
    order_kind: 'product_sale',
    customer_id: b.customer_id,
    shabbat_id: null,
    sale_date: saleDate,
    order_status: 'approved',
    payment_status: 'unpaid',
    pricing_mode: 'cost_based',
    delivery_method: 'self_pickup',
    contact_name: String(b.contact_name || '').trim() || null,
    contact_phone: String(b.contact_phone || '').trim() || null,
    preferred_payment_method: paymentMethod || null,
    notes: String(b.notes || '').trim() || null,
    base_amount: 0,
    extras_amount: 0,
    inventory_lines_amount: 0,
    manual_charges_amount: 0,
    discount_amount: 0,
    final_amount: 0,
    approved_by: req.appUser?.sub || null,
    approved_at: new Date().toISOString(),
  }).select('*').single();
  if (ordErr) throw ordErr;

  try {
    await replaceLines(sale.id, built.lineRows);

    const sync = await syncSaleInventory(sale.id, built.baseLines, req.appUser?.sub);
    if (!sync.ok) {
      await supabase.from('orders').delete().eq('id', sale.id);
      return fail(res, sync.status, sync.message);
    }

    const amounts = await recomputeSaleAmounts(sale.id);
    await logHistory(sale.id, 'נוצרה מכירת מוצרים', {
      sale_date: saleDate, lines: built.lineRows.length, final_amount: amounts.final_amount,
    }, req.appUser?.sub);

    res.status(201).json({ ok: true, sale: { ...sale, ...amounts } });
  } catch (e) {
    // השורות יורדות ב-cascade יחד עם ההזמנה.
    await supabase.from('orders').delete().eq('id', sale.id);
    throw e;
  }
}));

// ---------------------------------------------------------------------------
// PATCH /:id - עדכון פרטי המכירה (בלי השורות)
// ---------------------------------------------------------------------------
router.patch('/:id', asyncHandler(async (req, res) => {
  const sale = await loadSale(res, req.params.id);
  if (!sale) return;
  if (sale.order_status === 'cancelled') return fail(res, 409, 'לא ניתן לשנות מכירה מבוטלת.');
  const b = req.body || {};

  const patch = {};
  if (b.customer_id !== undefined) {
    if (!b.customer_id) return fail(res, 400, 'יש לבחור לקוח.');
    patch.customer_id = b.customer_id;
  }
  if (b.sale_date !== undefined) {
    if (!isIsoDate(b.sale_date)) return fail(res, 400, 'נא לבחור תאריך מכירה תקין.');
    patch.sale_date = b.sale_date;
  }
  if (b.preferred_payment_method !== undefined) {
    const m = String(b.preferred_payment_method || '').trim();
    if (m && !PAYMENT_METHODS.includes(m)) return fail(res, 400, 'אמצעי תשלום לא תקין.');
    patch.preferred_payment_method = m || null;
  }
  if (b.contact_name !== undefined) patch.contact_name = String(b.contact_name || '').trim() || null;
  if (b.contact_phone !== undefined) patch.contact_phone = String(b.contact_phone || '').trim() || null;
  if (b.notes !== undefined) patch.notes = String(b.notes || '').trim() || null;

  if (Object.keys(patch).length === 0) return res.json({ ok: true });

  const { error } = await supabase.from('orders').update(patch).eq('id', sale.id);
  if (error) throw error;
  await logHistory(sale.id, 'עודכנו פרטי המכירה', patch, req.appUser?.sub);

  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// PUT /:id/lines - החלפת שורות המכירה + סנכרון המלאי
// ---------------------------------------------------------------------------
// ה-RPC נקרא **לפני** החלפת השורות: הוא מחשב את הדלתא מול התנועות שכבר בוצעו
// ולא מול השורות, ולכן כשל חוסר מלאי משאיר את המכירה כפי שהייתה במקום למחוק
// את שורותיה ורק אז להיכשל.
router.put('/:id/lines', asyncHandler(async (req, res) => {
  const sale = await loadSale(res, req.params.id);
  if (!sale) return;
  if (sale.order_status === 'cancelled') return fail(res, 409, 'לא ניתן לשנות מכירה מבוטלת.');

  const built = await buildSaleLines(req.body?.lines);
  if (built.error) return fail(res, 400, built.error);

  const sync = await syncSaleInventory(sale.id, built.baseLines, req.appUser?.sub);
  if (!sync.ok) return fail(res, sync.status, sync.message);

  await replaceLines(sale.id, built.lineRows);
  const amounts = await recomputeSaleAmounts(sale.id);
  await logHistory(sale.id, 'עודכנו מוצרי המכירה', {
    lines: built.lineRows.length, final_amount: amounts.final_amount,
  }, req.appUser?.sub);

  res.json({ ok: true, amounts });
}));

// ---------------------------------------------------------------------------
// POST /:id/cancel - ביטול מכירה והחזרת המלאי
// ---------------------------------------------------------------------------
// הכסף שכבר נגבה נשאר רשום במכוון: הביטול אינו מוחק תשלום, וההשבה עוברת במסלול
// ההחזרים הקיים (routes/payments.js).
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const sale = await loadSale(res, req.params.id);
  if (!sale) return;
  if (sale.order_status === 'cancelled') return fail(res, 409, 'המכירה כבר מבוטלת.');

  const sync = await syncSaleInventory(sale.id, [], req.appUser?.sub);
  if (!sync.ok) return fail(res, sync.status, sync.message);

  const { error } = await supabase.from('orders')
    .update({ order_status: 'cancelled' }).eq('id', sale.id);
  if (error) throw error;

  await logHistory(sale.id, 'המכירה בוטלה והמלאי הוחזר', {
    returned_items: sync.moved.length,
  }, req.appUser?.sub);

  res.json({ ok: true, returned: sync.moved });
}));

// ---------------------------------------------------------------------------
// DELETE /:id - מחיקת מכירה (developer בלבד)
// ---------------------------------------------------------------------------
// חסום כשקיימים תשלומים: מחיקת ההזמנה הייתה מוחקת גם את רשומות הכסף. המסלול
// הנכון במקרה כזה הוא ביטול והחזר.
router.delete('/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const sale = await loadSale(res, req.params.id);
  if (!sale) return;

  const { count, error: cErr } = await supabase
    .from('customer_payments')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', sale.id);
  if (cErr) throw cErr;
  if (count) return fail(res, 409, 'למכירה יש תשלומים מתועדים. יש לבטל אותה ולטפל בהחזר במקום למחוק.');

  const sync = await syncSaleInventory(sale.id, [], req.appUser?.sub);
  if (!sync.ok) return fail(res, sync.status, sync.message);

  const { error: refErr } = await supabase.from('order_refunds').delete().eq('order_id', sale.id);
  if (refErr) throw refErr;

  // השורות, ההנחות, החיובים וההיסטוריה יורדים ב-cascade. התנועות נשארות
  // כרשומת ביקורת ומאבדות את ההפניה (on delete set null, מיגרציה 55).
  const { error } = await supabase.from('orders').delete().eq('id', sale.id);
  if (error) throw error;

  res.json({ ok: true });
}));

export default router;
