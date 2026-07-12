import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ActionIconLink } from '../components/ActionIcon.jsx';

export default function AdminFinance({ onAuthError }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.financeSummary().then(setData).catch((err) => {
      if (err.name === 'AdminAuthError') onAuthError?.();
      else setError(err.message || 'שגיאה בטעינת הנתונים הכספיים.');
    });
  }, [onAuthError]);

  if (error) return <FinanceState title="לא ניתן לטעון את המודול הכספי" message={error} error />;
  if (!data) return <FinanceLoading />;

  const { income, expenses, reports } = data;
  const net = reports.income_vs_expenses.net;

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-brand-gold/20 bg-brand-gold/[0.08] px-3 py-1 text-xs font-bold text-brand-gold-dark">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" /> תמונת מצב כספית
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#2b2024] sm:text-3xl">דשבורד כספי</h1>
          <p className="mt-1 text-sm text-[#7c7175]">הכנסות, הוצאות, יתרות ודוחות במקום אחד.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/orders" className="rounded-xl border border-black/[0.07] bg-white px-4 py-2.5 text-sm font-bold text-brand-burgundy shadow-[0_5px_16px_rgba(42,31,36,0.05)] transition hover:border-brand-gold/35">הזמנות</Link>
          <Link to="/admin/suppliers" className="rounded-xl bg-brand-burgundy px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_18px_rgba(92,26,46,0.16)] transition hover:bg-brand-burgundy-light">ספקים ותשלומים</Link>
        </div>
      </header>

      <section className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="מדדי הכנסה">
        <PrimaryMetric label="הכנסה צפויה" value={income.expected_total} icon="expected" />
        <PrimaryMetric label="שולם בפועל" value={income.paid_total} icon="paid" positive />
        <PrimaryMetric label="יתרה פתוחה לגבייה" value={income.open_balance} icon="open" warning={income.open_balance > 0} />
      </section>

      <section className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="מדדים נוספים">
        <SecondaryMetric label="נטו לאחר הוצאות" value={net} tone={net >= 0 ? 'positive' : 'danger'} />
        <SecondaryMetric label="הוצאות ששולמו" value={expenses.total} />
        <SecondaryMetric label="חובות לקוחות" value={reports.customer_debts_total} tone={reports.customer_debts_total > 0 ? 'warning' : 'neutral'} />
        <SecondaryMetric label="חובות לספקים" value={reports.supplier_debts_total} tone={reports.supplier_debts_total > 0 ? 'warning' : 'neutral'} />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,.75fr)]" aria-label="ניתוח חזותי">
        <MonthlyChart income={income.by_month} expenses={expenses.by_month} />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <CollectionDonut paid={income.paid_total} expected={income.expected_total} />
          <MoneyBreakdown paid={income.paid_total} open={income.open_balance} expenses={expenses.total} />
        </div>
      </section>

      <section className="pilot-panel mt-5 p-5 sm:p-6">
        <div className="flex items-end justify-between gap-3">
          <div><p className="text-xs font-bold text-brand-gold-dark">גישה מהירה</p><h2 className="mt-0.5 text-lg font-extrabold text-[#2b2024]">דוחות שדורשים תשומת לב</h2></div>
          <span className="hidden text-xs font-semibold text-[#91878a] sm:block">הנתונים מתעדכנים אוטומטית</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <ReportLink label="הזמנות שלא שולמו" value={reports.unpaid_orders} to="/admin/orders" />
          <ReportLink label="שולמו חלקית" value={reports.partially_paid_orders} to="/admin/orders" />
          <ReportLink label="החזרים פתוחים" value={reports.open_refunds} sub={nis(reports.open_refunds_amount)} to="/admin/orders" />
          <ReportLink label="חשבוניות ספק פתוחות" value={expenses.open_supplier_invoices} to="/admin/suppliers" />
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <FinancePanel title="חובות לקוחות" subtitle={`${reports.customer_debts.length} יתרות פתוחות`} full>
          {reports.customer_debts.length === 0 ? <Empty>אין חובות פתוחים — כל ההזמנות הפעילות שולמו במלואן.</Empty> : (
            <FinanceTable head={['הזמנה', 'שבת', 'סכום סופי', 'שולם', 'יתרה', '']}>
              {reports.customer_debts.map((order) => (
                <tr key={order.id}>
                  <td className="px-5 py-4 font-mono text-xs font-bold text-brand-burgundy" dir="ltr">{order.order_number}</td>
                  <td className="px-4 py-4 font-medium">{order.shabbat || '—'}</td>
                  <MoneyCell value={order.final_amount} />
                  <MoneyCell value={order.paid} muted />
                  <MoneyCell value={order.balance} danger />
                  <td className="px-4 py-4"><ActionIconLink as={Link} to={`/admin/orders/${order.id}`} icon="open" label="פתיחה" tone="warning" /></td>
                </tr>
              ))}
            </FinanceTable>
          )}
        </FinancePanel>

        <FinancePanel title="הכנסות לפי שבת" subtitle="צפוי מול שולם">
          {income.by_shabbat.length === 0 ? <Empty>אין הזמנות פעילות.</Empty> : (
            <FinanceTable head={['שבת', 'תאריך', 'צפוי', 'שולם', 'יתרה']}>
              {income.by_shabbat.map((row) => (
                <tr key={row.shabbat_id}>
                  <td className="px-5 py-4 font-bold">{row.label}</td>
                  <td className="px-4 py-4 text-sm text-[#82777b]" dir="ltr">{row.date || '—'}</td>
                  <MoneyCell value={row.expected} /><MoneyCell value={row.paid} muted /><MoneyCell value={round2(row.expected - row.paid)} />
                </tr>
              ))}
            </FinanceTable>
          )}
        </FinancePanel>

        <FinancePanel title="הכנסות לפי חודש" subtitle="מגמת הכנסות חודשית">
          {income.by_month.length === 0 ? <Empty>אין נתוני הכנסות.</Empty> : (
            <FinanceTable head={['חודש', 'צפוי', 'שולם']}>
              {income.by_month.map((row) => <tr key={row.month}><td className="px-5 py-4 font-bold" dir="ltr">{row.month}</td><MoneyCell value={row.expected} /><MoneyCell value={row.paid} muted /></tr>)}
            </FinanceTable>
          )}
        </FinancePanel>

        <FinancePanel title="הוצאות לפי ספק" subtitle="חלוקת הוצאות לספקים">
          {expenses.by_supplier.length === 0 ? <Empty>טרם נרשמו הוצאות לספקים.</Empty> : (
            <FinanceTable head={['ספק', 'סכום']}>
              {expenses.by_supplier.map((row) => <tr key={row.supplier_id}><td className="px-5 py-4 font-bold">{row.name}</td><MoneyCell value={row.amount} /></tr>)}
            </FinanceTable>
          )}
        </FinancePanel>

        <FinancePanel title="הוצאות לפי חודש" subtitle="מגמת הוצאות חודשית">
          {expenses.by_month.length === 0 ? <Empty>אין נתוני הוצאות.</Empty> : (
            <FinanceTable head={['חודש', 'סכום']}>
              {expenses.by_month.map((row) => <tr key={row.month}><td className="px-5 py-4 font-bold" dir="ltr">{row.month}</td><MoneyCell value={row.amount} /></tr>)}
            </FinanceTable>
          )}
        </FinancePanel>
      </div>
    </main>
  );
}

