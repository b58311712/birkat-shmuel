// הוצאות כלליות - הזנה חופשית (Manual General Expenses).
// כל הקריאות מאחורי requireAdmin (נרשם ב-index.js תחת /api/admin/expenses).
//
// פועל על טבלת general_expenses הקיימת, מוגבל תמיד לשורות ידניות
// (recurring_expense_id is null) - כדי לא לגעת ברשומות שמופיקה ההפקה
// החודשית האוטומטית של הוצאות קבועות (routes/recurringExpenses.js).
// נכנס לסיכום הכספי (routes/finance.js) בדיוק כמו כל general_expenses אחר.
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';

const router = Router();

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const SELECT = 'id, expense_date, amount, payment_method, payment_status, invoice_number, supplier_id, note, created_at, suppliers(name)';

// אמצעי תשלום - רשימה סגורה, שדה חובה (ראו client/src/lib/status.jsx EXPENSE_PAYMENT_METHOD).
const PAYMENT_METHODS = ['cash', 'check', 'credit', 'bank_transfer', 'other'];

// מנקה/מנרמל שדות הוצאה מגוף הבקשה. מחזיר { row, error }.
function buildExpense(body) {
  const { expense_date, amount, payment_method, payment_status, invoice_number, supplier_id, note } = body || {};

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { error: 'יש להזין סכום חיובי.' };

  if (!PAYMENT_METHODS.includes(payment_method)) return { error: 'יש לבחור אמצעי תשלום.' };

  return {
    row: {
      expense_date: expense_date || new Date().toISOString().slice(0, 10),
      amount: round2(amt),
      payment_method,
      payment_status: payment_status || 'unpaid',
      invoice_number: invoice_number?.trim() || null,
      supplier_id: supplier_id || null,
      note: note?.trim() || null,
    },
  };
}

function present(row) {
  return { ...row, supplier_name: row.suppliers?.name || null, suppliers: undefined };
}

// ---------------------------------------------------------------------------
// GET / - כל ההוצאות הידניות (חדש→ישן) + סיכום
// ---------------------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('general_expenses')
    .select(SELECT)
    .is('recurring_expense_id', null)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = (data || []).map(present);
  const total = round2(rows.reduce((s, r) => s + Number(r.amount || 0), 0));
  const paidTotal = round2(rows.filter((r) => r.payment_status === 'paid').reduce((s, r) => s + Number(r.amount || 0), 0));

  res.json({
    expenses: rows,
    summary: { count: rows.length, total, paid_total: paidTotal, open_total: round2(total - paidTotal) },
  });
}));

// ---------------------------------------------------------------------------
// POST / - יצירת הוצאה ידנית
// ---------------------------------------------------------------------------
router.post('/', asyncHandler(async (req, res) => {
  const { row, error: vErr } = buildExpense(req.body);
  if (vErr) return fail(res, 400, vErr);

  row.created_by = req.appUser?.sub || null;

  const { data, error } = await supabase
    .from('general_expenses')
    .insert(row)
    .select(SELECT)
    .single();
  if (error) throw error;

  res.status(201).json(present(data));
}));

// ---------------------------------------------------------------------------
// PUT /:id - עריכת הוצאה ידנית
// ---------------------------------------------------------------------------
router.put('/:id', asyncHandler(async (req, res) => {
  const { row, error: vErr } = buildExpense(req.body);
  if (vErr) return fail(res, 400, vErr);

  const { data, error } = await supabase
    .from('general_expenses')
    .update(row)
    .eq('id', req.params.id)
    .is('recurring_expense_id', null)
    .select(SELECT)
    .single();
  if (error) throw error;
  if (!data) return fail(res, 404, 'ההוצאה לא נמצאה.');

  res.json(present(data));
}));

// ---------------------------------------------------------------------------
// DELETE /:id - מחיקת הוצאה ידנית
// ---------------------------------------------------------------------------
router.delete('/:id', asyncHandler(async (req, res) => {
  const { error } = await supabase
    .from('general_expenses')
    .delete()
    .eq('id', req.params.id)
    .is('recurring_expense_id', null);
  if (error) throw error;
  res.json({ ok: true });
}));

export default router;
