// אירועים: אירוע פנימי של הקהילה ואירוע פרטי חריג של חבר קהילה (מיגרציה 52).
// כל הקריאות מאחורי requireAdmin (נרשם ב-index.js תחת /api/admin/events).
//
// מבנה: אירוע = מועד (shabbatot עם kind='event') + תיק עבודה + הזמנה אחת.
// המשמעות המעשית - כל מה שתלוי ב-shabbat_id עובד לאירוע בלי קוד ייעודי:
//   גבייה     - routes/payments.js לפי order_id (אין כאן שום נתיב תשלום)
//   מלאי      - routes/inventory.js .../shabbat/:id/deduct-auto
//   חוסרים    - services/shabbatFile.js buildInventoryReport
//   רכש       - purchase_orders.shabbat_id
//   כספים     - routes/finance.js שואב מ-orders ומ-customer_payments
//
// ההבדל היחיד מהזמנת שבת הוא התמחור: אירוע מתומחר לפי עלות המוצרים
// (pricing_mode='cost_based', services/costing.js) ולא לפי מסלול מחיר.
//
// שני תרחישים תחת אותו :id (מיגרציה 60, ראו loadEvent):
//   עצמאי  - :id הוא מזהה shabbatot מסוג 'event'. מועד + תיק עבודה + הזמנה
//            נוצרים ביחד, בדיוק כמתואר למעלה.
//   מקושר  - אירוע פרטי שחל בזמן שבת קהילתית קיימת. אין shabbatot/shabbat_files
//            חדשים; ההזמנה מצביעה ישירות על shabbat_id של השבת האמיתית, ונכנסת
//            לאותו תיק עבודה, אותו ניכוי מלאי ואותו מטבח כמו כל הזמנה רגילה
//            שלה. :id הוא כאן מזהה ההזמנה עצמה (shabbat_id משותף עם הזמנות
//            נוספות ולכן אינו מזהה ייחודי לאירוע). שם/שעת האירוע יושבים על
//            ההזמנה (event_title/event_time) ולא על shabbatot המשותף.
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { requireRole } from '../lib/auth.js';
import { priceOrderByCost, inventoryLineUnitCost } from '../services/costing.js';
import { calcFinal, round2 } from '../services/pricing.js';

const router = Router();

const EVENT_TYPES = ['community', 'private'];
const PAYMENT_METHODS = ['bank_transfer', 'cash', 'check'];
const OCCASION_STATUSES = ['open', 'closed', 'completed', 'cancelled'];

const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// ---------------------------------------------------------------------------
// עזרים
// ---------------------------------------------------------------------------

