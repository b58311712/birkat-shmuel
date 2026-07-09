// בניית פריטי הזמנה + חישוב סכומים — משותף ליצירה (POST /orders) ולעריכה (PUT /admin/orders/:id)
// כל המחירים מחושבים בשרת מהמחירון הפעיל הנוכחי ונשמרים "קפואים" (סעיף 15.3).
import { supabase } from '../lib/supabase.js';
import { calcBase, suggestExtraQuantity, calcFinal, round2 } from './pricing.js';

const MIN_PORTIONS = 50;
const MAX_PORTIONS = 100;

// מקבל את קלט ההזמנה (slots/meals/extras) ומחזיר את שורות המשנה המוכנות + הסכומים.
// לא נוגע ב-DB של ההזמנה עצמה — רק קורא קטלוג ומחשב. הקורא אחראי על insert/update.
//   input: { slots:[{meal_slot_id,portions}], meals:[{meal_slot_id,meal_id}], extras:[{extra_id,actual_quantity?}], orderId? }
// אם מועבר orderId — נקראים סכומי ההנחות והחיובים הידניים הקיימים ומקופלים ל-final_amount,
// כך שעריכת הזמנה לא מוחקת בטעות הנחות/חיובים שנרשמו בנפרד (סעיף 16).
// זורק Error עם .userMessage כשיש כשל ולידציה (companion-only).
export async function buildOrderItems(input) {
  const slots = Array.isArray(input.slots) ? input.slots : [];
  if (input.enforcePortionRange) {
    const invalidPortions = slots.some((s) => {
      const portions = Number(s.portions);
      return !Number.isInteger(portions) || portions < MIN_PORTIONS || portions > MAX_PORTIONS;
    });
    if (invalidPortions) {
      const err = new Error('invalid-portions-range');
      err.userMessage = `מספר המנות בכל סעודה חייב להיות בין ${MIN_PORTIONS} ל-${MAX_PORTIONS}.`;
      throw err;
    }
  }

  // --- כלל "סעודה שלישית לא לבד" (סעיף 12.2) ---
  const { data: allSlots } = await supabase.from('meal_slots').select('*');
  const chosenSlotIds = slots.map((s) => s.meal_slot_id);
  const companionOnly = (allSlots || []).filter(
    (s) => s.requires_companion && chosenSlotIds.includes(s.id)
  );
  if (companionOnly.length > 0 && chosenSlotIds.length === companionOnly.length) {
    const err = new Error('companion-only');
    err.userMessage = 'לא ניתן לבחור סעודה שלישית לבד. יש לבחור לפחות עוד סעודה אחת.';
    throw err;
  }

  // --- מסלולי מחיר לחישוב בסיס (סעיף 15) ---
  const { data: priceTracks } = await supabase
    .from('price_tracks').select('*').eq('is_active', true);
  const base = calcBase(priceTracks || [], slots);

  // --- מאכלים: snapshot של שם + תוספת מחיר אם דורש (סעיף 13.5) ---
  const mealsInput = Array.isArray(input.meals) ? input.meals : [];
  let mealExtraCharges = 0;
  const mealRows = [];
  if (mealsInput.length > 0) {
    const mealIds = [...new Set(mealsInput.map((m) => m.meal_id))];
    const { data: mealsData } = await supabase
      .from('meals').select('id, name, requires_extra_charge, extra_charge_amount')
      .in('id', mealIds);
    const byId = Object.fromEntries((mealsData || []).map((m) => [m.id, m]));
    for (const m of mealsInput) {
      const meal = byId[m.meal_id];
      if (!meal) continue;
      const charge = meal.requires_extra_charge ? Number(meal.extra_charge_amount || 0) : 0;
      mealExtraCharges += charge;
      mealRows.push({
        meal_slot_id: m.meal_slot_id,
        meal_id: m.meal_id,
        meal_name_snapshot: meal.name,
        extra_charge_amount: charge,
      });
    }
  }

  // --- תוספות: חישוב כמות/מחיר (סעיף 14.4) ---
  const extrasInput = Array.isArray(input.extras) ? input.extras : [];
  let extrasAmount = 0;
  const extraRows = [];
  if (extrasInput.length > 0) {
    const extraIds = [...new Set(extrasInput.map((e) => e.extra_id))];
    const { data: extrasData } = await supabase
      .from('extras').select('*').in('id', extraIds);
    const byId = Object.fromEntries((extrasData || []).map((e) => [e.id, e]));
    const ctx = {
      totalPortions: base.totalPortions,
      portionsPerSlotSum: base.totalPortions,
    };
    for (const e of extrasInput) {
      const extra = byId[e.extra_id];
      if (!extra) continue;
      const suggested = suggestExtraQuantity(extra, ctx);
      const actual = e.actual_quantity != null ? Number(e.actual_quantity) : suggested;
      const lineTotal = round2(actual * Number(extra.unit_price));
      extrasAmount += lineTotal;
      extraRows.push({
        extra_id: extra.id,
        extra_name_snapshot: extra.name,
        suggested_quantity: suggested,
        actual_quantity: actual,
        unit_price: Number(extra.unit_price),
        line_total: lineTotal,
      });
    }
  }

  // --- הנחות וחיובים ידניים קיימים (רק בעריכה, כשיש orderId) — סעיף 16 ---
  let manualCharges = 0;
  let discounts = 0;
  if (input.orderId) {
    const [{ data: mc }, { data: dc }] = await Promise.all([
      supabase.from('order_manual_charges').select('amount').eq('order_id', input.orderId),
      supabase.from('order_discounts').select('discount_amount').eq('order_id', input.orderId),
    ]);
    manualCharges = round2((mc || []).reduce((s, r) => s + Number(r.amount || 0), 0));
    discounts = round2((dc || []).reduce((s, r) => s + Number(r.discount_amount || 0), 0));
  }

  const baseAmount = round2(base.baseAmount + mealExtraCharges);
  const finalAmount = calcFinal({
    baseAmount, extrasAmount: round2(extrasAmount), manualCharges, discounts,
  });

  // שורות סעודות (price_track_id + price_per_portion קפואים)
  const slotRows = slots.map((s) => ({
    meal_slot_id: s.meal_slot_id,
    portions: Number(s.portions),
    price_track_id: base.track ? base.track.id : null,
    price_per_portion: base.pricePerPortion,
  }));

  return {
    slotRows,
    mealRows,
    extraRows,
    amounts: {
      base_amount: baseAmount,
      extras_amount: round2(extrasAmount),
      manual_charges_amount: manualCharges,
      discount_amount: discounts,
      final_amount: finalAmount,
    },
  };
}
