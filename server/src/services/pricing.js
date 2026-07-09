// שירות חישוב מחיר הזמנה (סעיף 15, 14, 16)
import { roundUp } from '../lib/helpers.js';

// מחשב מחיר בסיס לפי מספר סעודות שנבחרו ומספר מנות לכל סעודה.
// מסלול המחיר נבחר לפי מספר הסעודות (סעיף 15.1, 15.2).
//   priceTracks: כל המסלולים הפעילים (עם meals_count ו-price_per_portion)
//   selectedSlots: [{ meal_slot_id, portions }]
export function calcBase(priceTracks, selectedSlots) {
  const slotsCount = selectedSlots.length;

  // מוצאים מסלול שתואם למספר הסעודות, אחרת המסלול עם הכי הרבה סעודות שקטן/שווה
  let track =
    priceTracks.find((t) => t.meals_count === slotsCount) ||
    priceTracks
      .filter((t) => (t.meals_count ?? 0) <= slotsCount)
      .sort((a, b) => (b.meals_count ?? 0) - (a.meals_count ?? 0))[0] ||
    null;

  const pricePerPortion = track ? Number(track.price_per_portion) : 0;

  // מחיר בסיס = סך המנות בכל הסעודות * מחיר למנה
  const totalPortions = selectedSlots.reduce((sum, s) => sum + Number(s.portions || 0), 0);
  const baseAmount = totalPortions * pricePerPortion;

  return {
    track,
    pricePerPortion,
    totalPortions,
    baseAmount: round2(baseAmount),
  };
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