const round2 = (number) => Math.round((Number(number) + Number.EPSILON) * 100) / 100;
const nis = (number) => `${Number(number || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;

function MonthlyChart({ income, expenses }) {
  const expenseByMonth = new Map(expenses.map((row) => [row.month, Number(row.amount || 0)]));
  const months = income.slice(-6).map((row) => ({
    month: row.month,
    income: Number(row.paid || 0),
    expense: expenseByMonth.get(row.month) || 0,
  }));
  const extraExpenseMonths = expenses
    .filter((row) => !months.some((month) => month.month === row.month))
    .slice(-Math.max(0, 6 - months.length))
    .map((row) => ({ month: row.month, income: 0, expense: Number(row.amount || 0) }));
  const points = [...extraExpenseMonths, ...months].slice(-6);
  const maximum = Math.max(1, ...points.flatMap((point) => [point.income, point.expense]));

  return (
    <div className="pilot-panel overflow-hidden p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold text-brand-gold-dark">ששת החודשים האחרונים</p><h2 className="mt-0.5 text-lg font-extrabold text-[#2b2024]">הכנסות מול הוצאות</h2></div>
        <div className="flex items-center gap-4 text-xs font-semibold text-[#7f7478]"><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-brand-burgundy" />הכנסות</span><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-brand-gold" />הוצאות</span></div>
      </div>
      {points.length === 0 ? <div className="grid h-64 place-items-center text-sm font-medium text-[#91878a]">אין עדיין מספיק נתונים להצגת מגמה</div> : (
        <div className="relative mt-6 h-64 border-b border-black/[0.07] sm:h-72">
          <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between pb-7"><span className="border-t border-dashed border-black/[0.055]" /><span className="border-t border-dashed border-black/[0.055]" /><span className="border-t border-dashed border-black/[0.055]" /><span /></div>
          <div className="relative flex h-full items-end justify-around gap-2 px-1 sm:gap-5 sm:px-4">
            {points.map((point) => (
              <div key={point.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                <div className="flex h-[calc(100%-2rem)] w-full max-w-16 items-end justify-center gap-1.5 sm:gap-2">
                  <ChartBar value={point.income} maximum={maximum} tone="income" label={`הכנסות ${point.month}: ${nis(point.income)}`} />
                  <ChartBar value={point.expense} maximum={maximum} tone="expense" label={`הוצאות ${point.month}: ${nis(point.expense)}`} />
                </div>
                <span className="mt-2 max-w-full truncate text-[10px] font-bold text-[#81777a] sm:text-xs" dir="ltr">{shortMonth(point.month)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChartBar({ value, maximum, tone, label }) {
  const height = value > 0 ? Math.max(5, (value / maximum) * 100) : 2;
  return <div className={`group relative w-3/5 max-w-6 rounded-t-lg transition-all hover:brightness-110 sm:max-w-8 ${tone === 'income' ? 'bg-brand-burgundy' : 'bg-brand-gold'}`} style={{ height: `${height}%` }} role="img" aria-label={label}><span className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#2b2024] px-2 py-1 text-[10px] font-bold text-white shadow-lg group-hover:block">{nis(value)}</span></div>;
}

function CollectionDonut({ paid, expected }) {
  const rate = expected > 0 ? Math.min(100, Math.max(0, (Number(paid) / Number(expected)) * 100)) : 0;
  const circumference = 2 * Math.PI * 42;
  return (
    <div className="pilot-panel flex items-center gap-5 p-5 sm:p-6">
      <div className="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`אחוז גבייה ${Math.round(rate)} אחוז`}><circle cx="50" cy="50" r="42" fill="none" stroke="#f0eded" strokeWidth="10" /><circle cx="50" cy="50" r="42" fill="none" stroke="#5C1A2E" strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - rate / 100)} /></svg>
        <span className="absolute inset-0 grid place-items-center text-xl font-extrabold text-brand-burgundy">{Math.round(rate)}%</span>
      </div>
      <div className="min-w-0"><p className="text-xs font-bold text-brand-gold-dark">יעילות גבייה</p><h2 className="mt-0.5 text-lg font-extrabold text-[#2b2024]">אחוז ששולם</h2><p className="mt-2 text-sm leading-6 text-[#7f7478]">{nis(paid)} מתוך {nis(expected)}</p></div>
    </div>
  );
}

function MoneyBreakdown({ paid, open, expenses }) {
  const entries = [
    { label: 'שולם בפועל', value: Number(paid || 0), color: 'bg-brand-burgundy' },
    { label: 'פתוח לגבייה', value: Number(open || 0), color: 'bg-brand-gold' },
    { label: 'הוצאות', value: Number(expenses || 0), color: 'bg-[#c9c4c5]' },
  ];
  const total = Math.max(1, entries.reduce((sum, entry) => sum + entry.value, 0));
  return (
    <div className="pilot-panel p-5 sm:p-6">
      <p className="text-xs font-bold text-brand-gold-dark">פילוח כספי</p><h2 className="mt-0.5 text-lg font-extrabold text-[#2b2024]">חלוקת הסכומים</h2>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-[#f1eeee]">{entries.map((entry) => <span key={entry.label} className={entry.color} style={{ width: `${(entry.value / total) * 100}%` }} />)}</div>
      <div className="mt-4 space-y-2.5">{entries.map((entry) => <div key={entry.label} className="flex items-center justify-between gap-3 text-sm"><span className="inline-flex items-center gap-2 font-semibold text-[#756a6e]"><i className={`h-2.5 w-2.5 rounded-full ${entry.color}`} />{entry.label}</span><strong className="tabular-nums text-[#3d3135]" dir="ltr">{nis(entry.value)}</strong></div>)}</div>
    </div>
  );
}

function shortMonth(value) {
  if (!value) return '';
  const [year, month] = String(value).split('-');
  return month && year ? `${month}/${String(year).slice(-2)}` : value;
}

function PrimaryMetric({ label, value, icon, positive, warning }) {
  const tone = warning ? 'bg-amber-50 text-amber-700' : positive ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-gold/10 text-brand-gold-dark';
  return <div className="pilot-panel flex min-w-0 items-center gap-4 p-4 sm:p-5"><span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tone}`}><MetricIcon name={icon} /></span><div className="min-w-0"><p className="truncate text-xs font-bold text-[#8a7f82] sm:text-sm">{label}</p><p className="mt-1 truncate text-xl font-extrabold tabular-nums text-[#33272b] sm:text-2xl" dir="ltr">{nis(value)}</p></div></div>;
}

