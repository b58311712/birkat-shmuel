import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ORDER_STATUS } from '../lib/status.jsx';
import { adminMenuGroups } from './Layout.jsx';

/* חיפוש גלובלי (Ctrl+K): מסכים, לקוחות והזמנות בפלטה אחת.
   הנתונים נטענים פעם אחת בפתיחה (סקאלה קהילתית - מאות רשומות)
   והסינון רץ בזיכרון תוך כדי הקלדה. */

const SCREENS = [
  { to: '/admin', label: 'דשבורד', group: 'ראשי' },
  ...adminMenuGroups.flatMap((group) =>
    group.items.map((item) => ({ to: item.to, label: item.label, group: group.label }))),
];

const DATA_TTL_MS = 60000;

export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [data, setData] = useState({ customers: [], orders: [], loading: false });
  const fetchedAt = useRef(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    // פוקוס אחרי שהפאנל מצויר
    requestAnimationFrame(() => inputRef.current?.focus());

    if (Date.now() - fetchedAt.current < DATA_TTL_MS) return;
    setData((d) => ({ ...d, loading: true }));
    Promise.all([api.adminCustomers(), api.adminOrders()])
      .then(([customers, orders]) => {
        fetchedAt.current = Date.now();
        setData({ customers: customers || [], orders: orders || [], loading: false });
      })
      .catch(() => setData((d) => ({ ...d, loading: false })));
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');

    const screens = (q
      ? SCREENS.filter((s) => s.label.toLowerCase().includes(q) || s.group.toLowerCase().includes(q))
      : SCREENS
    ).map((s) => ({ kind: 'screen', key: `s:${s.to}`, ...s }));

    if (!q) return { screens, customers: [], orders: [] };

    const customers = data.customers
      .filter((c) =>
        (c.full_name || '').toLowerCase().includes(q)
        || (digits && (c.phone || '').replace(/\D/g, '').includes(digits))
        || (c.email || '').toLowerCase().includes(q))
      .slice(0, 6)
      .map((c) => ({ kind: 'customer', key: `c:${c.id}`, customer: c }));

    const orders = data.orders
      .filter((o) =>
        (digits && String(o.order_number || '').includes(digits))
        || (o.customers?.full_name || '').toLowerCase().includes(q)
        || (digits && (o.customers?.phone || '').replace(/\D/g, '').includes(digits)))
      .slice(0, 6)
      .map((o) => ({ kind: 'order', key: `o:${o.id}`, order: o }));

    return { screens: screens.slice(0, 5), customers, orders };
  }, [query, data]);

  const flat = useMemo(
    () => [...results.screens, ...results.customers, ...results.orders],
    [results],
  );

  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!open) return null;

  function go(item) {
    onClose();
    if (item.kind === 'screen') navigate(item.to);
    else if (item.kind === 'customer') navigate(`/admin/customers?search=${encodeURIComponent(item.customer.full_name || '')}`);
    else if (item.kind === 'order') navigate(`/admin/orders/${item.order.id}`);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && flat[selected]) { e.preventDefault(); go(flat[selected]); }
    else if (e.key === 'Escape') onClose();
  }

  let flatIndex = -1;
  const renderItem = (item, content) => {
    flatIndex += 1;
    const index = flatIndex;
    const isSelected = index === selected;
    return (
      <button
        key={item.key}
        type="button"
        data-selected={isSelected || undefined}
        onMouseEnter={() => setSelected(index)}
        onClick={() => go(item)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-right text-[13px] transition-colors ${
          isSelected ? 'bg-[#F7EEF1] text-brand-burgundy' : 'text-surface-body'
        }`}
      >
        {content}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="חיפוש גלובלי">
      <button type="button" className="absolute inset-0 bg-ink/35 backdrop-blur-sm" onClick={onClose} aria-label="סגירת החיפוש" />
      <div className="absolute inset-x-3 top-[10vh] mx-auto max-w-[560px] overflow-hidden rounded-3xl border border-surface-line bg-white shadow-dialog" dir="rtl">
        <div className="flex items-center gap-2.5 border-b border-surface-line px-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 text-surface-muted" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="חיפוש לקוח, הזמנה או מסך..."
            className="!min-h-0 w-full !rounded-none !border-0 !bg-transparent py-3.5 text-[15px] text-ink placeholder:text-surface-muted focus:!shadow-none focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-surface-line bg-surface-canvas px-1.5 py-0.5 font-sans text-[10px] font-semibold text-surface-muted" dir="ltr">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {results.screens.length > 0 && (
            <>
              <p className="side-nav-group !pt-2">מסכים</p>
              {results.screens.map((item) => renderItem(item, (
                <>
                  <ScreenIcon />
                  <span className="font-semibold">{item.label}</span>
                  <span className="mr-auto text-[11px] text-surface-muted">{item.group}</span>
                </>
              )))}
            </>
          )}

          {results.customers.length > 0 && (
            <>
              <p className="side-nav-group">לקוחות</p>
              {results.customers.map((item) => renderItem(item, (
                <>
                  <CustomerIcon />
                  <span className="truncate font-semibold">{item.customer.full_name}</span>
                  {item.customer.phone && (
                    <span className="mr-auto text-[11.5px] tabular-nums text-surface-muted" dir="ltr">{item.customer.phone}</span>
                  )}
                </>
              )))}
            </>
          )}

          {results.orders.length > 0 && (
            <>
              <p className="side-nav-group">הזמנות</p>
              {results.orders.map((item) => renderItem(item, (
                <>
                  <OrderIcon />
                  <span className="font-bold tabular-nums" dir="ltr">#{item.order.order_number}</span>
                  <span className="truncate">{item.order.customers?.full_name}</span>
                  <span className="mr-auto shrink-0 text-[11px] text-surface-muted">
                    {ORDER_STATUS[item.order.order_status]?.label || item.order.order_status}
                  </span>
                </>
              )))}
            </>
          )}

          {query.trim() && flat.length === 0 && (
            <p className="px-3 py-8 text-center text-[13px] text-surface-muted">
              {data.loading ? 'טוען נתונים...' : `לא נמצאו תוצאות עבור "${query.trim()}"`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-surface-line bg-surface-canvas/60 px-4 py-2 text-[11px] text-surface-muted">
          <span><kbd className="font-sans font-semibold">↑↓</kbd> ניווט</span>
          <span><kbd className="font-sans font-semibold">Enter</kbd> פתיחה</span>
          <span className="mr-auto">Ctrl+K לפתיחה מכל מקום</span>
        </div>
      </div>
    </div>
  );
}

function ScreenIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[15px] w-[15px] shrink-0 text-surface-muted" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8" /></svg>;
}
function CustomerIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[15px] w-[15px] shrink-0 text-surface-muted" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-1a7 7 0 0 1 14 0v1" /></svg>;
}
function OrderIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[15px] w-[15px] shrink-0 text-surface-muted" aria-hidden="true"><path d="M9 5H7a2 2 0 0 0-2 2v12h14V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></svg>;
}
