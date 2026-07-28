// חישוב עלות לפי מרכיבים (מיגרציה 54)
//
// משמש לתמחור אירוע: המחיר נגזר מעלות המוצרים שנצרכים בפועל, ולא ממסלול מחיר
// קבוע למנה. שני מקורות צריכה:
//   מאכל מהקטלוג  - עלות למנה מתוך recipe_lines, כפול מספר המנות.
//   שורת מלאי חופשית - כמות מוחלטת כפול עלות ליחידה, בלי קשר למספר המנות.
//
// מקור המחיר: inventory_items.last_purchase_price - מחיר בסיס **לפני מע"מ**
// ליחידת הבסיס של הפריט (מיגרציה 33). מוסיפים מע"מ לפריט שאינו vat_exempt, כי
// העלות האמיתית של המטבח היא מה ששולם בפועל.
//
// ההמרה ליחידת הבסיס עוברת ב-inventoryUnitConversion, בדיוק אותו מסלול של
// ניכוי המלאי. זה מכוון: אם העלות והניכוי היו מחשבים המרות שונות, המחיר לא היה
// משקף את מה שירד מהמלאי.
//
// עיקרון: מחיר חסר אינו חוסם. פריט בלי last_purchase_price מוחזר ב-missing_prices
// והממשק מציג אזהרה, אך התמחור החלקי מתבצע. זאת בשונה מפקטור המרה חסר, שכן חוסם
// את הניכוי (שם הנזק הוא מלאי שגוי, כאן רק מחיר חלקי שהמנהל יכול לתקן ידנית).
import { supabase } from '../lib/supabase.js';
import { indexConversions } from './inventoryUnitConversion.js';
import { costPerBaseUnit, toBaseQuantity, round2, round4 } from '../lib/costMath.js';

const DEFAULT_VAT_RATE = 18;

