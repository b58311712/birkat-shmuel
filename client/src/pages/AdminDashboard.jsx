import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function AdminDashboard({ onAuthError }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.adminDashboard().then(setData).catch((err) => {
      if (err.name === 'AdminAuthError') onAuthError?.();
      else setError(err.message || 'שגיאה בטעינת הדשבורד.');
    });
  }, [onAuthError]);

  const ns = data?.next_shabbat;
  const nsOrdersLink = ns ? `/admin/orders?shabbat_id=${ns.id}` : '/admin/orders';
  const nsFileLink = ns ? `/admin/shabbat/${ns.id}` : '/admin/shabbat';
  const openCount = data ? [
    data.orders?.pending_approval, data.orders?.overdue_unpaid,
    data.payments?.unpaid, data.payments?.partially_paid, data.payments?.open_refunds,
    data.inventory?.below_min, data.volunteers?.unassigned_tasks,
    data.volunteers?.missing_transport, data.suppliers?.open_payments,
    data.registrations?.pending,
  ].reduce((sum, value) => sum + (Number(value) > 0 ? 1 : 0), 0) : null;

  const metrics = [
    { label: 'ממתינות לאישור', value: data?.orders?.pending_approval, to: '/admin/orders?status=pending_approval', icon: ICONS.orders, tone: 'amber' },
    { label: 'יתרות פתוחות', value: data?.payments?.unpaid, to: '/admin/orders', icon: ICONS.payments, tone: 'red' },
    { label: 'בקשות רישום', value: data?.registrations?.pending, to: '/admin/registrations', icon: ICONS.community, tone: 'gold' },
    { label: 'פריטי מלאי חסרים', value: data?.inventory?.below_min, to: '/admin/inventory', icon: ICONS.inventory, tone: 'red' },
  ];

  const sections = [
    { title: 'הזמנות', icon: ICONS.orders, rows: [
      { n: data?.orders?.pending_approval, label: 'ממתינות לאישור', to: '/admin/orders?status=pending_approval', tone: 'amber' },
      { n: data?.orders?.next_shabbat, label: 'לשבת הקרובה', to: nsOrdersLink, tone: 'neutral' },
      { n: data?.orders?.overdue_unpaid, label: 'לא שולמו בזמן', to: '/admin/orders', tone: 'red' },
      { n: data?.orders?.cancelled_recent, label: 'בוטלו לאחרונה', to: '/admin/orders?status=cancelled', tone: 'neutral' },
    ]},
    { title: 'תשלומים', icon: ICONS.payments, rows: [
      { n: data?.payments?.unpaid, label: 'לא שולמו', to: '/admin/orders', tone: 'red' },
      { n: data?.payments?.partially_paid, label: 'שולמו חלקית', to: '/admin/orders', tone: 'amber' },
      { n: data?.payments?.overrides, label: 'חריגות תשלום', to: '/admin/orders', tone: 'neutral' },
      { n: data?.payments?.open_refunds, label: 'החזרים פתוחים', to: '/admin/orders', tone: 'amber' },
    ]},
    { title: 'מלאי ורכש', icon: ICONS.inventory, rows: [
      { n: data?.inventory?.below_min, label: 'מתחת למינימום', to: '/admin/inventory', tone: 'red' },
      { n: data?.inventory?.open_purchase_orders, label: 'הזמנות רכש פתוחות', to: '/admin/purchase-orders', tone: 'neutral' },
      { n: data?.suppliers?.open_payments, label: 'תשלומי ספקים פתוחים', to: '/admin/suppliers', tone: 'amber' },
    ]},
    { title: 'קהילה ומתנדבים', icon: ICONS.community, rows: [
      { n: data?.volunteers?.unassigned_tasks, label: 'משימות ללא שיבוץ', to: '/admin/volunteers', tone: 'amber' },
      { n: data?.volunteers?.missing_transport, label: 'שיבוץ שינוע חסר', to: '/admin/volunteers', tone: 'amber' },
      { n: data?.registrations?.pending, label: 'בקשות רישום ממתינות', to: '/admin/registrations', tone: 'amber' },
    ]},
  ];

  return (
    <main id="admin-dashboard-content" className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
      <section className="pilot-panel relative overflow-hidden p-5 sm:p-7">
        <div aria-hidden="true" className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-brand-gold/10 blur-3xl" />
        <div className="relative grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col justify-center">
            <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-brand-gold/20 bg-brand-gold/[0.08] px-3 py-1.5 text-xs font-bold text-brand-gold-dark">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" /> תמונת מצב עדכנית
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[#2b2024] sm:text-3xl">הדברים שחשוב לדעת היום</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#756a6e] sm:text-base">
              {openCount === null ? 'טוען את מצב המערכת…' : openCount === 0 ? 'הכול תחת שליטה — אין כרגע נושאים דחופים לטיפול.' : <><strong className="text-brand-burgundy">{openCount} תחומים</strong> דורשים את תשומת הלב שלך.</>}
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link to="/admin/orders?status=pending_approval" className="rounded-xl bg-brand-burgundy px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(92,26,46,0.16)] transition hover:-translate-y-0.5 hover:bg-brand-burgundy-light focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2">טיפול בהזמנות</Link>
              <Link to="/admin/shabbat" className="rounded-xl border border-black/[0.07] bg-white px-4 py-2.5 text-sm font-bold text-brand-burgundy shadow-[0_5px_16px_rgba(42,31,36,0.05)] transition hover:-translate-y-0.5 hover:border-brand-gold/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold">תיקי שבת</Link>
            </div>
          </div>

          <ShabbatCard ns={ns} to={nsFileLink} orders={data?.orders?.next_shabbat} loading={!data} />
        </div>
      </section>

      {error && <div className="mt-5 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700" role="alert"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-red-100 font-bold">!</span><span className="font-medium">{error}</span></div>}

      <section className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="מדדים מרכזיים">
        {metrics.map((metric) => <MetricCard key={metric.label} {...metric} loading={!data} />)}
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,.7fr)]">
        <section className="pilot-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4 sm:px-6">
            <div><p className="text-xs font-bold text-brand-gold-dark">מעקב שוטף</p><h2 className="mt-0.5 text-lg font-extrabold text-[#2b2024]">דורש טיפול</h2></div>
            <Link to="/admin/orders" className="text-sm font-bold text-brand-burgundy hover:text-brand-gold-dark">לכל ההזמנות ←</Link>
          </div>
          <div className="grid md:grid-cols-2">
            {sections.map((section, index) => <AttentionSection key={section.title} {...section} loading={!data} divided={index % 2 === 1} />)}
          </div>
        </section>

        <aside className="space-y-5">
          <QuickActions />
          <SystemStatus openCount={openCount} />
        </aside>
      </div>
    </main>
  );
}

