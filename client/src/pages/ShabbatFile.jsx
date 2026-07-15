import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { Badge, ORDER_STATUS, PAYMENT_STATUS } from '../lib/status.jsx';
import { formatGregorianDate, formatShabbatHebrewDate, formatShabbatTitle } from '../lib/dates.js';

// מסך תיק שבת בלשוניות (סעיף 9). לשונית פעילה טוענת את הנתונים שלה עצמאית.
const TABS = [
  { key: 'summary', label: 'סיכום' },
  { key: 'orders', label: 'הזמנות' },
  { key: 'kitchen', label: 'כמויות ומטבח' },
  { key: 'inventory', label: 'מלאי וחוסרים' },
  { key: 'packing', label: 'אריזה' },
  { key: 'transport', label: 'שינוע' },
  { key: 'volunteers', label: 'מתנדבים' },
  { key: 'print', label: 'הדפסות' },
];

const SHABBAT_STATUS = {
  open: { label: 'פתוחה להזמנות', cls: 'bg-green-100 text-green-800' },
  closed: { label: 'סגורה להזמנות', cls: 'bg-amber-100 text-amber-800' },
  completed: { label: 'הושלמה', cls: 'bg-blue-100 text-blue-800' },
  cancelled: { label: 'מבוטלת / המטבח לא פעיל', cls: 'bg-gray-200 text-gray-600' },
};

const SHABBAT_STATUS_OPTIONS = Object.entries(SHABBAT_STATUS).map(([value, status]) => ({
  value,
  label: status.label,
}));

export default function ShabbatFile({ onAuthError }) {
  const { id } = useParams();
  const [tab, setTab] = useState('summary');
  const [summary, setSummary] = useState(null);

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else console.error(e);
  }, [onAuthError]);

  // הסיכום נטען תמיד — משמש גם לכותרת התיק
  useEffect(() => {
    api.shabbatSummary(id).then(setSummary).catch(handleErr);
  }, [id, handleErr]);

  const sh = summary?.shabbat;

  return (
    <Page>
      <div className="mb-4">
        <Link to="/admin/shabbat" className="text-sm text-brand-burgundy/60 hover:text-brand-burgundy">← כל התיקים</Link>
        <h1 className="text-2xl font-extrabold text-brand-burgundy mt-1">
          {sh ? `תיק שבת — ${formatShabbatTitle(sh)}` : 'תיק שבת'}
        </h1>
        {sh && (
          <div className="flex flex-wrap items-center gap-3 text-brand-burgundy/70">
            <div>
              <div className="text-sm font-medium text-brand-gold-dark/90">{formatShabbatHebrewDate(sh)}</div>
              <div>{formatGregorianDate(sh.gregorian_date)}</div>
            </div>
            <span className={`badge ${SHABBAT_STATUS[sh.status]?.cls || 'bg-gray-100 text-gray-600'}`}>
              {SHABBAT_STATUS[sh.status]?.label || sh.status}
            </span>
          </div>
        )}
      </div>

      {/* לשוניות */}
      <div className="flex gap-1 mb-5 border-b border-brand-cream-dark overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-brand-gold text-brand-burgundy'
                : 'border-transparent text-brand-burgundy/50 hover:text-brand-burgundy'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'summary' && <SummaryTab summary={summary} id={id} onAuthError={handleErr} onNotes={setSummary} onStatus={setSummary} />}
      {tab === 'orders' && <OrdersTab id={id} onAuthError={handleErr} />}
      {tab === 'kitchen' && <KitchenTab id={id} onAuthError={handleErr} />}
      {tab === 'inventory' && <InventoryTab id={id} onAuthError={handleErr} />}
      {tab === 'packing' && <PackingTab id={id} onAuthError={handleErr} />}
      {tab === 'transport' && <TransportTab id={id} onAuthError={handleErr} />}
      {tab === 'volunteers' && <VolunteersTab id={id} onAuthError={handleErr} />}
      {tab === 'print' && <PrintTab id={id} onAuthError={handleErr} />}
    </Page>
  );
}

// כרטיס מספר גדול
function Stat({ label, value, hint }) {
  return (
    <div className="card">
      <div className="text-3xl font-extrabold text-brand-burgundy">{value}</div>
      <div className="text-sm text-brand-burgundy/70 mt-1">{label}</div>
      {hint && <div className="text-xs text-brand-burgundy/40 mt-0.5">{hint}</div>}
    </div>
  );
}

// ---- לשונית סיכום (סעיף 9.2) ----
function SummaryTab({ summary, id, onNotes, onStatus }) {
  const [notes, setNotesLocal] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  useEffect(() => { setNotesLocal(summary?.shabbat?.notes || ''); }, [summary]);

  if (!summary) return <p>טוען...</p>;

  async function saveNotes() {
    setSaving(true);
    try {
      await api.shabbatNotes(id, notes);
      onNotes?.((s) => s ? { ...s, shabbat: { ...s.shabbat, notes } } : s);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function updateStatus(status) {
    if (status === summary.shabbat.status) return;
    setSavingStatus(true);
    try {
      const result = await api.shabbatStatus(id, status);
      onStatus?.((s) => s ? { ...s, shabbat: { ...s.shabbat, ...result.shabbat } } : s);
    } catch (e) { alert(e.message); }
    finally { setSavingStatus(false); }
  }

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="font-bold text-brand-burgundy mb-1">סטטוס שבת</h3>
            <p className="text-sm text-brand-burgundy/60">
              רק שבת פתוחה להזמנות מופיעה ללקוחות וניתן ליצור אליה הזמנה חדשה.
            </p>
          </div>
          <select
            value={summary.shabbat.status}
            disabled={savingStatus}
            onChange={(e) => updateStatus(e.target.value)}
            className="w-full rounded-lg border border-brand-cream-dark bg-white px-3 py-2 text-sm text-brand-burgundy outline-none focus:border-brand-gold disabled:opacity-60 sm:w-64"
          >
            {SHABBAT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="סך הזמנות" value={summary.total_orders} hint="לא כולל מבוטלות" />
        <Stat label="סך מנות" value={summary.total_portions} />
        <Stat label="נכנסות להכנות" value={summary.operational_orders} hint="מאושרות ושולמו" />
        <Stat label="מנות בהכנה" value={summary.operational_portions} />
      </div>

      <div className="card">
        <h3 className="font-bold text-brand-burgundy mb-3">פילוח לפי סטטוס</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.by_order_status || {}).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <Badge map={ORDER_STATUS} value={k} /><span className="text-sm font-bold">{v}</span>
            </span>
          ))}
        </div>
        <h3 className="font-bold text-brand-burgundy mb-3 mt-4">פילוח לפי תשלום</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.by_payment_status || {}).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <Badge map={PAYMENT_STATUS} value={k} /><span className="text-sm font-bold">{v}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="font-bold text-brand-burgundy mb-2">הערות תיק שבת</h3>
        <textarea value={notes} onChange={(e) => setNotesLocal(e.target.value)} rows={3}
          className="w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none"
          placeholder="הערות כלליות לשבת זו..." />
        <button onClick={saveNotes} disabled={saving} className="btn-secondary mt-2">
          {saving ? 'שומר...' : 'שמירת הערות'}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Link to={`/admin/orders?shabbat_id=${id}`} className="btn-primary">הזמנות השבת</Link>
      </div>
    </div>
  );
}

