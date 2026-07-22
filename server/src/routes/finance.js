// מודול כספי כללי (סעיף 29) - הכנסות, הוצאות ודוחות כספיים.
// כל הקריאות מאחורי requireAdmin (נרשם ב-index.js תחת /api/admin/finance).
//
// מקורות אמת:
//   הכנסות  - orders.final_amount (צפוי) מול customer_payments.amount (שולם).
//   הוצאות  - supplier_payments.amount_paid + general_expenses.amount
//             + petty_cash_transactions (kind='expense') - הוצאות הקופה הקטנה.
// הזמנות מבוטלות אינן נספרות בצפוי (final_amount לא רלוונטי לגבייה).
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/helpers.js';

const router = Router();

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const ACTIVE = ['pending_approval', 'approved', 'needs_correction', 'delivered'];

// מפתח חודש YYYY-MM מתוך תאריך (date/ISO). מחזיר null אם אין תאריך.
function monthKey(dateStr) {
  return dateStr ? String(dateStr).slice(0, 7) : null;
}
function yearKey(dateStr) {
  return dateStr ? String(dateStr).slice(0, 4) : null;
}

// ---------------------------------------------------------------------------
// GET /api/admin/finance/summary - תמונה כוללת: הכנסות, הוצאות ודוחות (סעיף 29)
// ---------------------------------------------------------------------------
router.get('/summary', asyncHandler(async (req, res) => {
  // הזמנות פעילות עם השבת שלהן (לצורך קיבוץ הכנסות לפי שבת/חודש/שנה)
  const [ordersRes, paymentsRes, supPaymentsRes, expensesRes, refundsRes, pettyRes] = await Promise.all([
    supabase.from('orders')
      .select('id, order_number, final_amount, payment_status, order_status, shabbat_id, shabbatot(parasha, gregorian_date)')
      .in('order_status', ACTIVE),
    supabase.from('customer_payments').select('order_id, amount, paid_at'),
    supabase.from('supplier_payments').select('supplier_id, amount_paid, invoice_amount, status, paid_at, suppliers(name)'),
    supabase.from('general_expenses').select('supplier_id, amount, expense_date, payment_status, suppliers(name)'),
    supabase.from('order_refunds').select('id, amount_to_refund, amount_refunded, status'),
    supabase.from('petty_cash_transactions').select('kind, amount, tx_date, supplier_id, suppliers(name)'),
  ]);

  for (const r of [ordersRes, paymentsRes, supPaymentsRes, expensesRes, refundsRes, pettyRes]) {
    if (r.error) throw r.error;
  }

  const orders = ordersRes.data || [];
  const payments = paymentsRes.data || [];
  const supPayments = supPaymentsRes.data || [];
  const expenses = expensesRes.data || [];
  const refunds = refundsRes.data || [];
  // רק הוצאות הקופה הקטנה נספרות כהוצאה (הפקדות הן מימון פנימי, לא הוצאה כספית).
  const pettyExpenses = (pettyRes.data || []).filter((t) => t.kind === 'expense');

  // --- הכנסות (29.1) ---
  const expectedTotal = round2(orders.reduce((s, o) => s + Number(o.final_amount || 0), 0));

  // שולם בפועל לכל הזמנה
  const paidByOrder = new Map();
  for (const p of payments) {
    paidByOrder.set(p.order_id, round2((paidByOrder.get(p.order_id) || 0) + Number(p.amount || 0)));
  }
  // סך שולם - רק על הזמנות פעילות (מתעלם מתשלומים על הזמנות מבוטלות)
  const activeOrderIds = new Set(orders.map((o) => o.id));
  const paidTotal = round2(
    payments
      .filter((p) => activeOrderIds.has(p.order_id))
      .reduce((s, p) => s + Number(p.amount || 0), 0),
  );

  const openBalance = round2(expectedTotal - paidTotal);

  // קיבוצים לפי שבת / חודש / שנה (לפי תאריך השבת)
  const byShabbat = new Map();   // shabbat_id -> { label, date, expected, paid }
  const byMonth = new Map();     // YYYY-MM   -> { expected, paid }
  const byYear = new Map();      // YYYY      -> { expected, paid }

  for (const o of orders) {
    const gdate = o.shabbatot?.gregorian_date || null;
    const expected = Number(o.final_amount || 0);
    const paid = paidByOrder.get(o.id) || 0;

    const sKey = o.shabbat_id;
    if (sKey) {
      const cur = byShabbat.get(sKey) || {
        shabbat_id: sKey,
        label: o.shabbatot?.parasha || '-',
        date: gdate,
        expected: 0, paid: 0,
      };
      cur.expected = round2(cur.expected + expected);
      cur.paid = round2(cur.paid + paid);
      byShabbat.set(sKey, cur);
    }

    const mKey = monthKey(gdate);
    if (mKey) {
      const cur = byMonth.get(mKey) || { month: mKey, expected: 0, paid: 0 };
      cur.expected = round2(cur.expected + expected);
      cur.paid = round2(cur.paid + paid);
      byMonth.set(mKey, cur);
    }

    const yKey = yearKey(gdate);
    if (yKey) {
      const cur = byYear.get(yKey) || { year: yKey, expected: 0, paid: 0 };
      cur.expected = round2(cur.expected + expected);
      cur.paid = round2(cur.paid + paid);
      byYear.set(yKey, cur);
    }
  }

  const incomeByShabbat = [...byShabbat.values()]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const incomeByMonth = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
  const incomeByYear = [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year));

  // --- הוצאות (29.2) ---
  // תשלומים לספקים ששולמו בפועל
  const supplierPaidTotal = round2(
    supPayments.reduce((s, p) => s + Number(p.amount_paid || 0), 0),
  );
  const generalExpensesTotal = round2(
    expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
  );
  // הוצאות הקופה הקטנה (סעיף קופה קטנה) - נספרות בסך ההוצאות.
  const pettyCashTotal = round2(
    pettyExpenses.reduce((s, t) => s + Number(t.amount || 0), 0),
  );
  const expensesTotal = round2(supplierPaidTotal + generalExpensesTotal + pettyCashTotal);

  // חשבוניות פתוחות = תשלומי ספק/הוצאות שטרם שולמו במלואם
  const openSupplierInvoices = supPayments.filter(
    (p) => ['unpaid', 'partially_paid', 'awaiting_invoice'].includes(p.status),
  ).length;
  const openGeneralExpenses = expenses.filter(
    (e) => ['unpaid', 'partially_paid', 'awaiting_invoice'].includes(e.payment_status),
  ).length;

  // הוצאות לפי ספק (מאחד תשלומי ספק + הוצאות כלליות)
  const bySupplier = new Map(); // supplier_id -> { name, amount }
  for (const p of supPayments) {
    if (!p.supplier_id) continue;
    const cur = bySupplier.get(p.supplier_id) || { supplier_id: p.supplier_id, name: p.suppliers?.name || '-', amount: 0 };
    cur.amount = round2(cur.amount + Number(p.amount_paid || 0));
    bySupplier.set(p.supplier_id, cur);
  }
  for (const e of expenses) {
    if (!e.supplier_id) continue;
    const cur = bySupplier.get(e.supplier_id) || { supplier_id: e.supplier_id, name: e.suppliers?.name || '-', amount: 0 };
    cur.amount = round2(cur.amount + Number(e.amount || 0));
    bySupplier.set(e.supplier_id, cur);
  }
  for (const t of pettyExpenses) {
    if (!t.supplier_id) continue;
    const cur = bySupplier.get(t.supplier_id) || { supplier_id: t.supplier_id, name: t.suppliers?.name || '-', amount: 0 };
    cur.amount = round2(cur.amount + Number(t.amount || 0));
    bySupplier.set(t.supplier_id, cur);
  }
  const expensesBySupplier = [...bySupplier.values()].sort((a, b) => b.amount - a.amount);

  // הוצאות לפי חודש (לפי תאריך תשלום/הוצאה)
  const expByMonth = new Map();
  for (const p of supPayments) {
    const mKey = monthKey(p.paid_at);
    if (!mKey) continue;
    const cur = expByMonth.get(mKey) || { month: mKey, amount: 0 };
    cur.amount = round2(cur.amount + Number(p.amount_paid || 0));
    expByMonth.set(mKey, cur);
  }
  for (const e of expenses) {
    const mKey = monthKey(e.expense_date);
    if (!mKey) continue;
    const cur = expByMonth.get(mKey) || { month: mKey, amount: 0 };
    cur.amount = round2(cur.amount + Number(e.amount || 0));
    expByMonth.set(mKey, cur);
  }
  for (const t of pettyExpenses) {
    const mKey = monthKey(t.tx_date);
    if (!mKey) continue;
    const cur = expByMonth.get(mKey) || { month: mKey, amount: 0 };
    cur.amount = round2(cur.amount + Number(t.amount || 0));
    expByMonth.set(mKey, cur);
  }
  const expensesByMonth = [...expByMonth.values()].sort((a, b) => b.month.localeCompare(a.month));

  // --- דוחות כספיים (29.3) ---
  // חובות לקוחות = יתרה פתוחה להזמנות פעילות שלא שולמו/חלקית
  const customerDebts = orders
    .map((o) => ({
      id: o.id,
      order_number: o.order_number,
      shabbat: o.shabbatot?.parasha || null,
      final_amount: round2(Number(o.final_amount || 0)),
      paid: round2(paidByOrder.get(o.id) || 0),
      balance: round2(Number(o.final_amount || 0) - (paidByOrder.get(o.id) || 0)),
      payment_status: o.payment_status,
    }))
    .filter((o) => o.balance > 0.001)
    .sort((a, b) => b.balance - a.balance);
  const customerDebtsTotal = round2(customerDebts.reduce((s, o) => s + o.balance, 0));

  // חובות לספקים = invoice_amount שטרם שולם
  const supplierDebtsTotal = round2(
    supPayments
      .filter((p) => p.status !== 'paid' && p.status !== 'cancelled')
      .reduce((s, p) => s + (Number(p.invoice_amount || 0) - Number(p.amount_paid || 0)), 0),
  );

  const unpaidOrders = orders.filter((o) => o.payment_status === 'unpaid').length;
  const partiallyPaidOrders = orders.filter((o) => o.payment_status === 'partially_paid').length;
  const openRefunds = refunds.filter((r) => r.status === 'pending').length;
  const openRefundsAmount = round2(
    refunds.filter((r) => r.status === 'pending')
      .reduce((s, r) => s + Number(r.amount_to_refund || 0), 0),
  );

  res.json({
    income: {
      expected_total: expectedTotal,
      paid_total: paidTotal,
      open_balance: openBalance,
      by_shabbat: incomeByShabbat,
      by_month: incomeByMonth,
      by_year: incomeByYear,
    },
    expenses: {
      total: expensesTotal,
      supplier_paid: supplierPaidTotal,
      general_expenses: generalExpensesTotal,
      petty_cash: pettyCashTotal,
      open_supplier_invoices: openSupplierInvoices,
      open_general_expenses: openGeneralExpenses,
      by_supplier: expensesBySupplier,
      by_month: expensesByMonth,
    },
    reports: {
      income_vs_expenses: {
        income: paidTotal,
        expenses: expensesTotal,
        net: round2(paidTotal - expensesTotal),
      },
      customer_debts_total: customerDebtsTotal,
      customer_debts: customerDebts,
      supplier_debts_total: supplierDebtsTotal,
      unpaid_orders: unpaidOrders,
      partially_paid_orders: partiallyPaidOrders,
      open_refunds: openRefunds,
      open_refunds_amount: openRefundsAmount,
    },
  });
}));

export default router;
