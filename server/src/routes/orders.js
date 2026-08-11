// יצירת וניהול הזמנות (סעיף 10, 11) + עריכה עצמית של הזמנה ע"י לקוח באמצעות קוד
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { buildOrderItems, saveOrderEdit, loadOrderItems, PAYMENT_METHODS } from '../services/orderItems.js';
import { createAdminNotification } from '../services/adminNotifications.js';
import { sendOrderCreatedEmails, sendOrderUpdatedEmail } from '../services/orderNotifications.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import { generateEditCode, isEditWindowOpen, MAX_CODE_ATTEMPTS, LOCK_MINUTES } from '../services/orderEdit.js';

const router = Router();

// ------- עזר: טוען תיק שבת קיים או פותח חדש (סעיף 8.5) -------
async function ensureShabbatFile(shabbatId) {
  const { data: existing } = await supabase
    .from('shabbat_files').select('id').eq('shabbat_id', shabbatId).maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await supabase
    .from('shabbat_files').insert({ shabbat_id: shabbatId }).select('id').single();
  if (error) throw error;
  return created.id;
}

// =====================================================================
// POST /api/orders - יצירת הזמנה חדשה (מהלקוח)
// body: { customer_id, shabbat_id, slots:[{meal_slot_id,portions}],
//         meals:[{meal_slot_id, meal_id}], extras:[{extra_id, actual_quantity?}],
//         delivery_method?, contact_name?, contact_phone?, venue_name,
//         venue_address, preferred_payment_method, notes? }
// כל המחירים מחושבים בשרת ונשמרים "קפואים" (סעיף 15.3).
// =====================================================================
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body;

  // --- ולידציה בסיסית ---
  if (!b.customer_id) return fail(res, 400, 'חסר מזהה לקוח.');
  if (!b.shabbat_id) return fail(res, 400, 'חסרה בחירת שבת.');
  if (!Array.isArray(b.slots) || b.slots.length === 0)
    return fail(res, 400, 'יש לבחור לפחות סעודה אחת.');
  const venueName = String(b.venue_name || '').trim();
  const venueAddress = String(b.venue_address || '').trim();
  if (!venueName) return fail(res, 400, 'יש להזין את שם האולם.');
  if (!venueAddress) return fail(res, 400, 'יש להזין את כתובת האולם.');
  if (!PAYMENT_METHODS.includes(b.preferred_payment_method))
    return fail(res, 400, 'יש לבחור אמצעי תשלום תקין.');

  // --- שבת חייבת להיות פתוחה (סעיף 8.4) ---
  // הנתיב הזה הוא ההזמנה העצמית של הלקוח, ולכן מוגבל לשבתות בלבד. הזמנת אירוע
  // נוצרת רק במשרד דרך /api/admin/events (מיגרציה 52). הבדיקה כאן היא ההגנה
  // האמיתית: סינון הרשימה ב-/shabbatot/open מסתיר את האירוע, אך אינו מונע
  // שליחת מזהה אירוע ישירות.
  const { data: shabbat, error: shErr } = await supabase
    .from('shabbatot').select('id, kind, status, parasha, gregorian_date, payment_deadline').eq('id', b.shabbat_id).single();
  if (shErr) throw shErr;
  if (shabbat.kind !== 'shabbat')
    return fail(res, 400, 'לא ניתן להזמין למועד הזה.');
  if (shabbat.status !== 'open')
    return fail(res, 400, 'השבת שנבחרה סגורה להזמנות.');

  // --- בניית פריטי המשנה + חישוב סכומים (משותף עם עריכה) ---
  let built;
  try {
    built = await buildOrderItems({ slots: b.slots, meals: b.meals, extras: b.extras });
  } catch (e) {
    if (e.userMessage) return fail(res, 400, e.userMessage);
    throw e;
  }
  const { slotRows: builtSlotRows, mealRows, extraRows, amounts, exception } = built;

  // --- מספר הזמנה שנתי רץ (סעיף 10.3) ---
  const year = new Date().getFullYear();
  const { data: orderNumber, error: numErr } = await supabase
    .rpc('allocate_order_number', { p_year: year });
  if (numErr) throw numErr;

  // --- תיק שבת (סעיף 8.5) ---
  await ensureShabbatFile(b.shabbat_id);

  // --- קוד עריכה (בן 6 ספרות, כמו סיסמה) - נשמר רק כ-hash, נשלח במייל פעם אחת ---
  const editCode = generateEditCode();
  const editCodeHash = await hashPassword(editCode);

  // --- יצירת ראש ההזמנה ---
  const { data: order, error: ordErr } = await supabase.from('orders').insert({
    order_number: orderNumber,
    customer_id: b.customer_id,
    shabbat_id: b.shabbat_id,
    order_status: 'pending_approval',
    payment_status: 'unpaid',
    delivery_method: b.delivery_method || 'volunteer_transport',
    contact_name: b.contact_name || null,
    contact_phone: b.contact_phone || null,
    venue_name: venueName,
    venue_address: venueAddress,
    notes: String(b.notes || '').trim() || null,
    preferred_payment_method: b.preferred_payment_method,
    base_amount: amounts.base_amount,
    extras_amount: amounts.extras_amount,
    manual_charges_amount: 0,
    discount_amount: 0,
    final_amount: amounts.final_amount,
    portions_exception_requested: exception.requested,
    portions_exception_note: exception.note,
    edit_code_hash: editCodeHash,
  }).select('*').single();
  if (ordErr) throw ordErr;

  // --- פריטי משנה ---
  await supabase.from('order_meal_slots')
    .insert(builtSlotRows.map((s) => ({ ...s, order_id: order.id })));

  if (mealRows.length)
    await supabase.from('order_meals').insert(mealRows.map((m) => ({ ...m, order_id: order.id })));
  if (extraRows.length)
    await supabase.from('order_extras').insert(extraRows.map((e) => ({ ...e, order_id: order.id })));

  await supabase.from('order_history').insert({
    order_id: order.id,
    action: exception.requested
      ? `נוצרה הזמנה חדשה ע"י הלקוח (בקשת חריג במספר מנות - ${exception.note})`
      : 'נוצרה הזמנה חדשה ע"י הלקוח',
  });

  await createAdminNotification({
    notification_type: 'new_order',
    entity_table: 'orders',
    entity_id: order.id,
    title: exception.requested
      ? 'הזמנה חדשה עם בקשת חריג במנות - ממתינה לאישור'
      : 'הזמנה חדשה ממתינה לאישור',
    body: exception.requested
      ? `הזמנה ${order.order_number} - ${exception.note}`
      : `הזמנה ${order.order_number}`,
    link_path: `/admin/orders/${order.id}`,
  });

  // --- תשובה ללקוח מיד לאחר שההזמנה נשמרה ---
  // המיילים הם תופעת-לוואי ורצים ברקע *אחרי* התשובה. אחרת שליחת SMTP איטית/תקועה
  // (נפוץ ב-Render חינם) הייתה מעכבת את res והמסך היה "נתקע" ב"שולח" למרות
  // שההזמנה כבר נשמרה במערכת. sendTemplateEmail בולע כל כשל, כך שאין promise דחוי.
  res.status(201).json({ ok: true, order });

  // --- מיילים (סעיף 18) - ברקע, לא חוסמים את התשובה ולא מפילים את הבקשה ---
  sendOrderCreatedEmails({ order, shabbat, customerId: b.customer_id, editCode }).catch((e) =>
    console.warn('sendOrderCreatedEmails failed:', e.message)
  );
}));

