import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import {
  Badge, ORDER_STATUS, PAYMENT_STATUS, REFUND_STATUS, DELIVERY_METHOD, PAYMENT_METHOD,
} from '../lib/status.jsx';

// פירוט הזמנה מלא לניהול — כל השדות כפי שהתקבלו מהטופס + פעולות (סעיף 9.3, 11)
export default function AdminOrderView({ onAuthError, currentAdmin }) {
  const { id } = useParams();
  const nav = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const canDelete = currentAdmin?.role === 'developer';

  function handleErr(e) {
    if (e.name === 'AdminAuthError') { onAuthError?.(); return true; }
    return false;
  }

  function load() {
    setLoading(true);
    api.adminOrder(id).then(setOrder).catch(handleErr).finally(() => setLoading(false));
  }
  useEffect(load, [id]);

  async function doAction(fn, ...args) {
    setBusy(true);
    try { await fn(id, ...args); load(); }
    catch (e) { if (!handleErr(e)) alert(e.message); }
    finally { setBusy(false); }
  }

  async function deleteOrder() {
    if (!confirm(`למחוק לצמיתות את הזמנה ${order.order_number}?`)) return;
    setBusy(true);
    try {
      await api.deleteOrder(order.id);
      nav('/admin/orders');
    } catch (e) {
      if (!handleErr(e)) alert(e.message);
      setBusy(false);
    }
  }

  if (loading) return <Page title="הזמנה"><p>טוען...</p></Page>;
  if (!order) return <Page title="הזמנה"><p>ההזמנה לא נמצאה.</p></Page>;

  // קיבוץ מאכלים לפי סעודה
  const mealsBySlot = {};
  for (const m of order.meals || []) (mealsBySlot[m.meal_slot_id] ||= []).push(m);

  return (
    <Page>
      <div className="mb-4">
        <Link to="/admin/orders" className="btn-ghost">← חזרה לרשימת ההזמנות</Link>
      </div>

      <div className="card">
        {/* כותרת + סטטוסים */}
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
            {order.refund_status && order.refund_status !== 'not_required' && (
              <Badge map={REFUND_STATUS} value={order.refund_status} />
            )}
          </div>
        </div>

        {/* בקשת כמות מנות חריגה — לתשומת לב המנהל לפני אישור (סעיף 12.2) */}
        {order.portions_exception_requested && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-300 p-3">
            <div className="font-bold text-amber-800">בקשת כמות מנות חריגה — נדרש אישור מודע</div>
            <p className="text-sm text-amber-800 mt-0.5">
              {order.portions_exception_note || 'אחת הסעודות מחוץ לטווח הרגיל (50–100 מנות).'}
            </p>
            {order.order_status === 'pending_approval' && (
              <p className="text-xs text-amber-700 mt-1">אישור ההזמנה מהווה אישור לכמות החריגה.</p>
            )}
          </div>
        )}

        {/* פעולות ניהול */}
        <div className="flex gap-2 flex-wrap mb-4">
          {order.order_status !== 'cancelled' && (
            <Link to={`/admin/orders/${order.id}/edit`}
              className="px-3 py-1.5 rounded-lg bg-brand-burgundy text-brand-cream hover:opacity-90 font-medium">עריכת הזמנה</Link>
          )}
          {order.order_status === 'pending_approval' && (
            <button disabled={busy} onClick={() => doAction(api.approveOrder)}
              className="px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 font-medium">אישור הזמנה</button>
          )}
          {order.order_status !== 'cancelled' && (
            <button disabled={busy}
              onClick={() => confirm('לבטל את ההזמנה?') && doAction((oid) => api.cancelOrder(oid, ''))}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium">ביטול הזמנה</button>
          )}
          {canDelete && (
            <button disabled={busy}
              onClick={deleteOrder}
              className="px-3 py-1.5 rounded-lg bg-red-700 text-white hover:bg-red-800 font-medium">מחיקה</button>
          )}
        </div>

        {/* פרטי לקוח + אספקה — כפי שהתקבלו מהטופס */}
        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          <Section title="פרטי לקוח">
            <Field label="שם" value={order.customers?.full_name} />
            <Field label="טלפון" value={order.customers?.phone} />
            <Field label="דוא״ל" value={order.customers?.email} />
            <Field label="כתובת" value={order.customers?.address} />
          </Section>

          <Section title="אספקה ותשלום">
            <Field label="אופן אספקה" value={DELIVERY_METHOD[order.delivery_method] || order.delivery_method} />
            <Field label="איש קשר לקבלה" value={order.contact_name} />
            <Field label="טלפון איש קשר" value={order.contact_phone} />
            <Field label="שם האולם" value={order.venue_name} />
            <Field label="כתובת האולם" value={order.venue_address} />
            <Field label="הערות שינוע" value={order.transport_notes} />
            <Field label="אמצעי תשלום"
              value={order.preferred_payment_method ? PAYMENT_METHOD[order.preferred_payment_method] || order.preferred_payment_method : null} />
          </Section>
        </div>

        {/* סעודות ומאכלים */}
        <div className="space-y-4 mb-4">
          <div className="font-bold text-brand-gold-dark">סעודות ומאכלים</div>
          {(order.slots || []).map((s) => (
            <div key={s.id}>
              <div className="flex justify-between font-bold text-brand-burgundy border-b border-brand-cream-dark pb-1 mb-2">
                <span>{s.meal_slots?.name}</span>
                <span>{s.portions} מנות</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(mealsBySlot[s.meal_slot_id] || []).map((m) => (
                  <span key={m.id} className="badge bg-brand-cream text-brand-burgundy">
                    {m.meal_name_snapshot}
                    {m.portions != null && <span className="font-bold"> × {Number(m.portions)}</span>}
                    {Number(m.extra_charge_amount) > 0 && ` (+${Number(m.extra_charge_amount).toFixed(0)}₪ למנה)`}
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

        {/* סיכום מחיר */}
        <div className="bg-brand-cream/50 rounded-xl p-4 space-y-1">
          <Row label="מחיר בסיס" value={order.base_amount} />
          <Row label="תוספות" value={order.extras_amount} />
          {Number(order.manual_charges_amount) > 0 && <Row label="חיובים ידניים" value={order.manual_charges_amount} />}
          {Number(order.discount_amount) > 0 && <Row label="הנחה" value={-order.discount_amount} />}
          <div className="flex justify-between font-extrabold text-lg text-brand-burgundy pt-2 border-t border-brand-cream-dark">
            <span>סה"כ לתשלום</span>
            <span>{Number(order.final_amount).toFixed(2)} ₪</span>
          </div>
        </div>
      </div>

      {/* הנחות וחיובים ידניים (סעיף 16) */}
      <DiscountsCharges
        order={order}
        disabled={order.order_status === 'cancelled'}
        onError={handleErr}
        onChanged={load}
      />

      {/* גבייה מלקוח (סעיף 17) */}
      <PaymentsPanel order={order} onError={handleErr} onChanged={load} />

      {/* החזרים כספיים (סעיף 19) */}
      <RefundsPanel order={order} onError={handleErr} onChanged={load} />

      {/* היסטוריית ההזמנה */}
      {(order.history || []).length > 0 && (
        <div className="card mt-4">
          <div className="font-bold text-brand-gold-dark mb-2">היסטוריית ההזמנה</div>
          <div className="space-y-1">
            {order.history.map((h) => (
              <div key={h.id} className="flex justify-between text-sm text-brand-burgundy/80 py-1 border-b border-brand-cream-dark last:border-0">
                <span>{h.action}</span>
                <span className="text-brand-burgundy/50">{new Date(h.created_at).toLocaleString('he-IL')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-brand-cream/30 rounded-xl p-4">
      <div className="font-bold text-brand-gold-dark mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="flex justify-between text-sm gap-3">
      <span className="text-brand-burgundy/60 shrink-0">{label}</span>
      <span className="text-brand-burgundy font-medium text-left">{value || '—'}</span>
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

// פאנל הנחות וחיובים ידניים (סעיף 16) — הוספה/הסרה עם חישוב-מחדש בשרת
function DiscountsCharges({ order, disabled, onError, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [dType, setDType] = useState('fixed_amount');
  const [dValue, setDValue] = useState('');
  const [dReason, setDReason] = useState('');
  const [cName, setCName] = useState('');
  const [cAmount, setCAmount] = useState('');
  const [cReason, setCReason] = useState('');

  async function run(fn) {
    setBusy(true);
    try { await fn(); onChanged(); }
    catch (e) { if (!onError(e)) alert(e.message); }
    finally { setBusy(false); }
  }

  async function addDiscount(e) {
    e.preventDefault();
    const value = Number(dValue);
    if (!(value > 0)) return alert('יש להזין ערך הנחה גדול מאפס.');
    await run(async () => {
      await api.addOrderDiscount(order.id, { discount_type: dType, value, internal_reason: dReason });
      setDValue(''); setDReason('');
    });
  }

  async function addCharge(e) {
    e.preventDefault();
    if (!cName.trim()) return alert('יש להזין שם לחיוב.');
    const amount = Number(cAmount);
    if (!(amount > 0)) return alert('יש להזין סכום גדול מאפס.');
    await run(async () => {
      await api.addOrderManualCharge(order.id, { name: cName.trim(), amount, reason: cReason });
      setCName(''); setCAmount(''); setCReason('');
    });
  }

  const discounts = order.discounts || [];
  const charges = order.manual_charges || [];

  return (
    <div className="card mt-4">
      <div className="font-bold text-brand-gold-dark mb-3">הנחות וחיובים ידניים</div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* הנחות */}
        <div>
          <div className="font-bold text-brand-burgundy mb-2">הנחות</div>
          {discounts.length === 0 && <p className="text-sm text-brand-burgundy/40 mb-2">אין הנחות.</p>}
          <div className="space-y-1 mb-3">
            {discounts.map((d) => (
              <div key={d.id} className="flex justify-between items-center text-sm bg-brand-cream/40 rounded-lg px-3 py-2">
                <span>
                  {d.discount_type === 'percentage' ? `${Number(d.value)}%` : `${Number(d.value).toFixed(2)}₪`}
                  {d.internal_reason && <span className="text-brand-burgundy/50"> · {d.internal_reason}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">−{Number(d.discount_amount).toFixed(2)} ₪</span>
                  {!disabled && (
                    <button disabled={busy} title="הסרה"
                      onClick={() => confirm('להסיר את ההנחה?') && run(() => api.removeOrderDiscount(order.id, d.id))}
                      className="text-red-600 hover:text-red-800 font-bold px-1">✕</button>
                  )}
                </span>
              </div>
            ))}
          </div>
          {!disabled && (
            <form onSubmit={addDiscount} className="space-y-2">
              <div className="flex gap-2">
                <select value={dType} onChange={(e) => setDType(e.target.value)} className="input flex-1">
                  <option value="fixed_amount">סכום קבוע (₪)</option>
                  <option value="percentage">אחוזים (%)</option>
                </select>
                <input type="number" step="0.01" min="0" value={dValue} onChange={(e) => setDValue(e.target.value)}
                  placeholder={dType === 'percentage' ? 'אחוז' : 'סכום'} className="input w-24" />
              </div>
              <input value={dReason} onChange={(e) => setDReason(e.target.value)} placeholder="סיבה (פנימית, לא חובה)" className="input w-full" />
              <button disabled={busy} className="btn-secondary w-full">הוספת הנחה</button>
            </form>
          )}
        </div>

        {/* חיובים ידניים */}
        <div>
          <div className="font-bold text-brand-burgundy mb-2">חיובים ידניים</div>
          {charges.length === 0 && <p className="text-sm text-brand-burgundy/40 mb-2">אין חיובים ידניים.</p>}
          <div className="space-y-1 mb-3">
            {charges.map((c) => (
              <div key={c.id} className="flex justify-between items-center text-sm bg-brand-cream/40 rounded-lg px-3 py-2">
                <span>
                  {c.name}
                  {c.reason && <span className="text-brand-burgundy/50"> · {c.reason}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">+{Number(c.amount).toFixed(2)} ₪</span>
                  {!disabled && (
                    <button disabled={busy} title="הסרה"
                      onClick={() => confirm('להסיר את החיוב?') && run(() => api.removeOrderManualCharge(order.id, c.id))}
                      className="text-red-600 hover:text-red-800 font-bold px-1">✕</button>
                  )}
                </span>
              </div>
            ))}
          </div>
          {!disabled && (
            <form onSubmit={addCharge} className="space-y-2">
              <div className="flex gap-2">
                <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="שם החיוב" className="input flex-1" />
                <input type="number" step="0.01" min="0" value={cAmount} onChange={(e) => setCAmount(e.target.value)}
                  placeholder="סכום" className="input w-24" />
              </div>
              <input value={cReason} onChange={(e) => setCReason(e.target.value)} placeholder="הערה (לא חובה)" className="input w-full" />
              <button disabled={busy} className="btn-secondary w-full">הוספת חיוב</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// פאנל גבייה מלקוח (סעיף 17) — תיעוד תשלומים, סיכום יתרה, אישור חריגה
function PaymentsPanel({ order, onError, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(order.preferred_payment_method || 'bank_transfer');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');

  function load() {
    api.orderPayments(order.id).then(setData).catch((e) => onError(e));
  }
  useEffect(load, [order.id]);

  async function run(fn) {
    setBusy(true);
    try { await fn(); load(); onChanged(); }
    catch (e) { if (!onError(e)) alert(e.message); }
    finally { setBusy(false); }
  }

  async function addPayment(e) {
    e.preventDefault();
    const amt = Number(amount);
    if (!(amt > 0)) return alert('יש להזין סכום גדול מאפס.');
    await run(async () => {
      await api.addOrderPayment(order.id, { amount: amt, payment_method: method, paid_at: paidAt, internal_note: note });
      setAmount(''); setNote('');
    });
  }

  const s = data?.summary;
  const payments = data?.payments || [];
  const override = order.payment_status === 'payment_override';

  return (
    <div className="card mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-bold text-brand-gold-dark">גבייה מלקוח</div>
        <Badge map={PAYMENT_STATUS} value={order.payment_status} />
      </div>

      {/* סיכום יתרה */}
      {s && (
        <div className="grid grid-cols-3 gap-2 mb-4 text-center">
          <div className="bg-brand-cream/50 rounded-xl p-3">
            <div className="text-xs text-brand-burgundy/60">לתשלום</div>
            <div className="font-extrabold text-brand-burgundy">{Number(s.final).toFixed(2)} ₪</div>
          </div>
          <div className="bg-green-50 rounded-xl p-3">
            <div className="text-xs text-brand-burgundy/60">שולם</div>
            <div className="font-extrabold text-green-700">{Number(s.paid).toFixed(2)} ₪</div>
          </div>
          <div className={`rounded-xl p-3 ${s.balance > 0 ? 'bg-red-50' : 'bg-brand-cream/50'}`}>
            <div className="text-xs text-brand-burgundy/60">יתרה</div>
            <div className={`font-extrabold ${s.balance > 0 ? 'text-red-700' : 'text-brand-burgundy'}`}>{Number(s.balance).toFixed(2)} ₪</div>
          </div>
        </div>
      )}

      {/* רשימת תשלומים */}
      {payments.length === 0 && <p className="text-sm text-brand-burgundy/40 mb-3">טרם תועדו תשלומים.</p>}
      <div className="space-y-1 mb-4">
        {payments.map((p) => (
          <div key={p.id} className="flex justify-between items-center text-sm bg-brand-cream/40 rounded-lg px-3 py-2">
            <span>
              <span className="font-medium">{Number(p.amount).toFixed(2)} ₪</span>
              <span className="text-brand-burgundy/50"> · {PAYMENT_METHOD[p.payment_method] || p.payment_method} · {p.paid_at}</span>
              {p.internal_note && <span className="text-brand-burgundy/50"> · {p.internal_note}</span>}
            </span>
            <button disabled={busy} title="מחיקה"
              onClick={() => confirm('למחוק את תיעוד התשלום?') && run(() => api.removeOrderPayment(order.id, p.id))}
              className="text-red-600 hover:text-red-800 font-bold px-1">✕</button>
          </div>
        ))}
      </div>

      {/* טופס הוספת תשלום */}
      <form onSubmit={addPayment} className="grid sm:grid-cols-4 gap-2 items-end">
        <div>
          <label className="text-xs text-brand-burgundy/60">סכום (₪)</label>
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="input w-full" />
        </div>
        <div>
          <label className="text-xs text-brand-burgundy/60">אמצעי</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="input w-full">
            {Object.entries(PAYMENT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-brand-burgundy/60">תאריך</label>
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="input w-full" />
        </div>
        <button disabled={busy} className="btn-secondary">תיעוד תשלום</button>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערה פנימית (לא חובה)" className="input w-full sm:col-span-4" />
      </form>

      {/* אישור חריגת תשלום (סעיף 17.4) */}
      <div className="mt-3 pt-3 border-t border-brand-cream-dark flex items-center gap-3">
        <span className="text-sm text-brand-burgundy/70">
          {override ? 'ההזמנה מסומנת כחריגת תשלום מאושרת.' : 'לאשר חריגת תשלום (סכום מאושר על אף יתרה)?'}
        </span>
        <button disabled={busy}
          onClick={() => run(() => api.setPaymentOverride(order.id, !override))}
          className="px-3 py-1 rounded-lg bg-purple-100 text-purple-800 hover:bg-purple-200 text-sm font-medium">
          {override ? 'ביטול חריגה' : 'אישור חריגה'}
        </button>
      </div>
    </div>
  );
}

// פאנל החזרים כספיים (סעיף 19) — פתיחה, ביצוע, ביטול. ניהול פנימי בלבד (19.3).
function RefundsPanel({ order, onError, onChanged }) {
  const [refunds, setRefunds] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [showForm, setShowForm] = useState(false);

  function load() {
    api.orderRefunds(order.id).then(setRefunds).catch((e) => onError(e));
  }
  useEffect(load, [order.id]);

  async function run(fn) {
    setBusy(true);
    try { await fn(); load(); onChanged(); }
    catch (e) { if (!onError(e)) alert(e.message); }
    finally { setBusy(false); }
  }

  async function createRefund(e) {
    e.preventDefault();
    const payload = { reason: reason.trim() || null };
    if (amount !== '') {
      const amt = Number(amount);
      if (!(amt > 0)) return alert('יש להזין סכום גדול מאפס.');
      payload.amount_to_refund = amt;
    }
    await run(async () => {
      await api.createRefund(order.id, payload);
      setReason(''); setAmount(''); setShowForm(false);
    });
  }

  async function execute(r) {
    const input = prompt('סכום שהוחזר בפועל (₪):', String(Number(r.amount_to_refund).toFixed(2)));
    if (input == null) return;
    const amt = Number(input);
    if (!(amt > 0)) return alert('סכום לא תקין.');
    await run(() => api.executeRefund(r.id, { amount_refunded: amt }));
  }

  const list = refunds || [];

  return (
    <div className="card mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-bold text-brand-gold-dark">החזרים כספיים <span className="text-xs font-normal text-brand-burgundy/50">(ניהול פנימי בלבד)</span></div>
        <button disabled={busy} onClick={() => setShowForm((v) => !v)} className="btn-secondary text-sm">
          {showForm ? 'ביטול' : '+ החזר חדש'}
        </button>
      </div>

      {/* טופס פתיחת החזר */}
      {showForm && (
        <form onSubmit={createRefund} className="bg-brand-cream/40 rounded-xl p-3 mb-4 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-brand-burgundy/60">סכום להחזר (₪) — ריק = חישוב אוטומטי מהיתרה</label>
              <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="אוטומטי" className="input w-full" />
            </div>
            <div>
              <label className="text-xs text-brand-burgundy/60">סיבת החזר</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: הפחתת מנות לאחר תשלום" className="input w-full" />
            </div>
          </div>
          <button disabled={busy} className="btn-primary w-full">פתיחת החזר</button>
        </form>
      )}

      {list.length === 0 && <p className="text-sm text-brand-burgundy/40">אין החזרים.</p>}
      <div className="space-y-2">
        {list.map((r) => (
          <div key={r.id} className="border border-brand-cream-dark rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <Badge map={REFUND_STATUS} value={r.status} />
              <span className="font-extrabold text-brand-burgundy">{Number(r.amount_to_refund).toFixed(2)} ₪</span>
            </div>
            {r.reason && <div className="text-sm text-brand-burgundy/70 mb-1">{r.reason}</div>}
            <div className="text-xs text-brand-burgundy/50 grid grid-cols-2 gap-x-4 gap-y-0.5">
              <span>שולם: {Number(r.amount_paid).toFixed(2)} ₪</span>
              <span>סופי לאחר שינוי: {Number(r.final_amount_after_change).toFixed(2)} ₪</span>
              {r.amount_refunded != null && <span>הוחזר בפועל: {Number(r.amount_refunded).toFixed(2)} ₪</span>}
              {r.refund_method && <span>אמצעי: {PAYMENT_METHOD[r.refund_method] || r.refund_method}</span>}
              {r.refunded_at && <span>תאריך החזר: {r.refunded_at}</span>}
              {r.approver?.full_name && <span>אישר: {r.approver.full_name}</span>}
              {r.executor?.full_name && <span>ביצע: {r.executor.full_name}</span>}
            </div>
            {(r.status === 'pending' || r.status === 'partial') && (
              <div className="flex gap-2 mt-2">
                <button disabled={busy} onClick={() => execute(r)}
                  className="px-3 py-1 rounded-lg bg-green-600 text-white hover:bg-green-700 text-sm font-medium">ביצוע החזר</button>
                <button disabled={busy}
                  onClick={() => confirm('לבטל את ההחזר?') && run(() => api.cancelRefund(r.id, ''))}
                  className="px-3 py-1 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 text-sm font-medium">ביטול החזר</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
