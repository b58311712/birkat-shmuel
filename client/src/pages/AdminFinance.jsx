import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';

// מודול כספי כללי (סעיף 29) — הכנסות, הוצאות ודוחות כספיים.
// כרטיסי KPI עליונים + טבלאות פירוט לפי שבת/חודש/ספק + רשימת חובות לקוחות.
export default function AdminFinance({ onAuthError }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.financeSummary().then(setData).catch((err) => {
      if (err.name === 'AdminAuthError') onAuthError?.();
      else setError(err.message || 'שגיאה בטעינת הנתונים הכספיים.');
    });
  }, [onAuthError]);

  if (error) {
    return (
      <Page title="מודול כספי">
        <div className="card text-red-600">{error}</div>
      </Page>
    );
  }

  if (!data) {
    return (
      <Page title="מודול כספי" subtitle="טוען נתונים…">
        <div className="card">טוען…</div>
      </Page>
    );
  }

  const { income, expenses, reports } = data;
  const net = reports.income_vs_expenses.net;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      {/* --- באנר-כותרת עם מספרי-על --- */}
      <div className="bg-gradient-to-l from-brand-burgundy to-brand-burgundy-dark rounded-3xl p-6 sm:p-8 text-brand-cream shadow-card mb-6 relative overflow-hidden">
        <div className="absolute -left-8 -top-8 w-40 h-40 rounded-full bg-brand-gold/10" aria-hidden="true" />
        <div className="absolute -left-16 top-10 w-52 h-52 rounded-full bg-brand-gold/5" aria-hidden="true" />
        <div className="relative">
          <h1 className="text-2xl sm:text-3xl font-extrabold">מודול כספי</h1>
          <p className="text-brand-cream/75 mt-1">הכנסות, הוצאות ודוחות כספיים</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
            <HeroStat label="הכנסה צפויה" value={income.expected_total} />
            <HeroStat label="שולם בפועל" value={income.paid_total} accent />
            <HeroStat label="יתרה פתוחה לגבייה" value={income.open_balance} warn={income.open_balance > 0} />
          </div>
        </div>
      </div>

      {/* --- KPI משני --- */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="הכנסות בניכוי הוצאות (נטו)" value={net} tone={net >= 0 ? 'green' : 'red'} />
        <Kpi label="הוצאות (שולמו)" value={expenses.total} tone="neutral" />
        <Kpi label="חובות לקוחות" value={reports.customer_debts_total} tone={reports.customer_debts_total > 0 ? 'amber' : 'neutral'} />
        <Kpi label="חובות לספקים" value={reports.supplier_debts_total} tone={reports.supplier_debts_total > 0 ? 'amber' : 'neutral'} />
      </div>

      {/* --- דוחות מהירים --- */}
      <div className="card mb-6">
        <h2 className="font-bold text-brand-burgundy mb-3">דוחות כספיים</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat label="הזמנות שלא שולמו" value={reports.unpaid_orders} to="/admin/orders" />
          <MiniStat label="שולמו חלקית" value={reports.partially_paid_orders} to="/admin/orders" />
          <MiniStat label="החזרים פתוחים" value={reports.open_refunds} sub={nis(reports.open_refunds_amount)} to="/admin/orders" />
          <MiniStat label="חשבוניות ספק פתוחות" value={expenses.open_supplier_invoices} to="/admin/suppliers" />
        </div>
      </div>

      {/* --- חובות לקוחות --- */}
      <Section title={`חובות לקוחות (${reports.customer_debts.length})`}>
        {reports.customer_debts.length === 0 ? (
          <Empty>אין חובות פתוחים — כל ההזמנות הפעילות שולמו במלואן.</Empty>
        ) : (
          <Table head={['הזמנה', 'שבת', 'סכום סופי', 'שולם', 'יתרה', '']}>
            {reports.customer_debts.map((o) => (
              <tr key={o.id} className="border-t border-brand-cream-dark">
                <td className="p-3 font-medium" dir="ltr">{o.order_number}</td>
                <td className="p-3">{o.shabbat || '—'}</td>
                <td className="p-3" dir="ltr">{nis(o.final_amount)}</td>
                <td className="p-3" dir="ltr">{nis(o.paid)}</td>
                <td className="p-3 font-semibold text-red-700" dir="ltr">{nis(o.balance)}</td>
                <td className="p-3">
                  <Link to={`/admin/orders/${o.id}`} className="text-brand-gold-dark hover:underline text-sm">פתיחה</Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* --- הכנסות לפי שבת --- */}
      <Section title="הכנסות לפי שבת">
        {income.by_shabbat.length === 0 ? (
          <Empty>אין הזמנות פעילות.</Empty>
        ) : (
          <Table head={['שבת', 'תאריך', 'צפוי', 'שולם', 'יתרה']}>
            {income.by_shabbat.map((s) => (
              <tr key={s.shabbat_id} className="border-t border-brand-cream-dark">
                <td className="p-3 font-medium">{s.label}</td>
                <td className="p-3 text-sm" dir="ltr">{s.date || '—'}</td>
                <td className="p-3" dir="ltr">{nis(s.expected)}</td>
                <td className="p-3" dir="ltr">{nis(s.paid)}</td>
                <td className="p-3" dir="ltr">{nis(round2(s.expected - s.paid))}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* --- הכנסות לפי חודש --- */}
      <Section title="הכנסות לפי חודש">
        {income.by_month.length === 0 ? (
          <Empty>אין נתונים.</Empty>
        ) : (
          <Table head={['חודש', 'צפוי', 'שולם']}>
            {income.by_month.map((m) => (
              <tr key={m.month} className="border-t border-brand-cream-dark">
                <td className="p-3 font-medium" dir="ltr">{m.month}</td>
                <td className="p-3" dir="ltr">{nis(m.expected)}</td>
                <td className="p-3" dir="ltr">{nis(m.paid)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* --- הוצאות לפי ספק --- */}
      <Section title="הוצאות לפי ספק">
        {expenses.by_supplier.length === 0 ? (
          <Empty>טרם נרשמו הוצאות לספקים.</Empty>
        ) : (
          <Table head={['ספק', 'סכום']}>
            {expenses.by_supplier.map((s) => (
              <tr key={s.supplier_id} className="border-t border-brand-cream-dark">
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3" dir="ltr">{nis(s.amount)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* --- הוצאות לפי חודש --- */}
      <Section title="הוצאות לפי חודש">
        {expenses.by_month.length === 0 ? (
          <Empty>אין נתונים.</Empty>
        ) : (
          <Table head={['חודש', 'סכום']}>
            {expenses.by_month.map((m) => (
              <tr key={m.month} className="border-t border-brand-cream-dark">
                <td className="p-3 font-medium" dir="ltr">{m.month}</td>
                <td className="p-3" dir="ltr">{nis(m.amount)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// עזרים ורכיבי תצוגה
// ---------------------------------------------------------------------------
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function nis(n) {
  return `₪${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// מספר-על בתוך הבאנר הכהה. accent=מודגש בזהב, warn=מודגש בכתום-בהיר.
function HeroStat({ label, value, accent = false, warn = false }) {
  const valueColor = warn ? 'text-amber-300' : accent ? 'text-brand-gold-light' : 'text-brand-cream';
  return (
    <div className="bg-brand-cream/10 backdrop-blur rounded-2xl px-4 py-3 border border-brand-gold/20">
      <div className={`text-2xl font-extrabold leading-none ${valueColor}`} dir="ltr">{nis(value)}</div>
      <div className="text-sm text-brand-cream/70 mt-1.5">{label}</div>
    </div>
  );
}

const KPI_TONES = {
  neutral: 'bg-white border-brand-cream-dark text-brand-burgundy',
  green: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
  red: 'bg-red-50 border-red-200 text-red-700',
};

function Kpi({ label, value, tone = 'neutral', big = false }) {
  return (
    <div className={`rounded-xl border p-4 ${KPI_TONES[tone]}`}>
      <div className={`${big ? 'text-2xl' : 'text-xl'} font-extrabold leading-none`} dir="ltr">{nis(value)}</div>
      <div className="text-sm font-medium mt-2">{label}</div>
    </div>
  );
}

function MiniStat({ label, value, sub, to }) {
  const inner = (
    <>
      <div className="text-2xl font-extrabold text-brand-burgundy leading-none">{value ?? 0}</div>
      <div className="text-sm font-medium text-brand-burgundy/80 mt-1">{label}</div>
      {sub && <div className="text-xs text-brand-burgundy/60 mt-0.5" dir="ltr">{sub}</div>}
    </>
  );
  return to
    ? <Link to={to} className="block rounded-lg border border-brand-cream-dark p-3 hover:border-brand-gold transition-colors">{inner}</Link>
    : <div className="rounded-lg border border-brand-cream-dark p-3">{inner}</div>;
}

function Section({ title, children }) {
  return (
    <section className="mb-6">
      <h2 className="font-bold text-brand-burgundy mb-2">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, children }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-right">
        <thead>
          <tr className="bg-brand-cream text-brand-burgundy text-sm">
            {head.map((h, i) => <th key={i} className="p-3 font-semibold whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Empty({ children }) {
  return <div className="card text-brand-burgundy/60">{children}</div>;
}