// שיעור המע"מ מהגדרות המערכת, עם נפילה לברירת המחדל (כמו routes/settings.js).
export async function fetchVatRate() {
  const { data, error } = await supabase
    .from('system_settings').select('value').eq('key', 'vat_rate').maybeSingle();
  if (error) throw error;
  const parsed = data?.value != null ? Number(data.value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_VAT_RATE;
}

// טוען את כל פריטי המלאי והמרות היחידות הדרושים, ומחזיר עוזרים מוכנים לשימוש.
async function loadCostContext(itemIds) {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) {
    return { itemById: {}, conversionsByItem: {}, vatRate: await fetchVatRate() };
  }

  const [itemsRes, convsRes, vatRate] = await Promise.all([
    supabase.from('inventory_items')
      .select('id, name, unit, unit_id, last_purchase_price, vat_exempt')
      .in('id', ids),
    supabase.from('inventory_unit_conversions')
      .select('inventory_item_id, from_unit_id, factor_to_base')
      .in('inventory_item_id', ids),
    fetchVatRate(),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (convsRes.error) throw convsRes.error;

  return {
    itemById: Object.fromEntries((itemsRes.data || []).map((i) => [i.id, i])),
    conversionsByItem: indexConversions(convsRes.data || []),
    vatRate,
  };
}

// עלות למנה אחת של כל מאכל ברשימה.
// מחזיר { costByMeal: { meal_id -> cost }, warnings: [...] }.
// warnings כולל שלושה סוגים: מרכיב בלי קישור למלאי, פריט בלי מחיר, והמרת יחידה
// חסרה. כולם רק מקטינים את דיוק העלות ולכן אינם חוסמים.
export async function mealCostPerPortion(mealIds) {
  const ids = [...new Set((mealIds || []).filter(Boolean))];
  if (ids.length === 0) return { costByMeal: {}, warnings: [] };

  const { data: recipeLines, error } = await supabase
    .from('recipe_lines')
    .select('meal_id, inventory_item_id, ingredient_name, quantity_per_portion, unit, unit_id')
    .in('meal_id', ids);
  if (error) throw error;

  const ctx = await loadCostContext((recipeLines || []).map((r) => r.inventory_item_id));

  const costByMeal = {};
  const warnings = [];

  for (const line of recipeLines || []) {
    const qty = Number(line.quantity_per_portion);
    if (!(qty > 0)) continue;

    if (!line.inventory_item_id) {
      warnings.push({ type: 'unlinked_ingredient', meal_id: line.meal_id, name: line.ingredient_name });
      continue;
    }
    const item = ctx.itemById[line.inventory_item_id];
    if (!item) continue;

    const baseQty = toBaseQuantity(qty, line.unit_id, item, ctx.conversionsByItem[item.id]);
    if (baseQty == null) {
      warnings.push({
        type: 'missing_conversion',
        meal_id: line.meal_id,
        item_name: item.name,
        from_unit: line.unit,
        base_unit: item.unit,
      });
      continue;
    }

    const unitCost = costPerBaseUnit(item, ctx.vatRate);
    if (unitCost == null) {
      warnings.push({ type: 'missing_price', meal_id: line.meal_id, item_name: item.name });
      continue;
    }

    costByMeal[line.meal_id] = (costByMeal[line.meal_id] || 0) + baseQty * unitCost;
  }

  for (const mealId of Object.keys(costByMeal)) {
    costByMeal[mealId] = round4(costByMeal[mealId]);
  }
  return { costByMeal, warnings };
}

// עלות ליחידת ההזנה של פריט מלאי (למשל "עלות לחבילה" כשהיחידה היא חבילה).
// משמש את הממשק כדי למלא מראש את unit_cost בשורת מלאי חופשית.
export async function inventoryLineUnitCost(itemId, unitId) {
  const ctx = await loadCostContext([itemId]);
  const item = ctx.itemById[itemId];
  if (!item) return { unit_cost: null, warning: 'item_not_found' };

  const perBase = costPerBaseUnit(item, ctx.vatRate);
  if (perBase == null) return { unit_cost: null, warning: 'missing_price' };

  // עלות ליחידת ההזנה = עלות ליחידת בסיס * כמה יחידות בסיס יש ביחידת ההזנה.
  const baseQty = toBaseQuantity(1, unitId || item.unit_id, item, ctx.conversionsByItem[item.id]);
  if (baseQty == null) return { unit_cost: null, warning: 'missing_conversion' };

  return { unit_cost: round2(perBase * baseQty), warning: null };
}

// תמחור מלא של הזמנה לפי עלות (סעיף התמחור של אירוע).
//   orderMeals:      [{ meal_id, meal_name_snapshot, portions }]
//   inventoryLines:  [{ inventory_item_id, item_name_snapshot, quantity, unit_id, unit_cost }]
//
// שורות המלאי מתומחרות לפי unit_cost ה**קפוא** שנשמר בשורה, ולא מחושבות מחדש -
// זה עיקרון המחירים הקפואים (סעיף 15.3). המאכלים כן מחושבים מהמחירים הנוכחיים,
// כי הם הדבר שהמנהל מבקש לתמחר.
//
// מחזיר פירוט מלא לתצוגה, ולא רק סכום, כדי שהמסך יראה "חזה עוף: 12.40 למנה
// x 80 מנות = 992" ויאפשר להבין מאיפה הגיע המחיר.
export async function priceOrderByCost({ orderMeals = [], inventoryLines = [] }) {
  const { costByMeal, warnings } = await mealCostPerPortion(orderMeals.map((m) => m.meal_id));

  const mealBreakdown = orderMeals.map((m) => {
    const perPortion = costByMeal[m.meal_id] || 0;
    const portions = Number(m.portions || 0);
    return {
      meal_id: m.meal_id,
      meal_name: m.meal_name_snapshot,
      portions,
      cost_per_portion: round2(perPortion),
      line_total: round2(perPortion * portions),
    };
  });

  const linesBreakdown = inventoryLines.map((l) => ({
    inventory_item_id: l.inventory_item_id,
    item_name: l.item_name_snapshot,
    quantity: Number(l.quantity || 0),
    unit_cost: round2(l.unit_cost || 0),
    line_total: round2(Number(l.quantity || 0) * Number(l.unit_cost || 0)),
  }));

  const mealsTotal = round2(mealBreakdown.reduce((s, m) => s + m.line_total, 0));
  const linesTotal = round2(linesBreakdown.reduce((s, l) => s + l.line_total, 0));

  return {
    meals_total: mealsTotal,
    inventory_lines_total: linesTotal,
    computed_total: round2(mealsTotal + linesTotal),
    meal_breakdown: mealBreakdown,
    inventory_line_breakdown: linesBreakdown,
    warnings,
  };
}
