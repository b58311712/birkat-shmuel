import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { Badge, ORDER_STATUS, PAYMENT_STATUS, PAYMENT_METHOD, orderContextLabel, orderContextDate } from '../lib/status.jsx';
import { canEditOrder } from '../lib/orderEdit.js';
import { groupMealsByCategory } from '../lib/orderMeals.js';

// צפייה בהזמנה בודדת + מסך סיכום לאחר יצירה (סעיף 18.1)
export default function OrderView() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const created = sp.get('created') === '1';
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);

  useEffect(() => {
    api.order(id).then(setOrder).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Page title="הזמנה"><p>טוען...</p></Page>;
  if (!order) return <Page title="הזמנה"><p>ההזמנה לא נמצאה.</p></Page>;

  // מכירת מוצרים בנויה משורות מלאי בלבד (מיגרציה 55): אין לה סעודות, מאכלים,
  // תוספות ולא אולם, ולכן החלקים האלה מוחלפים בטבלת המוצרים שנרכשו.
  const isSale = order.order_kind === 'product_sale';

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
            <h1 className="text-2xl font-extrabold text-brand-burgundy">
              {isSale ? 'מכירה' : 'הזמנה'} {order.order_number}
            </h1>
            <p className="text-brand-burgundy/60">{orderContextLabel(order)} · {orderContextDate(order)}</p>
            {order.created_at && (
              <p className="text-sm text-brand-burgundy/50 mt-0.5">
                בוצעה בתאריך {new Date(order.created_at).toLocaleString('he-IL')}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-1">
              <Badge map={ORDER_STATUS} value={order.order_status} />
              <Badge map={PAYMENT_STATUS} value={order.payment_status} />
            </div>
            {canEditOrder(order) && (
              <button type="button" className="btn-ghost text-sm" onClick={() => setEditModalOpen(true)}>
                ✎ ערוך הזמנה
              </button>
            )}
          </div>
        </div>

        {/* מוצרים שנרכשו (מכירת מוצרים) */}
        {isSale && (
          <div className="mb-4">
            <div className="font-bold text-brand-gold-dark mb-2">מוצרים</div>
            {(order.inventory_lines || []).map((l) => (
              <div key={l.id} className="flex justify-between text-sm py-1 border-b border-brand-cream-dark/50 last:border-0">
                <span>
                  {l.item_name_snapshot} × {Number(l.quantity)}
                  {l.units?.name && <span className="text-brand-burgundy/50"> {l.units.name}</span>}
                </span>
                <span className="tabular-nums">{Number(l.line_total).toFixed(2)} ₪</span>
              </div>
            ))}
            {!(order.inventory_lines || []).length && (
              <div className="text-sm text-brand-burgundy/40">אין מוצרים במכירה.</div>
            )}
          </div>
        )}

        {/* סעודות ומאכלים */}
        <div className="space-y-4 mb-4">
          {(order.slots || []).map((s) => (
            <div key={s.id}>
              <div className="flex justify-between font-bold text-brand-gold-dark border-b border-brand-cream-dark pb-1 mb-2">
                <span>{s.meal_slots?.name}</span>
                <span>{s.portions} מנות</span>
              </div>
              <div className="space-y-2">
                {groupMealsByCategory(mealsBySlot[s.meal_slot_id]).map((g) => (
                  <div key={g.key}>
                    <div className="mb-1 text-xs font-bold text-brand-burgundy/50">{g.name}</div>
                    <div className="flex flex-wrap gap-2">
                      {g.meals.map((m) => (
                        <span key={m.id} className="badge bg-brand-cream text-brand-burgundy">
                          {m.meal_name_snapshot}
                          {m.portions != null && <span className="font-bold"> × {Number(m.portions)}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
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
          {!isSale && <Detail label="שם האולם" value={order.venue_name} />}
          {!isSale && <Detail label="כתובת האולם" value={order.venue_address} />}
          {isSale && <Detail label="תאריך המכירה" value={order.sale_date} />}
          <Detail label="אמצעי תשלום" value={PAYMENT_METHOD[order.preferred_payment_method]} />
        </div>

        {order.notes && (
          <div className="mb-4 rounded-xl border border-brand-cream-dark bg-brand-cream/30 p-3">
            <div className="text-xs text-brand-burgundy/50">הערות להזמנה</div>
            <div className="mt-1 whitespace-pre-wrap text-sm text-brand-burgundy">{order.notes}</div>
          </div>
        )}

        {/* סיכום מחיר */}
        <div className="bg-brand-cream/50 rounded-xl p-4 space-y-1">
          {isSale ? (
            <Row label={'מוצרים (כולל מע"מ)'} value={order.inventory_lines_amount} />
          ) : (
            <>
              <Row label="מחיר בסיס" value={order.base_amount} />
              <Row label="תוספות" value={order.extras_amount} />
            </>
          )}
          {Number(order.manual_charges_amount) > 0 && <Row label="חיובים נוספים" value={order.manual_charges_amount} />}
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

      {editModalOpen && (
        <EditCodeModal
          orderId={order.id}
          onClose={() => setEditModalOpen(false)}
          onVerified={(fullOrder, code) => nav(`/order/${order.id}/edit`, { state: { order: fullOrder, code } })}
        />
      )}
    </Page>
  );
}

// מודאל הזנת קוד עריכה - אימות מוקדם לפני מעבר למסך העריכה, כדי שקוד שגוי
// ייתפס כאן ולא רק בשמירה בסוף הטופס.
function EditCodeModal({ orderId, onClose, onVerified }) {
  const [codeInput, setCodeInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setVerifying(true);
    setError('');
    try {
      const data = await api.verifyOrderEditCode(orderId, codeInput.trim());
      onVerified(data, codeInput.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-burgundy-dark/55 p-3 sm:p-6">
      <section className="w-full max-w-sm rounded-xl bg-white shadow-card border border-brand-cream-dark p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="text-lg font-extrabold text-brand-burgundy">קוד עריכה</h2>
          <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5" aria-label="סגירה">×</button>
        </div>
        <p className="text-sm text-brand-burgundy/60 mb-4">
          נא להזין את קוד העריכה בן 6 הספרות שנשלח במייל בעת יצירת ההזמנה.
        </p>
        {error && <div className="bg-red-50 text-red-700 rounded-xl p-3 mb-3">{error}</div>}
        <form onSubmit={submit} className="space-y-3">
          <input
            className="input w-full text-center text-2xl tracking-[0.5em]"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoFocus
          />
          <button type="submit" className="btn-primary w-full" disabled={verifying || codeInput.length !== 6}>
            {verifying ? 'בודק...' : 'המשך לעריכה'}
          </button>
        </form>
      </section>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <div className="text-xs text-brand-burgundy/50">{label}</div>
      <div className="font-medium text-brand-burgundy">{value || '-'}</div>
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
