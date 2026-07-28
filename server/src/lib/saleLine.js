// תמחור שורת מכירת מוצרים - טהור, בלי גישה למסד. משמש services/productSale.js.
//
// ההפרדה מכוונת: כללי המכירה (מה ניתן למכור, באיזה מחיר, וכמה יורד מהמלאי)
// הם לב הפיצ'ר וצריכים להיות ניתנים לבדיקה בלי מסד נתונים. אותה חלוקה של
// lib/costMath.js ו-lib/inventoryPackages.js מול services/.
import { costPerBaseUnit, toBaseQuantity, round2 } from './costMath.js';

// מחזיר { row, qtyBase } או { error } עם הודעה בעברית.
//
//   row     - שורה מוכנה ל-order_inventory_lines, עם מחיר קפוא
//   qtyBase - הכמות ביחידת הבסיס של הפריט, לניכוי המלאי
//
// שני הערכים נגזרים מאותו פקטור המרה במכוון: אילו המחיר והניכוי היו מחושבים
// בנפרד, הסכום שנגבה לא היה משקף את מה שירד מהמלאי.
export function priceSaleLine(item, line, vatRate, factorByUnitId) {
  if (!item) return { error: 'פריט מלאי לא נמצא.' };
  if (!item.is_active) return { error: `הפריט "${item.name}" אינו פעיל ולא ניתן למכירה.` };
  // direct_event אינו מנוהל ככמות במלאי (מיגרציה 50 אוכפת עליו מלאי אפס),
  // ולכן מכירתו הייתה מפחיתה כמות שאיש אינו מתחזק.
  if (item.procurement_type === 'direct_event') {
    return { error: `הפריט "${item.name}" מסומן כרכש ישיר לאירוע ואינו מנוהל במלאי.` };
  }

  const quantity = Number(line.quantity);
  if (!(quantity > 0)) return { error: `כמות לא תקינה בשורה "${item.name}".` };

  // ברירת המחדל היא יחידת הבסיס של הפריט (פקטור 1), ולכן ההמרה לא נכשלת
  // כשהממשק לא שלח יחידה.
  const unitId = line.unit_id || item.unit_id || null;

  // מחיר חסר **חוסם** כאן. costing.js מתעד במפורש שמחיר חסר אינו חוסם, כי שם
  // מדובר בהערכת עלות פנימית של אירוע שהמנהל יכול לתקן. במכירה זה כסף שנגבה
  // מלקוח, ומחיר 0 פירושו למסור מוצר בחינם בלי שאיש ישים לב.
  const perBase = costPerBaseUnit(item, vatRate);
  if (perBase == null) {
    return { error: `לפריט "${item.name}" אין מחיר עלות אחרון. יש לעדכן את המחיר בכרטיס הפריט לפני המכירה.` };
  }

  const unitsPerEntry = toBaseQuantity(1, unitId, item, factorByUnitId);
  if (unitsPerEntry == null) {
    return { error: `חסרה המרת יחידות לפריט "${item.name}" (מיחידת ההזנה ליחידת הבסיס "${item.unit}").` };
  }

  const unitCost = round2(perBase * unitsPerEntry);
  return {
    qtyBase: quantity * unitsPerEntry,
    row: {
      inventory_item_id: item.id,
      item_name_snapshot: item.name,
      quantity,
      unit_id: unitId,
      unit_cost: unitCost,
      line_total: round2(quantity * unitCost),
      note: String(line.note || '').trim() || null,
    },
  };
}
