// יצירת וניהול הזמנות (סעיף 10, 11)
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { buildOrderItems } from '../services/orderItems.js';
import { createAdminNotification } from '../services/adminNotifications.js';
import { sendTemplateEmail, orderVars } from '../services/email.js';

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
// POST /api/orders — יצירת הזמנה חדשה (מהלקוח)
// body: { customer_id, shabbat_id, slots:[{meal_slot_id,portions}],
//         meals:[{meal_slot_id, meal_id}], extras:[{extra_id, actual_quantity?}],
//         delivery_method?, contact_name?, contact_phone?, venue_address?,
//         preferred_payment_method? }
// כל המחירים מחושבים בשרת ונשמרים "קפואים" (סעיף 15.3).
// =====================================================================
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body;

  // --- ולידציה בסיסית ---
  if (!b.customer_id) return fail(res, 400, 'חסר מזהה לקוח.');
  if (!b.shabbat_id) return fail(res, 400, 'חסרה בחירת שבת.');
  if (!Array.isArray(b.slots) || b.slots.length === 0)
    return fail(res, 400, 'יש לבחור לפחות סעודה אחת.');

  // --- שבת חייבת להיות פתוחה (סעיף 8.4) ---
  const { data: shabbat, error: shErr } = await supabase
    .from('shabbatot').select('id, status, parasha, payment_deadline').eq('id', b.shabbat_id).single();
  if (shErr) throw shErr;
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
    venue_address: b.venue_address || null,
    preferred_payment_method: b.preferred_payment_method || null,
    base_amount: amounts.base_amount,
    extras_amount: amounts.extras_amount,
    manual_charges_amount: 0,
    discount_amount: 0,
    final_amount: amounts.final_amount,
    portions_exception_requested: exception.requested,
    portions_exception_note: exception.note,
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
      ? `נוצרה הזמנה חדשה ע"י הלקוח (בקשת חריג במספר מנות — ${exception.note})`
      : 'נוצרה הזמנה חדשה ע"י הלקוח',
  });

  await createAdminNotification({
    notification_type: 'new_order',
    entity_table: 'orders',
    entity_id: order.id,
    title: exception.requested
      ? 'הזמנה חדשה עם בקשת חריג במנות — ממתינה לאישור'
      : 'הזמנה חדשה ממתינה לאישור',
    body: exception.requested
      ? `הזמנה ${order.order_number} — ${exception.note}`
      : `הזמנה ${order.order_number}`,
    link_path: `/admin/orders/${order.id}`,
  });

  // --- תשובה ללקוח מיד לאחר שההזמנה נשמרה ---
  // המיילים הם תופעת-לוואי ורצים ברקע *אחרי* התשובה. אחרת שליחת SMTP איטית/תקועה
  // (נפוץ ב-Render חינם) הייתה מעכבת את res והמסך היה "נתקע" ב"שולח" למרות
  // שההזמנה כבר נשמרה במערכת. sendTemplateEmail בולע כל כשל, כך שאין promise דחוי.
  res.status(201).json({ ok: true, order });

  // --- מיילים (סעיף 18) — ברקע, לא חוסמים את התשובה ולא מפילים את הבקשה ---
  sendOrderEmails({ order, shabbat, customerId: b.customer_id }).catch((e) =>
    console.warn('sendOrderEmails failed:', e.message)
  );
}));

// שליחת מיילי "הזמנה חדשה" ברקע (סיכום ללקוח + התראה למנהלים). לא נזרק כלפי מעלה.
async function sendOrderEmails({ order, shabbat, customerId }) {
  const { data: customer } = await supabase
    .from('customers').select('full_name, email').eq('id', customerId).maybeSingle();
  const vars = orderVars({ order, customer, shabbat });

  // 18.1 — סיכום הזמנה ללקוח (אם יש מייל)
  await sendTemplateEmail({ code: 'order_summary', to: customer?.email, vars, orderId: order.id });

  // 18.2 — התראה למנהלים/רכזים על הזמנה חדשה (בנוסף להתראה במסך שכבר נוצרה)
  const { data: managers } = await supabase
    .from('app_users').select('email')
    .in('role', ['manager', 'coordinator', 'developer']).eq('is_active', true);
  for (const m of managers || []) {
    await sendTemplateEmail({ code: 'new_order_manager_alert', to: m.email, vars, orderId: order.id });
  }
}

// =====================================================================
// GET /api/orders/customer/:customerId — היסטוריית הזמנות של לקוח (סעיף 5.4)
// =====================================================================
router.get('/customer/:customerId', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, shabbatot(parasha, hebrew_date, gregorian_date)')
    .eq('customer_id', req.params.customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  res.json(data);
}));

// =====================================================================
// GET /api/orders/:id — הזמנה מלאה עם כל הפריטים
// =====================================================================
router.get('/:id', asyncHandler(async (req, res) => {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, customers(full_name, phone), shabbatot(parasha, hebrew_date, gregorian_date)')
    .eq('id', req.params.id).single();
  if (error) throw error;

  const [slots, meals, extras] = await Promise.all([
    supabase.from('order_meal_slots').select('*, meal_slots(name)').eq('order_id', order.id),
    supabase.from('order_meals').select('*').eq('order_id', order.id),
    supabase.from('order_extras').select('*').eq('order_id', order.id),
  ]);

  res.json({
    ...order,
    slots: slots.data || [],
    meals: meals.data || [],
    extras: extras.data || [],
  });
}));

export default router;
