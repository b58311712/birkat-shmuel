import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { Badge, ORDER_STATUS, PAYMENT_STATUS, PAYMENT_METHOD } from '../lib/status.jsx';

// צפייה בהזמנה בודדת + מסך סיכום לאחר יצירה (סעיף 18.1)
export default function OrderView() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const created = sp.get('created') === '1';
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.order(id).then(setOrder).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Page title="הזמנה"><p>טוען...</p></Page>;
  if (!order) return <Page title="הזמנה"><p>ההזמנה לא נמצאה.</p></Page>;

  // קיבוץ מאכלים לפי סעודה
  const slotNames = Object.fromEntries((order.slots || []).map((s) => [s.meal_slot_id, s.meal_slots?.name]));
  const mealsBySlot = {};
  for (const m of order.meals || []) (mealsBySlot[m.meal_slot_id] ||= []).push(m);

  return (
    <Page>
      {created && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-4 mb-4 text-center">
          <div className="text-3xl mb-1">✓</div>
          <div className="font-bold">ההזמנה נשלחה בהצלחה!</div>
          <div className="text-sm">ההזמנה ממתינה לאישור מנהל.</div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4 pb-4 border-b border-brand-cream-dark">
          <div>
            <h1 className="text-2xl font-extrabold text-brand-burgundy">הזמנה {order.order_number}</h1>
            <p className="text-brand-burgundy/60">{order.shabbatot?.parasha} · {order.shabbatot?.gregorian_date}</p>
            {order.created_at && (
              <p className="text-sm text-brand-burgundy/50 mt-0.5">
                בוצעה בתאריך {new Date(order.created_at).toLocaleString('he-IL')}
              </p>
            )}
          </div>
          <div className="flex gap-1">
            <Badge map={ORDER_STATUS} value={order.order_status} />
            <Badge map={PAYMENT_STATUS} value={order.payment_status} />
          </div>
        </div>

        {/* סעודות ומאכלים */}
        <div className="space-y-4 mb-4">
          {(order.slots || []).map((s) => (
            <div key={s.id}>
              <div className="flex justify-between font-bold text-brand-gold-dark border-b border-brand-cream-dark pb-1 mb-2">
                <span>{s.meal_slots?.name}</span>
                <span>{s.portions} מנות</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(mealsBySlot[s.meal_slot_id] || []).map((m) => (
                  <span key={m.id} className="badge bg-brand-cream text-brand-burgundy">
                    {m.meal_name_snapshot}
                    {m.portions != null && <span className="font-bold"> × {Number(m.portions)}</span>}
                  </span>
                ))}
                {!(mealsBySlot[s.meal_slot_id] || []).length && <span className="text-sm text-brand-burgundy/40">לא נבחרו מאכלים</span>}
              </div>
            </div>
          ))}
        </div>

        {/* תוספות */}
        {(order.extras || []).length > 0 && (
          <div className="mb-4">
            <div className="font-bold text-brand-gold-dark mb-2">תוספות בתשלום</div>
            {order.extras.map((e) => (
              <div key={e.id} className="flex justify-between text-sm py-1">
                <span>{e.extra_name_snapshot} × {e.actual_quantity}</span>
                <span>{Number(e.line_total).toFixed(2)} ₪</span>
              </div>
            ))}
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-3 mb-4 rounded-xl border border-brand-cream-dark p-3 text-sm">
          <Detail label="שם האולם" value={order.venue_name} />
          <Detail label="כתובת האולם" value={order.venue_address} />
          <Detail label="אמצעי תשלום" value={PAYMENT_METHOD[order.preferred_payment_method]} />
        </div>

        {/* סיכום מחיר */}
        <div className="bg-brand-cream/50 rounded-xl p-4 space-y-1">
          <Row label="מחיר בסיס" value={order.base_amount} />
          <Row label="תוספות" value={order.extras_amount} />
          {Number(order.discount_amount) > 0 && <Row label="הנחה" value={-order.discount_amount} />}
          <div className="flex justify-between font-extrabold text-lg text-brand-burgundy pt-2 border-t border-brand-cream-dark">
            <span>סה"כ לתשלום</span>
            <span>{Number(order.final_amount).toFixed(2)} ₪</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Link to="/my-orders" className="btn-ghost">← חזרה להזמנות שלי</Link>
      </div>
    </Page>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <div className="text-xs text-brand-burgundy/50">{label}</div>
      <div className="font-medium text-brand-burgundy">{value || '—'}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between text-brand-burgundy/80">
      <span>{label}</span>
      <span>{Number(value).toFixed(2)} ₪</span>
    </div>
  );
}