// ---- לשונית הזמנות (סעיף 9.3) — קישור מהיר לניהול הזמנות מסונן לשבת ----
function OrdersTab({ id, onAuthError }) {
  const [orders, setOrders] = useState(null);
  useEffect(() => {
    api.adminOrders(`?shabbat_id=${id}`).then(setOrders).catch(onAuthError);
  }, [id, onAuthError]);

  if (!orders) return <p>טוען...</p>;
  if (orders.length === 0) return <div className="card text-center py-8 text-brand-burgundy/60">אין הזמנות לשבת זו.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
        <thead className="bg-brand-burgundy text-brand-cream text-sm">
          <tr>
            <th className="p-3 text-right">מס׳</th>
            <th className="p-3 text-right">לקוח</th>
            <th className="p-3 text-right">סכום</th>
            <th className="p-3 text-right">סטטוס</th>
            <th className="p-3 text-right">תשלום</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-brand-cream-dark hover:bg-brand-cream/30">
              <td className="p-3 font-mono text-sm">
                <Link to={`/admin/orders?shabbat_id=${id}`} className="hover:underline">{o.order_number}</Link>
              </td>
              <td className="p-3">{o.customers?.full_name}</td>
              <td className="p-3 font-bold">{Number(o.final_amount).toFixed(0)}₪</td>
              <td className="p-3"><Badge map={ORDER_STATUS} value={o.order_status} /></td>
              <td className="p-3"><Badge map={PAYMENT_STATUS} value={o.payment_status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3">
        <Link to={`/admin/orders?shabbat_id=${id}`} className="btn-secondary">לניהול הזמנות מלא</Link>
      </div>
    </div>
  );
}

