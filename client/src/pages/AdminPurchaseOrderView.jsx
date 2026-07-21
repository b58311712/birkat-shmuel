import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { Badge, PO_STATUS, SUPPLIER_PAYMENT_STATUS, SUPPLIER_CHANNEL } from '../lib/status.jsx';
import PriceInput from '../components/PriceInput.jsx';
import { formatWithVat } from '../lib/vat.js';

// פירוט הזמנת רכש (סעיף 27.2): שורות, קבלת סחורה למלאי (27.3) ותשלום לספק (28.1).

export default function AdminPurchaseOrderView({ onAuthError, currentAdmin }) {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null); // null | 'receive' | 'payment'
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') { onAuthError?.(); return true; }
    return false;
  }, [onAuthError]);

  const load = useCallback(() => {
    setLoading(true);
    api.purchaseOrder(id).then(setData).catch((e) => { if (!handleErr(e)) alert(e.message); }).finally(() => setLoading(false));
  }, [id, handleErr]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(status, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    try { await api.setPurchaseOrderStatus(id, status); setMode(null); load(); }
    catch (e) { if (!handleErr(e)) alert(e.message); }
    finally { setBusy(false); }
  }

  async function deletePurchaseOrder() {
    if (!confirm('למחוק לצמיתות את הזמנת הרכש?')) return;
    setBusy(true);
    try {
      await api.deletePurchaseOrder(id);
      nav('/admin/purchase-orders');
    } catch (e) {
      if (!handleErr(e)) alert(e.message);
      setBusy(false);
    }
  }

  if (loading) return <Page title="הזמנת רכש"><p>טוען...</p></Page>;
  if (!data) return <Page title="הזמנת רכש"><p>ההזמנה לא נמצאה.</p></Page>;

  const { purchase_order: po, lines, payment } = data;
  const isDraft = po.status === 'draft';
  const isCancelled = po.status === 'cancelled';
  const isReceived = po.status === 'received';
  const canReceive = po.status === 'sent' || po.status === 'partially_received';

  return (
    <Page title={`הזמנת רכש ${po.po_number}`} subtitle={po.supplier?.name}>
      <div className="mb-4">
        <Link to="/admin/purchase-orders" className="text-brand-burgundy/60 hover:underline text-sm">→ חזרה לרשימת הזמנות הרכש</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* פרטי ההזמנה */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-brand-burgundy text-lg">פרטי ההזמנה</h3>
              <Badge map={PO_STATUS} value={po.status} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <Info label="ספק" value={po.supplier?.name} />
              <Info label="אמצעי הזמנה" value={SUPPLIER_CHANNEL[po.supplier?.preferred_channel]} />
              <Info label="טלפון ספק" value={po.supplier?.phone} ltr />
              <Info label="תאריך יצירה" value={new Date(po.created_at).toLocaleDateString('he-IL')} ltr />
              <Info label="אספקה צפויה" value={po.expected_delivery_date} ltr />
              <Info label="נוצר ע״י" value={po.creator?.full_name} />
              <Info label='מחיר משוער (לפני מע"מ)' value={po.estimated_amount != null ? `₪${po.estimated_amount}` : null} ltr />
              <Info label='מחיר בפועל (לפני מע"מ)' value={po.actual_amount != null ? `₪${po.actual_amount}` : null} ltr />
            </div>
            {po.notes && <div className="text-sm text-brand-burgundy/70 border-t border-brand-cream-dark pt-2">הערות: {po.notes}</div>}
          </div>

          {/* שורות ההזמנה */}
          <div className="card">
            <h3 className="font-bold text-brand-burgundy mb-3">פריטים</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-brand-burgundy/60 border-b border-brand-cream-dark">
                  <tr>
                    <th className="p-2 text-right">מוצר</th>
                    <th className="p-2 text-right">הוזמן</th>
                    <th className="p-2 text-right">התקבל</th>
                    <th className="p-2 text-right">מחיר משוער (כולל מע"מ)</th>
                    <th className="p-2 text-right">מחיר בפועל (כולל מע"מ)</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const full = Number(l.quantity_received) >= Number(l.quantity);
                    const partial = Number(l.quantity_received) > 0 && !full;
                    return (
                      <tr key={l.id} className="border-b border-brand-cream-dark/50">
                        <td className="p-2 font-medium">{l.item?.name || '—'} <span className="text-brand-burgundy/40">({l.item?.unit})</span></td>
                        <td className="p-2" dir="ltr">{fmt(l.quantity)}</td>
                        <td className={`p-2 font-medium ${full ? 'text-green-700' : partial ? 'text-amber-700' : 'text-brand-burgundy/50'}`} dir="ltr">
                          {fmt(l.quantity_received)}
                        </td>
                        <td className="p-2" dir="ltr">{formatWithVat(l.estimated_price, { exempt: l.item?.vat_exempt })}</td>
                        <td className="p-2" dir="ltr">{formatWithVat(l.actual_price, { exempt: l.item?.vat_exempt })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {mode === 'receive' && (
            <ReceivePanel lines={lines} supplierIncludesVat={po.supplier?.default_price_includes_vat || false} onCancel={() => setMode(null)} onDone={() => { setMode(null); load(); }} poId={id} onErr={handleErr} />
          )}
          {mode === 'payment' && (
            <PaymentPanel po={po} payment={payment} onCancel={() => setMode(null)} onDone={() => { setMode(null); load(); }} onErr={handleErr} />
          )}
        </div>

        {/* צד: פעולות + תשלום */}
        <div className="space-y-4">
          <div className="card space-y-2">
            <h3 className="font-bold text-brand-burgundy">פעולות</h3>
            {isDraft && (
              <button onClick={() => changeStatus('sent')} disabled={busy} className="btn-primary w-full disabled:opacity-50">סימון כנשלחה לספק</button>
            )}
            {canReceive && (
              <button onClick={() => setMode(mode === 'receive' ? null : 'receive')} className="btn-primary w-full">קבלת סחורה למלאי</button>
            )}
            {!isCancelled && !isReceived && (
              <button onClick={() => changeStatus('cancelled', 'לבטל את הזמנת הרכש?')} disabled={busy} className="btn-ghost w-full text-red-600">ביטול הזמנה</button>
            )}
            {canDelete && (
              <button onClick={deletePurchaseOrder} disabled={busy} className="btn-ghost w-full text-red-700">מחיקה</button>
            )}
            {isReceived && <p className="text-sm text-green-700">✓ ההזמנה התקבלה במלואה והמלאי עודכן.</p>}
            {isCancelled && <p className="text-sm text-brand-burgundy/50">ההזמנה בוטלה.</p>}
          </div>

          {/* תשלום לספק (סעיף 28.1) */}
          <div className="card space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-brand-burgundy">תשלום לספק</h3>
              {payment && <Badge map={SUPPLIER_PAYMENT_STATUS} value={payment.status} />}
            </div>
            {payment ? (
              <div className="text-sm space-y-1 text-brand-burgundy/80">
                {payment.invoice_number && <div>חשבונית: {payment.invoice_number}</div>}
                {payment.invoice_amount != null && <div dir="ltr" className="text-right">סכום חשבונית: ₪{payment.invoice_amount}</div>}
                {payment.amount_paid != null && <div dir="ltr" className="text-right">שולם: ₪{payment.amount_paid}</div>}
                {payment.invoice_amount != null && payment.amount_paid != null && (
                  <div dir="ltr" className="text-right font-medium">יתרה: ₪{fmt(Number(payment.invoice_amount) - Number(payment.amount_paid))}</div>
                )}
                {payment.paid_at && <div dir="ltr" className="text-right">תאריך תשלום: {payment.paid_at}</div>}
                {payment.notes && <div className="text-brand-burgundy/50">{payment.notes}</div>}
              </div>
            ) : (
              <p className="text-sm text-brand-burgundy/50">טרם נרשם תשלום.</p>
            )}
            <button onClick={() => setMode(mode === 'payment' ? null : 'payment')} className="btn-ghost w-full text-sm">
              {payment ? 'עדכון תשלום' : 'רישום תשלום'}
            </button>
          </div>
        </div>
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// קבלת סחורה למלאי (סעיף 27.3)
// quantity_received בכל שורה = הכמות המצטברת הכוללת שהתקבלה (כולל קודמות).
// ברירת מחדל: מלוא הכמות שהוזמנה.
// ---------------------------------------------------------------------------
function ReceivePanel({ lines, supplierIncludesVat, poId, onCancel, onDone, onErr }) {
  const [rows, setRows] = useState(() =>
    lines.map((l) => ({
      line_id: l.id,
      name: l.item?.name,
      unit: l.item?.unit,
      vat_exempt: l.item?.vat_exempt || false,
      ordered: Number(l.quantity),
      alreadyReceived: Number(l.quantity_received),
      quantity_received: Number(l.quantity), // ברירת מחדל: התקבל הכל
      // מחיר בפועל מאוחסן כמחיר בסיס (לפני מע"מ); ברירת מחדל מהמשוער/בפועל הקודם
      actual_price: l.actual_price ?? l.estimated_price ?? '',
    })));
  const [busy, setBusy] = useState(false);

  function setRow(idx, patch) { setRows((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x))); }

  async function submit(e) {
    e.preventDefault();
    // שולחים רק שורות שבהן הכמות המצטברת שונה מזו שכבר נרשמה
    const payload = rows
      .filter((r) => Number(r.quantity_received) !== r.alreadyReceived)
      .map((r) => ({
        line_id: r.line_id,
        quantity_received: Number(r.quantity_received),
        actual_price: r.actual_price === '' ? null : Number(r.actual_price),
      }));
    if (payload.length === 0) return alert('אין שינוי בכמויות שהתקבלו.');
    setBusy(true);
    try { await api.receivePurchaseOrder(poId, payload); onDone(); }
    catch (err) { if (!onErr(err)) alert(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">קבלת סחורה → הוספה למלאי</h3>
      <p className="text-sm text-brand-burgundy/60">הזן את הכמות הכוללת שהתקבלה בכל שורה. ההפרש מהכמות שכבר נקלטה יתווסף למלאי ויתועד כתנועת "קבלת סחורה".</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-brand-burgundy/60 border-b border-brand-cream-dark">
            <tr>
              <th className="p-2 text-right">מוצר</th>
              <th className="p-2 text-right">הוזמן</th>
              <th className="p-2 text-right">כבר נקלט</th>
              <th className="p-2 text-right">התקבל בסה״כ</th>
              <th className="p-2 text-right">מחיר בפועל ליח׳ (מהחשבונית)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.line_id} className="border-b border-brand-cream-dark/50">
                <td className="p-2 font-medium">{r.name} <span className="text-brand-burgundy/40">({r.unit})</span></td>
                <td className="p-2" dir="ltr">{fmt(r.ordered)}</td>
                <td className="p-2 text-brand-burgundy/50" dir="ltr">{fmt(r.alreadyReceived)}</td>
                <td className="p-2">
                  <input type="number" step="any" min="0" value={r.quantity_received}
                    onChange={(e) => setRow(idx, { quantity_received: e.target.value })}
                    className={`${inputCls} w-24`} dir="ltr" />
                </td>
                <td className="p-2">
                  <div className="w-40">
                    <PriceInput
                      value={r.actual_price}
                      onChange={(base) => setRow(idx, { actual_price: base ?? '' })}
                      exempt={r.vat_exempt}
                      defaultIncludesVat={supplierIncludesVat}
                      className={`${inputCls} w-full`}
                      placeholder="₪"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'קולט...' : 'אישור קבלה והוספה למלאי'}</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// רישום/עדכון תשלום לספק (סעיף 28.1)
// ---------------------------------------------------------------------------
const PAYMENT_STATUS_OPTIONS = [
  { value: 'unpaid', label: 'לא שולם' },
  { value: 'awaiting_invoice', label: 'ממתין לחשבונית' },
  { value: 'partially_paid', label: 'שולם חלקית' },
  { value: 'paid', label: 'שולם במלואו' },
  { value: 'cancelled', label: 'בוטל' },
];

function PaymentPanel({ po, payment, onCancel, onDone, onErr }) {
  const [f, setF] = useState({
    status: payment?.status || 'unpaid',
    invoice_amount: payment?.invoice_amount ?? (po.actual_amount ?? ''),
    invoice_number: payment?.invoice_number || '',
    invoice_date: payment?.invoice_date || '',
    paid_at: payment?.paid_at || '',
    payment_method: payment?.payment_method || '',
    amount_paid: payment?.amount_paid ?? '',
    notes: payment?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.setPurchaseOrderPayment(po.id, {
        ...f,
        invoice_amount: f.invoice_amount === '' ? null : Number(f.invoice_amount),
        amount_paid: f.amount_paid === '' ? null : Number(f.amount_paid),
        estimated_amount: po.estimated_amount ?? null,
      });
      onDone();
    } catch (err) { if (!onErr(err)) alert(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-burgundy">
      <h3 className="font-bold text-brand-burgundy">{payment ? 'עדכון תשלום לספק' : 'רישום תשלום לספק'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="סטטוס תשלום">
          <select value={f.status} onChange={(e) => set('status', e.target.value)} className={inputCls}>
            {PAYMENT_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="מספר חשבונית / קבלה">
          <input value={f.invoice_number} onChange={(e) => set('invoice_number', e.target.value)} className={inputCls} />
        </Field>
        <Field label="סכום חשבונית (₪, כפי שמופיע בחשבונית)">
          <input type="number" step="any" value={f.invoice_amount} onChange={(e) => set('invoice_amount', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="סכום ששולם (₪)">
          <input type="number" step="any" value={f.amount_paid} onChange={(e) => set('amount_paid', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="תאריך חשבונית">
          <input type="date" value={f.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="תאריך תשלום">
          <input type="date" value={f.paid_at} onChange={(e) => set('paid_at', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="אמצעי תשלום">
          <input value={f.payment_method} onChange={(e) => set('payment_method', e.target.value)} className={inputCls} placeholder="העברה בנקאית / מזומן / צ׳ק" />
        </Field>
      </div>
      <Field label="הערות">
        <input value={f.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} />
      </Field>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'שומר...' : 'שמירת תשלום'}</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
const inputCls = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm text-brand-burgundy/70 block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Info({ label, value, ltr }) {
  return (
    <div>
      <div className="text-xs text-brand-burgundy/50">{label}</div>
      <div className={ltr ? 'text-right' : ''} dir={ltr ? 'ltr' : undefined}>{value || '—'}</div>
    </div>
  );
}

function fmt(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return n;
  return String(Number(num.toFixed(4)));
}
