import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatShabbatTitle } from '../lib/dates.js';

// ---------------------------------------------------------------------------
// שיוך הזמנת רכש: מועד + הזמנת לקוח מסוימת בתוכו (מיגרציה 63).
// מועד אחד מכיל כמה הזמנות לקוח, ולכן כשהרכש נעשה עבור הזמנה מסוימת (למשל
// רכש ישיר לאולם) צריך לציין אותה. השרת גוזר את המועד מההזמנה שנבחרה, ולכן
// בחירת הזמנה נועלת כאן את המועד לזה שלה.
// משותף לטופס היצירה ולעריכת טיוטה, כדי שההתנהגות תהיה זהה בשניהם.
// ---------------------------------------------------------------------------
export default function PurchaseOrderLinkFields({ shabbatId, orderId, onChange, className = '' }) {
  const [shabbatot, setShabbatot] = useState([]);
  const [orders, setOrders] = useState(null); // null = טרם נטען עבור המועד הנוכחי

  useEffect(() => { api.allShabbatot().then(setShabbatot).catch(() => {}); }, []);

  useEffect(() => {
    if (!shabbatId) { setOrders([]); return; }
    let cancelled = false; // מונע דריסה בתשובה מאוחרת של מועד קודם
    setOrders(null);
    api.adminOrders(`?shabbat_id=${shabbatId}`)
      .then((rows) => { if (!cancelled) setOrders(rows || []); })
      .catch(() => { if (!cancelled) setOrders([]); });
    return () => { cancelled = true; };
  }, [shabbatId]);

  // החלפת מועד מבטלת את ההזמנה שנבחרה - היא שייכת למועד הקודם.
  function pickShabbat(value) {
    onChange({ shabbat_id: value, order_id: '' });
  }

  function orderLabel(order) {
    const customer = order.customers?.full_name || 'לקוח';
    const venue = order.venue_name ? ` · ${order.venue_name}` : '';
    return `#${order.order_number} · ${customer}${venue}`;
  }

  return (
    <>
      <Field label="אירוע" className={className}>
        <select value={shabbatId || ''} onChange={(e) => pickShabbat(e.target.value)} className={inputCls}>
          <option value="">- ללא שיוך -</option>
          {shabbatot.map((shabbat) => (
            <option key={shabbat.id} value={shabbat.id}>
              {formatShabbatTitle(shabbat)} · {shabbat.gregorian_date}
            </option>
          ))}
        </select>
      </Field>
      <Field label="הזמנת לקוח" className={className}>
        <select
          value={orderId || ''}
          onChange={(e) => onChange({ shabbat_id: shabbatId || '', order_id: e.target.value })}
          disabled={!shabbatId}
          className={`${inputCls} disabled:bg-brand-cream disabled:text-brand-burgundy/40`}
        >
          <option value="">{shabbatId ? '- כל האירוע -' : '- בחרו אירוע תחילה -'}</option>
          {(orders || []).map((order) => (
            <option key={order.id} value={order.id}>{orderLabel(order)}</option>
          ))}
        </select>
        {shabbatId && orders === null && <span className="text-xs text-brand-burgundy/50">טוען הזמנות...</span>}
        {shabbatId && orders?.length === 0 && <span className="text-xs text-brand-burgundy/50">אין הזמנות לקוח באירוע זה.</span>}
      </Field>
    </>
  );
}

const inputCls = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none';

function Field({ label, className, children }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm text-brand-burgundy/70 block mb-1">{label}</span>
      {children}
    </label>
  );
}
