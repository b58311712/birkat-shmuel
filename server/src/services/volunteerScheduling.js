import { supabase } from '../lib/supabase.js';

// שיבוץ מתנדבים (סעיף 24) — מבנה מפושט: תבנית גלובלית אחת.
// המשימות (volunteer_tasks) מגדירות מתנדב קבוע (primary) + מחליפים (backup).
// המתנדב המשובץ בפועל מחושב חי ב-buildVolunteerReport (shabbatFile.js) בלי snapshot.
// כאן נשארות: שליפת המאכלים שהוזמנו בשבת, ודריסה ידנית פר-שבת (is_override).

// מזהי המאכלים שהוזמנו בשבת (מהזמנות שאינן מבוטלות) — כדי לדעת אילו משימות בישול
// רלוונטיות בפועל בשבת זו.
export async function orderedMealIds(shabbatId) {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_meals(meal_id)')
    .eq('shabbat_id', shabbatId)
    .neq('order_status', 'cancelled');
  if (error) throw error;
  return new Set((orders || []).flatMap((order) => order.order_meals || []).map((row) => row.meal_id));
}

// דריסה ידנית של המתנדב הקבוע למשימה בשבת ספציפית (למשל אם הקבוע חולה).
// שומר שורת is_override אחת ל-(שבת, משימה) ע"י delete-then-insert (הטבלה זעירה —
// שורה אחת פר משימה בשבת). volunteerId=null מסיר את הדריסה.
export async function overrideTaskLead(shabbatId, taskId, volunteerId) {
  if (!taskId) return null;
  await clearOverride(shabbatId, taskId);
  if (!volunteerId) return { ok: true };
  const { data, error } = await supabase
    .from('volunteer_assignments')
    .insert({
      shabbat_id: shabbatId,
      task_id: taskId,
      volunteer_id: volunteerId,
      is_override: true,
      is_auto: false,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

// הסרת דריסה — המשימה חוזרת למתנדב הקבוע מהתבנית.
export async function clearOverride(shabbatId, taskId) {
  if (!taskId) return null;
  const { error } = await supabase
    .from('volunteer_assignments')
    .delete()
    .eq('shabbat_id', shabbatId)
    .eq('task_id', taskId);
  if (error) throw error;
  return { ok: true };
}