// טוען אירוע + ההזמנה היחידה שלו. מחזיר null (ומשיב 404) אם אינו קיים.
//
// שני תרחישים (ראו הערת הראש): עצמאי - eventId הוא מזהה shabbatot מסוג
// 'event'; מקושר - eventId הוא מזהה ההזמנה עצמה, וה"מועד" שמוחזר הוא השבת
// האמיתית המשותפת (kind='shabbat'). occasion.linked מסמן איזה משני התרחישים.
async function loadEvent(res, eventId) {
  const { data: occasion, error } = await supabase
    .from('shabbatot')
    .select('*')
    .eq('id', eventId)
    .eq('kind', 'event')
    .maybeSingle();
  if (error) throw error;

  if (occasion) {
    const { data: order, error: oErr } = await supabase
      .from('orders')
      .select('*')
      .eq('shabbat_id', eventId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (oErr) throw oErr;
    if (!order) { fail(res, 409, 'לאירוע אין הזמנה משויכת.'); return null; }
    return { occasion, order, linked: false };
  }

  // לא נמצא מועד עצמאי - ננסה כאירוע פרטי מקושר, שבו eventId הוא מזהה ההזמנה.
  const { data: order, error: ordErr } = await supabase
    .from('orders')
    .select('*')
    .eq('id', eventId)
    .eq('pricing_mode', 'cost_based')
    .eq('order_kind', 'occasion')
    .maybeSingle();
  if (ordErr) throw ordErr;
  if (!order) { fail(res, 404, 'אירוע לא נמצא.'); return null; }

  const { data: linkedShabbat, error: lErr } = await supabase
    .from('shabbatot')
    .select('*')
    .eq('id', order.shabbat_id)
    .eq('kind', 'shabbat')
    .maybeSingle();
  if (lErr) throw lErr;
  if (!linkedShabbat) { fail(res, 404, 'אירוע לא נמצא.'); return null; }

  return { occasion: linkedShabbat, order, linked: true };
}

// מזהה ה"אירוע" כפי שהלקוח אמור להשתמש בו בקריאות API הבאות: מזהה shabbatot
// לאירוע עצמאי, מזהה ההזמנה לאירוע מקושר (ראו loadEvent).
function routeId(loaded) {
  return loaded.linked ? loaded.order.id : loaded.occasion.id;
}

// בונה את אובייקט ה"מועד" המנורמל שהלקוח מציג: שם/סוג/שעה מגיעים מ-shabbatot
// לאירוע עצמאי, ומההזמנה עצמה לאירוע מקושר (ששם ה-shabbatot שלו משותף עם
// הזמנות נוספות ולכן לא יכול לשאת אותם).
function normalizedOccasion(loaded) {
  const { occasion, order, linked } = loaded;
  if (!linked) return occasion;
  return {
    ...occasion,
    title: order.event_title,
    event_type: 'private',
    event_time: order.event_time,
    use_full_workfile: true,
    notes: null,
  };
}

// ודא שלשבת קיימת יש תיק עבודה. שבת אמיתית מקבלת תיק עבודה מיד ביצירתה, אך
// זו בדיקת הגנה קלה לפני קישור אירוע פרטי אליה.
async function ensureShabbatFile(shabbatId) {
  const { data: existing, error } = await supabase
    .from('shabbat_files').select('id').eq('shabbat_id', shabbatId).maybeSingle();
  if (error) throw error;
  if (existing) return existing.id;
  const { data: created, error: insErr } = await supabase
    .from('shabbat_files').insert({ shabbat_id: shabbatId }).select('id').single();
  if (insErr) throw insErr;
  return created.id;
}

// מחשב מחדש את כל סכומי ההזמנה של אירוע ושומר אותם.
//
// מחיר הבסיס הוא עלות המאכלים (עלות למנה * מנות). אם המנהל קבע base_amount_override
// הוא גובר - זו "אפשרות התיקון". שורות המלאי מתומחרות לפי unit_cost הקפוא שנשמר
// בשורה ולא מחושבות מחדש (עיקרון המחירים הקפואים, סעיף 15.3).
//
// מחזיר גם את פירוט העלות, כדי שהמסך יציג מאיפה הגיע המחיר ולא רק סכום.
async function recomputeEventAmounts(orderId) {
  const [mealsRes, linesRes, slotsRes, discRes, chargeRes, orderRes] = await Promise.all([
    supabase.from('order_meals').select('meal_id, meal_slot_id, meal_name_snapshot, portions').eq('order_id', orderId),
    supabase.from('order_inventory_lines').select('*').eq('order_id', orderId),
    supabase.from('order_meal_slots').select('meal_slot_id, portions').eq('order_id', orderId),
    supabase.from('order_discounts').select('discount_amount').eq('order_id', orderId),
    supabase.from('order_manual_charges').select('amount').eq('order_id', orderId),
    supabase.from('orders').select('base_amount_override').eq('id', orderId).single(),
  ]);
  for (const r of [mealsRes, linesRes, slotsRes, discRes, chargeRes, orderRes]) {
    if (r.error) throw r.error;
  }

  const slotPortions = Object.fromEntries(
    (slotsRes.data || []).map((s) => [s.meal_slot_id, Number(s.portions || 0)]),
  );
  // מאכל בלי מנות משלו יורש את מנות הסעודה שלו - אותו כלל של תיק השבת.
  const orderMeals = (mealsRes.data || []).map((m) => ({
    ...m,
    portions: m.portions != null ? Number(m.portions) : (slotPortions[m.meal_slot_id] || 0),
  }));

  const costing = await priceOrderByCost({
    orderMeals,
    inventoryLines: linesRes.data || [],
  });

  const override = orderRes.data?.base_amount_override;
  const baseAmount = override != null ? round2(override) : costing.meals_total;
  const discounts = round2((discRes.data || []).reduce((s, d) => s + Number(d.discount_amount || 0), 0));
  const manualCharges = round2((chargeRes.data || []).reduce((s, c) => s + Number(c.amount || 0), 0));

  const finalAmount = calcFinal({
    baseAmount,
    extrasAmount: 0,
    inventoryLines: costing.inventory_lines_total,
    manualCharges,
    discounts,
  });

  const { error: updErr } = await supabase.from('orders').update({
    base_amount: baseAmount,
    extras_amount: 0,
    inventory_lines_amount: costing.inventory_lines_total,
    manual_charges_amount: manualCharges,
    discount_amount: discounts,
    final_amount: finalAmount,
  }).eq('id', orderId);
  if (updErr) throw updErr;

  // עלות למנה קפואה לכל סעודה, לתצוגה בלבד: סכום עלויות המאכלים שבאותה סעודה.
  // מחיר הבסיס עצמו נגזר מהמאכלים ולא מכאן, כי למאכל יכולות להיות מנות משלו.
  const costPerSlot = {};
  for (const m of costing.meal_breakdown) {
    const slot = orderMeals.find((om) => om.meal_id === m.meal_id)?.meal_slot_id;
    if (slot) costPerSlot[slot] = round2((costPerSlot[slot] || 0) + m.cost_per_portion);
  }
  for (const [slotId, perPortion] of Object.entries(costPerSlot)) {
    await supabase.from('order_meal_slots')
      .update({ price_per_portion: perPortion })
      .eq('order_id', orderId).eq('meal_slot_id', slotId);
  }

  return {
    amounts: {
      base_amount: baseAmount,
      inventory_lines_amount: costing.inventory_lines_total,
      manual_charges_amount: manualCharges,
      discount_amount: discounts,
      final_amount: finalAmount,
      base_amount_override: override != null ? round2(override) : null,
      computed_base_amount: costing.meals_total,
    },
    costing,
  };
}

async function logHistory(orderId, action, changes, actorId) {
  await supabase.from('order_history').insert({
    order_id: orderId, action, changes: changes || null, changed_by: actorId || null,
  });
}

// ---------------------------------------------------------------------------
// GET / - רשימת אירועים עם סיכום כספי (עצמאיים + פרטיים מקושרים)
// ---------------------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const [occRes, linkedRes] = await Promise.all([
    supabase.from('shabbatot')
      .select('id, title, event_type, event_time, gregorian_date, status, payment_deadline, use_full_workfile, notes')
      .eq('kind', 'event')
      .order('gregorian_date', { ascending: false }),
    // אירוע פרטי מקושר: הזמנה ששייכת לשבת אמיתית (kind='shabbat') אך מתומחרת
    // כאירוע. shabbatot!inner הופך את ה-join לפנימי כדי שאפשר יהיה לסנן לפיו.
    supabase.from('orders')
      .select(`
        id, shabbat_id, order_number, order_status, payment_status, final_amount,
        venue_name, event_title, event_time,
        customers(full_name, phone), order_meal_slots(portions),
        shabbatot!inner(gregorian_date, status, payment_deadline, kind)
      `)
      .eq('pricing_mode', 'cost_based')
      .eq('order_kind', 'occasion')
      .eq('shabbatot.kind', 'shabbat')
      .order('created_at', { ascending: false }),
  ]);
  if (occRes.error) throw occRes.error;
  if (linkedRes.error) throw linkedRes.error;

  const occasions = occRes.data || [];
  const linkedOrders = linkedRes.data || [];
  if (occasions.length === 0 && linkedOrders.length === 0) return res.json([]);

  const occasionIds = occasions.map((o) => o.id);
  const [ordersRes, filesRes] = await Promise.all([
    occasionIds.length
      ? supabase.from('orders')
        .select('id, shabbat_id, order_number, order_status, payment_status, final_amount, venue_name, customers(full_name, phone), order_meal_slots(portions)')
        .in('shabbat_id', occasionIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('shabbat_files').select('shabbat_id, is_inventory_deducted')
      .in('shabbat_id', [...new Set([...occasionIds, ...linkedOrders.map((o) => o.shabbat_id)])]),
  ]);
  if (ordersRes.error) throw ordersRes.error;
  if (filesRes.error) throw filesRes.error;

  const orderByEvent = Object.fromEntries((ordersRes.data || []).map((o) => [o.shabbat_id, o]));
  const deductedByShabbat = Object.fromEntries(
    (filesRes.data || []).map((f) => [f.shabbat_id, f.is_inventory_deducted]),
  );

  // סך התשלומים לכל הזמנה - מקור האמת ליתרה, בדיוק כמו במודול הכספי.
  const orderIds = [...(ordersRes.data || []).map((o) => o.id), ...linkedOrders.map((o) => o.id)];
  const { data: payments, error: pErr } = orderIds.length
    ? await supabase.from('customer_payments').select('order_id, amount').in('order_id', orderIds)
    : { data: [], error: null };
  if (pErr) throw pErr;

  const paidByOrder = {};
  for (const p of payments || []) {
    paidByOrder[p.order_id] = round2((paidByOrder[p.order_id] || 0) + Number(p.amount || 0));
  }

  const standaloneRows = occasions.map((occ) => {
    const order = orderByEvent[occ.id] || null;
    const paid = order ? (paidByOrder[order.id] || 0) : 0;
    const finalAmount = round2(Number(order?.final_amount || 0));
    return {
      ...occ,
      id: occ.id,
      linked: false,
      order_id: order?.id || null,
      order_number: order?.order_number || null,
      order_status: order?.order_status || null,
      payment_status: order?.payment_status || null,
      payer_name: order?.customers?.full_name || null,
      payer_phone: order?.customers?.phone || null,
      venue_name: order?.venue_name || null,
      portions: (order?.order_meal_slots || []).reduce((s, ms) => s + Number(ms.portions || 0), 0),
      final_amount: finalAmount,
      paid_amount: paid,
      balance: round2(finalAmount - paid),
      is_inventory_deducted: !!deductedByShabbat[occ.id],
    };
  });

  const linkedRows = linkedOrders.map((order) => {
    const paid = paidByOrder[order.id] || 0;
    const finalAmount = round2(Number(order.final_amount || 0));
    return {
      id: order.id,
      linked: true,
      title: order.event_title,
      event_type: 'private',
      event_time: order.event_time,
      gregorian_date: order.shabbatot?.gregorian_date || null,
      status: order.shabbatot?.status || null,
      payment_deadline: order.shabbatot?.payment_deadline || null,
      use_full_workfile: true,
      notes: null,
      order_id: order.id,
      order_number: order.order_number,
      order_status: order.order_status,
      payment_status: order.payment_status,
      payer_name: order.customers?.full_name || null,
      payer_phone: order.customers?.phone || null,
      venue_name: order.venue_name || null,
      portions: (order.order_meal_slots || []).reduce((s, ms) => s + Number(ms.portions || 0), 0),
      final_amount: finalAmount,
      paid_amount: paid,
      balance: round2(finalAmount - paid),
      is_inventory_deducted: !!deductedByShabbat[order.shabbat_id],
    };
  });

  res.json(
    [...standaloneRows, ...linkedRows]
      .sort((a, b) => String(b.gregorian_date || '').localeCompare(String(a.gregorian_date || ''))),
  );
}));

