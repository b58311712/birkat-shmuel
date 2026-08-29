import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, PAYMENT_STATUS, PAYMENT_METHOD } from '../lib/status.jsx';

// פאנל גבייה מלקוח (סעיף 17) - תיעוד תשלומים וסיכום יתרה.
//
// הפאנל עובד על order_id בלבד ואינו יודע דבר על מועד, סעודות או מוצרים, ולכן
// הוא משרת הזמנת שבת, אירוע ומכירת מוצרים באותה מידה. זו בדיוק הסיבה שמכירה
// נבנתה כשורת orders ולא כטבלה נפרדת (מיגרציה 55).
//
// props:
//   order     - ההזמנה/המכירה. נדרשים id, payment_status, preferred_payment_method
//   onError   - מטפל שגיאות הדף; מחזיר true אם טיפל בעצמו (שגיאת אימות)
//   onChanged - נקרא אחרי כל שינוי, כדי שהדף יטען מחדש את הסכומים
export default function OrderPaymentsPanel({ order, onError, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(order.preferred_payment_method || 'bank_transfer');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');

  function load() {
    api.orderPayments(order.id).then(setData).catch((e) => onError?.(e));
  }
  useEffect(load, [order.id]);

  async function run(fn) {
    setBusy(true);
    try { await fn(); load(); onChanged?.(); }
    catch (e) { if (!onError?.(e)) alert(e.message); }
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
    </div>
  );
}
