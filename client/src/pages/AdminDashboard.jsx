import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

// דשבורד ניהולי — "הדברים הדורשים טיפול" ב-5 סקציות (סעיף 30).
// עיצוב: כותרת חמה + כרטיס שבת קרובה, ואז כרטיסי-סקציה עם שורות פריט.
// לכל פריט תג-מספר עגול שנצבע רק כשיש מה לטפל (>0) — אחרת רגוע ולא צועק.
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

  // סך הפריטים הדורשים טיפול (למשפט הפתיחה)
  const openCount = data
    ? [
        data.orders?.pending_approval, data.orders?.overdue_unpaid,
        data.payments?.unpaid, data.payments?.partially_paid, data.payments?.open_refunds,
        data.inventory?.below_min, data.volunteers?.unassigned_tasks,
        data.volunteers?.missing_transport, data.suppliers?.open_payments,
        data.registrations?.pending,
      ].reduce((s, n) => s + (Number(n) > 0 ? 1 : 0), 0)
    : null;

  const sections = [
    {
      title: 'הזמנות', icon: ICONS.orders,
      rows: [
        { n: data?.orders?.pending_approval, label: 'ממתינות לאישור', to: '/admin/orders?status=pending_approval', tone: 'amber' },
        { n: data?.orders?.next_shabbat, label: 'לשבת הקרובה', to: nsOrdersLink, tone: 'neutral' },
        { n: data?.orders?.overdue_unpaid, label: 'לא שולמו בזמן', to: '/admin/orders', tone: 'red' },
        { n: data?.orders?.cancelled_recent, label: 'בוטלו לאחרונה', to: '/admin/orders?status=cancelled', tone: 'neutral' },
      ],
    },
    {
      title: 'תשלומים', icon: ICONS.payments,
      rows: [
        { n: data?.payments?.unpaid, label: 'לא שולמו', to: '/admin/orders', tone: 'red' },
        { n: data?.payments?.partially_paid, label: 'שולמו חלקית', to: '/admin/orders', tone: 'amber' },
        { n: data?.payments?.overrides, label: 'חריגות תשלום', to: '/admin/orders', tone: 'neutral' },
        { n: data?.payments?.open_refunds, label: 'החזרים פתוחים', to: '/admin/orders', tone: 'amber' },
      ],
    },
    {
      title: 'מלאי', icon: ICONS.inventory,
      rows: [
        { n: data?.inventory?.below_min, label: 'מתחת למינימום', to: '/admin/inventory', tone: 'red' },
        { n: data?.inventory?.open_purchase_orders, label: 'הזמנות רכש פתוחות', to: '/admin/purchase-orders', tone: 'neutral' },
      ],
    },
    {
      title: 'מתנדבים', icon: ICONS.volunteers,
      rows: [
        { n: data?.volunteers?.unassigned_tasks, label: 'משימות ללא שיבוץ', to: '/admin/volunteers', tone: 'amber' },
        { n: data?.volunteers?.missing_transport, label: 'שיבוץ שינוע חסר', to: '/admin/volunteers', tone: 'amber' },
      ],
    },
    {
      title: 'ספקים', icon: ICONS.suppliers,
      rows: [
        { n: data?.suppliers?.open_purchase_orders, label: 'הזמנות רכש פתוחות', to: '/admin/purchase-orders', tone: 'neutral' },
        { n: data?.suppliers?.open_payments, label: 'תשלומים פתוחים', to: '/admin/suppliers', tone: 'amber' },
      ],
    },
    {
      title: 'קהילה', icon: ICONS.community,
      rows: [
        { n: data?.registrations?.pending, label: 'בקשות רישום ממתינות', to: '/admin/registrations', tone: 'amber' },
      ],
    },
  ];

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      {/* --- כותרת + שבת קרובה --- */}
      <div className="bg-gradient-to-l from-brand-burgundy to-brand-burgundy-dark rounded-3xl p-6 sm:p-8 text-brand-cream shadow-card mb-6 relative overflow-hidden">
        <div className="absolute -left-8 -top-8 w-40 h-40 rounded-full bg-brand-gold/10" aria-hidden="true" />
        <div className="absolute -left-16 top-10 w-52 h-52 rounded-full bg-brand-gold/5" aria-hidden="true" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold">דשבורד ניהולי</h1>
            <p className="text-brand-cream/75 mt-1">
              {openCount === null
                ? 'טוען…'
                : openCount === 0
                  ? 'הכול תחת שליטה — אין פריטים דחופים כרגע.'
                  : `${openCount} תחומים דורשים את תשומת ליבך.`}
            </p>
          </div>
          {ns && (
            <div className="bg-brand-cream/10 backdrop-blur rounded-2xl px-5 py-4 border border-brand-gold/30 shrink-0">
              <div className="text-xs uppercase tracking-wide text-brand-gold-light font-semibold mb-1">השבת הקרובה</div>
              <div className="text-lg font-extrabold leading-tight">פרשת {ns.parasha}</div>
              {ns.hebrew_date && !ns.hebrew_date.includes(ns.parasha) && (
                <div className="text-sm text-brand-cream/70">{ns.hebrew_date}</div>
              )}
              {ns.gregorian_date && <div className="text-sm text-brand-cream/70" dir="ltr">{ns.gregorian_date}</div>}
              <Link to={nsOrdersLink} className="inline-flex items-center gap-1 text-sm text-brand-gold-light hover:text-brand-gold font-semibold mt-2">
                {data?.orders?.next_shabbat ?? 0} הזמנות ←
              </Link>
            </div>
          )}
        </div>
      </div>

      {error && <div className="card text-red-600 mb-6">{error}</div>}

      {/* --- קישור למודול כספי --- */}
      <Link
        to="/admin/finance"
        className="group flex items-center justify-between bg-white rounded-2xl border border-brand-cream-dark shadow-card p-5 mb-6 hover:border-brand-gold transition-colors"
      >
        <div className="flex items-center gap-4">
          <span className="w-12 h-12 rounded-xl bg-brand-gold/15 text-brand-gold-dark flex items-center justify-center">
            {ICONS.finance}
          </span>
          <div>
            <div className="font-bold text-brand-burgundy">מודול כספי ודוחות</div>
            <div className="text-sm text-brand-burgundy/60">הכנסות, הוצאות, חובות ורווחיות</div>
          </div>
        </div>
        <span className="text-brand-gold-dark group-hover:-translate-x-1 transition-transform text-xl">←</span>
      </Link>

      {/* --- סקציות --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {sections.map((s) => (
          <SectionCard key={s.title} {...s} loading={!data} />
        ))}
      </div>
    </main>
  );
}

// כרטיס-סקציה: כותרת עם אייקון וקו-זהב, ואז שורות פריט מופרדות.
function SectionCard({ title, icon, rows, loading }) {
  return (
    <section className="bg-white rounded-2xl border border-brand-cream-dark shadow-card overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-brand-cream-dark">
        <span className="w-9 h-9 rounded-lg bg-brand-burgundy/8 text-brand-burgundy flex items-center justify-center">
          {icon}
        </span>
        <h2 className="font-bold text-brand-burgundy">{title}</h2>
      </div>
      <div className="divide-y divide-brand-cream-dark/70">
        {rows.map((r) => <StatRow key={r.label} {...r} loading={loading} />)}
      </div>
    </section>
  );
}

// שורת פריט: תווית מימין, תג-מספר משמאל. התג נצבע רק כשיש מה לטפל (>0).
function StatRow({ n, label, to, tone, loading }) {
  const value = loading ? '·' : (n ?? 0);
  const active = !loading && Number(n) > 0;

  const badge = active
    ? {
        red: 'bg-red-100 text-red-700 ring-1 ring-red-200',
        amber: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
        neutral: 'bg-brand-gold/20 text-brand-gold-dark ring-1 ring-brand-gold/30',
      }[tone]
    : 'bg-brand-cream text-brand-burgundy/40';

  return (
    <Link
      to={to}
      className="flex items-center justify-between px-5 py-3.5 hover:bg-brand-cream/50 transition-colors group"
    >
      <span className={`font-medium ${active ? 'text-brand-burgundy' : 'text-brand-burgundy/70'}`}>
        {label}
        {active && tone === 'red' && <span className="mr-2 text-xs text-red-500 font-bold">•</span>}
      </span>
      <span className="flex items-center gap-2">
        <span className={`min-w-8 h-8 px-2 rounded-full text-sm font-extrabold flex items-center justify-center ${badge}`}>
          {value}
        </span>
        <span className="text-brand-cream-dark group-hover:text-brand-gold group-hover:-translate-x-0.5 transition-all">←</span>
      </span>
    </Link>
  );
}

// אייקוני קו פשוטים (stroke=currentColor) — יורשים את צבע ההורה.
const svg = (paths) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    {paths}
  </svg>
);
const ICONS = {
  orders: svg(<><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></>),
  payments: svg(<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>),
  inventory: svg(<><path d="M21 8V6a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 6v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l3-1.72" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></>),
  volunteers: svg(<><circle cx="9" cy="7" r="3" /><path d="M2 21v-1a6 6 0 0 1 12 0v1M16 3.13a3 3 0 0 1 0 5.75M22 21v-1a6 6 0 0 0-3-5.2" /></>),
  suppliers: svg(<><path d="M10 17h4V5H2v12h3M15 17h6v-5l-3-3h-3v8M6 17a2 2 0 1 0 4 0M17 17a2 2 0 1 0 4 0" /></>),
  community: svg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>),
  finance: svg(<><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
};
