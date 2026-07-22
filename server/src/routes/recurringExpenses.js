// הוצאות קבועות חודשיות (Recurring Expenses) - תבניות תקורה חוזרת + הפקה חודשית.
// כל הקריאות מאחורי requireAdmin (נרשם ב-index.js תחת /api/admin/recurring-expenses).
//
// מודל: מגדירים "תבנית" פעם אחת (שם, סכום, יום בחודש, קטגוריה, ספק).
//       הפקה חודשית יוצרת רשומת general_expenses אמיתית לכל חודש - idempotent
//       (unique על recurring_expense_id+period_month מונע כפילות).
//       הרשומות המופקות נכנסות לסיכום הכספי (routes/finance.js) כמו כל הוצאה כללית.
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { generateForMonth, isMonthKey } from '../services/recurringExpenses.js';

const router = Router();

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// מנקה/מנרמל שדות תבנית מגוף הבקשה. מחזיר { row, error }.
function buildTemplate(body) {
  const { name, amount, day_of_month, category, supplier_id, payment_method, note, is_active } = body || {};

  if (!name || !String(name).trim()) return { error: 'יש להזין שם להוצאה.' };

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { error: 'יש להזין סכום חיובי.' };

  let day = Number(day_of_month);
  if (!Number.isInteger(day)) day = 1;
  if (day < 1 || day > 28) return { error: 'יום בחודש חייב להיות בין 1 ל-28.' };

  return {
    row: {
      name: String(name).trim(),
      amount: round2(amt),
      day_of_month: day,
      category: category?.trim() || null,
      supplier_id: supplier_id || null,
      payment_method: payment_method?.trim() || null,
      note: note?.trim() || null,
      is_active: is_active === undefined ? true : !!is_active,
    },
  };
}

// ---------------------------------------------------------------------------
// GET / - כל התבניות (פעילות תחילה) + סיכום עלות חודשית
// ---------------------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .select('id, name, amount, day_of_month, category, supplier_id, payment_method, note, is_active, created_at, suppliers(name)')
    .order('is_active', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw error;

  const templates = (data || []).map((t) => ({
    ...t,
    supplier_name: t.suppliers?.name || null,
    suppliers: undefined,
  }));

  const monthlyTotal = round2(
    templates.filter((t) => t.is_active).reduce((s, t) => s + Number(t.amount || 0), 0),
  );

  res.json({ templates, monthly_total: monthlyTotal });
}));

// ---------------------------------------------------------------------------
// POST / - יצירת תבנית הוצאה קבועה
// ---------------------------------------------------------------------------
router.post('/', asyncHandler(async (req, res) => {
  const { row, error: vErr } = buildTemplate(req.body);
  if (vErr) return fail(res, 400, vErr);

  row.created_by = req.appUser?.sub || null;

  const { data, error } = await supabase
    .from('recurring_expenses')
    .insert(row)
    .select('id, name, amount, day_of_month, category, supplier_id, payment_method, note, is_active, created_at, suppliers(name)')
    .single();
  if (error) throw error;

  res.status(201).json({ ...data, supplier_name: data.suppliers?.name || null, suppliers: undefined });
}));

// ---------------------------------------------------------------------------
// PUT /:id - עריכת תבנית
// ---------------------------------------------------------------------------
router.put('/:id', asyncHandler(async (req, res) => {
  const { row, error: vErr } = buildTemplate(req.body);
  if (vErr) return fail(res, 400, vErr);

  const { data, error } = await supabase
    .from('recurring_expenses')
    .update(row)
    .eq('id', req.params.id)
    .select('id, name, amount, day_of_month, category, supplier_id, payment_method, note, is_active, created_at, suppliers(name)')
    .single();
  if (error) throw error;
  if (!data) return fail(res, 404, 'התבנית לא נמצאה.');

  res.json({ ...data, supplier_name: data.suppliers?.name || null, suppliers: undefined });
}));

