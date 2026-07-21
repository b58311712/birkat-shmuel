// דריסות אחוזי החלוקה האוטומטית (split_mode='additive') פר-סעודה — טבלת category_slot_splits.
//
// מודל: לכל (קטגוריה × סעודה) אפשר לקבוע אחוז עיקרי ואחוז משני משלה. ערך NULL
// (או שורה חסרה) = נפילה-לאחור לאחוז ברמת הקטגוריה, ומשם לברירת המחדל (80/50).
// כך אפשר, למשל, בקטגוריית דגים: ליל שבת 80%+50%, שבת בבוקר 50%+50%.
//
// עמידות למיגרציה שטרם הורצה (מיגרציה 39): כל עוד הטבלה אינה קיימת ב-DB,
// הקריאות מחזירות "אין דריסות" והמערכת ממשיכה לעבוד לפי אחוזי הקטגוריה בלבד.
// רק ניסיון *לשמור* דריסה יחזיר שגיאה מפורשת למנהל.
import { supabase } from '../lib/supabase.js';

const MISSING_TABLE_CODES = ['42P01', 'PGRST205'];
const MIGRATION_MESSAGE =
  'טבלת החלוקה פר-סעודה טרם נוצרה במסד הנתונים. יש להריץ את מיגרציה 39 ואז לנסות שוב.';

function isMissingTable(error) {
  return !!error && MISSING_TABLE_CODES.includes(error.code);
}

// מחזיר מפה `${categoryId}:${mealSlotId}` -> { primary_percent, secondary_percent }.
// categoryIds = null → כל הקטגוריות.
export async function fetchSlotSplits(categoryIds = null) {
  let q = supabase
    .from('category_slot_splits')
    .select('category_id, meal_slot_id, primary_percent, secondary_percent');
  if (categoryIds) {
    if (categoryIds.length === 0) return {};
    q = q.in('category_id', categoryIds);
  }

  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return {};
    throw error;
  }

  const map = {};
  for (const row of data || []) {
    map[`${row.category_id}:${row.meal_slot_id}`] = {
      primary_percent: row.primary_percent,
      secondary_percent: row.secondary_percent,
    };
  }
  return map;
}

// אותם נתונים בקיבוץ לפי קטגוריה: { [categoryId]: { [slotId]: {…} } } — לצירוף לתשובת API.
export async function fetchSlotSplitsByCategory(categoryIds = null) {
  const flat = await fetchSlotSplits(categoryIds);
  const byCategory = {};
  for (const [key, value] of Object.entries(flat)) {
    const [categoryId, slotId] = key.split(':');
    (byCategory[categoryId] ||= {})[slotId] = value;
  }
  return byCategory;
}

// אחוז המנות למאכל: דריסה פר-סעודה → אחוז הקטגוריה → ברירת מחדל (80 עיקרי / 50 משני).
export function percentFor(splits, category, mealSlotId, isSecondary) {
  const field = isSecondary ? 'secondary_percent' : 'primary_percent';
  const override = splits[`${category?.id}:${mealSlotId}`] || {};
  return Number(override[field] ?? category?.[field] ?? (isSecondary ? 50 : 80));
}

// מחליף את כל הדריסות של קטגוריה. rows: [{ meal_slot_id, primary_percent, secondary_percent }].
export async function replaceSlotSplits(categoryId, rows) {
  const del = await supabase.from('category_slot_splits').delete().eq('category_id', categoryId);
  if (del.error) {
    // הטבלה חסרה ואין מה לשמור — שמירת הקטגוריה עצמה ממשיכה כרגיל.
    if (isMissingTable(del.error) && !rows.length) return;
    if (isMissingTable(del.error)) {
      const err = new Error('missing-category-slot-splits-table');
      err.userMessage = MIGRATION_MESSAGE;
      throw err;
    }
    throw del.error;
  }
  if (!rows.length) return;

  const { error } = await supabase
    .from('category_slot_splits')
    .insert(rows.map((r) => ({ ...r, category_id: categoryId })));
  if (error) throw error;
}
