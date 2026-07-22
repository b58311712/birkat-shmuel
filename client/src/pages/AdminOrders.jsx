import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { Badge, ORDER_STATUS, PAYMENT_STATUS } from '../lib/status.jsx';

const filters = [
  { key: '', label: 'כל ההזמנות' },
  { key: 'pending_approval', label: 'ממתינות' },
  { key: 'approved', label: 'מאושרות' },
  { key: 'cancelled', label: 'מבוטלות' },
];

// סינון פר-שדה בזיכרון (בנוסף לחיפוש החופשי ולטאבי הסטטוס). כל שדה לפי טיפוסו.
const EMPTY_COL_FILTERS = { order_number: '', customer: '', shabbat: '', amountMin: '', amountMax: '', order_status: '', payment_status: '' };

function matchesColFilters(order, f) {
  const has = (v, term) => String(v ?? '').toLocaleLowerCase('he-IL').includes(term.toLocaleLowerCase('he-IL'));
  if (f.order_number && !has(order.order_number, f.order_number)) return false;
  if (f.customer && !(has(order.customers?.full_name, f.customer) || has(order.customers?.phone, f.customer))) return false;
  if (f.shabbat && !has(order.shabbatot?.parasha, f.shabbat)) return false;
  if (f.order_status && order.order_status !== f.order_status) return false;
  if (f.payment_status && order.payment_status !== f.payment_status) return false;
  const amount = Number(order.final_amount || 0);
  if (f.amountMin !== '' && amount < Number(f.amountMin)) return false;
  if (f.amountMax !== '' && amount > Number(f.amountMax)) return false;
  return true;
}

function countActiveColFilters(f) {
  let n = 0;
  if (f.order_number) n += 1;
  if (f.customer) n += 1;
  if (f.shabbat) n += 1;
  if (f.order_status) n += 1;
  if (f.payment_status) n += 1;
  if (f.amountMin !== '' || f.amountMax !== '') n += 1;
  return n;
}