function ShabbatCard({ ns, to, orders, loading }) {
  return (
    <Link to={to} className="group relative overflow-hidden rounded-[22px] border border-brand-gold/20 bg-gradient-to-br from-[#fffdf8] to-[#f6efe2] p-5 shadow-[0_12px_35px_rgba(70,45,24,0.08)] transition hover:-translate-y-0.5 hover:border-brand-gold/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold">
      <div className="flex items-center justify-between"><span className="inline-flex items-center gap-2 text-xs font-bold text-brand-gold-dark">{ICONS.candle} השבת הקרובה</span><span className="text-brand-gold-dark transition group-hover:-translate-x-1">←</span></div>
      {loading ? <div className="mt-7 h-16 animate-pulse rounded-xl bg-brand-gold/10" /> : ns ? <><h2 className="mt-5 text-2xl font-extrabold text-brand-burgundy">פרשת {ns.parasha}</h2><div className="mt-1 text-sm text-[#796b70]">{ns.hebrew_date && !ns.hebrew_date.includes(ns.parasha) && <span>{ns.hebrew_date}</span>}{ns.gregorian_date && <span className="mr-2 tabular-nums" dir="ltr">{ns.gregorian_date}</span>}</div><div className="mt-5 inline-flex rounded-lg bg-white/80 px-3 py-1.5 text-sm font-bold text-brand-burgundy shadow-sm"><span className="ml-1 tabular-nums text-brand-gold-dark">{orders ?? 0}</span> הזמנות בתיק</div></> : <><h2 className="mt-5 text-xl font-extrabold text-brand-burgundy">תיקי שבת</h2><p className="mt-2 text-sm text-[#796b70]">לצפייה וניהול של תיקי השבת</p></>}
    </Link>
  );
}

