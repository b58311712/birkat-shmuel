// לוגיקת הפקת הוצאות קבועות - משותפת לנתיב הניהול (הפקה ידנית) ולנתיב ה-CRON (אוטומטי).
import { supabase } from '../lib/supabase.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// אימות מפתח חודש בפורמט YYYY-MM
export function isMonthKey(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

// מפתח החודש הנוכחי (YYYY-MM) לפי תאריך נתון (ברירת מחדל: היום).
export function monthKeyOf(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// בונה תאריך expense_date מתוך חודש (YYYY-MM) ויום בחודש (מוגבל ל-1..28).
function expenseDateFor(periodMonth, dayOfMonth) {
  const day = String(Math.min(Math.max(Number(dayOfMonth) || 1, 1), 28)).padStart(2, '0');
  return `${periodMonth}-${day}`;
}

// בונה רשומת general_expenses מתבנית לחודש נתון.
function rowFromTemplate(t, month, createdBy) {
  return {
    recurring_expense_id: t.id,
    period_month: month,
    expense_date: expenseDateFor(month, t.day_of_month),
    amount: round2(Number(t.amount || 0)),
    supplier_id: t.supplier_id || null,
    payment_method: t.payment_method || null,
    payment_status: 'unpaid',
    note: [t.name, t.category, t.note].filter(Boolean).join(' · ') || null,
    created_by: createdBy || null,
  };
}

// מפיק הוצאות לחודש נתון מכל התבניות הפעילות (idempotent - מדלג על מה שכבר הופק).
// אם onlyDayOfMonth מוגדר (1..28), מפיק רק תבניות שה-day_of_month שלהן שווה לו (למצב CRON יומי).
// מחזיר { month, created_count, skipped_count, created }.
export async function generateForMonth({ month, createdBy = null, onlyDayOfMonth = null } = {}) {
  if (!isMonthKey(month)) throw new Error('חודש לא תקין (נדרש YYYY-MM).');

  // תבניות פעילות (מסונן ליום ספציפי במצב CRON)
  let query = supabase
    .from('recurring_expenses')
    .select('id, amount, day_of_month, category, supplier_id, payment_method, note, name')
    .eq('is_active', true);
  if (onlyDayOfMonth != null) query = query.eq('day_of_month', onlyDayOfMonth);

  const { data: templates, error: tplErr } = await query;
  if (tplErr) throw tplErr;

  // מה כבר הופק לחודש הזה (מניעת כפילות מעבר לאינדקס הייחודי)
  const { data: existing, error: exErr } = await supabase
    .from('general_expenses')
    .select('recurring_expense_id')
    .eq('period_month', month)
    .not('recurring_expense_id', 'is', null);
  if (exErr) throw exErr;
  const alreadyGenerated = new Set((existing || []).map((r) => r.recurring_expense_id));

  const toInsert = (templates || [])
    .filter((t) => !alreadyGenerated.has(t.id))
    .map((t) => rowFromTemplate(t, month, createdBy));

  let created = [];
  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from('general_expenses')
      .insert(toInsert)
      .select('id, recurring_expense_id, expense_date, amount, note');
    if (error) throw error;
    created = data || [];
  }

  return {
    month,
    created_count: created.length,
    skipped_count: (templates || []).length - toInsert.length,
    created,
  };
}