// ---------------------------------------------------------------------------
// DELETE /:id - מחיקת תבנית (השבתה רכה כדי לא לפגוע ברשומות שכבר הופקו)
// ---------------------------------------------------------------------------
router.delete('/:id', asyncHandler(async (req, res) => {
  const { error } = await supabase
    .from('recurring_expenses')
    .update({ is_active: false })
    .eq('id', req.params.id);
  if (error) throw error;
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// GET /generation-status?month=YYYY-MM - אילו תבניות פעילות כבר הופקו לחודש
// ---------------------------------------------------------------------------
router.get('/generation-status', asyncHandler(async (req, res) => {
  const month = req.query.month;
  if (!isMonthKey(month)) return fail(res, 400, 'חודש לא תקין (נדרש YYYY-MM).');

  const [tplRes, genRes] = await Promise.all([
    supabase.from('recurring_expenses')
      .select('id, name, amount, day_of_month, category')
      .eq('is_active', true),
    supabase.from('general_expenses')
      .select('recurring_expense_id')
      .eq('period_month', month)
      .not('recurring_expense_id', 'is', null),
  ]);
  if (tplRes.error) throw tplRes.error;
  if (genRes.error) throw genRes.error;

  const generatedIds = new Set((genRes.data || []).map((r) => r.recurring_expense_id));
  const templates = (tplRes.data || []).map((t) => ({
    ...t,
    already_generated: generatedIds.has(t.id),
  }));
  const pending = templates.filter((t) => !t.already_generated);

  res.json({
    month,
    templates,
    pending_count: pending.length,
    pending_total: round2(pending.reduce((s, t) => s + Number(t.amount || 0), 0)),
  });
}));

// ---------------------------------------------------------------------------
// GET /generated?month=YYYY-MM - טבלת ההוצאות שכבר הופקו מתבניות קבועות.
// ללא month → כל ההוצאות המופקות (חדש→ישן). מחזיר גם סיכום ופירוט תשלום.
// ---------------------------------------------------------------------------
router.get('/generated', asyncHandler(async (req, res) => {
  const month = req.query.month;
  if (month && !isMonthKey(month)) return fail(res, 400, 'חודש לא תקין (נדרש YYYY-MM).');

  let query = supabase
    .from('general_expenses')
    .select('id, period_month, expense_date, amount, payment_status, payment_method, note, recurring_expense_id, supplier_id, suppliers(name), recurring_expenses(name, category)')
    .not('recurring_expense_id', 'is', null)
    .order('expense_date', { ascending: false });
  if (month) query = query.eq('period_month', month);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).map((r) => ({
    id: r.id,
    period_month: r.period_month,
    expense_date: r.expense_date,
    amount: round2(Number(r.amount || 0)),
    payment_status: r.payment_status,
    payment_method: r.payment_method,
    note: r.note,
    name: r.recurring_expenses?.name || null,
    category: r.recurring_expenses?.category || null,
    supplier_name: r.suppliers?.name || null,
  }));

  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const paidTotal = round2(rows.filter((r) => r.payment_status === 'paid').reduce((s, r) => s + r.amount, 0));

  res.json({
    month: month || null,
    expenses: rows,
    summary: { count: rows.length, total, paid_total: paidTotal, open_total: round2(total - paidTotal) },
  });
}));

// ---------------------------------------------------------------------------
// POST /generate - הפקת הוצאות חודשיות מכל התבניות הפעילות לחודש נתון.
// body: { month: "YYYY-MM" }. idempotent - מדלג על תבניות שכבר הופקו לחודש.
// ---------------------------------------------------------------------------
router.post('/generate', asyncHandler(async (req, res) => {
  const month = req.body?.month;
  if (!isMonthKey(month)) return fail(res, 400, 'חודש לא תקין (נדרש YYYY-MM).');

  const result = await generateForMonth({ month, createdBy: req.appUser?.sub || null });
  res.json(result);
}));

export default router;
