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

// טוען אירוע + ההזמנה היחידה שלו. מחזיר null (ומשיב 404) אם אינו קיים או שאינו
// אירוע - כדי שלא ניתן יהיה לערוך שבת דרך נתיבי האירועים.
async function loadEvent(res, eventId) {
  const { data: occasion, error } = await supabase
    .from('shabbatot')
    .select('*')
    .eq('id', eventId)
    .eq('kind', 'event')
    .maybeSingle();
  if (error) throw error;
  if (!occasion) { fail(res, 404, 'אירוע לא נמצא.'); return null; }

  const { data: order, error: oErr } = await supabase
    .from('orders')
    .select('*')
    .eq('shabbat_id', eventId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (oErr) throw oErr;
  if (!order) { fail(res, 409, 'לאירוע אין הזמנה משויכת.'); return null; }

  return { occasion, order };
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
// GET / - רשימת אירועים עם סיכום כספי
// ---------------------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const { data: occasions, error } = await supabase
    .from('shabbatot')
    .select('id, title, event_type, event_time, gregorian_date, status, payment_deadline, use_full_workfile, notes')
    .eq('kind', 'event')
    .order('gregorian_date', { ascending: false });
  if (error) throw error;

  const ids = (occasions || []).map((o) => o.id);
  if (ids.length === 0) return res.json([]);

  const [ordersRes, filesRes] = await Promise.all([
    supabase.from('orders')
      .select('id, shabbat_id, order_number, order_status, payment_status, final_amount, venue_name, customers(full_name, phone), order_meal_slots(portions)')
      .in('shabbat_id', ids),
    supabase.from('shabbat_files').select('shabbat_id, is_inventory_deducted').in('shabbat_id', ids),
  ]);
  if (ordersRes.error) throw ordersRes.error;
  if (filesRes.error) throw filesRes.error;

  const orderByEvent = Object.fromEntries((ordersRes.data || []).map((o) => [o.shabbat_id, o]));
  const deductedByEvent = Object.fromEntries(
    (filesRes.data || []).map((f) => [f.shabbat_id, f.is_inventory_deducted]),
  );

  // סך התשלומים לכל הזמנה - מקור האמת ליתרה, בדיוק כמו במודול הכספי.
  const orderIds = (ordersRes.data || []).map((o) => o.id);
  const { data: payments, error: pErr } = orderIds.length
    ? await supabase.from('customer_payments').select('order_id, amount').in('order_id', orderIds)
    : { data: [], error: null };
  if (pErr) throw pErr;

  const paidByOrder = {};
  for (const p of payments || []) {
    paidByOrder[p.order_id] = round2((paidByOrder[p.order_id] || 0) + Number(p.amount || 0));
  }

  res.json((occasions || []).map((occ) => {
    const order = orderByEvent[occ.id] || null;
    const paid = order ? (paidByOrder[order.id] || 0) : 0;
    const finalAmount = round2(Number(order?.final_amount || 0));
    return {
      ...occ,
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
      is_inventory_deducted: !!deductedByEvent[occ.id],
    };
  }));
}));

// ---------------------------------------------------------------------------
// POST / - יצירת אירוע
// ---------------------------------------------------------------------------
// יוצר שלושה רכיבים: מועד, תיק עבודה, והזמנה. אין טרנזקציה בין קריאות Supabase,
// ולכן כישלון אחרי יצירת המועד מנקה אותו במפורש - אחרת היה נשאר אירוע יתום
// בלי הזמנה, שלא ניתן לערוך ולא ניתן למחוק מהממשק.
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const gregorianDate = String(b.gregorian_date || '').trim();
  const eventType = String(b.event_type || '').trim();
  const venueName = String(b.venue_name || '').trim();
  const venueAddress = String(b.venue_address || '').trim();
  const paymentMethod = String(b.preferred_payment_method || '').trim();
  const paymentDeadline = String(b.payment_deadline || '').trim();

  if (!title) return fail(res, 400, 'יש להזין שם לאירוע.');
  if (!isIsoDate(gregorianDate)) return fail(res, 400, 'נא לבחור תאריך תקין.');
  if (!EVENT_TYPES.includes(eventType)) return fail(res, 400, 'יש לבחור סוג אירוע.');
  if (!b.customer_id) return fail(res, 400, 'יש לבחור גורם משלם.');
  if (!venueName) return fail(res, 400, 'יש להזין את מקום האירוע.');
  if (!venueAddress) return fail(res, 400, 'יש להזין את כתובת האירוע.');
  if (!PAYMENT_METHODS.includes(paymentMethod)) return fail(res, 400, 'יש לבחור אמצעי תשלום תקין.');
  if (paymentDeadline && !isIsoDate(paymentDeadline)) return fail(res, 400, 'מועד התשלום אינו תאריך תקין.');

  const { data: payer, error: payerErr } = await supabase
    .from('customers').select('id').eq('id', b.customer_id).maybeSingle();
  if (payerErr) throw payerErr;
  if (!payer) return fail(res, 400, 'הגורם המשלם לא נמצא.');

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

    res.status(201).json({ ok: true, event: occasion, order });
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
    event: occasion,
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
  const { occasion, order } = loaded;
  const b = req.body || {};

  const occasionPatch = {};
  const orderPatch = {};

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
  const { occasion, order } = loaded;

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
