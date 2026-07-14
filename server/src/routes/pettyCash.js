// קופה קטנה (Petty Cash) — ספר תנועות גלובלי עם יתרה רצה.
// כל הקריאות מאחורי requireAdmin (נרשם ב-index.js תחת /api/admin/petty-cash).
//
// יתרה = Σ deposits − Σ expenses. אין ספירת מזומן/התאמה — יתרה רצה בלבד.
// הוצאות הקופה נספרות בסך ההוצאות במודול הכספי (routes/finance.js).
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';

const router = Router();

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const KINDS = ['deposit', 'expense'];

// מחזיר את היתרה הרצה ואת סכומי ההפקדות/ההוצאות מכל התנועות.
function summarize(rows) {
  let deposits = 0;
  let expenses = 0;
  for (const r of rows) {
    const amt = Number(r.amount || 0);
    if (r.kind === 'deposit') deposits += amt;
    else if (r.kind === 'expense') expenses += amt;
  }
  return {
    deposits_total: round2(deposits),
    expenses_total: round2(expenses),
    balance: round2(deposits - expenses),
  };
}

// ---------------------------------------------------------------------------
// GET / — כל התנועות (חדש→ישן) + סיכום יתרה
// ---------------------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('petty_cash_transactions')
    .select('id, kind, amount, tx_date, category, description, supplier_id, receipt_number, created_at, suppliers(name)')
    .order('tx_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = (data || []).map((r) => ({
    ...r,
    supplier_name: r.suppliers?.name || null,
    suppliers: undefined,
  }));

  res.json({ transactions: rows, summary: summarize(rows) });
}));

// ---------------------------------------------------------------------------
// POST / — הוספת תנועה (הפקדה או הוצאה)
// ---------------------------------------------------------------------------
router.post('/', asyncHandler(async (req, res) => {
  const { kind, amount, tx_date, category, description, supplier_id, receipt_number } = req.body || {};

  if (!KINDS.includes(kind)) return fail(res, 400, 'סוג תנועה לא תקין (הפקדה או הוצאה).');

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return fail(res, 400, 'יש להזין סכום חיובי.');

  const row = {
    kind,
    amount: round2(amt),
    tx_date: tx_date || undefined,        // ברירת מחדל בבסיס = current_date
    category: category?.trim() || null,
    description: description?.trim() || null,
    supplier_id: kind === 'expense' ? (supplier_id || null) : null,
    receipt_number: receipt_number?.trim() || null,
    created_by: req.appUser?.sub || null,
  };

  const { data, error } = await supabase
    .from('petty_cash_transactions')
    .insert(row)
    .select('id, kind, amount, tx_date, category, description, supplier_id, receipt_number, created_at, suppliers(name)')
    .single();
  if (error) throw error;

  res.status(201).json({ ...data, supplier_name: data.suppliers?.name || null, suppliers: undefined });
}));

// ---------------------------------------------------------------------------
// DELETE /:id — מחיקת תנועה
// ---------------------------------------------------------------------------
router.delete('/:id', asyncHandler(async (req, res) => {
  const { error } = await supabase
    .from('petty_cash_transactions')
    .delete()
    .eq('id', req.params.id);
  if (error) throw error;
  res.json({ ok: true });
}));

export default router;