// =====================================================================
// GET /api/orders/customer/:customerId - היסטוריית הזמנות של לקוח (סעיף 5.4)
// =====================================================================
router.get('/customer/:customerId', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, shabbatot(kind, title, parasha, hebrew_date, gregorian_date)')
    .eq('customer_id', req.params.customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  res.json(data);
}));

// =====================================================================
// GET /api/orders/:id - הזמנה מלאה עם כל הפריטים
// =====================================================================
router.get('/:id', asyncHandler(async (req, res) => {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, customers(full_name, phone), shabbatot(kind, title, parasha, hebrew_date, gregorian_date)')
    .eq('id', req.params.id).single();
  if (error) throw error;

  const items = await loadOrderItems(order.id);

  res.json({
    ...order,
    slots: items.slots,
    meals: items.meals,
    extras: items.extras,
    inventory_lines: items.inventoryLines,
  });
}));

// =====================================================================
// עריכה עצמית של הזמנה ע"י לקוח, מוגנת בקוד בן 6 ספרות (נשלח במייל ביצירה) -
// מותרת רק עד שבועיים לפני מועד השבת (isEditWindowOpen), בלי תלות בסטטוס אישור.
// =====================================================================

// טוען את ההזמנה ומאמת קוד עריכה. מחזיר { order, shabbat } בהצלחה, או
// { status, message } לכשל - הקורא מחליט איך להגיב (fail/res).
async function checkEditAccess(orderId, code) {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, shabbatot(kind, title, parasha, gregorian_date, payment_deadline)')
    .eq('id', orderId).maybeSingle();
  if (error) throw error;
  if (!order) return { status: 404, message: 'ההזמנה לא נמצאה.' };
  if (order.order_kind !== 'occasion' || order.order_status === 'cancelled') {
    return { status: 409, message: 'לא ניתן לערוך הזמנה זו.' };
  }
  if (!order.edit_code_hash) {
    return { status: 409, message: 'לא זמינה עריכה עצמאית להזמנה זו. יש לפנות למשרד.' };
  }
  if (order.edit_code_locked_until && new Date(order.edit_code_locked_until) > new Date()) {
    return { status: 429, message: 'יותר מדי ניסיונות עם קוד שגוי. נא לנסות שוב מאוחר יותר, או לפנות למשרד.' };
  }
  const shabbat = order.shabbatot;
  if (!isEditWindowOpen(shabbat?.gregorian_date)) {
    return { status: 403, message: 'לא ניתן לערוך הזמנה פחות משבועיים לפני מועד השבת. יש לפנות למשרד.' };
  }

  const valid = await verifyPassword(String(code || ''), order.edit_code_hash);
  if (!valid) {
    const attempts = (order.edit_code_attempts || 0) + 1;
    const update = { edit_code_attempts: attempts };
    if (attempts >= MAX_CODE_ATTEMPTS) {
      update.edit_code_locked_until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
    }
    await supabase.from('orders').update(update).eq('id', order.id);
    return { status: 401, message: 'קוד שגוי.' };
  }

  // איפוס מונה הניסיונות בהצלחה
  await supabase.from('orders').update({ edit_code_attempts: 0, edit_code_locked_until: null }).eq('id', order.id);

  return { order, shabbat };
}