// ---------------------------------------------------------------------------
// POST / - יצירת אירוע (עצמאי, או פרטי מקושר לשבת קיימת - מיגרציה 60)
// ---------------------------------------------------------------------------
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const gregorianDate = String(b.gregorian_date || '').trim();
  const eventType = String(b.event_type || '').trim();
  const venueName = String(b.venue_name || '').trim();
  const venueAddress = String(b.venue_address || '').trim();
  const paymentMethod = String(b.preferred_payment_method || '').trim();
  const paymentDeadline = String(b.payment_deadline || '').trim();
  const linkShabbatId = String(b.link_to_shabbat_id || '').trim() || null;

  if (!title) return fail(res, 400, 'יש להזין שם לאירוע.');
  if (!EVENT_TYPES.includes(eventType)) return fail(res, 400, 'יש לבחור סוג אירוע.');
  if (linkShabbatId && eventType !== 'private') {
    return fail(res, 400, 'ניתן לקשר לשבת קיימת רק אירוע פרטי.');
  }
  if (!linkShabbatId && !isIsoDate(gregorianDate)) return fail(res, 400, 'נא לבחור תאריך תקין.');
  if (!b.customer_id) return fail(res, 400, 'יש לבחור גורם משלם.');
  if (!venueName) return fail(res, 400, 'יש להזין את מקום האירוע.');
  if (!venueAddress) return fail(res, 400, 'יש להזין את כתובת האירוע.');
  if (!PAYMENT_METHODS.includes(paymentMethod)) return fail(res, 400, 'יש לבחור אמצעי תשלום תקין.');
  if (!linkShabbatId && paymentDeadline && !isIsoDate(paymentDeadline)) {
    return fail(res, 400, 'מועד התשלום אינו תאריך תקין.');
  }

  const { data: payer, error: payerErr } = await supabase
    .from('customers').select('id').eq('id', b.customer_id).maybeSingle();
  if (payerErr) throw payerErr;
  if (!payer) return fail(res, 400, 'הגורם המשלם לא נמצא.');

  // -------------------------------------------------------------------
  // תרחיש מקושר: בלי מועד/תיק עבודה חדשים, רק הזמנה על השבת הקיימת.
  // -------------------------------------------------------------------
  if (linkShabbatId) {
    const { data: linkedShabbat, error: shErr } = await supabase
      .from('shabbatot').select('id').eq('id', linkShabbatId).eq('kind', 'shabbat').maybeSingle();
    if (shErr) throw shErr;
    if (!linkedShabbat) return fail(res, 400, 'השבת שנבחרה לקישור לא נמצאה.');

    await ensureShabbatFile(linkedShabbat.id);

    const year = new Date().getFullYear();
    const { data: orderNumber, error: numErr } = await supabase
      .rpc('allocate_order_number', { p_year: year });
    if (numErr) throw numErr;

    const { data: order, error: ordErr } = await supabase.from('orders').insert({
      order_number: orderNumber,
      customer_id: b.customer_id,
      shabbat_id: linkedShabbat.id,
      order_status: 'approved',
      payment_status: 'unpaid',
      pricing_mode: 'cost_based',
      event_title: title,
      event_time: String(b.event_time || '').trim() || null,
      notes: String(b.notes || '').trim() || null,
      delivery_method: b.delivery_method || 'self_pickup',
      venue_name: venueName,
      venue_address: venueAddress,
      contact_name: String(b.contact_name || '').trim() || null,
      contact_phone: String(b.contact_phone || '').trim() || null,
      preferred_payment_method: paymentMethod,
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

    await logHistory(order.id, `נוצר אירוע פרטי מקושר: ${title}`, { shabbat_id: linkedShabbat.id }, req.appUser?.sub);

    return res.status(201).json({ ok: true, id: order.id, order });
  }

  // -------------------------------------------------------------------
  // תרחיש עצמאי: מועד + תיק עבודה + הזמנה, שלושתם חדשים. אין טרנזקציה בין
  // קריאות Supabase, ולכן כישלון אחרי יצירת המועד מנקה אותו במפורש - אחרת
  // היה נשאר אירוע יתום בלי הזמנה, שלא ניתן לערוך ולא ניתן למחוק מהממשק.
  // -------------------------------------------------------------------
  const { data: occasion, error: occErr } = await supabase.from('shabbatot').insert({
    kind: 'event',
    title,
    event_type: eventType,
    event_time: String(b.event_time || '').trim() || null,
    gregorian_date: gregorianDate,
    status: 'open',
    payment_deadline: paymentDeadline || null,
    use_full_workfile: false,
    notes: String(b.notes || '').trim() || null,
  }).select('*').single();
  if (occErr) throw occErr;

  try {
    const { error: fileErr } = await supabase
      .from('shabbat_files').insert({ shabbat_id: occasion.id });
    if (fileErr) throw fileErr;

    const year = new Date(gregorianDate).getFullYear();
    const { data: orderNumber, error: numErr } = await supabase
      .rpc('allocate_order_number', { p_year: year });
    if (numErr) throw numErr;

    // ההזמנה נוצרת מאושרת: אירוע נרשם במשרד ביוזמת המנהל, ואין כאן שלב אישור
    // כמו בהזמנה שהלקוח שלח. הכניסה לחישובים התפעוליים עדיין מותנית בתשלום
    // (כלל 8.7), ולכן ניכוי המלאי ידרוש תיעוד תשלום או אישור חריגה.
    const { data: order, error: ordErr } = await supabase.from('orders').insert({
      order_number: orderNumber,
      customer_id: b.customer_id,
      shabbat_id: occasion.id,
      order_status: 'approved',
      payment_status: 'unpaid',
      pricing_mode: 'cost_based',
      delivery_method: b.delivery_method || 'self_pickup',
      venue_name: venueName,
      venue_address: venueAddress,
      contact_name: String(b.contact_name || '').trim() || null,
      contact_phone: String(b.contact_phone || '').trim() || null,
      preferred_payment_method: paymentMethod,
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

    await logHistory(order.id, `נוצר אירוע: ${title}`, { event_type: eventType, gregorian_date: gregorianDate }, req.appUser?.sub);

    res.status(201).json({ ok: true, id: occasion.id, event: occasion, order });
  } catch (e) {
    // ניקוי: תיק ומועד. ההזמנה לא נוצרה (או שהיצירה שלה היא שנכשלה).
    await supabase.from('shabbat_files').delete().eq('shabbat_id', occasion.id);
    await supabase.from('shabbatot').delete().eq('id', occasion.id);
    throw e;
  }
}));

// ---------------------------------------------------------------------------
// GET /:id - אירוע מלא
// ---------------------------------------------------------------------------
router.get('/:id', asyncHandler(async (req, res) => {
  const loaded = await loadEvent(res, req.params.id);
  if (!loaded) return;
  const { occasion, order } = loaded;

  const [mealsRes, linesRes, slotsRes, payRes, fileRes, custRes] = await Promise.all([
    // occasion.id הוא תמיד השבת/מועד האמיתי (ראו loadEvent), ולכן shabbat_files
    // נשלף נכון גם לאירוע פרטי מקושר - זה בדיוק תיק העבודה שהוא משתתף בו.
    supabase.from('order_meals')
      .select('*, meals(name, category_id)')
      .eq('order_id', order.id),
    supabase.from('order_inventory_lines')
      .select('*, inventory_items(name, unit, unit_id), units(name)')
      .eq('order_id', order.id),
    supabase.from('order_meal_slots')
      .select('*, meal_slots(name)')
      .eq('order_id', order.id),
    supabase.from('customer_payments').select('*').eq('order_id', order.id).order('paid_at'),
    supabase.from('shabbat_files').select('*').eq('shabbat_id', occasion.id).maybeSingle(),
    supabase.from('customers').select('id, full_name, phone, email, is_organization').eq('id', order.customer_id).maybeSingle(),
  ]);
  for (const r of [mealsRes, linesRes, slotsRes, payRes, fileRes, custRes]) {
    if (r.error) throw r.error;
  }

  // הפירוט מחושב בכל טעינה כדי להציג את העלות העדכנית לצד הסכום השמור. הפער
  // ביניהם הוא בדיוק מה שמצדיק את כפתור "חשב מחיר מחדש".
  const slotPortions = Object.fromEntries(
    (slotsRes.data || []).map((s) => [s.meal_slot_id, Number(s.portions || 0)]),
  );
  const costing = await priceOrderByCost({
    orderMeals: (mealsRes.data || []).map((m) => ({
      ...m,
      portions: m.portions != null ? Number(m.portions) : (slotPortions[m.meal_slot_id] || 0),
    })),
    inventoryLines: linesRes.data || [],
  });

  const paid = round2((payRes.data || []).reduce((s, p) => s + Number(p.amount || 0), 0));

  res.json({
    id: routeId(loaded),
    linked: loaded.linked,
    event: normalizedOccasion(loaded),
    order,
    payer: custRes.data || null,
    slots: slotsRes.data || [],
    meals: mealsRes.data || [],
    inventory_lines: linesRes.data || [],
    payments: payRes.data || [],
    shabbat_file: fileRes.data || null,
    costing,
    summary: {
      final: round2(Number(order.final_amount || 0)),
      paid,
      balance: round2(Number(order.final_amount || 0) - paid),
      payment_status: order.payment_status,
    },
  });
}));

// ---------------------------------------------------------------------------
// PATCH /:id - עדכון פרטי האירוע
// ---------------------------------------------------------------------------
router.patch('/:id', asyncHandler(async (req, res) => {
  const loaded = await loadEvent(res, req.params.id);
  if (!loaded) return;
  const { occasion, order, linked } = loaded;
  const b = req.body || {};

  const occasionPatch = {};
  const orderPatch = {};

  if (linked) {
    // אירוע פרטי מקושר: שם/שעה/הערות יושבים על ההזמנה (ראו מיגרציה 60). תאריך,
    // סוג, סטטוס ומועד תשלום שייכים לשבת המשותפת ואינם ניתנים לעריכה מכאן -
    // עריכתם דרך תיק השבת הייתה משפיעה על כל שאר ההזמנות של אותה שבת.
    if (b.title !== undefined) {
      const title = String(b.title).trim();
      if (!title) return fail(res, 400, 'שם האירוע אינו יכול להיות ריק.');
      orderPatch.event_title = title;
    }
    if (b.event_time !== undefined) orderPatch.event_time = String(b.event_time || '').trim() || null;
    if (b.notes !== undefined) orderPatch.notes = String(b.notes || '').trim() || null;
  } else {
    if (b.title !== undefined) {
      const title = String(b.title).trim();
      if (!title) return fail(res, 400, 'שם האירוע אינו יכול להיות ריק.');
      occasionPatch.title = title;
    }
    if (b.gregorian_date !== undefined) {
      if (!isIsoDate(b.gregorian_date)) return fail(res, 400, 'נא לבחור תאריך תקין.');
      occasionPatch.gregorian_date = b.gregorian_date;
    }
    if (b.event_type !== undefined) {
      if (!EVENT_TYPES.includes(b.event_type)) return fail(res, 400, 'סוג אירוע לא תקין.');
      occasionPatch.event_type = b.event_type;
    }
    if (b.event_time !== undefined) occasionPatch.event_time = String(b.event_time || '').trim() || null;
    if (b.status !== undefined) {
      if (!OCCASION_STATUSES.includes(b.status)) return fail(res, 400, 'סטטוס לא תקין.');
      occasionPatch.status = b.status;
    }
    if (b.payment_deadline !== undefined) {
      const d = String(b.payment_deadline || '').trim();
      if (d && !isIsoDate(d)) return fail(res, 400, 'מועד התשלום אינו תאריך תקין.');
      occasionPatch.payment_deadline = d || null;
    }
    if (b.notes !== undefined) occasionPatch.notes = String(b.notes || '').trim() || null;
  }

  if (b.customer_id !== undefined) {
    if (!b.customer_id) return fail(res, 400, 'יש לבחור גורם משלם.');
    orderPatch.customer_id = b.customer_id;
  }
  if (b.venue_name !== undefined) {
    const v = String(b.venue_name).trim();
    if (!v) return fail(res, 400, 'יש להזין את מקום האירוע.');
    orderPatch.venue_name = v;
  }
  if (b.venue_address !== undefined) {
    const v = String(b.venue_address).trim();
    if (!v) return fail(res, 400, 'יש להזין את כתובת האירוע.');
    orderPatch.venue_address = v;
  }
  if (b.contact_name !== undefined) orderPatch.contact_name = String(b.contact_name || '').trim() || null;
  if (b.contact_phone !== undefined) orderPatch.contact_phone = String(b.contact_phone || '').trim() || null;
  if (b.delivery_method !== undefined) orderPatch.delivery_method = b.delivery_method;
  if (b.preferred_payment_method !== undefined) {
    if (!PAYMENT_METHODS.includes(b.preferred_payment_method)) return fail(res, 400, 'אמצעי תשלום לא תקין.');
    orderPatch.preferred_payment_method = b.preferred_payment_method;
  }
  if (b.order_status !== undefined) orderPatch.order_status = b.order_status;

  if (Object.keys(occasionPatch).length) {
    const { error } = await supabase.from('shabbatot').update(occasionPatch).eq('id', occasion.id);
    if (error) throw error;
  }
  if (Object.keys(orderPatch).length) {
    const { error } = await supabase.from('orders').update(orderPatch).eq('id', order.id);
    if (error) throw error;
    await logHistory(order.id, 'עודכנו פרטי האירוע', orderPatch, req.appUser?.sub);
  }

  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// POST /:id/link-to-shabbat - קישור אירוע עצמאי קיים לשבת קיימת (מיגרציה 60)
// ---------------------------------------------------------------------------
// הופך אירוע עצמאי (עם מועד+תיק עבודה משלו) לאירוע פרטי מקושר: ההזמנה עוברת
// להצביע על shabbat_id של השבת הנבחרת, והמועד/תיק העבודה העצמאיים נמחקים.
// התפריט, התמחור והתשלומים נשארים כמות שהם - הם תלויים ב-order_id ולא נוגעים
// בשינוי. חסום אחרי ניכוי מלאי: התנועות כבר נרשמו על shabbat_id הישן, וניוד
// ההזמנה אחריו לא היה מתקן אותן (deduct_shabbat_inventory הוא RPC ברמת שבת).
router.post('/:id/link-to-shabbat', asyncHandler(async (req, res) => {
  const loaded = await loadEvent(res, req.params.id);
  if (!loaded) return;
  const { occasion, order, linked } = loaded;

  if (linked) return fail(res, 400, 'האירוע כבר מקושר לשבת.');
  if (occasion.event_type !== 'private') {
    return fail(res, 400, 'ניתן לקשר לשבת קיימת רק אירוע פרטי.');
  }

  const { data: file, error: fileErr } = await supabase
    .from('shabbat_files').select('is_inventory_deducted').eq('shabbat_id', occasion.id).maybeSingle();
  if (fileErr) throw fileErr;
  if (file?.is_inventory_deducted) {
    return fail(res, 400, 'לא ניתן לקשר אירוע שהמלאי שלו כבר נוכה. יש לפנות לתמיכה.');
  }

  const targetShabbatId = String(req.body?.shabbat_id || '').trim();
  if (!targetShabbatId) return fail(res, 400, 'יש לבחור שבת לקישור.');

  const { data: targetShabbat, error: shErr } = await supabase
    .from('shabbatot').select('id').eq('id', targetShabbatId).eq('kind', 'shabbat').maybeSingle();
  if (shErr) throw shErr;
  if (!targetShabbat) return fail(res, 400, 'השבת שנבחרה לקישור לא נמצאה.');

  await ensureShabbatFile(targetShabbat.id);

  const { error: updErr } = await supabase.from('orders').update({
    shabbat_id: targetShabbat.id,
    event_title: occasion.title,
    event_time: occasion.event_time,
    notes: occasion.notes,
  }).eq('id', order.id);
  if (updErr) throw updErr;

  // המועד ותיק העבודה העצמאיים התייתמו - ההזמנה כבר לא מצביעה עליהם.
  const { error: delFileErr } = await supabase.from('shabbat_files').delete().eq('shabbat_id', occasion.id);
  if (delFileErr) throw delFileErr;
  const { error: delOccErr } = await supabase.from('shabbatot').delete().eq('id', occasion.id);
  if (delOccErr) throw delOccErr;

  await logHistory(order.id, 'האירוע קושר לשבת קיימת', { shabbat_id: targetShabbat.id }, req.appUser?.sub);

  res.json({ ok: true, id: order.id });
}));

// ---------------------------------------------------------------------------
// PUT /:id/menu - החלפת התפריט המלא
// ---------------------------------------------------------------------------
// החלפה מלאה ולא עדכון הפרשי: הממשק שולח את התפריט כפי שהוא אחרי העריכה.
// זה פשוט יותר מלנהל הוספות/מחיקות, ובטוח כי אין כאן היסטוריה ברמת השורה.
router.put('/:id/menu', asyncHandler(async (req, res) => {
  const loaded = await loadEvent(res, req.params.id);
  if (!loaded) return;
  const { order } = loaded;
  const b = req.body || {};

  const slots = Array.isArray(b.slots) ? b.slots : [];
  const meals = Array.isArray(b.meals) ? b.meals : [];
  const lines = Array.isArray(b.inventory_lines) ? b.inventory_lines : [];

  if (slots.length === 0 && lines.length === 0) {
    return fail(res, 400, 'יש לבחור לפחות סעודה אחת או שורת מלאי אחת.');
  }
  for (const s of slots) {
    if (!s.meal_slot_id) return fail(res, 400, 'חסרה סעודה.');
    if (!(Number(s.portions) > 0)) return fail(res, 400, 'מספר המנות חייב להיות גדול מאפס.');
  }

  // --- שמות snapshot ועלויות לשורות המלאי ---
  const itemIds = [...new Set(lines.map((l) => l.inventory_item_id).filter(Boolean))];
  if (itemIds.length !== lines.length) {
    return fail(res, 400, 'יש לבחור פריט מלאי בכל שורה.');
  }
  const { data: items, error: itemsErr } = itemIds.length
    ? await supabase.from('inventory_items').select('id, name, unit_id').in('id', itemIds)
    : { data: [], error: null };
  if (itemsErr) throw itemsErr;
  const itemById = Object.fromEntries((items || []).map((i) => [i.id, i]));

  const lineRows = [];
  for (const l of lines) {
    const item = itemById[l.inventory_item_id];
    if (!item) return fail(res, 400, 'פריט מלאי לא נמצא.');
    const quantity = Number(l.quantity);
    if (!(quantity > 0)) return fail(res, 400, `כמות לא תקינה בשורה "${item.name}".`);

    // יחידת ההזנה חייבת להיות מוגדרת, אחרת ההמרה ליחידת הבסיס תיכשל בניכוי
    // המלאי. ברירת המחדל היא יחידת הבסיס של הפריט (פקטור 1).
    const unitId = l.unit_id || item.unit_id || null;

    // עלות: מה שהממשק שלח, ואם לא נשלחה - נגזרת מהמחיר האחרון של הפריט.
    let unitCost = Number(l.unit_cost);
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      const derived = await inventoryLineUnitCost(item.id, unitId);
      unitCost = derived.unit_cost ?? 0;
    }

    lineRows.push({
      order_id: order.id,
      inventory_item_id: item.id,
      item_name_snapshot: item.name,
      quantity,
      unit_id: unitId,
      unit_cost: round2(unitCost),
      line_total: round2(quantity * unitCost),
      note: String(l.note || '').trim() || null,
    });
  }

  // --- שמות snapshot למאכלים ---
  const mealIds = [...new Set(meals.map((m) => m.meal_id).filter(Boolean))];
  const { data: mealRecords, error: mealsErr } = mealIds.length
    ? await supabase.from('meals').select('id, name').in('id', mealIds)
    : { data: [], error: null };
  if (mealsErr) throw mealsErr;
  const mealById = Object.fromEntries((mealRecords || []).map((m) => [m.id, m]));

  const slotPortions = Object.fromEntries(slots.map((s) => [s.meal_slot_id, Number(s.portions)]));
  const mealRows = [];
  for (const m of meals) {
    const meal = mealById[m.meal_id];
    if (!meal) return fail(res, 400, 'מאכל לא נמצא.');
    if (!slotPortions[m.meal_slot_id]) {
      return fail(res, 400, `המאכל "${meal.name}" משויך לסעודה שאינה באירוע.`);
    }
    mealRows.push({
      order_id: order.id,
      meal_slot_id: m.meal_slot_id,
      meal_id: m.meal_id,
      meal_name_snapshot: meal.name,
      // מנות פר-מאכל: ברירת המחדל היא מנות הסעודה. חורג רק כשהמנהל קבע אחרת
      // (למשל מאכל שמוגש לחלק מהמוזמנים).
      portions: m.portions != null && Number(m.portions) > 0
        ? Number(m.portions)
        : slotPortions[m.meal_slot_id],
      extra_charge_amount: 0,
    });
  }

  // --- החלפה ---
  const cleanup = await Promise.all([
    supabase.from('order_meals').delete().eq('order_id', order.id),
    supabase.from('order_inventory_lines').delete().eq('order_id', order.id),
    supabase.from('order_meal_slots').delete().eq('order_id', order.id),
  ]);
  const cleanupErr = cleanup.find((r) => r.error)?.error;
  if (cleanupErr) throw cleanupErr;

  if (slots.length) {
    const { error } = await supabase.from('order_meal_slots').insert(
      slots.map((s) => ({
        order_id: order.id,
        meal_slot_id: s.meal_slot_id,
        portions: Number(s.portions),
        price_track_id: null,   // אירוע אינו מתומחר לפי מסלול
        price_per_portion: 0,   // נכתב מחדש ב-recomputeEventAmounts
      })),
    );
    if (error) throw error;
  }
  if (mealRows.length) {
    const { error } = await supabase.from('order_meals').insert(mealRows);
    if (error) throw error;
  }
  if (lineRows.length) {
    const { error } = await supabase.from('order_inventory_lines').insert(lineRows);
    if (error) throw error;
  }

  const result = await recomputeEventAmounts(order.id);
  await logHistory(order.id, 'עודכן תפריט האירוע', {
    slots: slots.length, meals: mealRows.length, inventory_lines: lineRows.length,
    final_amount: result.amounts.final_amount,
  }, req.appUser?.sub);

  res.json({ ok: true, ...result });
}));

// ---------------------------------------------------------------------------
// PATCH /:id/pricing - תיקון ידני של מחיר הבסיס
// ---------------------------------------------------------------------------
// base_amount_override = null מחזיר לתמחור לפי העלות המחושבת.
router.patch('/:id/pricing', asyncHandler(async (req, res) => {
  const loaded = await loadEvent(res, req.params.id);
  if (!loaded) return;
  const { order } = loaded;

  const raw = req.body?.base_amount_override;
  let override = null;
  if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
    override = Number(raw);
    if (!Number.isFinite(override) || override < 0) {
      return fail(res, 400, 'מחיר הבסיס חייב להיות מספר אי-שלילי.');
    }
    override = round2(override);
  }

  const { error } = await supabase.from('orders')
    .update({ base_amount_override: override }).eq('id', order.id);
  if (error) throw error;

  const result = await recomputeEventAmounts(order.id);
  await logHistory(order.id,
    override == null ? 'בוטל תיקון מחיר הבסיס' : `תוקן מחיר הבסיס ל-${override}`,
    { base_amount_override: override, final_amount: result.amounts.final_amount },
    req.appUser?.sub);

  res.json({ ok: true, ...result });
}));

// ---------------------------------------------------------------------------
// POST /:id/recalc-price - חישוב מחדש לפי המחירים העדכניים
// ---------------------------------------------------------------------------
router.post('/:id/recalc-price', asyncHandler(async (req, res) => {
  const loaded = await loadEvent(res, req.params.id);
  if (!loaded) return;
  const result = await recomputeEventAmounts(loaded.order.id);
  await logHistory(loaded.order.id, 'חושב מחיר האירוע מחדש',
    { final_amount: result.amounts.final_amount }, req.appUser?.sub);
  res.json({ ok: true, ...result });
}));

// ---------------------------------------------------------------------------
// POST /:id/promote - הפיכת האירוע לתיק עבודה מלא
// ---------------------------------------------------------------------------
// מתג תצוגה בלבד. תיק העבודה קיים מרגע יצירת האירוע, וכל הנתונים כבר במקומם;
// מכאן והלאה האירוע מופיע גם ברשימת תיקי השבת עם כל הלשוניות.
router.post('/:id/promote', asyncHandler(async (req, res) => {
  const loaded = await loadEvent(res, req.params.id);
  if (!loaded) return;

  // אירוע פרטי מקושר יושב כבר על תיק עבודה מלא (השבת האמיתית) - אין מה לקדם.
  if (loaded.linked) {
    return res.json({ ok: true, shabbat_file_path: `/admin/shabbat/${loaded.occasion.id}` });
  }

  const { error } = await supabase.from('shabbatot')
    .update({ use_full_workfile: true }).eq('id', loaded.occasion.id);
  if (error) throw error;

  await logHistory(loaded.order.id, 'האירוע קודם לתיק עבודה מלא', null, req.appUser?.sub);
  res.json({ ok: true, shabbat_file_path: `/admin/shabbat/${loaded.occasion.id}` });
}));

// ---------------------------------------------------------------------------
// DELETE /:id - מחיקת אירוע (developer בלבד, כמו מחיקת תיק שבת)
// ---------------------------------------------------------------------------
router.delete('/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const loaded = await loadEvent(res, req.params.id);
  if (!loaded) return;
  const { occasion, order, linked } = loaded;

  // אירוע פרטי מקושר: מוחקים רק את ההזמנה ואת מה שתלוי בה. shabbat_files
  // ו-shabbatot שייכים לשבת האמיתית המשותפת עם הזמנות נוספות ואסור לגעת בהם -
  // וכך גם inventory_movements, שהם תנועות מצטברות של כל השבת ולא של הזמנה
  // בודדת (ראו deduct_shabbat_inventory).
  if (linked) {
    const cleanup = await Promise.all([
      supabase.from('customer_payments').delete().eq('order_id', order.id),
      supabase.from('order_refunds').delete().eq('order_id', order.id),
    ]);
    const cleanupErr = cleanup.find((r) => r.error)?.error;
    if (cleanupErr) throw cleanupErr;

    const { error } = await supabase.from('orders').delete().eq('id', order.id);
    if (error) throw error;

    return res.json({ ok: true });
  }

  // פריטי ההזמנה יורדים ב-cascade; מה שאינו cascade נמחק כאן במפורש.
  const cleanup = await Promise.all([
    supabase.from('customer_payments').delete().eq('order_id', order.id),
    supabase.from('order_refunds').delete().eq('order_id', order.id),
    supabase.from('inventory_movements').delete().eq('shabbat_id', occasion.id),
  ]);
  const cleanupErr = cleanup.find((r) => r.error)?.error;
  if (cleanupErr) throw cleanupErr;

  const del = await Promise.all([
    supabase.from('orders').delete().eq('id', order.id),
    supabase.from('shabbat_files').delete().eq('shabbat_id', occasion.id),
  ]);
  const delErr = del.find((r) => r.error)?.error;
  if (delErr) throw delErr;

  const { error } = await supabase.from('shabbatot').delete().eq('id', occasion.id);
  if (error) throw error;

  res.json({ ok: true });
}));

export default router;