// ---- לשונית כמויות ומטבח (סעיף 9.4, 21) ----
function KitchenTab({ id, onAuthError }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.shabbatKitchen(id).then(setData).catch(onAuthError); }, [id, onAuthError]);

  if (!data) return <p>טוען...</p>;
  if (!data.categories.length) {
    return <div className="card text-center py-8 text-brand-burgundy/60">
      אין הזמנות שנכנסות להכנות עדיין. הזמנה נכנסת רק כשהיא מאושרת ושולמה (או אושרה חריגה).
    </div>;
  }

  return (
    <div className="space-y-5">
      <div className="text-brand-burgundy/70">סך מנות בהכנה: <span className="font-bold text-brand-burgundy">{data.total_portions}</span></div>
      {data.categories.map((cat) => (
        <div key={cat.category_id} className="card">
          <h3 className="font-bold text-brand-burgundy text-lg mb-3 pb-2 border-b border-brand-cream-dark">
            {cat.category_name}
          </h3>
          <div className="space-y-4">
            {cat.meals.map((m) => (
              <div key={m.meal_id}>
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-brand-burgundy">{m.name}</span>
                  <span className="text-sm">
                    <span className="font-bold text-brand-gold-dark text-lg">{m.total_portions}</span>
                    <span className="text-brand-burgundy/60"> מנות</span>
                  </span>
                </div>
                {m.kitchen_report_notes && (
                  <div className="text-xs text-brand-burgundy/50 mt-0.5">{m.kitchen_report_notes}</div>
                )}
                {m.ingredients.length > 0 && (
                  <table className="w-full text-sm mt-2 bg-brand-cream/30 rounded-lg overflow-hidden">
                    <thead className="text-brand-burgundy/60 text-xs">
                      <tr>
                        <th className="p-2 text-right">חומר גלם</th>
                        <th className="p-2 text-right">מדויק</th>
                        <th className="p-2 text-right">מעוגל</th>
                        <th className="p-2 text-right">יחידה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.ingredients.map((ing, i) => (
                        <tr key={i} className="border-t border-brand-cream-dark/50">
                          <td className="p-2">{ing.ingredient_name}</td>
                          <td className="p-2 text-brand-burgundy/60">{ing.exact_quantity}</td>
                          <td className="p-2 font-bold">{ing.rounded_quantity}</td>
                          <td className="p-2 text-brand-burgundy/60">{ing.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {m.ingredients.length === 0 && (
                  <div className="text-xs text-brand-burgundy/40 mt-1">אין מתכון מוגדר למאכל זה.</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- לשונית מלאי וחוסרים (סעיף 9.5, 26) ----
function InventoryTab({ id, onAuthError }) {
  const [data, setData] = useState(null);
  const [deducting, setDeducting] = useState(false);

  const load = useCallback(() => {
    api.shabbatInventory(id).then(setData).catch(onAuthError);
  }, [id, onAuthError]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <p>טוען...</p>;

  const hasSuppliers = data.suppliers.length > 0;
  if (!hasSuppliers && data.unlinked.length === 0) {
    return <div className="card text-center py-8 text-brand-burgundy/60">
      אין צורך מחושב עדיין. הצורך מבוסס על מתכוני המאכלים בהזמנות שנכנסות להכנות (מאושרות ושולמו),
      והמאכלים צריכים להיות מקושרים לפריטי מלאי.
    </div>;
  }

  // סיכום עליון: כמה פריטים חסרים בסך הכל
  const totalMissing = data.suppliers.reduce((s, g) => s + g.total_missing_items, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-brand-burgundy/70">
          פריטים בחוסר: <span className="font-bold text-brand-burgundy">{totalMissing}</span>
        </span>
        <span className="text-brand-burgundy/50 text-xs">
          הצורך מחושב מהזמנות שנכנסות להכנות בלבד · הכמות הנדרשת מעוגלת כלפי מעלה
        </span>
        {hasSuppliers && (
          <button onClick={() => setDeducting(true)} className="btn-primary text-sm mr-auto">
            הפחתה בפועל מהמלאי
          </button>
        )}
      </div>

      {deducting && (
        <DeductionPanel id={id} onClose={() => setDeducting(false)}
          onDone={() => { setDeducting(false); load(); }} onErr={onAuthError} />
      )}

      {data.suppliers.map((group) => (
        <div key={group.supplier_id || '_none'} className="card">
          <h3 className="font-bold text-brand-burgundy text-lg mb-1 pb-2 border-b border-brand-cream-dark flex items-baseline justify-between">
            <span>{group.supplier_name || 'ללא ספק מוגדר'}</span>
            {group.supplier_phone && (
              <span className="text-sm font-normal text-brand-burgundy/50" dir="ltr">{group.supplier_phone}</span>
            )}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-2">
              <thead className="text-brand-burgundy/60 text-xs">
                <tr>
                  <th className="p-2 text-right">פריט</th>
                  <th className="p-2 text-right">נדרש</th>
                  <th className="p-2 text-right">קיים</th>
                  <th className="p-2 text-right">חסר</th>
                  <th className="p-2 text-right">מומלץ לקנייה</th>
                  <th className="p-2 text-right">יחידה</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((it) => (
                  <tr key={it.item_id}
                    className={`border-t border-brand-cream-dark/50 ${it.missing > 0 ? 'bg-red-50/50' : ''}`}>
                    <td className="p-2">
                      {it.name}
                      {it.is_packaging && <span className="text-xs text-brand-gold-dark mr-1">(אריזה)</span>}
                    </td>
                    <td className="p-2 font-bold">{it.required}</td>
                    <td className="p-2 text-brand-burgundy/60">{it.on_hand}</td>
                    <td className={`p-2 font-bold ${it.missing > 0 ? 'text-red-700' : 'text-green-700'}`}>
                      {it.missing > 0 ? it.missing : '✓'}
                    </td>
                    <td className="p-2 font-bold text-brand-gold-dark">
                      {it.suggested_purchase > 0 ? it.suggested_purchase : '—'}
                    </td>
                    <td className="p-2 text-brand-burgundy/60">{it.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {data.unlinked.length > 0 && (
        <div className="card border-r-4 border-brand-gold">
          <h3 className="font-bold text-brand-burgundy mb-1">חומרי גלם ללא קישור למלאי</h3>
          <p className="text-xs text-brand-burgundy/50 mb-2">
            שורות מתכון שאינן מקושרות לפריט מלאי — לא ניתן לחשב חוסר או קנייה. שייך אותן לפריט מלאי כדי שייכנסו לדוח.
          </p>
          <table className="w-full text-sm">
            <thead className="text-brand-burgundy/60 text-xs">
              <tr>
                <th className="p-2 text-right">חומר גלם</th>
                <th className="p-2 text-right">כמות נדרשת</th>
                <th className="p-2 text-right">יחידה</th>
              </tr>
            </thead>
            <tbody>
              {data.unlinked.map((u, i) => (
                <tr key={i} className="border-t border-brand-cream-dark/50">
                  <td className="p-2">{u.name}</td>
                  <td className="p-2 font-bold">{u.quantity}</td>
                  <td className="p-2 text-brand-burgundy/60">{u.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- הפחתה בפועל מהמלאי לאחר ההכנות (סעיף 25.4) ----
// טוען תצוגה מקדימה של הצורך המחושב, מאפשר תיקון כמויות ידני לפני ההפחתה,
// ואז מבצע הפחתה מתועדת (inventory_movements type=shabbat_deduction).
function DeductionPanel({ id, onClose, onDone, onErr }) {
  const [rows, setRows] = useState(null);
  const [qty, setQty] = useState({});     // item_id -> כמות להפחתה (עריכה ידנית)
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.invDeductionPreview(id).then((d) => {
      setRows(d.items);
      setQty(Object.fromEntries(d.items.map((it) => [it.item_id, it.suggested_deduction])));
    }).catch(onErr);
  }, [id, onErr]);

  async function deduct() {
    const lines = Object.entries(qty)
      .map(([item_id, q]) => ({ item_id, quantity: Number(q) }))
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) return alert('אין כמויות להפחתה.');
    if (!window.confirm('לבצע הפחתה בפועל מהמלאי? הפעולה מתועדת ומעדכנת את הכמויות.')) return;
    setSaving(true);
    try {
      const res = await api.invDeduct(id, lines);
      alert(`הופחתו ${res.deducted} פריטים מהמלאי.`);
      onDone();
    } catch (e) { onErr(e); }
    finally { setSaving(false); }
  }

  if (!rows) return <div className="card">טוען צורך מחושב...</div>;
  if (rows.length === 0) return (
    <div className="card border-r-4 border-brand-gold">
      <div className="flex items-center justify-between">
        <p className="text-brand-burgundy/60">אין פריטים מקושרים להפחתה.</p>
        <button onClick={onClose} className="text-brand-burgundy/60 hover:underline text-sm">סגירה</button>
      </div>
    </div>
  );

  return (
    <div className="card border-r-4 border-brand-burgundy space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-brand-burgundy">הפחתה בפועל מהמלאי</h3>
        <button onClick={onClose} className="text-brand-burgundy/60 hover:underline text-sm">סגירה</button>
      </div>
      <p className="text-xs text-brand-burgundy/50">
        לאחר סיום ההכנות — אשר הפחתה מהמלאי לפי הצורך שחושב. ניתן לתקן כמויות ידנית לפני האישור.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-brand-burgundy/60 text-xs">
            <tr>
              <th className="p-2 text-right">פריט</th>
              <th className="p-2 text-right">נדרש</th>
              <th className="p-2 text-right">קיים במלאי</th>
              <th className="p-2 text-right">כמות להפחתה</th>
              <th className="p-2 text-right">יחידה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => (
              <tr key={it.item_id} className="border-t border-brand-cream-dark/50">
                <td className="p-2">
                  {it.name}
                  {it.is_packaging && <span className="text-xs text-brand-gold-dark mr-1">(אריזה)</span>}
                </td>
                <td className="p-2 text-brand-burgundy/60">{it.required}</td>
                <td className="p-2 text-brand-burgundy/60">{it.on_hand}</td>
                <td className="p-2">
                  <input type="number" step="any" min="0" dir="ltr"
                    value={qty[it.item_id] ?? ''}
                    onChange={(e) => setQty((s) => ({ ...s, [it.item_id]: e.target.value }))}
                    className="w-24 border border-brand-cream-dark rounded-lg p-1.5 focus:border-brand-gold outline-none" />
                </td>
                <td className="p-2 text-brand-burgundy/60">{it.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button onClick={deduct} disabled={saving} className="btn-primary">
          {saving ? 'מפחית...' : 'אישור הפחתה'}
        </button>
        <button onClick={onClose} className="btn-ghost">ביטול</button>
      </div>
    </div>
  );
}

// ---- לשונית אריזה (סעיף 9.6) ----
function PackingTab({ id, onAuthError }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.shabbatPacking(id).then(setData).catch(onAuthError); }, [id, onAuthError]);

  if (!data) return <p>טוען...</p>;
  if (!data.orders.length) return <div className="card text-center py-8 text-brand-burgundy/60">אין הזמנות לאריזה.</div>;

  return (
    <div className="space-y-4">
      {data.orders.map((o) => (
        <div key={o.order_id} className="card">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="font-mono text-sm text-brand-burgundy/60">#{o.order_number}</span>
              <span className="font-bold text-brand-burgundy mr-2">{o.customer_name}</span>
            </div>
            <span className="text-sm"><span className="font-bold">{o.total_portions}</span> מנות · {o.slots.join(', ')}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-brand-burgundy/60 text-xs">
              <tr>
                <th className="p-2 text-right">מאכל</th>
                <th className="p-2 text-right">סעודה</th>
                <th className="p-2 text-right">מנות</th>
                <th className="p-2 text-right">אריזות</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((it, i) => (
                <tr key={i} className="border-t border-brand-cream-dark/50">
                  <td className="p-2">{it.meal_name}</td>
                  <td className="p-2 text-brand-burgundy/60">{it.slot_name}</td>
                  <td className="p-2">{it.portions}</td>
                  <td className="p-2">
                    {it.packages.length === 0
                      ? <span className="text-brand-burgundy/40">—</span>
                      : it.packages.map((p, j) => (
                          <span key={j} className="inline-block ml-2">
                            <span className="font-bold">{p.count}</span> × {p.packaging_label}
                          </span>
                        ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ---- לשונית שינוע (סעיף 9.7) ----
function TransportTab({ id, onAuthError }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.shabbatTransport(id).then(setData).catch(onAuthError); }, [id, onAuthError]);

  if (!data) return <p>טוען...</p>;
  if (!data.orders.length) return <div className="card text-center py-8 text-brand-burgundy/60">אין הזמנות לשינוע (כולן באיסוף עצמי).</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
        <thead className="bg-brand-burgundy text-brand-cream text-sm">
          <tr>
            <th className="p-3 text-right">מס׳</th>
            <th className="p-3 text-right">מזמין</th>
            <th className="p-3 text-right">איש קשר</th>
            <th className="p-3 text-right">טלפון</th>
            <th className="p-3 text-right">אולם וכתובת</th>
            <th className="p-3 text-right">מנות</th>
            <th className="p-3 text-right">הערות</th>
          </tr>
        </thead>
        <tbody>
          {data.orders.map((o) => (
            <tr key={o.order_id} className="border-b border-brand-cream-dark hover:bg-brand-cream/30">
              <td className="p-3 font-mono text-sm">#{o.order_number}</td>
              <td className="p-3">{o.customer_name}</td>
              <td className="p-3">{o.contact_name}</td>
              <td className="p-3 text-sm" dir="ltr">{o.contact_phone}</td>
              <td className="p-3 text-sm">{[o.venue_name, o.venue_address].filter(Boolean).join(' · ') || '—'}</td>
              <td className="p-3 font-bold">{o.total_portions}</td>
              <td className="p-3 text-sm text-brand-burgundy/60">{o.transport_notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- לשונית מתנדבים (סעיף 9.8, 24) ----
const AREA_LABELS = {
  cooking: 'בישול', packing: 'אריזה', transport: 'שינוע', cleaning: 'ניקיון', general: 'כללי',
};
const AREA_ORDER = ['cooking', 'packing', 'transport', 'cleaning', 'general'];
const DAY_LABELS = { general: 'כללי', tuesday: 'יום ג׳', wednesday: 'יום ד׳', thursday: 'יום ה׳', friday: 'יום ו׳', shabbat: 'שבת', motzei_shabbat: 'מוצ״ש' };
const SHIFT_LABELS = { morning: 'בוקר', noon: 'צהריים', evening: 'ערב', night: 'לילה' };

function orderedVolunteerSuggestions(task, volunteers) {
  const assignedIds = new Set((task.assigned || []).map((assignment) => assignment.volunteer_id));
  const preferred = task.preferred_candidates || [];
  const preferredIds = new Set(preferred.map((volunteer) => volunteer.id));
  const areaCandidates = (volunteers || []).filter((volunteer) =>
    (volunteer.areas?.length ? volunteer.areas : [volunteer.area]).includes(task.area)
    && !preferredIds.has(volunteer.id));
  return [...preferred, ...areaCandidates].filter((volunteer) => !assignedIds.has(volunteer.id));
}

function VolunteersTab({ id, onAuthError }) {
  const [data, setData] = useState(null);
  const [volunteers, setVolunteers] = useState(null); // כל המתנדבים הפעילים (לשיבוץ ידני)
  const [busy, setBusy] = useState(false);
  const [assigningTask, setAssigningTask] = useState(null); // task_id שנפתח לשיבוץ

  const load = useCallback(() => {
    Promise.all([api.shabbatVolunteers(id), api.volunteers('?active=true')])
      .then(([rep, vols]) => { setData(rep); setVolunteers(vols); })
      .catch(onAuthError);
  }, [id, onAuthError]);

  useEffect(() => { load(); }, [load]);

  async function autoAssign() {
    setBusy(true);
    try {
      const r = await api.shabbatVolunteerAutoAssign(id);
      load();
      alert(`השיבוץ רוענן מהתבנית (${r.refreshed ?? 0} משימות בתיק השבת).`);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  async function assign(task, volunteerId, assignmentKind = 'lead') {
    setBusy(true);
    try {
      await api.shabbatVolunteerAssign(id, {
        task_id: task.task_id,
        shabbat_task_id: task.shabbat_task_id,
        volunteer_id: volunteerId,
        assignment_kind: assignmentKind,
      });
      setAssigningTask(null);
      load();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  async function resetLead(task) {
    setBusy(true);
    try { await api.shabbatVolunteerReset(id, task.shabbat_task_id); setAssigningTask(null); load(); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  async function unassign(assignmentId) {
    setBusy(true);
    try {
      await api.shabbatVolunteerUnassign(id, assignmentId);
      load();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  if (!data) return <p>טוען...</p>;
  if (!data.tasks.length) {
    return <div className="card text-center py-8 text-brand-burgundy/60">
      אין משימות קבועות מוגדרות. יש להגדיר משימות בניהול המתנדבים.
    </div>;
  }

  // קיבוץ משימות לפי תחום
  const byCategory = {};
  for (const task of data.tasks) {
    const key = `${task.parent_category_name || ''}::${task.category_name || 'לא מסווג'}`;
    (byCategory[key] ||= []).push(task);
  }
  const categoryGroups = Object.entries(byCategory);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-brand-burgundy/70">
          משימות ללא שיבוץ: <span className={`font-bold ${data.unassigned_count > 0 ? 'text-red-700' : 'text-green-700'}`}>
            {data.unassigned_count}
          </span>
        </div>
        <button onClick={autoAssign} disabled={busy} className="btn-secondary text-sm">
          רענון מהתבנית
        </button>
      </div>

      {categoryGroups.map(([categoryKey, categoryTasks]) => (
        <div key={categoryKey} className="card">
          <h3 className="font-bold text-brand-burgundy text-lg mb-3 pb-2 border-b border-brand-cream-dark">
            {[categoryTasks[0].parent_category_name, categoryTasks[0].category_name].filter(Boolean).join(' / ')}
          </h3>
          <div className="space-y-3">
            {categoryTasks.map((t) => (
              <div key={t.shabbat_task_id || t.task_id} className={`rounded-lg p-3 ${t.is_unassigned ? 'bg-red-50/60' : 'bg-brand-cream/30'}`}>
                <div className="flex items-baseline justify-between flex-wrap gap-1">
                  <div className="font-medium text-brand-burgundy">
                    {t.name}
                    <span className="text-xs text-brand-burgundy/50 mr-2">
                      {DAY_LABELS[t.execution_day] || 'כללי'}{t.shift ? ` · ${SHIFT_LABELS[t.shift]}` : ''}{t.timing_note ? ` · ${t.timing_note}` : ''}
                    </span>
                    {t.linked_meal_name && (
                      <span className="text-xs text-brand-burgundy/50 mr-2">({t.linked_meal_name})</span>
                    )}
                    {t.meal_is_ordered && t.is_unassigned && (
                      <span className="text-xs text-red-700 mr-2 font-bold">· מוזמן בשבת, אין מתנדב</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setAssigningTask(assigningTask === t.shabbat_task_id ? null : t.shabbat_task_id)}
                      className="text-xs text-brand-burgundy/60 hover:text-brand-burgundy underline">החלפת אחראי</button>
                    <button onClick={() => setAssigningTask(assigningTask === `support:${t.shabbat_task_id}` ? null : `support:${t.shabbat_task_id}`)}
                      className="text-xs text-brand-burgundy/60 hover:text-brand-burgundy underline">+ תומך</button>
                  </div>
                </div>

                {/* מתנדבים משובצים */}
                {t.assigned.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {t.assigned.map((a) => (
                      <span key={a.assignment_id}
                        className="inline-flex items-center gap-1.5 bg-white border border-brand-cream-dark rounded-full px-3 py-1 text-sm">
                        <span className="font-medium text-brand-burgundy">{a.volunteer_name}</span>
                        {a.phone && <span className="text-brand-burgundy/50 text-xs" dir="ltr">{a.phone}</span>}
                        {a.has_vehicle && <span className="text-xs" title="יש רכב">🚗</span>}
                        {a.is_auto && <span className="text-[10px] text-brand-gold-dark" title="שובץ אוטומטית">אוטו׳</span>}
                        {a.assignment_kind === 'support' && <span className="text-[10px] text-brand-burgundy/50">תומך</span>}
                        <button onClick={() => unassign(a.assignment_id)} disabled={busy}
                          className="text-red-600 hover:text-red-800 text-xs mr-1" title="ביטול שיבוץ">✕</button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-brand-burgundy/40 mt-1">ללא שיבוץ</div>
                )}

                {t.has_manual_override && (
                  <button type="button" onClick={() => resetLead(t)} disabled={busy}
                    className="mt-2 text-xs text-brand-gold-dark underline">החזרת האחראי מהתבנית</button>
                )}

                {/* בורר שיבוץ ידני */}
                {assigningTask === t.shabbat_task_id && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {orderedVolunteerSuggestions(t, volunteers).map((v) => (
                        <button key={v.id} onClick={() => assign(t, v.id, 'lead')} disabled={busy}
                          className="text-sm bg-brand-burgundy/5 hover:bg-brand-gold/20 border border-brand-cream-dark rounded-full px-3 py-1">
                          {v.full_name}{v.role === 'backup' ? ` · מחליף ${v.priority}` : v.role === 'candidate' ? ' · מועמד' : ''}{v.has_vehicle ? ' 🚗' : ''}
                        </button>
                      ))}
                    {orderedVolunteerSuggestions(t, volunteers).length === 0 && (
                      <span className="text-xs text-brand-burgundy/40">אין מתנדבים פנויים בתחום זה.</span>
                    )}
                  </div>
                )}
                {assigningTask === `support:${t.shabbat_task_id}` && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {orderedVolunteerSuggestions(t, volunteers).map((volunteer) => (
                      <button key={volunteer.id} onClick={() => assign(t, volunteer.id, 'support')} disabled={busy}
                        className="text-sm bg-brand-burgundy/5 hover:bg-brand-gold/20 border border-brand-cream-dark rounded-full px-3 py-1">
                        {volunteer.full_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="text-xs text-brand-burgundy/40">
        שיבוץ בישול נעשה אוטומטית לפי קישור המתנדב למאכל. שיבוץ שינוע ושאר התחומים — ידני.
      </div>
    </div>
  );
}

// ---- לשונית הדפסות / תיק עבודה מרוכז (סעיף 9.9, 33) ----
const DELIVERY_LABELS = {
  volunteer_transport: 'שינוע על ידי מתנדבים', self_pickup: 'איסוף עצמי',
};

// כותרת דוח בתוך תיק העבודה, עם שבירת עמוד להדפסה
function ReportBlock({ title, subtitle, children }) {
  return (
    <section className="print-section mb-8">
      <h2 className="text-xl font-extrabold text-brand-burgundy border-b-2 border-brand-gold pb-1 mb-3">
        {title}
        {subtitle && <span className="text-sm font-normal text-brand-burgundy/50 mr-2">{subtitle}</span>}
      </h2>
      {children}
    </section>
  );
}

// טבלה פשוטה עם גבולות שנראית טוב בהדפסה
function PrintTable({ head, children }) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-brand-cream text-brand-burgundy">
          {head.map((h, i) => (
            <th key={i} className="border border-brand-cream-dark p-2 text-right font-bold">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function PrintTab({ id, onAuthError }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.shabbatWorkFile(id).then(setData).catch(onAuthError); }, [id, onAuthError]);

  if (!data) return <p>טוען...</p>;

  const sh = data.shabbat;
  const genDate = new Date(data.generated_at).toLocaleString('he-IL');
  const s = data.summary;
  const k = data.kitchen;
  const inv = data.inventory;
  const pk = data.packing;
  const tr = data.transport;
  const vol = data.volunteers;
  const slips = data.customer_slips;

  const hasOperational = (s?.operational_orders || 0) > 0;

  return (
    <div>
      {/* סרגל פעולות — לא מודפס */}
      <div className="no-print flex items-center justify-between flex-wrap gap-2 mb-4 card">
        <div className="text-sm text-brand-burgundy/70">
          תיק עבודה מרוכז לשבת — מוכן להדפסה. הופק: {genDate}
        </div>
        <button onClick={() => window.print()} className="btn-primary">🖨️ הדפסת תיק העבודה</button>
      </div>

      {!hasOperational && (
        <div className="no-print card border-r-4 border-brand-gold mb-4 text-sm text-brand-burgundy/70">
          אין עדיין הזמנות שנכנסות להכנות (מאושרות ושולמו). תיק העבודה יכיל את השער בלבד.
          דוחות המטבח, האריזה, השינוע והמלאי מתמלאים כשההזמנות נכנסות להכנות (כלל 8.7).
        </div>
      )}

      {/* אזור ההדפסה בפועל */}
      <div className="print-area bg-white">
        {/* 1. עמוד שער (סעיף 33.2) */}
        <section className="print-section text-center py-10 print-avoid">
          <div className="text-brand-gold-dark font-bold text-lg mb-2">מטבח החסד · ברכת שמואל</div>
          <h1 className="text-4xl font-extrabold text-brand-burgundy mb-2">תיק עבודה לשבת</h1>
          <div className="text-2xl text-brand-burgundy mt-4">{formatShabbatTitle(sh) || '—'}</div>
          <div className="text-sm font-medium text-brand-gold-dark/90 mt-1">{formatShabbatHebrewDate(sh)}</div>
          <div className="text-brand-burgundy/70">{formatGregorianDate(sh?.gregorian_date)}</div>
          <div className="inline-grid grid-cols-2 gap-x-8 gap-y-1 mt-8 text-brand-burgundy text-sm text-right">
            <span className="text-brand-burgundy/60">סך הזמנות:</span><span className="font-bold">{s?.total_orders ?? 0}</span>
            <span className="text-brand-burgundy/60">נכנסות להכנות:</span><span className="font-bold">{s?.operational_orders ?? 0}</span>
            <span className="text-brand-burgundy/60">סך מנות:</span><span className="font-bold">{s?.total_portions ?? 0}</span>
            <span className="text-brand-burgundy/60">מנות בהכנה:</span><span className="font-bold">{s?.operational_portions ?? 0}</span>
          </div>
          {sh?.notes && (
            <div className="mt-6 text-sm text-brand-burgundy/70 max-w-lg mx-auto whitespace-pre-wrap">
              <span className="font-bold">הערות: </span>{sh.notes}
            </div>
          )}
          <div className="text-xs text-brand-burgundy/40 mt-8">הופק: {genDate}</div>
        </section>

        {/* 2. סיכום הזמנות (סעיף 33.2) */}
        {s && (
          <ReportBlock title="סיכום הזמנות">
            <div className="grid grid-cols-4 gap-3 mb-3 text-center">
              <SlipStat label="סך הזמנות" value={s.total_orders} />
              <SlipStat label="סך מנות" value={s.total_portions} />
              <SlipStat label="נכנסות להכנות" value={s.operational_orders} />
              <SlipStat label="מנות בהכנה" value={s.operational_portions} />
            </div>
          </ReportBlock>
        )}

        {/* 3. דוח עבודה למטבח + 4. חומרי גלם (סעיף 33.3) */}
        <ReportBlock title="דוח עבודה למטבח" subtitle={k ? `סך ${k.total_portions} מנות` : ''}>
          {!k?.categories?.length ? (
            <p className="text-brand-burgundy/50 text-sm">אין מאכלים בהכנה.</p>
          ) : (
            k.categories.map((cat) => (
              <div key={cat.category_id} className="mb-4 print-avoid">
                <h3 className="font-bold text-brand-burgundy bg-brand-cream/60 px-2 py-1 rounded">{cat.category_name}</h3>
                {cat.meals.map((m) => (
                  <div key={m.meal_id} className="mt-2 print-avoid">
                    <div className="flex items-baseline justify-between px-1">
                      <span className="font-medium">{m.name}</span>
                      <span><span className="font-bold text-brand-gold-dark">{m.total_portions}</span> מנות</span>
                    </div>
                    {m.kitchen_report_notes && (
                      <div className="text-xs text-brand-burgundy/50 px-1">{m.kitchen_report_notes}</div>
                    )}
                    {m.ingredients.length > 0 && (
                      <table className="w-full text-xs mt-1 border-collapse">
                        <thead>
                          <tr className="text-brand-burgundy/60">
                            <th className="border border-brand-cream-dark p-1 text-right">חומר גלם</th>
                            <th className="border border-brand-cream-dark p-1 text-right">מדויק</th>
                            <th className="border border-brand-cream-dark p-1 text-right">מעוגל</th>
                            <th className="border border-brand-cream-dark p-1 text-right">יחידה</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.ingredients.map((ing, i) => (
                            <tr key={i}>
                              <td className="border border-brand-cream-dark p-1">{ing.ingredient_name}</td>
                              <td className="border border-brand-cream-dark p-1 text-brand-burgundy/60">{ing.exact_quantity}</td>
                              <td className="border border-brand-cream-dark p-1 font-bold">{ing.rounded_quantity}</td>
                              <td className="border border-brand-cream-dark p-1 text-brand-burgundy/60">{ing.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </ReportBlock>

        {/* 5. דוח חוסרים וקניות (סעיף 33.2, 26) */}
        <ReportBlock title="דוח חומרי גלם וחוסרים">
          {!inv?.suppliers?.length && !inv?.unlinked?.length ? (
            <p className="text-brand-burgundy/50 text-sm">אין צורך מחושב.</p>
          ) : (
            <>
              {inv.suppliers.map((g) => (
                <div key={g.supplier_id || '_none'} className="mb-4 print-avoid">
                  <h3 className="font-bold text-brand-burgundy flex justify-between px-1">
                    <span>{g.supplier_name || 'ללא ספק מוגדר'}</span>
                    {g.supplier_phone && <span className="text-sm font-normal" dir="ltr">{g.supplier_phone}</span>}
                  </h3>
                  <PrintTable head={['פריט', 'נדרש', 'קיים', 'חסר', 'מומלץ לקנייה', 'יחידה']}>
                    {g.items.map((it) => (
                      <tr key={it.item_id}>
                        <td className="border border-brand-cream-dark p-2">
                          {it.name}{it.is_packaging && <span className="text-xs text-brand-gold-dark mr-1">(אריזה)</span>}
                        </td>
                        <td className="border border-brand-cream-dark p-2 font-bold">{it.required}</td>
                        <td className="border border-brand-cream-dark p-2 text-brand-burgundy/60">{it.on_hand}</td>
                        <td className={`border border-brand-cream-dark p-2 font-bold ${it.missing > 0 ? 'text-red-700' : ''}`}>
                          {it.missing > 0 ? it.missing : '✓'}
                        </td>
                        <td className="border border-brand-cream-dark p-2 font-bold text-brand-gold-dark">
                          {it.suggested_purchase > 0 ? it.suggested_purchase : '—'}
                        </td>
                        <td className="border border-brand-cream-dark p-2 text-brand-burgundy/60">{it.unit}</td>
                      </tr>
                    ))}
                  </PrintTable>
                </div>
              ))}
              {inv.unlinked.length > 0 && (
                <div className="print-avoid">
                  <h3 className="font-bold text-brand-burgundy px-1">חומרי גלם ללא קישור למלאי</h3>
                  <PrintTable head={['חומר גלם', 'כמות נדרשת', 'יחידה']}>
                    {inv.unlinked.map((u, i) => (
                      <tr key={i}>
                        <td className="border border-brand-cream-dark p-2">{u.name}</td>
                        <td className="border border-brand-cream-dark p-2 font-bold">{u.quantity}</td>
                        <td className="border border-brand-cream-dark p-2 text-brand-burgundy/60">{u.unit}</td>
                      </tr>
                    ))}
                  </PrintTable>
                </div>
              )}
            </>
          )}
        </ReportBlock>

        {/* 6. דוח אריזה לפי הזמנות (סעיף 33.4) */}
        <ReportBlock title="דוח אריזה לפי הזמנות">
          {!pk?.orders?.length ? (
            <p className="text-brand-burgundy/50 text-sm">אין הזמנות לאריזה.</p>
          ) : (
            pk.orders.map((o) => (
              <div key={o.order_id} className="mb-4 print-avoid">
                <div className="flex justify-between font-bold text-brand-burgundy px-1">
                  <span><span className="font-mono text-brand-burgundy/60">#{o.order_number}</span> {o.customer_name}</span>
                  <span>{o.total_portions} מנות · {o.slots.join(', ')}</span>
                </div>
                <PrintTable head={['מאכל', 'סעודה', 'מנות', 'אריזות']}>
                  {o.items.map((it, i) => (
                    <tr key={i}>
                      <td className="border border-brand-cream-dark p-2">{it.meal_name}</td>
                      <td className="border border-brand-cream-dark p-2 text-brand-burgundy/60">{it.slot_name}</td>
                      <td className="border border-brand-cream-dark p-2">{it.portions}</td>
                      <td className="border border-brand-cream-dark p-2">
                        {it.packages.length === 0 ? '—' : it.packages.map((p, j) => (
                          <span key={j} className="inline-block ml-2"><span className="font-bold">{p.count}</span> × {p.packaging_label}</span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </PrintTable>
              </div>
            ))
          )}
        </ReportBlock>

        {/* 7. דוח שינוע (סעיף 33.5) */}
        <ReportBlock title="דוח שינוע">
          {!tr?.orders?.length ? (
            <p className="text-brand-burgundy/50 text-sm">אין הזמנות לשינוע (כולן באיסוף עצמי).</p>
          ) : (
            <PrintTable head={['מס׳', 'מזמין', 'איש קשר', 'טלפון', 'אולם וכתובת', 'מנות', 'הערות']}>
              {tr.orders.map((o) => (
                <tr key={o.order_id}>
                  <td className="border border-brand-cream-dark p-2 font-mono">#{o.order_number}</td>
                  <td className="border border-brand-cream-dark p-2">{o.customer_name}</td>
                  <td className="border border-brand-cream-dark p-2">{o.contact_name}</td>
                  <td className="border border-brand-cream-dark p-2" dir="ltr">{o.contact_phone}</td>
                  <td className="border border-brand-cream-dark p-2">{[o.venue_name, o.venue_address].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="border border-brand-cream-dark p-2 font-bold">{o.total_portions}</td>
                  <td className="border border-brand-cream-dark p-2 text-brand-burgundy/60">{o.transport_notes || '—'}</td>
                </tr>
              ))}
            </PrintTable>
          )}
        </ReportBlock>

        {/* 8. דוח שיבוץ מתנדבים (סעיף 33.2) */}
        <ReportBlock title="דוח שיבוץ מתנדבים"
          subtitle={vol ? `${vol.unassigned_count} משימות ללא שיבוץ` : ''}>
          {!vol?.tasks?.length ? (
            <p className="text-brand-burgundy/50 text-sm">אין משימות מוגדרות.</p>
          ) : (
            <PrintTable head={['קטגוריה', 'מועד', 'משימה', 'מתנדבים משובצים']}>
              {vol.tasks.map((t) => (
                <tr key={t.shabbat_task_id || t.task_id}>
                  <td className="border border-brand-cream-dark p-2 text-brand-burgundy/70">
                    {[t.parent_category_name, t.category_name].filter(Boolean).join(' / ')}
                  </td>
                  <td className="border border-brand-cream-dark p-2 text-brand-burgundy/70">
                    {DAY_LABELS[t.execution_day] || 'כללי'}{t.shift ? ` · ${SHIFT_LABELS[t.shift]}` : ''}{t.timing_note ? ` · ${t.timing_note}` : ''}
                  </td>
                  <td className="border border-brand-cream-dark p-2">
                    {t.name}
                    {t.linked_meal_name && <span className="text-xs text-brand-burgundy/50 mr-1">({t.linked_meal_name})</span>}
                  </td>
                  <td className="border border-brand-cream-dark p-2">
                    {t.assigned.length === 0
                      ? <span className="text-red-700 font-bold">ללא שיבוץ</span>
                      : t.assigned.map((a) => (
                          <span key={a.assignment_id} className="inline-block ml-3">
                            {a.volunteer_name}{a.phone && <span className="text-brand-burgundy/50 text-xs mr-1" dir="ltr">{a.phone}</span>}{a.has_vehicle ? ' 🚗' : ''}
                          </span>
                        ))}
                  </td>
                </tr>
              ))}
            </PrintTable>
          )}
        </ReportBlock>

        {/* 9. דפי פירוט ללקוח — כל הזמנה בעמוד נפרד (סעיף 33.6, ללא מחירים) */}
        {slips?.orders?.length > 0 && slips.orders.map((o) => (
          <section key={o.order_id} className="print-section print-avoid py-6">
            <div className="text-center mb-4">
              <div className="text-brand-gold-dark font-bold">מטבח החסד · ברכת שמואל</div>
              <h2 className="text-2xl font-extrabold text-brand-burgundy">פירוט הזמנה ללקוח</h2>
              <div className="text-brand-burgundy/70">{formatShabbatTitle(sh)}</div>
              <div className="text-sm font-medium text-brand-gold-dark/90">{formatShabbatHebrewDate(sh)}</div>
            </div>
            <div className="border border-brand-cream-dark rounded-lg p-4 max-w-xl mx-auto">
              <div className="flex justify-between border-b border-brand-cream-dark pb-2 mb-3">
                <span className="font-bold text-brand-burgundy text-lg">{o.customer_name}</span>
                <span className="font-mono text-brand-burgundy/60">#{o.order_number}</span>
              </div>
              <div className="text-sm text-brand-burgundy/70 mb-3 space-y-0.5">
                <div>איש קשר: {o.contact_name} {o.contact_phone && <span dir="ltr">({o.contact_phone})</span>}</div>
                <div>אספקה: {DELIVERY_LABELS[o.delivery_method] || o.delivery_method}
                  {(o.venue_name || o.venue_address) && ` · ${[o.venue_name, o.venue_address].filter(Boolean).join(' · ')}`}</div>
                <div>סך מנות: <span className="font-bold text-brand-burgundy">{o.total_portions}</span></div>
              </div>
              {o.slots.map((slot) => (
                <div key={slot.slot_id} className="mb-2">
                  <div className="font-bold text-brand-burgundy">{slot.slot_name}
                    <span className="text-sm font-normal text-brand-burgundy/60"> · {slot.portions} מנות</span>
                  </div>
                  <ul className="list-disc pr-5 text-sm text-brand-burgundy/80">
                    {slot.meals.map((meal, i) => <li key={i}>{meal}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// כרטיס מספר קטן לשער/סיכום ההדפסה
function SlipStat({ label, value }) {
  return (
    <div className="border border-brand-cream-dark rounded-lg py-2">
      <div className="text-2xl font-extrabold text-brand-burgundy">{value}</div>
      <div className="text-xs text-brand-burgundy/60">{label}</div>
    </div>
  );
}