// POST /api/orders/:id/verify-edit-code - אימות קוד + החזרת ההזמנה המלאה למילוי טופס עריכה
router.post('/:id/verify-edit-code', asyncHandler(async (req, res) => {
  const result = await checkEditAccess(req.params.id, req.body?.code);
  if (result.status) return fail(res, result.status, result.message);

  const { order, shabbat } = result;
  const items = await loadOrderItems(order.id);
  res.json({
    ...order,
    shabbatot: shabbat,
    slots: items.slots,
    meals: items.meals,
    extras: items.extras,
  });
}));

// PUT /api/orders/:id - עריכה עצמית מלאה ע"י הלקוח (סעודות/מאכלים/תוספות/משלוח),
// לא כולל שינוי השבת עצמה. body: { code, ...כמו PUT /api/admin/orders/:id }
router.put('/:id', asyncHandler(async (req, res) => {
  const result = await checkEditAccess(req.params.id, req.body?.code);
  if (result.status) return fail(res, result.status, result.message);
  const { order, shabbat } = result;

  let updated;
  try {
    updated = await saveOrderEdit({
      order,
      body: req.body,
      allowShabbatChange: false,
      historyAction: 'ההזמנה נערכה ע"י הלקוח',
    });
  } catch (e) {
    if (e.userMessage) return fail(res, 400, e.userMessage);
    throw e;
  }

  await createAdminNotification({
    notification_type: 'order_edited',
    entity_table: 'orders',
    entity_id: updated.id,
    title: 'הזמנה נערכה ע"י הלקוח',
    body: `הזמנה ${updated.order_number}`,
    link_path: `/admin/orders/${updated.id}`,
  });

  res.json({ ok: true, order: updated });

  sendOrderUpdatedEmail({ order: updated, shabbat, customerId: updated.customer_id }).catch((e) =>
    console.warn('sendOrderUpdatedEmail failed:', e.message)
  );
}));

export default router;
