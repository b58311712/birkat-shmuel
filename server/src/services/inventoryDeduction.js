// ניכוי מלאי אוטומטי לפי מתכונים (סעיף 25.4)
//
// זרימה:
//   1. צוברים את הצריכה של כל פריט מלאי מכל ההזמנות התפעוליות של השבת
//      (מאכל × מנות × כמות-למנה), בדיוק כמו buildInventoryReport.
//   2. ממירים כל שורת מתכון מיחידת-המתכון (recipe_lines.unit, טקסט חופשי)
//      ליחידת הבסיס של הפריט (inventory_items.unit) דרך inventory_unit_conversions.
//   3. מאמתים שכל שורה ניתנת להמרה - פקטור חסר => שגיאה מתארת, בלי לנכות כלום.
//   4. קוראים ל-RPC deduct_shabbat_inventory שמבצע את הניכוי אטומית (נעילה,
//      אימות מספיקוּת, עדכון, תיעוד תנועות, וסימון התיק).
//
// הניכוי הוא ברמת השבת (לא פר-הזמנה) ומופעל ידנית פעם אחת (סעיף 25.4). דגל
// is_inventory_deducted בתיק השבת מונע ניכוי כפול - נאכף גם ב-RPC (אטומי).
import { supabase } from '../lib/supabase.js';
import { isOperational } from './shabbatFile.js';

// שגיאת דומיין עם הודעה ידידותית למשתמש (נתפסת ב-error middleware של הראוט).
class DeductionError extends Error {
  constructor(message, userMessage) {
    super(message);
    this.name = 'DeductionError';
    this.userMessage = userMessage;
    this.status = 400;
  }
}

// נרמול יחידה להשוואה עמידה: "כף " ו-"כף" ו-"Kaf" → מפתח אחיד.
const normUnit = (u) => String(u || '').trim().toLowerCase();

// צובר את הצריכה המדויקת (ביחידת המתכון) לכל פריט מלאי מקושר, על פני כל
// ההזמנות התפעוליות של השבת. מחזיר מפה: item_id -> { unit -> qty }.
// שורות מתכון בלי inventory_item_id אינן ניתנות לניכוי - נאספות בנפרד להתראה.
async function collectConsumption(shabbatId) {
  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select(`
      id, order_status, payment_status,
      order_meal_slots ( meal_slot_id, portions ),
      order_meals ( meal_slot_id, meal_id, portions )
    `)
    .eq('shabbat_id', shabbatId);
  if (oErr) throw oErr;

  // מנות מצטברות לכל מאכל (מאכל בקטגוריה מחלקת → הכמות שלו; אחרת מנות הסעודה).
  const portionsByMeal = {};
  for (const o of orders || []) {
    if (!isOperational(o)) continue;
    const slotPortions = Object.fromEntries(
      (o.order_meal_slots || []).map((ms) => [ms.meal_slot_id, Number(ms.portions || 0)]),
    );
    for (const om of o.order_meals || []) {
      const p = om.portions != null ? Number(om.portions) : (slotPortions[om.meal_slot_id] || 0);
      if (p > 0) portionsByMeal[om.meal_id] = (portionsByMeal[om.meal_id] || 0) + p;
    }
  }

  const mealIds = Object.keys(portionsByMeal);
  if (mealIds.length === 0) return { byItem: {}, unlinked: [] };

  const { data: recipes, error: rErr } = await supabase
    .from('recipe_lines')
    .select('meal_id, inventory_item_id, ingredient_name, quantity_per_portion, unit, unit_id')
    .in('meal_id', mealIds);
  if (rErr) throw rErr;

  // צוברים לפי (פריט, יחידת-המתכון). המפתח הוא unit_id (מזהה יציב); שם היחידה
  // הטקסטואלי נשמר רק לצורך הודעות שגיאה קריאות.
  const byItem = {};   // item_id -> { unit_id -> { unit_id, unit_name, qty } }
  const unlinked = []; // שורות בלי קישור למלאי - לא ניתנות לניכוי
  for (const rl of recipes || []) {
    const portions = portionsByMeal[rl.meal_id] || 0;
    const need = Number(rl.quantity_per_portion) * portions;
    if (!(need > 0)) continue;
    if (!rl.inventory_item_id) {
      unlinked.push({ name: rl.ingredient_name, unit: rl.unit });
      continue;
    }
    const perUnit = (byItem[rl.inventory_item_id] ||= {});
    const key = rl.unit_id || `text:${normUnit(rl.unit)}`; // נפילה לטקסט אם שורה ישנה בלי unit_id
    (perUnit[key] ||= { unit_id: rl.unit_id || null, unit_name: rl.unit, qty: 0 }).qty += need;
  }
  return { byItem, unlinked };
}

