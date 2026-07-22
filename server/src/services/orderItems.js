// בניית פריטי הזמנה + חישוב סכומים — משותף ליצירה (POST /orders) ולעריכה (PUT /admin/orders/:id)
// כל המחירים מחושבים בשרת מהמחירון הפעיל הנוכחי ונשמרים "קפואים" (סעיף 15.3).
import { supabase } from '../lib/supabase.js';
import { calcBase, suggestExtraQuantity, calcFinal, round2 } from './pricing.js';
import { fetchSlotSplits, percentFor } from './categorySplits.js';
import { roundUp } from '../lib/helpers.js';

// טווח המנות הסטנדרטי לסעודה. כמות מחוץ לטווח מותרת רק כ"בקשת חריג" (סעיף 12.2)
// הדורשת אישור מודע של מנהל. אין תקרה/רצפה קשיחה — כל כמות חיובית שלמה מותרת בחריג.
const MIN_PORTIONS = 50;
const MAX_PORTIONS = 100;

// בודק אילו סעודות חורגות מהטווח הסטנדרטי (50–100) ומחזיר תיאור לבקשת חריג.
// שם הסעודה מגיע מ-slotNameById (מפה slotId->name) כשקיים, אחרת "סעודה".
function detectPortionsException(slots, slotNameById = {}) {
  const outOfRange = slots
    .map((s) => ({ id: s.meal_slot_id, portions: Number(s.portions) }))
    .filter((s) => s.portions < MIN_PORTIONS || s.portions > MAX_PORTIONS);
  if (outOfRange.length === 0) return { requested: false, note: null };
  const note = outOfRange
    .map((s) => `${slotNameById[s.id] || 'סעודה'}: ${s.portions} מנות (חריג — מחוץ לטווח ${MIN_PORTIONS}–${MAX_PORTIONS})`)
    .join('; ');
  return { requested: true, note };
}