function SecondaryMetric({ label, value, tone = 'neutral' }) {
  const valueTone = { positive: 'text-emerald-700', danger: 'text-red-700', warning: 'text-amber-700', neutral: 'text-[#33272b]' }[tone];
  return <div className="rounded-2xl border border-black/[0.055] bg-white p-4 shadow-[0_7px_24px_rgba(42,31,36,0.045)]"><p className="text-[11px] font-bold text-[#8b8084] sm:text-sm">{label}</p><p className={`mt-1 truncate text-lg font-extrabold tabular-nums sm:text-xl ${valueTone}`} dir="ltr">{nis(value)}</p></div>;
}

function ReportLink({ label, value, sub, to }) {
  return <Link to={to} className="group rounded-2xl border border-black/[0.055] bg-[#faf9f8] p-4 transition hover:-translate-y-0.5 hover:border-brand-gold/35 hover:bg-white"><div className="flex items-start justify-between gap-2"><span className="text-2xl font-extrabold tabular-nums text-brand-burgundy">{value ?? 0}</span><span className="text-[#b4abad] transition group-hover:-translate-x-1 group-hover:text-brand-gold-dark">←</span></div><p className="mt-1 text-sm font-bold text-[#62575b]">{label}</p>{sub && <p className="mt-0.5 text-xs font-semibold text-[#958b8e]" dir="ltr">{sub}</p>}</Link>;
}

