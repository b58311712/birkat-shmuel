import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function AdminDashboard({ onAuthError }) {
  const [data, setData] = useState(null);
  const [nextOrders, setNextOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.adminDashboard().then(setData).catch((err) => {
      if (err.name === 'AdminAuthError') onAuthError?.();
      else setError(err.message || 'שגיאה בטעינת הדשבורד.');
    });
  }, [onAuthError]);

  useEffect(() => {
    if (!data?.next_shabbat?.id) {
      if (data) setNextOrders([]);
      return;
    }
    api.adminOrders(`?shabbat_id=${encodeURIComponent(data.next_shabbat.id)}`)
      .then(setNextOrders)
      .catch((err) => {
        if (err.name === 'AdminAuthError') onAuthError?.();
        else setNextOrders([]);
      });
  }, [data?.next_shabbat?.id, onAuthError]);

  const ns = data?.next_shabbat;
  const nsOrdersLink = ns ? `/admin/orders?shabbat_id=${ns.id}` : '/admin/orders';
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
      {error && <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700" role="alert"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-red-100 font-bold">!</span><span className="font-medium">{error}</span></div>}

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
          <NextShabbatOrders orders={nextOrders} shabbat={ns} />
        </aside>
      </div>
    </main>
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

function NextShabbatOrders({ orders, shabbat }) {
  const statusLabels = {
    pending_approval: 'ממתינה לאישור',
    approved: 'מאושרת',
    needs_correction: 'דורשת תיקון',
    delivered: 'נמסרה',
    cancelled: 'בוטלה',
  };
  const statusColors = {
    pending_approval: 'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-800',
    needs_correction: 'bg-orange-100 text-orange-800',
    delivered: 'bg-blue-100 text-blue-800',
    cancelled: 'bg-red-100 text-red-700',
  };
  const allOrdersLink = shabbat ? `/admin/orders?shabbat_id=${shabbat.id}` : '/admin/orders';

  return (
    <section className="pilot-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/[0.055] px-5 py-4">
        <div>
          <p className="text-xs font-bold text-brand-gold-dark">השבת הקרובה</p>
          <h2 className="mt-0.5 font-extrabold text-[#33272b]">הזמנות לשבת</h2>
        </div>
        <Link to={allOrdersLink} className="text-xs font-bold text-brand-burgundy hover:text-brand-gold-dark">לכל ההזמנות ←</Link>
      </div>
      {orders === null ? (
        <div className="space-y-2 p-5" aria-label="טוען הזמנות">
          {[1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-brand-gold/[0.07]" />)}
        </div>
      ) : orders.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-[#796f72]">אין הזמנות לשבת הקרובה.</p>
      ) : (
        <div className="max-h-72 divide-y divide-black/[0.05] overflow-y-auto">
          {orders.map((order) => (
            <Link key={order.id} to={`/admin/orders/${order.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-[#faf8f5]">
              <span className="min-w-0">
                <strong className="block truncate text-sm text-[#3c3034]">{order.customers?.full_name || 'לקוח ללא שם'}</strong>
                <span className="mt-1 flex items-center gap-2 text-xs text-[#91868a]">
                  <span>#{order.order_number}</span>
                  <span className={`rounded-full px-2 py-0.5 font-bold ${statusColors[order.order_status] || 'bg-gray-100 text-gray-700'}`}>
                    {statusLabels[order.order_status] || order.order_status}
                  </span>
                </span>
              </span>
              <strong className="shrink-0 text-sm tabular-nums text-brand-burgundy">{Number(order.final_amount || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })} ₪</strong>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

const svg = (paths) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">{paths}</svg>;
const ICONS = {
  orders: svg(<><path d="M9 5H7a2 2 0 0 0-2 2v12h14V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></>),
  payments: svg(<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>),
  inventory: svg(<><path d="M21 8 12 3 3 8l9 5 9-5M3 8v8l9 5 4-2.2M12 21v-8" /></>),
  community: svg(<><circle cx="9" cy="7" r="3" /><path d="M2 21v-1a6 6 0 0 1 12 0v1M16 4a3 3 0 0 1 0 6M22 21v-1a6 6 0 0 0-3-5.2" /></>),
  finance: svg(<><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
};
