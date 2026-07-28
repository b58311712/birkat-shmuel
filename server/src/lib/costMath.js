// חשבון עלות טהור - בלי גישה למסד. משמש את services/costing.js.
//
// ההפרדה מכוונת: הכללים כאן (מה נחשב מחיר תקין, איך מוסיפים מע"מ, איך ממירים
// יחידת הזנה ליחידת בסיס) הם לב התמחור של אירוע, וצריכים להיות ניתנים לבדיקה
// בלי מסד נתונים. אותה חלוקה של lib/inventoryPackages.js מול services/.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

// עלות ליחידת הבסיס של פריט, כולל מע"מ אם הפריט חייב בו.
//
// המחיר השמור הוא תמיד לפני מע"מ (מיגרציה 33), ולכן מחיר "כולל" מחושב ולא נשמר.
// פריט בלי מחיר קנייה מחזיר null במכוון ולא 0: אפס היה נראה כמו מוצר חינמי
// ומשקר בתמחור, בעוד null מאפשר לקורא לדווח "חסר מחיר" ולהציג עלות חלקית.
export function costPerBaseUnit(item, vatRate) {
  const base = Number(item?.last_purchase_price);
  if (!Number.isFinite(base) || base <= 0) return null;
  return item.vat_exempt ? base : base * (1 + Number(vatRate || 0) / 100);
}

// ממיר כמות מיחידת הזנה ליחידת הבסיס של הפריט.
//
// אותו כלל של convertRequirementsToBase (המסלול שמזין את ניכוי המלאי):
//   יחידת ההזנה = יחידת הבסיס  => פקטור 1, בלי צורך ברשומת המרה.
//   קיימת רשומת המרה           => כפל בפקטור.
//   אחרת                       => null; אין להמציא פקטור.
export function toBaseQuantity(quantity, unitId, item, factorByUnitId) {
  const factor = unitId && unitId === item?.unit_id ? 1 : factorByUnitId?.[unitId];
  if (factor == null) return null;
  return Number(quantity) * Number(factor);
}
