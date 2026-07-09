// גבייה מלקוחות והחזרים כספיים (סעיף 17, 19)
// כל הקריאות מאחורי requireAdmin (נרשם ב-index.js).
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';

const router = Router();

const PAYMENT_METHODS = ['bank_transfer', 'cash', 'check'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// עזרי חישוב
// ---------------------------------------------------------------------------

// סך ששולם בפועל להזמנה = סכום כל רשומות customer_payments.
async function sumPaid(orderId) {
  const { data, error } = await supabase
    .from('customer_payments').select('amount').eq('order_id', orderId);
  if (error) throw error;
  return round2((data || []).reduce((s, r) => s + Number(r.amount || 0), 0));
}

// גוזר סטטוס תשלום מתוך הסכום ששולם מול הסכום הסופי, ומעדכן את ראש ההזמנה.
// לא דורס 'payment_override' — חריגה שאושרה ידנית נשארת עד שמנהל משנה אותה (סעיף 17.4).
async function recomputePaymentStatus(orderId) {
  const { data: order, error } = await supabase
    .from('orders').select('final_amount, payment_status').eq('id', orderId).single();
  if (error) throw error;

  const paid = await sumPaid(orderId);
  const final = round2(Number(order.final_amount || 0));

  let status = order.payment_status;
  if (status !== 'payment_override') {
    if (paid <= 0) status = 'unpaid';
    else if (paid >= final) status = 'paid';
    else status = 'partially_paid';
  }

  if (status !== order.payment_status) {
    await supabase.from('orders').update({ payment_status: status }).eq('id', orderId);
  }
  return { paid, final, balance: round2(final - paid), payment_status: status };
}

// טוען הזמנה קיימת (או משיב 404). לא חוסם מבוטלת — תשלום/החזר אפשריים גם אחריה (סעיף 19.1).
async function loadOrder(res, orderId) {
  const { data: order, error } = await supabase
    .from('orders').select('id, order_number, final_amount, payment_status, order_status').eq('id', orderId).single();
  if (error || !order) { fail(res, 404, 'הזמנה לא נמצאה.'); return null; }
  return order;
}

async function logHistory(orderId, action, changes, actorId) {
  await supabase.from('order_history').insert({
    order_id: orderId, action, changes: changes || null, changed_by: actorId || null,
  });
}

// ===========================================================================
// תשלומי לקוחות (סעיף 17)
// ===========================================================================

// GET /orders/:id/payments — רשימת תשלומים + סיכום גבייה
router.get('/orders/:id/payments', asyncHandler(async (req, res) => {
  const order = await loadOrder(res, req.params.id);
  if (!order) return;

  const { data: payments, error } = await supabase
    .from('customer_payments')
    .select('*, app_users:recorded_by(full_name)')
    .eq('order_id', order.id)
    .order('paid_at', { ascending: true });
  if (error) throw error;

  const paid = round2((payments || []).reduce((s, r) => s + Number(r.amount || 0), 0));
  const final = round2(Number(order.final_amount || 0));
  res.json({
    payments: payments || [],
    summary: { final, paid, balance: round2(final - paid), payment_status: order.payment_status },
  });
}));

// POST /orders/:id/payments — תיעוד תשלום חדש (סעיף 17.2)
router.post('/orders/:id/payments', asyncHandler(async (req, res) => {
  const order = await loadOrder(res, req.params.id);
  if (!order) return;

  const amount = round2(req.body.amount);
  if (!(amount > 0)) return fail(res, 400, 'סכום התשלום חייב להיות גדול מאפס.');
  const method = req.body.payment_method || 'cash';
  if (!PAYMENT_METHODS.includes(method)) return fail(res, 400, 'אמצעי תשלום לא תקין.');
  const paidAt = req.body.paid_at || new Date().toISOString().slice(0, 10);

  const { data: payment, error } = await supabase.from('customer_payments').insert({
    order_id: order.id,
    amount,
    payment_method: method,
    paid_at: paidAt,
    internal_note: req.body.internal_note ? String(req.body.internal_note).trim() : null,
    recorded_by: req.appUser?.sub || null,
  }).select('*').single();
  if (error) throw error;

  const summary = await recomputePaymentStatus(order.id);
  await logHistory(order.id, 'תועד תשלום לקוח', { amount, method, paid_at: paidAt }, req.appUser?.sub);
  res.status(201).json({ ok: true, payment, summary });
}));

// DELETE /orders/:id/payments/:pid — מחיקת תיעוד תשלום (תיקון טעות)
router.delete('/orders/:id/payments/:pid', asyncHandler(async (req, res) => {
  const order = await loadOrder(res, req.params.id);
  if (!order) return;

  const { data, error } = await supabase
    .from('customer_payments').delete()
    .eq('id', req.params.pid).eq('order_id', order.id).select('amount').single();
  if (error || !data) return fail(res, 404, 'תשלום לא נמצא.');

  const summary = await recomputePaymentStatus(order.id);
  await logHistory(order.id, 'נמחק תיעוד תשלום', { amount: Number(data.amount) }, req.appUser?.sub);
  res.json({ ok: true, summary });
}));

// POST /orders/:id/payment-override — אישור חריגת תשלום ידני (סעיף 17.4 / 11.2)
// מנהל מסמן שהסכום מאושר על אף שלא נגבה במלואו (או להיפך — מבטל את החריגה).
router.post('/orders/:id/payment-override', asyncHandler(async (req, res) => {
  const order = await loadOrder(res, req.params.id);
  if (!order) return;

  const enable = req.body.enable !== false;
  if (enable) {
    await supabase.from('orders').update({ payment_status: 'payment_override' }).eq('id', order.id);
    await logHistory(order.id, 'אושרה חריגת תשלום', null, req.appUser?.sub);
    return res.json({ ok: true, summary: { payment_status: 'payment_override' } });
  }
  // ביטול החריגה — גוזרים מחדש מהסכומים בפועל
  await supabase.from('orders').update({ payment_status: 'unpaid' }).eq('id', order.id);
  const summary = await recomputePaymentStatus(order.id);
  await logHistory(order.id, 'בוטלה חריגת תשלום', null, req.appUser?.sub);
  res.json({ ok: true, summary });
}));

// ===========================================================================
// החזרים כספיים (סעיף 19)
// ===========================================================================

// GET /orders/:id/refunds — רשימת החזרים להזמנה
router.get('/orders/:id/refunds', asyncHandler(async (req, res) => {
  const order = await loadOrder(res, req.params.id);
  if (!order) return;

  const { data, error } = await supabase
    .from('order_refunds')
    .select('*, approver:approved_by(full_name), executor:executed_by(full_name)')
    .eq('order_id', order.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  res.json(data || []);
}));

// POST /orders/:id/refunds — פתיחת החזר חדש בסטטוס "ממתין להחזר" (סעיף 19.1, 19.5)
// אוטומטית: ממלא סכום-ששולם וסכום-סופי מהמצב הנוכחי, ומחשב סכום-להחזר כברירת מחדל.
router.post('/orders/:id/refunds', asyncHandler(async (req, res) => {
  const order = await loadOrder(res, req.params.id);
  if (!order) return;

  const paid = await sumPaid(order.id);
  const finalAfter = round2(Number(order.final_amount || 0));
  // ברירת מחדל להחזר = מה שנגבה מעבר לסכום הסופי (למשל אחרי הפחתת מנות/הנחה)
  const defaultToRefund = round2(Math.max(0, paid - finalAfter));
  const amountToRefund = req.body.amount_to_refund != null
    ? round2(req.body.amount_to_refund)
    : defaultToRefund;
  if (!(amountToRefund > 0)) return fail(res, 400, 'סכום ההחזר חייב להיות גדול מאפס.');
  if (amountToRefund > paid) return fail(res, 400, 'סכום ההחזר לא יכול לעלות על הסכום ששולם.');

  const { data: refund, error } = await supabase.from('order_refunds').insert({
    order_id: order.id,
    status: 'pending',
    reason: req.body.reason ? String(req.body.reason).trim() : null,
    amount_paid: paid,
    final_amount_after_change: finalAfter,
    amount_to_refund: amountToRefund,
    internal_note: req.body.internal_note ? String(req.body.internal_note).trim() : null,
    approved_by: req.appUser?.sub || null,   // מי שפותח את ההחזר גם מאשר אותו (סעיף 19.2)
  }).select('*').single();
  if (error) throw error;

  await supabase.from('orders').update({ refund_status: 'pending' }).eq('id', order.id);
  await logHistory(order.id, 'נפתח החזר כספי', { amount_to_refund: amountToRefund, reason: refund.reason }, req.appUser?.sub);
  res.status(201).json({ ok: true, refund });
}));

// טוען החזר קיים לפי id (או משיב 404).
async function loadRefund(res, refundId) {
  const { data, error } = await supabase
    .from('order_refunds').select('*').eq('id', refundId).single();
  if (error || !data) { fail(res, 404, 'החזר לא נמצא.'); return null; }
  return data;
}

// מסנכרן את refund_status בראש ההזמנה לפי ההחזר האחרון (התצוגה בהזמנה).
async function syncOrderRefundStatus(orderId) {
  const { data } = await supabase
    .from('order_refunds').select('status').eq('order_id', orderId)
    .order('created_at', { ascending: false }).limit(1);
  const status = data?.[0]?.status || 'not_required';
  await supabase.from('orders').update({ refund_status: status }).eq('id', orderId);
}

// PATCH /refunds/:rid — עדכון פרטי החזר בסטטוס "ממתין" (סיבה/סכום/הערה)
router.patch('/refunds/:rid', asyncHandler(async (req, res) => {
  const refund = await loadRefund(res, req.params.rid);
  if (!refund) return;
  if (refund.status !== 'pending')
    return fail(res, 409, 'ניתן לערוך רק החזר בסטטוס "ממתין להחזר".');

  const update = {};
  if (req.body.reason !== undefined) update.reason = req.body.reason ? String(req.body.reason).trim() : null;
  if (req.body.internal_note !== undefined) update.internal_note = req.body.internal_note ? String(req.body.internal_note).trim() : null;
  if (req.body.amount_to_refund !== undefined) {
    const amt = round2(req.body.amount_to_refund);
    if (!(amt > 0)) return fail(res, 400, 'סכום ההחזר חייב להיות גדול מאפס.');
    if (amt > Number(refund.amount_paid || 0)) return fail(res, 400, 'סכום ההחזר לא יכול לעלות על הסכום ששולם.');
    update.amount_to_refund = amt;
  }

  const { data, error } = await supabase
    .from('order_refunds').update(update).eq('id', refund.id).select('*').single();
  if (error) throw error;
  res.json({ ok: true, refund: data });
}));

// POST /refunds/:rid/execute — ביצוע החזר בפועל (סעיף 19.4, 19.5)
// קובע סטטוס full/partial לפי הסכום שהוחזר מול הסכום להחזר.
router.post('/refunds/:rid/execute', asyncHandler(async (req, res) => {
  const refund = await loadRefund(res, req.params.rid);
  if (!refund) return;
  if (refund.status === 'cancelled')
    return fail(res, 409, 'לא ניתן לבצע החזר שבוטל.');
  if (refund.status === 'full')
    return fail(res, 409, 'ההחזר כבר הוחזר במלואו.');

  const amountRefunded = req.body.amount_refunded != null
    ? round2(req.body.amount_refunded)
    : round2(refund.amount_to_refund);
  if (!(amountRefunded > 0)) return fail(res, 400, 'סכום שהוחזר חייב להיות גדול מאפס.');
  if (amountRefunded > Number(refund.amount_to_refund || 0))
    return fail(res, 400, 'הסכום שהוחזר לא יכול לעלות על הסכום להחזר.');

  const method = req.body.refund_method || 'bank_transfer';
  if (!PAYMENT_METHODS.includes(method)) return fail(res, 400, 'אמצעי החזר לא תקין.');

  const status = amountRefunded >= Number(refund.amount_to_refund || 0) ? 'full' : 'partial';

  const { data, error } = await supabase.from('order_refunds').update({
    status,
    amount_refunded: amountRefunded,
    refund_method: method,
    refunded_at: req.body.refunded_at || new Date().toISOString().slice(0, 10),
    executed_by: req.appUser?.sub || null,
    internal_note: req.body.internal_note !== undefined
      ? (req.body.internal_note ? String(req.body.internal_note).trim() : null)
      : refund.internal_note,
  }).eq('id', refund.id).select('*').single();
  if (error) throw error;

  await syncOrderRefundStatus(refund.order_id);
  await logHistory(refund.order_id,
    status === 'full' ? 'בוצע החזר כספי במלואו' : 'בוצע החזר כספי חלקי',
    { amount_refunded: amountRefunded, method }, req.appUser?.sub);
  res.json({ ok: true, refund: data });
}));

// POST /refunds/:rid/cancel — ביטול החזר / סימון שלא יבוצע (סעיף 19.4)
router.post('/refunds/:rid/cancel', asyncHandler(async (req, res) => {
  const refund = await loadRefund(res, req.params.rid);
  if (!refund) return;
  if (refund.status === 'full')
    return fail(res, 409, 'לא ניתן לבטל החזר שכבר הוחזר במלואו.');

  const { data, error } = await supabase.from('order_refunds').update({
    status: 'cancelled',
    internal_note: req.body.reason ? String(req.body.reason).trim() : refund.internal_note,
  }).eq('id', refund.id).select('*').single();
  if (error) throw error;

  await syncOrderRefundStatus(refund.order_id);
  await logHistory(refund.order_id, 'בוטל החזר כספי', { reason: req.body.reason || null }, req.appUser?.sub);
  res.json({ ok: true, refund: data });
}));

export default router;