function MetricCard({ label, value, to, icon, tone, loading }) {
  const active = !loading && Number(value) > 0;
  const colors = { red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-700', gold: 'bg-brand-gold/10 text-brand-gold-dark' };
  return <Link to={to} className="pilot-panel group flex min-w-0 items-center gap-3 p-3.5 transition hover:-translate-y-0.5 hover:border-brand-gold/30 sm:gap-4 sm:p-5"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl sm:h-12 sm:w-12 ${active ? colors[tone] : 'bg-[#f4f2f2] text-[#9e9598]'}`}>{icon}</span><span className="min-w-0"><strong className="block text-xl font-extrabold tabular-nums text-[#2b2024] sm:text-2xl">{loading ? '–' : (value ?? 0)}</strong><span className="block truncate text-[11px] font-semibold text-[#83787c] sm:text-sm">{label}</span></span></Link>;
}

function AttentionSection({ title, icon, rows, loading, divided }) {
  return <section className={`p-5 sm:p-6 ${divided ? 'md:border-r md:border-black/[0.055]' : ''} border-b border-black/[0.055]`}><div className="mb-3 flex items-center gap-2.5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-burgundy/[0.055] text-brand-burgundy">{icon}</span><h3 className="font-extrabold text-[#3a2e32]">{title}</h3></div><div className="space-y-1">{rows.map((row) => <StatRow key={row.label} {...row} loading={loading} />)}</div></section>;
}

function StatRow({ n, label, to, tone, loading }) {
  const active = !loading && Number(n) > 0;
  const badge = active ? { red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-800', neutral: 'bg-brand-gold/10 text-brand-gold-dark' }[tone] : 'bg-[#f5f3f3] text-[#9b9295]';
  return <Link to={to} className="group flex items-center justify-between rounded-xl px-2.5 py-2.5 text-sm transition hover:bg-[#f8f6f4] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"><span className={active ? 'font-bold text-[#4b3d42]' : 'font-medium text-[#796f72]'}>{label}</span><span className={`inline-flex min-w-7 items-center justify-center rounded-lg px-2 py-1 text-xs font-extrabold tabular-nums ${badge}`}>{loading ? '–' : (n ?? 0)}</span></Link>;
}

function QuickActions() {
  const actions = [{ to: '/admin/orders', label: 'הזמנות', icon: ICONS.orders }, { to: '/admin/customers', label: 'לקוחות', icon: ICONS.community }, { to: '/admin/inventory', label: 'מלאי', icon: ICONS.inventory }, { to: '/admin/finance', label: 'כספים', icon: ICONS.finance }];
  return <section className="pilot-panel p-5"><p className="text-xs font-bold text-brand-gold-dark">גישה מהירה</p><h2 className="mt-0.5 text-lg font-extrabold text-[#2b2024]">פעולות נפוצות</h2><div className="mt-4 grid grid-cols-2 gap-2">{actions.map((action) => <Link key={action.to} to={action.to} className="flex items-center gap-2.5 rounded-xl border border-black/[0.055] bg-[#faf9f8] px-3 py-3 text-sm font-bold text-brand-burgundy transition hover:border-brand-gold/35 hover:bg-brand-cream/30"><span className="text-brand-gold-dark">{action.icon}</span>{action.label}</Link>)}</div></section>;
}

function SystemStatus({ openCount }) {
  const calm = openCount === 0;
  return <section className="pilot-panel p-5"><div className="flex items-center gap-3"><span className={`grid h-11 w-11 place-items-center rounded-full ${calm ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-gold/10 text-brand-gold-dark'}`}>{calm ? ICONS.check : ICONS.pulse}</span><div><p className="text-xs font-bold text-[#887c80]">מצב המערכת</p><h2 className="font-extrabold text-[#33272b]">{openCount === null ? 'טוען נתונים…' : calm ? 'הכול תקין' : 'המערכת פעילה'}</h2></div></div><p className="mt-3 text-sm leading-6 text-[#796f72]">{openCount === null ? 'הנתונים מתעדכנים ברקע.' : calm ? 'לא נמצאו נושאים דחופים שדורשים טיפול.' : `נמצאו ${openCount} תחומים שכדאי לבדוק.`}</p></section>;
}

const svg = (paths) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">{paths}</svg>;
const ICONS = {
  orders: svg(<><path d="M9 5H7a2 2 0 0 0-2 2v12h14V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></>),
  payments: svg(<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>),
  inventory: svg(<><path d="M21 8 12 3 3 8l9 5 9-5M3 8v8l9 5 4-2.2M12 21v-8" /></>),
  community: svg(<><circle cx="9" cy="7" r="3" /><path d="M2 21v-1a6 6 0 0 1 12 0v1M16 4a3 3 0 0 1 0 6M22 21v-1a6 6 0 0 0-3-5.2" /></>),
  finance: svg(<><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  candle: svg(<><path d="M12 3c1.2 1 1.2 2.2.4 3.2M9 9h6v9a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM8 22h8" /></>),
  check: svg(<path d="m5 12 4 4L19 6" />),
  pulse: svg(<path d="M3 12h4l2-7 4 14 2-7h6" />),
};