export default function AdminOrders({ onAuthError, currentAdmin }) {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const statusFilter = sp.get('status') || '';
  const shabbatFilter = sp.get('shabbat_id') || '';
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [colFilters, setColFilters] = useState(EMPTY_COL_FILTERS);
  const [showColFilters, setShowColFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const canDelete = currentAdmin?.role === 'developer';
  const setCol = (key, value) => setColFilters((f) => ({ ...f, [key]: value }));
  const activeColFilters = countActiveColFilters(colFilters);

  function handleErr(error) {
    if (error.name === 'AdminAuthError') { onAuthError?.(); return true; }
    return false;
  }

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (shabbatFilter) params.set('shabbat_id', shabbatFilter);
    const query = params.size ? `?${params.toString()}` : '';
    api.adminOrders(query).then(setOrders).catch(handleErr).finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter, shabbatFilter]);

  async function doAction(fn, id, ...args) {
    setBusy(id);
    try { await fn(id, ...args); load(); }
    catch (error) { if (!handleErr(error)) alert(error.message); }
    finally { setBusy(''); }
  }

  async function markPaid(id) {
    const amount = prompt('סכום ששולם (₪):');
    if (amount == null) return;
    await doAction((orderId) => api.updatePayment(orderId, { payment_status: 'paid', amount, payment_method: 'bank_transfer' }), id);
  }

  async function deleteOrder(order) {
    if (!confirm(`למחוק לצמיתות את הזמנה ${order.order_number}?`)) return;
    await doAction(api.deleteOrder, order.id);
  }

  const normalizedSearch = search.trim().toLocaleLowerCase('he-IL');
  const visibleOrders = useMemo(() => {
    return orders.filter((order) => {
      if (normalizedSearch && ![order.order_number, order.customers?.full_name, order.customers?.phone, order.shabbatot?.parasha]
        .some((value) => String(value || '').toLocaleLowerCase('he-IL').includes(normalizedSearch))) return false;
      if (activeColFilters && !matchesColFilters(order, colFilters)) return false;
      return true;
    });
  }, [orders, normalizedSearch, colFilters, activeColFilters]);
  const totalAmount = visibleOrders.reduce((sum, order) => sum + Number(order.final_amount || 0), 0);
  const pendingCount = visibleOrders.filter((order) => order.order_status === 'pending_approval').length;
  const unpaidCount = visibleOrders.filter((order) => order.payment_status !== 'paid' && order.order_status !== 'cancelled').length;

  function renderActions(order) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {order.order_status === 'pending_approval' && <ActionIconButton icon="approve" label="אישור" tone="success" disabled={busy === order.id} onClick={() => doAction(api.approveOrder, order.id)} />}
        {order.order_status === 'approved' && order.payment_status !== 'paid' && <ActionIconButton icon="paid" label="סמן שולם" tone="warning" disabled={busy === order.id} onClick={() => markPaid(order.id)} />}
        {order.order_status !== 'cancelled' && <ActionIconButton icon="cancel" label="ביטול" tone="danger" disabled={busy === order.id} onClick={() => confirm('לבטל את ההזמנה?') && doAction((id) => api.cancelOrder(id, ''), order.id)} />}
        {canDelete && <ActionIconButton icon="delete" label="מחיקה" tone="danger" disabled={busy === order.id} onClick={() => deleteOrder(order)} />}
      </div>
    );
  }

  return (
    <main id="admin-orders-content" className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#2b2024] sm:text-3xl">הזמנות</h1>
          <p className="mt-1 text-sm text-[#7c7175]">צפייה, אישור ומעקב אחר הזמנות ותשלומים.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex w-fit items-center gap-2 rounded-xl border border-black/[0.07] bg-white px-4 py-2.5 text-sm font-bold text-brand-burgundy shadow-[0_5px_16px_rgba(42,31,36,0.05)] transition hover:border-brand-gold/35 disabled:opacity-50">
          <RefreshIcon spinning={loading} /> רענון
        </button>
      </header>

      <section className="mt-5 grid grid-cols-3 gap-3" aria-label="סיכום הזמנות">
        <SummaryCard label="הזמנות בתצוגה" value={loading ? '–' : visibleOrders.length} />
        <SummaryCard label="ממתינות לאישור" value={loading ? '–' : pendingCount} warning={pendingCount > 0} />
        <SummaryCard label="סה״כ בתצוגה" value={loading ? '–' : `${totalAmount.toLocaleString('he-IL', { maximumFractionDigits: 0 })} ₪`} />
      </section>

      <section className="pilot-panel mt-5 overflow-hidden">
        <div className="border-b border-black/[0.05] p-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative block w-full lg:max-w-sm">
              <span className="sr-only">חיפוש הזמנות</span>
              <span className="pointer-events-none absolute inset-y-0 right-3.5 grid place-items-center text-[#968c8f]"><SearchIcon /></span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="חיפוש לפי לקוח, טלפון או מספר הזמנה"
                className="h-10 min-h-0 w-full rounded-xl border border-black/[0.065] bg-white py-2 pl-4 pr-10 text-sm text-[#3b3033] shadow-[0_2px_8px_rgba(42,31,36,0.025)] outline-none transition placeholder:text-[#a49b9e] focus:border-brand-gold/55 focus:ring-2 focus:ring-brand-gold/15"
              />
            </label>
            <div className="flex gap-1 overflow-x-auto rounded-xl bg-[#f4f3f3] p-1" role="group" aria-label="סינון לפי סטטוס">
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => {
                  const params = {};
                  if (filter.key) params.status = filter.key;
                  if (shabbatFilter) params.shabbat_id = shabbatFilter;
                  setSp(params);
                }}
                aria-pressed={statusFilter === filter.key}
                className={`shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold sm:text-sm ${statusFilter === filter.key ? 'bg-white text-brand-burgundy shadow-[0_2px_7px_rgba(42,31,36,0.09)]' : 'text-[#81777a] hover:text-brand-burgundy'}`}
              >
                {filter.label}
              </button>
            ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowColFilters((s) => !s)}
              aria-expanded={showColFilters}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#81777a] transition hover:text-brand-burgundy"
            >
              <FilterIcon />
              {showColFilters ? 'הסתרת סינון' : 'סינון מתקדם'}
              {activeColFilters > 0 && (
                <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-brand-gold px-1 text-[10px] font-extrabold text-brand-burgundy-dark">{activeColFilters}</span>
              )}
            </button>
            {activeColFilters > 0 && (
              <button type="button" onClick={() => setColFilters(EMPTY_COL_FILTERS)} className="text-xs font-semibold text-[#a49b9e] hover:underline">ניקוי סינון</button>
            )}
            {!loading && (
              <div className="mr-auto flex items-center gap-3 text-xs font-semibold text-[#91878a]">
                <span>{visibleOrders.length} תוצאות</span>
                <span>{unpaidCount > 0 ? `${unpaidCount} הזמנות עם תשלום פתוח` : 'אין תשלומים פתוחים בתצוגה'}</span>
              </div>
            )}
          </div>

          {showColFilters && (
            <div className="mt-3 grid gap-3 rounded-xl border border-black/[0.06] bg-[#faf9f8] p-3 sm:grid-cols-2 lg:grid-cols-3">
              <ColField label="מס׳ הזמנה">
                <input value={colFilters.order_number} onChange={(e) => setCol('order_number', e.target.value)} className={colInputCls} placeholder="חיפוש" />
              </ColField>
              <ColField label="לקוח / טלפון">
                <input value={colFilters.customer} onChange={(e) => setCol('customer', e.target.value)} className={colInputCls} placeholder="חיפוש" />
              </ColField>
              <ColField label="שבת">
                <input value={colFilters.shabbat} onChange={(e) => setCol('shabbat', e.target.value)} className={colInputCls} placeholder="פרשה" />
              </ColField>
              <ColField label="סכום (₪)">
                <div className="flex gap-1" dir="ltr">
                  <input type="number" step="any" value={colFilters.amountMin} onChange={(e) => setCol('amountMin', e.target.value)} className={colInputCls} placeholder="מ־" />
                  <input type="number" step="any" value={colFilters.amountMax} onChange={(e) => setCol('amountMax', e.target.value)} className={colInputCls} placeholder="עד" />
                </div>
              </ColField>
              <ColField label="סטטוס">
                <select value={colFilters.order_status} onChange={(e) => setCol('order_status', e.target.value)} className={colInputCls}>
                  <option value="">הכל</option>
                  {Object.entries(ORDER_STATUS).map(([value, def]) => <option key={value} value={value}>{def.label}</option>)}
                </select>
              </ColField>
              <ColField label="תשלום">
                <select value={colFilters.payment_status} onChange={(e) => setCol('payment_status', e.target.value)} className={colInputCls}>
                  <option value="">הכל</option>
                  {Object.entries(PAYMENT_STATUS).map(([value, def]) => <option key={value} value={value}>{def.label}</option>)}
                </select>
              </ColField>
            </div>
          )}
        </div>

        {loading ? <OrdersSkeleton /> : visibleOrders.length === 0 ? <EmptyState searching={Boolean(normalizedSearch) || activeColFilters > 0} /> : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="pilot-table w-full bg-white">
                <thead className="bg-[#f7f7f7] text-xs">
                  <tr>
                    <th className="px-5 py-3.5 text-right">מס׳ הזמנה</th>
                    <th className="px-4 py-3.5 text-right">לקוח</th>
                    <th className="px-4 py-3.5 text-right">שבת</th>
                    <th className="px-4 py-3.5 text-right">סכום</th>
                    <th className="px-4 py-3.5 text-right">סטטוס</th>
                    <th className="px-4 py-3.5 text-right">תשלום</th>
                    <th className="px-5 py-3.5 text-right">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.05]">
                  {visibleOrders.map((order) => (
                    <tr key={order.id} onClick={() => nav(`/admin/orders/${order.id}`)} className="cursor-pointer transition hover:bg-[#fbfaf8] focus-within:bg-[#fbfaf8]">
                      <td className="px-5 py-4"><span className="font-mono text-xs font-bold tabular-nums text-brand-burgundy">{order.order_number}</span>{order.portions_exception_requested && <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">חריג</span>}</td>
                      <td className="px-4 py-4"><div className="flex flex-col items-start"><div className="font-bold text-[#3c3034]">{order.customers?.full_name || '-'}</div><div className="mt-0.5 text-xs text-[#948a8d]" dir="ltr">{order.customers?.phone || '-'}</div></div></td>
                      <td className="px-4 py-4 text-sm font-medium text-[#63585c]">{order.shabbatot?.parasha || '-'}</td>
                      <td className="px-4 py-4 font-extrabold tabular-nums text-[#3c3034]">{Number(order.final_amount || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })} ₪</td>
                      <td className="px-4 py-4"><Badge map={ORDER_STATUS} value={order.order_status} /></td>
                      <td className="px-4 py-4"><Badge map={PAYMENT_STATUS} value={order.payment_status} /></td>
                      <td className="px-5 py-4" onClick={(event) => event.stopPropagation()}>{renderActions(order)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-black/[0.055] md:hidden">
              {visibleOrders.map((order) => (
                <article key={order.id} className="p-4 transition hover:bg-[#fbfaf8]">
                  <button type="button" onClick={() => nav(`/admin/orders/${order.id}`)} className="w-full text-right focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-extrabold text-[#35292d]">{order.customers?.full_name || 'ללא שם'}</p><p className="mt-0.5 text-xs text-[#948a8d]" dir="ltr">{order.customers?.phone || '-'}</p><p className="mt-1 font-mono text-xs font-bold text-brand-burgundy/55">#{order.order_number}</p></div>
                      <p className="shrink-0 text-base font-extrabold tabular-nums text-[#35292d]">{Number(order.final_amount || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })} ₪</p>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2"><Badge map={ORDER_STATUS} value={order.order_status} /><Badge map={PAYMENT_STATUS} value={order.payment_status} />{order.portions_exception_requested && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">חריג מנות</span>}{order.shabbatot?.parasha && <span className="text-xs font-semibold text-[#8a7f82]">פרשת {order.shabbatot.parasha}</span>}</div>
                  </button>
                  <div className="mt-3 flex items-center justify-end border-t border-black/[0.05] pt-3"><div onClick={(event) => event.stopPropagation()}>{renderActions(order)}</div></div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function SummaryCard({ label, value, warning }) {
  return <div className="pilot-panel min-w-0 p-3.5 sm:p-5"><p className="truncate text-[11px] font-bold text-[#8b8084] sm:text-sm">{label}</p><p className={`mt-1 truncate text-lg font-extrabold tabular-nums sm:text-2xl ${warning ? 'text-amber-700' : 'text-[#33272b]'}`}>{value}</p></div>;
}

const colInputCls = 'w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-[#3b3033] outline-none transition focus:border-brand-gold/55';

function ColField({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold text-[#8b8084]">{label}</span>
      {children}
    </label>
  );
}

function FilterIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4Z" /></svg>;
}

function OrdersSkeleton() {
  return <div className="space-y-px bg-black/[0.04]" aria-live="polite" aria-label="טוען הזמנות">{[1, 2, 3, 4].map((item) => <div key={item} className="flex items-center gap-5 bg-white px-5 py-5"><span className="h-7 w-20 animate-pulse rounded-lg bg-[#f0eded]" /><span className="h-4 w-32 animate-pulse rounded bg-[#f0eded]" /><span className="h-4 w-20 animate-pulse rounded bg-[#f0eded]" /></div>)}</div>;
}

function EmptyState({ searching }) {
  return <div className="flex flex-col items-center px-6 py-14 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-gold/10 text-brand-gold-dark"><EmptyIcon /></span><h2 className="mt-4 font-extrabold text-[#3a2e32]">{searching ? 'לא נמצאו הזמנות מתאימות' : 'אין הזמנות בתצוגה הזו'}</h2><p className="mt-1 text-sm text-[#897e82]">{searching ? 'אפשר לנסות חיפוש קצר יותר או לשנות את המסנן.' : 'אפשר לבחור מסנן אחר כדי לראות הזמנות נוספות.'}</p></div>;
}

function RefreshIcon({ spinning }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`} aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>; }
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>; }
function EmptyIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 10h8M8 14h5" /></svg>; }