function FinancePanel({ title, subtitle, children, full }) {
  return <section className={`pilot-panel overflow-hidden ${full ? 'xl:col-span-2' : ''}`}><div className="flex items-end justify-between gap-3 border-b border-black/[0.05] px-5 py-4"><div><h2 className="font-extrabold text-[#33272b]">{title}</h2><p className="mt-0.5 text-xs font-semibold text-[#958b8e]">{subtitle}</p></div></div>{children}</section>;
}

function FinanceTable({ head, children }) {
  return <div className="overflow-x-auto"><table className="pilot-table w-full text-right"><thead className="bg-[#f7f7f7]"><tr>{head.map((heading) => <th key={heading} className="px-4 py-3.5 first:px-5">{heading}</th>)}</tr></thead><tbody className="divide-y divide-black/[0.045]">{children}</tbody></table></div>;
}

function MoneyCell({ value, danger, muted }) {
  return <td className={`whitespace-nowrap px-4 py-4 font-bold tabular-nums ${danger ? 'text-red-700' : muted ? 'text-[#74696d]' : 'text-[#3d3135]'}`} dir="ltr">{nis(value)}</td>;
}

function Empty({ children }) {
  return <div className="flex items-center gap-3 px-5 py-8 text-sm text-[#7f7478]"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><MetricIcon name="check" /></span><span className="font-medium">{children}</span></div>;
}

function FinanceLoading() {
  return <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8" aria-live="polite"><div className="h-8 w-48 animate-pulse rounded-lg bg-black/[0.06]" /><div className="mt-5 grid gap-3 sm:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="pilot-panel h-24 animate-pulse bg-white" />)}</div><div className="pilot-panel mt-5 h-72 animate-pulse bg-white" /></main>;
}

function FinanceState({ title, message }) {
  return <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8"><div className="pilot-panel flex items-center gap-4 border-red-200 bg-red-50 p-5 text-red-700" role="alert"><span className="grid h-10 w-10 place-items-center rounded-xl bg-red-100 font-extrabold">!</span><div><h1 className="font-extrabold">{title}</h1><p className="mt-0.5 text-sm">{message}</p></div></div></main>;
}

function MetricIcon({ name }) {
  const paths = {
    expected: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /><path d="M2 19h20" /></>,
    paid: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    open: <><path d="M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">{paths[name]}</svg>;
}
