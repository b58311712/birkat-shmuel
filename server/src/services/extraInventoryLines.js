// מרכיבי המלאי של תוספות בתשלום (סעיף 14.6)
//
// תוספת בתשלום צורכת מלאי בדיוק כמו מאכל, ולכן היא משתמשת באותה טבלה
// (recipe_lines) עם extra_id במקום meal_id. ההבדל היחיד הוא המכפיל:
//   מאכל  - quantity_per_portion × מנות
//   תוספת - quantity_per_portion × יחידות החיוב שהוזמנו (order_extras.actual_quantity)
//
// עמידות למיגרציה 51 שטרם הורצה: כל עוד העמודה extra_id חסרה במסד, אין לתוספות
// מרכיבי מלאי בכלל - מחזירים רשימה ריקה במקום להפיל את תיק השבת ומסך הקטלוג.
import { supabase } from '../lib/supabase.js';

const UNDEFINED_COLUMN = '42703'; // Postgres: undefined_column

const DEFAULT_COLUMNS =
  'extra_id, inventory_item_id, ingredient_name, quantity_per_portion, unit, unit_id';

export const MISSING_EXTRA_LINK_MESSAGE =
  'קישור תוספות למלאי טרם הופעל במסד הנתונים (מיגרציה 51). יש להריץ אותה ולנסות שוב.';

export function isMissingExtraLinkColumn(error) {
  return error?.code === UNDEFINED_COLUMN;
}

// שורות המרכיבים של קבוצת תוספות. מחזיר [] כשאין מזהים או כשהעמודה טרם קיימת.
export async function fetchExtraRecipeLines(extraIds, columns = DEFAULT_COLUMNS) {
  const ids = [...new Set((extraIds || []).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('recipe_lines')
    .select(columns)
    .in('extra_id', ids);
  if (error) {
    if (isMissingExtraLinkColumn(error)) return [];
    throw error;
  }
  return data || [];
}