// מקבל את קלט ההזמנה (slots/meals/extras) ומחזיר את שורות המשנה המוכנות + הסכומים.
// לא נוגע ב-DB של ההזמנה עצמה — רק קורא קטלוג ומחשב. הקורא אחראי על insert/update.
//   input: { slots:[{meal_slot_id,portions}], meals:[{meal_slot_id,meal_id}], extras:[{extra_id,actual_quantity?}], orderId? }
// אם מועבר orderId — נקראים סכומי ההנחות והחיובים הידניים הקיימים ומקופלים ל-final_amount,
// כך שעריכת הזמנה לא מוחקת בטעות הנחות/חיובים שנרשמו בנפרד (סעיף 16).
// מחזיר גם exception:{ requested, note } — סימון בקשת כמות חריגה (מחוץ ל-50–100).
// זורק Error עם .userMessage כשיש כשל ולידציה (מנות לא חיוביות / companion-only).
export async function buildOrderItems(input) {
  const slots = Array.isArray(input.slots) ? input.slots : [];

  // מנות חייבות להיות מספר שלם חיובי בכל מצב (גם בחריג). התקרה/רצפה של 50–100 אינה קשיחה.
  const nonPositive = slots.some((s) => {
    const portions = Number(s.portions);
    return !Number.isInteger(portions) || portions <= 0;
  });
  if (nonPositive) {
    const err = new Error('invalid-portions');
    err.userMessage = 'מספר המנות בכל סעודה חייב להיות מספר שלם חיובי.';
    throw err;
  }

  // --- כלל "סעודה שלישית לא לבד" (סעיף 12.2) ---
  const { data: allSlots } = await supabase.from('meal_slots').select('*');
  const slotNameById = Object.fromEntries((allSlots || []).map((s) => [s.id, s.name]));
  const exception = detectPortionsException(slots, slotNameById);
  const chosenSlotIds = slots.map((s) => s.meal_slot_id);
  const companionOnly = (allSlots || []).filter(
    (s) => s.requires_companion && chosenSlotIds.includes(s.id)
  );
  if (companionOnly.length > 0 && chosenSlotIds.length === companionOnly.length) {
    const err = new Error('companion-only');
    err.userMessage = 'לא ניתן לבחור סעודה שלישית לבד. יש לבחור לפחות עוד סעודה אחת.';
    throw err;
  }

  // --- מסלולי מחיר לחישוב בסיס לפי צירוף הסעודות המדויק (סעיף 15) ---
  const { data: priceTracks } = await supabase
    .from('price_tracks').select('*').eq('is_active', true);
  const { data: trackSlots } = await supabase
    .from('price_track_meal_slots').select('price_track_id, meal_slot_id');
  const slotsByTrack = {};
  for (const row of trackSlots || []) (slotsByTrack[row.price_track_id] ||= []).push(row.meal_slot_id);
  const tracksWithSlots = (priceTracks || []).map((t) => ({ ...t, meal_slot_ids: slotsByTrack[t.id] || [] }));

  const base = calcBase(tracksWithSlots, slots);
  if (base.noMatch) {
    const err = new Error('no-price-track');
    err.userMessage = 'לא הוגדר מחיר לצירוף הסעודות שנבחר. יש לפנות למנהל להגדרת מסלול מחיר מתאים.';
    throw err;
  }

  // --- מאכלים: snapshot של שם + תוספת מחיר אם דורש (סעיף 13.5) ---
  // בקטגוריות עם חלוקת מנות לכל מאכל כמות מנות משלו (order_meals.portions):
  //   - equal:    הלקוח מזין כמות לכל מאכל, וסך הכמויות = מנות הסעודה (100 = 60+40).
  //   - additive: חלוקה אוטומטית — מאכל עיקרי מקבל primary_percent, מאכל משני (is_secondary)
  //               מקבל תוספת של secondary_percent; מאכל יחיד מקבל 100% (כל מנות הסעודה).
  //               האחוזים ניתנים לדריסה פר-סעודה (category_slot_splits): למשל בלילה
  //               80%+50% ובבוקר 50%+50%. אין דריסה → האחוז ברמת הקטגוריה.
  //               לא ניתן לבחור שני מאכלים עיקריים (סעיף 13).
  const mealsInput = Array.isArray(input.meals) ? input.meals : [];
  let mealExtraCharges = 0;
  const mealRows = [];
  if (mealsInput.length > 0) {
    const mealIds = [...new Set(mealsInput.map((m) => m.meal_id))];
    const { data: mealsData } = await supabase
      .from('meals').select('id, name, category_id, requires_extra_charge, extra_charge_amount, is_secondary')
      .in('id', mealIds);
    const byId = Object.fromEntries((mealsData || []).map((m) => [m.id, m]));

    // מצב החלוקה + האחוזים לכל קטגוריה מעורבת, ודריסות האחוזים פר-סעודה
    const catIds = [...new Set((mealsData || []).map((m) => m.category_id).filter(Boolean))];
    const catById = {}; // catId -> { split_mode, primary_percent, secondary_percent }
    let splitOverrides = {}; // `${catId}:${slotId}` -> { primary_percent, secondary_percent }
    if (catIds.length > 0) {
      const [{ data: cats }, overrides] = await Promise.all([
        supabase
          .from('categories')
          .select('id, split_mode, primary_percent, secondary_percent')
          .in('id', catIds),
        fetchSlotSplits(catIds),
      ]);
      for (const c of cats || []) catById[c.id] = c;
      splitOverrides = overrides;
    }
    const splitModeOf = (catId) => catById[catId]?.split_mode || 'none';
    const portionsBySlot = Object.fromEntries(slots.map((s) => [s.meal_slot_id, Number(s.portions)]));

    // צובר לכל (סעודה × קטגוריה מחלקת): כמה מאכלים, וכמה מהם מרכזיים (לא-משניים).
    // ב-equal צובר גם את הסכום שהוזן לאימות מול מנות הסעודה.
    const splitTotals = {}; // `${slotId}:${catId}` -> { mode, count, primaryCount, slotId, catId, declaredSum, allDeclared }
    for (const m of mealsInput) {
      const meal = byId[m.meal_id];
      if (!meal) continue;
      const mode = splitModeOf(meal.category_id);
      if (mode === 'none') continue;
      const key = `${m.meal_slot_id}:${meal.category_id}`;
      const entry = (splitTotals[key] ||= {
        mode, count: 0, primaryCount: 0, slotId: m.meal_slot_id, catId: meal.category_id,
      });
      entry.count += 1;
      if (!meal.is_secondary) entry.primaryCount += 1;
      const declared = m.portions != null ? Number(m.portions) : null;
      entry.declaredSum = (entry.declaredSum || 0) + (declared != null ? declared : 0);
      entry.allDeclared = (entry.allDeclared ?? true) && declared != null;
    }

    // אימות לכל קבוצה לפי המצב
    for (const entry of Object.values(splitTotals)) {
      const slotPortions = portionsBySlot[entry.slotId] || 0;
      if (entry.mode === 'additive') {
        // לכל היותר מאכל עיקרי אחד; ולפחות מאכל אחד (מובטח כי הקבוצה קיימת).
        if (entry.primaryCount > 1) {
          const err = new Error('too-many-primary-meals');
          err.userMessage = 'ניתן לבחור רק מאכל עיקרי אחד בקטגוריה. המאכל הנוסף חייב להיות מסומן כמאכל משני.';
          throw err;
        }
        continue;
      }
      // equal — סכום הכמויות = מנות הסעודה (המצב הקודם)
      if (entry.count === 1) continue; // סוג יחיד — יקבל את כל המנות בלולאה למטה
      if (!entry.allDeclared) {
        const err = new Error('portion-split-missing');
        err.userMessage = 'יש להזין מספר מנות לכל מאכל בקטגוריה שמחייבת חלוקת כמויות.';
        throw err;
      }
      if (entry.declaredSum !== slotPortions) {
        const err = new Error('portion-split-mismatch');
        err.userMessage = `סך המנות של המאכלים בקטגוריה חייב להיות שווה למספר המנות של הסעודה (${slotPortions}).`;
        throw err;
      }
    }

    for (const m of mealsInput) {
      const meal = byId[m.meal_id];
      if (!meal) continue;
      // The catalog amount is a surcharge per portion. A selected meal is served
      // for the meal slot, so charge it for every portion ordered in that slot.
      // This intentionally uses the slot quantity even when production portions
      // are split between dishes: pricing is based on the ordered meal portions.
      const charge = meal.requires_extra_charge ? Number(meal.extra_charge_amount || 0) : 0;
      mealExtraCharges += charge * (portionsBySlot[m.meal_slot_id] || 0);

      // כמות מנות למאכל: רק בקטגוריות מחלקות; NULL בשאר (כל מנות הסעודה)
      let mealPortions = null;
      const mode = splitModeOf(meal.category_id);
      if (mode !== 'none') {
        const key = `${m.meal_slot_id}:${meal.category_id}`;
        const group = splitTotals[key];
        const slotPortions = portionsBySlot[m.meal_slot_id] || 0;
        if (group?.count === 1) {
          mealPortions = slotPortions;                     // סוג יחיד → כל המנות (100%)
        } else if (mode === 'additive') {
          const cat = catById[meal.category_id] || { id: meal.category_id };
          const pct = percentFor(splitOverrides, cat, m.meal_slot_id, meal.is_secondary);
          mealPortions = roundUp(slotPortions * pct / 100); // אוטומטי, עיגול כלפי מעלה
        } else {
          mealPortions = Number(m.portions);               // equal — כבר אומת למעלה
        }
      }

      mealRows.push({
        meal_slot_id: m.meal_slot_id,
        meal_id: m.meal_id,
        meal_name_snapshot: meal.name,
        extra_charge_amount: charge,
        portions: mealPortions,
      });
    }
  }

  // --- תוספות: חישוב כמות/מחיר (סעיף 14.4) ---
  const extrasInput = Array.isArray(input.extras) ? input.extras : [];
  let extrasAmount = 0;
  const extraRows = [];
  if (extrasInput.length > 0) {
    const extraIds = [...new Set(extrasInput.map((e) => e.extra_id))];
    const [{ data: extrasData }, { data: extraMealLinks }] = await Promise.all([
      supabase.from('extras').select('*').in('id', extraIds),
      supabase.from('extra_meal_requirements').select('extra_id, meal_id').in('extra_id', extraIds),
    ]);
    const byId = Object.fromEntries((extrasData || []).map((e) => [e.id, e]));

    // התניית תוספת במאכל (סעיף 14): תוספת מקושרת נכללת רק אם נבחר לפחות אחד
    // מהמאכלים המקושרים אליה. ללא קישורים = ללא התניה.
    const requiredMealsByExtra = {};
    for (const row of extraMealLinks || []) (requiredMealsByExtra[row.extra_id] ||= []).push(row.meal_id);
    const selectedMealIds = new Set(mealsInput.map((m) => m.meal_id));

    const ctx = {
      totalPortions: base.totalPortions,
      portionsPerSlotSum: base.totalPortions,
    };
    for (const e of extrasInput) {
      const extra = byId[e.extra_id];
      if (!extra) continue;
      const required = requiredMealsByExtra[extra.id];
      if (required && !required.some((id) => selectedMealIds.has(id))) {
        const err = new Error('extra-requires-meal');
        err.userMessage = `התוספת "${extra.name}" זמינה רק בהזמנה שכוללת את המאכל שהיא מותנית בו.`;
        throw err;
      }
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
    exception, // { requested, note } — בקשת כמות מנות חריגה (מחוץ ל-50–100)
    amounts: {
      base_amount: baseAmount,
      extras_amount: round2(extrasAmount),
      manual_charges_amount: manualCharges,
      discount_amount: discounts,
      final_amount: finalAmount,
    },
  };
}
