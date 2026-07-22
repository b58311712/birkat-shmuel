// שירות חישוב מחיר הזמנה (סעיף 15, 14, 16)
import { roundUp } from '../lib/helpers.js';

// מחשב מחיר בסיס לפי *צירוף הסעודות המדויק* שנבחר (סעיף 15).
// כל מסלול משויך לקבוצת סעודות (price_track_meal_slots); נבחר המסלול שקבוצת
// הסעודות שלו זהה בדיוק לצירוף שהלקוח בחר. אין התאמה מדויקת → אין מחיר (noMatch).
//   priceTracks: כל המסלולים הפעילים, כל אחד עם meal_slot_ids: uuid[]
//   selectedSlots: [{ meal_slot_id, portions }]
export function calcBase(priceTracks, selectedSlots) {
  const selectedKey = slotKey(selectedSlots.map((s) => s.meal_slot_id));

  // צירוף זהה בדיוק: אותה קבוצת מזהי-סעודות (ללא תלות בסדר).
  const track = priceTracks.find((t) => slotKey(t.meal_slot_ids || []) === selectedKey) || null;

  const totalPortions = selectedSlots.reduce((sum, s) => sum + Number(s.portions || 0), 0);

  if (!track) {
    // אין מסלול לצירוף הזה - מסמנים חוסר-התאמה כדי שהקורא יחסום את ההזמנה.
    return { track: null, noMatch: true, pricePerPortion: 0, totalPortions, baseAmount: 0 };
  }

  const pricePerPortion = Number(track.price_per_portion);
  // מחיר בסיס = סך המנות בכל הסעודות * מחיר למנה
  const baseAmount = totalPortions * pricePerPortion;

  return {
    track,
    noMatch: false,
    pricePerPortion,
    totalPortions,
    baseAmount: round2(baseAmount),
  };
}

// מפתח נורמלי (ממוין, ייחודי) לקבוצת מזהי-סעודות - לשם השוואת צירופים.
export function slotKey(ids) {
  return [...new Set((ids || []).filter(Boolean).map(String))].sort().join('|');
}

// מחשב כמות מוצעת לתוספת לפי נוסחה (סעיף 14.4), מעוגל כלפי מעלה (14.5)
//   extra: { suggestion_ratio, suggestion_basis }
//   ctx:   { totalPortions, portionsPerSlotSum }
export function suggestExtraQuantity(extra, ctx) {
  const ratio = Number(extra.suggestion_ratio || 0);
  if (!ratio) return 1;

  switch (extra.suggestion_basis) {
    case 'per_portion':
      return roundUp(ctx.totalPortions * ratio);
    case 'per_portion_per_slot':
      return roundUp(ctx.portionsPerSlotSum * ratio);
    case 'fixed_per_order':
      return roundUp(ratio);
    default:
      return roundUp(ctx.totalPortions * ratio);
  }
}

// מחשב סכום סופי (סעיף 16.2): בסיס + תוספות + חיובים ידניים - הנחות
export function calcFinal({ baseAmount, extrasAmount, manualCharges, discounts }) {
  const final = baseAmount + extrasAmount + manualCharges - discounts;
  return round2(Math.max(0, final));
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