// ממיר את הצריכה של כל פריט ליחידת הבסיס שלו וצובר לכמות בסיס אחת.
// כלל ההמרה לכל (פריט, יחידת-מתכון), הכל לפי unit_id:
//   - יחידת המתכון = יחידת הבסיס של הפריט  → פקטור 1 (אין צורך ברשומת המרה).
//   - קיימת רשומת המרה (from_unit_id)      → כפל בפקטור.
//   - אחרת                                 → פקטור חסר; נאסף לשגיאה מתארת.
// מחזיר { lines:[{ item_id, qty_base }], missing:[...] }.
function convertToBase(byItem, itemById, conversionsByItem) {
  const lines = [];
  const missing = [];
  for (const [itemId, perUnit] of Object.entries(byItem)) {
    const item = itemById[itemId];
    if (!item) continue; // פריט נמחק/מושבת - מדלגים (אין מה לנכות)
    const baseUnitId = item.unit_id;
    const factorByUnitId = conversionsByItem[itemId] || {};

    let qtyBase = 0;
    for (const { unit_id, unit_name, qty } of Object.values(perUnit)) {
      // אותה יחידה כמו הבסיס → פקטור 1; אחרת נדרשת רשומת המרה לפי unit_id.
      const factor = (unit_id && unit_id === baseUnitId) ? 1 : factorByUnitId[unit_id];
      if (factor == null) {
        missing.push({ item_id: itemId, item_name: item.name, from_unit: unit_name, base_unit: item.unit });
        continue;
      }
      qtyBase += qty * factor;
    }
    if (qtyBase > 0) lines.push({ item_id: itemId, qty_base: round4(qtyBase) });
  }
  return { lines, missing };
}

// מריץ את ניכוי המלאי המלא לשבת. אטומי, פעם-אחת, ומאומת המרה מלאה מראש.
// זורק DeductionError (עם userMessage) על פקטור המרה חסר או מלאי לא מספיק.
// מחזיר סיכום: כמה פריטים נוכו, פירוט before/after, ושורות שלא קושרו למלאי.
export async function deductInventoryForShabbat(shabbatId, performedBy = null) {
  const { byItem, unlinked } = await collectConsumption(shabbatId);
  const itemIds = Object.keys(byItem);
  if (itemIds.length === 0) {
    throw new DeductionError('nothing-to-deduct',
      'אין צריכת מלאי מקושרת בשבת זו - אין מה לנכות.');
  }

  // שולפים את הפריטים (עם unit_id ליחידת הבסיס) ואת טבלת ההמרה שלהם במקביל.
  const [{ data: items, error: iErr }, { data: convs, error: cErr }] = await Promise.all([
    supabase.from('inventory_items').select('id, name, unit, unit_id, quantity_on_hand').in('id', itemIds),
    supabase.from('inventory_unit_conversions')
      .select('inventory_item_id, from_unit_id, factor_to_base').in('inventory_item_id', itemIds),
  ]);
  if (iErr) throw iErr;
  if (cErr) throw cErr;

  const itemById = Object.fromEntries((items || []).map((i) => [i.id, i]));
  const conversionsByItem = {}; // item_id -> { from_unit_id -> factor }
  for (const c of convs || []) {
    if (!c.from_unit_id) continue;
    (conversionsByItem[c.inventory_item_id] ||= {})[c.from_unit_id] = Number(c.factor_to_base);
  }

  const { lines, missing } = convertToBase(byItem, itemById, conversionsByItem);

  // קצה 1: פקטור המרה חסר - לא נוגעים ב-DB, זורקים רשימה מתארת מה חסר.
  if (missing.length > 0) {
    const details = missing
      .map((m) => `${m.item_name}: אין המרה מ־"${m.from_unit}" ליחידת הבסיס "${m.base_unit}"`)
      .join('; ');
    throw new DeductionError(`missing-conversion: ${details}`,
      `חסרות הגדרות המרת יחידות - יש להגדירן לפני ניכוי. ${details}`);
  }

  if (lines.length === 0) {
    throw new DeductionError('nothing-to-deduct',
      'אין צריכת מלאי לניכוי בשבת זו.');
  }

  // הניכוי עצמו - RPC אטומי. אימות המספיקוּת והנעילה קורים בתוך העסקה ב-DB.
  const { data, error } = await supabase.rpc('deduct_shabbat_inventory', {
    p_shabbat_id: shabbatId,
    p_lines: lines,
    p_performed_by: performedBy,
  });
  if (error) throw mapRpcError(error);

  return {
    shabbat_id: shabbatId,
    deducted_items: (data || []).length,
    movements: data || [],
    unlinked, // שורות מתכון בלי קישור למלאי - לא נוכו, להצגה כאזהרה
  };
}

// ממפה שגיאות RPC מוכרות (מ-raise exception ב-plpgsql) להודעות משתמש בעברית.
function mapRpcError(error) {
  const msg = String(error.message || '');
  if (msg.includes('already-deducted')) {
    return new DeductionError(msg, 'המלאי כבר הופחת עבור שבת זו.');
  }
  if (msg.includes('no-shabbat-file')) {
    return new DeductionError(msg, 'אין תיק שבת לשבת זו - לא ניתן לנכות מלאי.');
  }
  if (msg.includes('insufficient-inventory')) {
    // ה-HINT/DETAIL של Postgres כולל שם פריט + כמויות; מעבירים כפי שהוא.
    return new DeductionError(msg, `אין מספיק מלאי לניכוי - ${msg.split('insufficient-inventory:')[1]?.trim() || ''}`);
  }
  return error; // שגיאה לא צפויה - מגלגלים כמו שהיא ל-error middleware
}

function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}
