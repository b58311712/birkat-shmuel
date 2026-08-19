import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { Badge, ORDER_STATUS, PAYMENT_STATUS } from '../lib/status.jsx';
import { formatGregorianDate, formatShabbatHebrewDate, formatShabbatTitle } from '../lib/dates.js';
import {
  formatInventoryQuantity,
  packageQuantityTotal,
  splitPackageQuantity,
} from '../lib/inventoryPackages.js';

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

  // הסיכום נטען תמיד - משמש גם לכותרת התיק
  useEffect(() => {
    api.shabbatSummary(id).then(setSummary).catch(handleErr);
  }, [id, handleErr]);

  const sh = summary?.shabbat;

  return (
    <Page>
      <div className="mb-4">
        <Link to="/admin/shabbat" className="text-sm text-brand-burgundy/60 hover:text-brand-burgundy">← כל התיקים</Link>
        <h1 className="text-2xl font-extrabold text-brand-burgundy mt-1">
          {sh ? `תיק שבת - ${formatShabbatTitle(sh)}` : 'תיק שבת'}
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

// ---- לשונית הזמנות (סעיף 9.3) - קישור מהיר לניהול הזמנות מסונן לשבת ----
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
  const [creatingDrafts, setCreatingDrafts] = useState(false);

  const load = useCallback(() => {
    api.shabbatInventory(id).then(setData).catch(onAuthError);
  }, [id, onAuthError]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <p>טוען...</p>;

  const directSuppliers = data.direct_suppliers || [];
  const canSyncDirectDrafts = directSuppliers.length > 0 || data.has_direct_purchase_drafts;
  const hasSuppliers = data.suppliers.length > 0 || directSuppliers.length > 0;
  if (!hasSuppliers && !data.has_direct_purchase_drafts && data.unlinked.length === 0) {
    return <div className="card text-center py-8 text-brand-burgundy/60">
      אין צורך מחושב עדיין. הצורך מבוסס על מתכוני המאכלים בהזמנות שנכנסות להכנות (מאושרות ושולמו),
      והמאכלים צריכים להיות מקושרים לפריטי מלאי.
    </div>;
  }

  // סיכום עליון: כמה פריטים חסרים בסך הכל
  const totalMissing = data.suppliers.reduce((s, g) => s + g.total_missing_items, 0);
  const totalDirectMissing = directSuppliers.reduce((s, g) => s + g.total_missing_items, 0);

  async function createDirectDrafts() {
    setCreatingDrafts(true);
    try {
      const result = await api.createDirectPurchaseDrafts(id);
      const changed = result.orders?.length || 0;
      const unresolved = result.unresolved_items?.length || 0;
      alert(`טיוטות הרכש עודכנו: ${changed}.${unresolved ? ` ${unresolved} פריטים נשארו ללא ספק.` : ''}`);
      load();
    } catch (e) {
      onAuthError(e);
    } finally {
      setCreatingDrafts(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-brand-burgundy/70">
          פריטים בחוסר: <span className="font-bold text-brand-burgundy">{totalMissing}</span>
        </span>
        {canSyncDirectDrafts && (
          <span className="text-brand-burgundy/70">
            רכש ישיר שנותר להזמנה: <span className="font-bold text-brand-burgundy">{totalDirectMissing}</span>
          </span>
        )}
        <span className="text-brand-burgundy/50 text-xs">
          הצורך מחושב מהזמנות שנכנסות להכנות בלבד · המלצת הקנייה מעוגלת למארזים שלמים
        </span>
        {data.suppliers.length > 0 && (
          <button onClick={() => setDeducting(true)} className="btn-primary text-sm mr-auto">
            הפחתה בפועל מהמלאי
          </button>
        )}
        {directSuppliers.length > 0 && (
          <button
            onClick={createDirectDrafts}
            disabled={creatingDrafts}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {creatingDrafts ? 'מעדכן טיוטות...' : 'יצירת טיוטות לרכש ישיר'}
          </button>
        )}
      </div>

      {deducting && (
        <DeductionPanel id={id} onClose={() => setDeducting(false)}
          onDone={() => { setDeducting(false); load(); }} onErr={onAuthError} />
      )}

      {directSuppliers.length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="font-bold text-brand-burgundy text-lg">רכש ישיר לאירוע</h3>
            <p className="text-xs text-brand-burgundy/55">
              הכמות הנדרשת אינה מתקזזת מהמלאי. הזמנות מבוטלות אינן נספרות.
            </p>
          </div>
          {directSuppliers.map((group) => (
            <div key={`direct-${group.supplier_id || '_none'}`} className="card border-r-4 border-brand-gold">
              <h4 className="font-bold text-brand-burgundy mb-2">
                {group.supplier_name || 'ללא ספק מוגדר'}
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-brand-burgundy/60 text-xs">
                    <tr>
                      <th className="p-2 text-right">מוצר</th>
                      <th className="p-2 text-right">נדרש</th>
                      <th className="p-2 text-right">הוזמן</th>
                      <th className="p-2 text-right">התקבל</th>
                      <th className="p-2 text-right">נותר להזמנה</th>
                      <th className="p-2 text-right">חריגה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.item_id} className="border-t border-brand-cream-dark/50">
                        <td className="p-2 font-medium">{item.name}</td>
                        <td className="p-2">{formatInventoryQuantity(item.required, item)}</td>
                        <td className="p-2">{formatInventoryQuantity(item.ordered, item)}</td>
                        <td className="p-2">{formatInventoryQuantity(item.received, item)}</td>
                        <td className={`p-2 font-bold ${item.remaining_to_order > 0 ? 'text-red-700' : 'text-green-700'}`}>
                          {item.remaining_to_order > 0
                            ? formatInventoryQuantity(item.remaining_to_order, item)
                            : '✓'}
                        </td>
                        <td className="p-2 text-amber-700">
                          {item.over_ordered > 0
                            ? formatInventoryQuantity(item.over_ordered, item)
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!group.supplier_id && (
                <p className="mt-2 text-xs text-red-700">
                  יש להגדיר ספק ברירת מחדל למוצרים אלה לפני יצירת טיוטות.
                </p>
              )}
            </div>
          ))}
        </div>
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
                    <td className="p-2 font-bold">{formatInventoryQuantity(it.required, it)}</td>
                    <td className="p-2 text-brand-burgundy/60">{formatInventoryQuantity(it.on_hand, it)}</td>
                    <td className={`p-2 font-bold ${it.missing > 0 ? 'text-red-700' : 'text-green-700'}`}>
                      {it.missing > 0 ? formatInventoryQuantity(it.missing, it) : '✓'}
                    </td>
                    <td className="p-2 font-bold text-brand-gold-dark">
                      {it.suggested_purchase > 0 ? formatInventoryQuantity(it.suggested_purchase, it) : '-'}
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
            שורות מתכון שאינן מקושרות לפריט מלאי - לא ניתן לחשב חוסר או קנייה. שייך אותן לפריט מלאי כדי שייכנסו לדוח.
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
      setQty(Object.fromEntries(d.items.map((it) => {
        if (!it.package_size) return [it.item_id, it.suggested_deduction];
        const split = splitPackageQuantity(it.suggested_deduction, it.package_size);
        return [it.item_id, split];
      })));
    }).catch(onErr);
  }, [id, onErr]);

  async function deduct() {
    const lines = rows
      .map((item) => {
        const value = qty[item.item_id];
        const quantity = item.package_size
          ? packageQuantityTotal(value?.packages, value?.loose, item.package_size)
          : Number(value);
        return { item_id: item.item_id, quantity };
      })
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
        לאחר סיום ההכנות - אשר הפחתה מהמלאי לפי הצורך שחושב. ניתן לתקן כמויות ידנית לפני האישור.
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
                <td className="p-2 text-brand-burgundy/60">{formatInventoryQuantity(it.required, it)}</td>
                <td className="p-2 text-brand-burgundy/60">{formatInventoryQuantity(it.on_hand, it)}</td>
                <td className="p-2">
                  {it.package_size ? (
                    <div className="flex gap-1 min-w-48">
                      <input type="number" step="1" min="0" dir="ltr"
                        aria-label={it.package_label}
                        value={qty[it.item_id]?.packages ?? ''}
                        onChange={(e) => setQty((state) => ({
                          ...state,
                          [it.item_id]: { ...state[it.item_id], packages: e.target.value },
                        }))}
                        className="w-24 border border-brand-cream-dark rounded-lg p-1.5 focus:border-brand-gold outline-none" />
                      <input type="number" step="any" min="0" dir="ltr"
                        aria-label={it.unit}
                        value={qty[it.item_id]?.loose ?? ''}
                        onChange={(e) => setQty((state) => ({
                          ...state,
                          [it.item_id]: { ...state[it.item_id], loose: e.target.value },
                        }))}
                        className="w-24 border border-brand-cream-dark rounded-lg p-1.5 focus:border-brand-gold outline-none" />
                    </div>
                  ) : (
                    <input type="number" step="any" min="0" dir="ltr"
                      value={qty[it.item_id] ?? ''}
                      onChange={(e) => setQty((s) => ({ ...s, [it.item_id]: e.target.value }))}
                      className="w-24 border border-brand-cream-dark rounded-lg p-1.5 focus:border-brand-gold outline-none" />
                  )}
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
                      ? <span className="text-brand-burgundy/40">-</span>
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
              <td className="p-3 text-sm">{[o.venue_name, o.venue_address].filter(Boolean).join(' · ') || '-'}</td>
              <td className="p-3 font-bold">{o.total_portions}</td>
              <td className="p-3 text-sm text-brand-burgundy/60">{o.transport_notes || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- לשונית מתנדבים (סעיף 9.8, 24) ----
const DAY_LABELS = { general: 'כללי', tuesday: 'יום ג׳', wednesday: 'יום ד׳', thursday: 'יום ה׳', friday: 'יום ו׳', shabbat: 'שבת', motzei_shabbat: 'מוצ״ש' };
const SHIFT_LABELS = { morning: 'בוקר', noon: 'צהריים', evening: 'ערב', night: 'לילה' };

// הצעות מתנדבים לדריסה: קודם המחליפים (backup) של המשימה, אחריהם שאר המתנדבים
// באותו תחום - פרט למי שכבר האחראי בפועל.
function overrideSuggestions(task, volunteers) {
  const leadId = task.lead?.volunteer_id || null;
  const backups = (task.backups || []).map((b) => ({ id: b.volunteer_id, full_name: b.volunteer_name, has_vehicle: b.has_vehicle, priority: b.priority }));
  const backupIds = new Set(backups.map((b) => b.id));
  const areaCandidates = (volunteers || []).filter((volunteer) =>
    (volunteer.area_ids || []).includes(task.area_id)
    && !backupIds.has(volunteer.id));
  return [...backups, ...areaCandidates].filter((volunteer) => volunteer.id !== leadId);
}

// תיאור עיתוי המשימה (יום · משמרת · הערה) לתא בטבלה
function timingLabel(t) {
  const parts = [DAY_LABELS[t.execution_day] || 'כללי'];
  if (t.shift) parts.push(SHIFT_LABELS[t.shift]);
  if (t.timing_note) parts.push(t.timing_note);
  return parts.join(' · ');
}

// תג משובץ/לא-משובץ בסגנון badge-dot של המערכת
function AssignedBadge({ ok, yes, no }) {
  return (
    <span className={`badge ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
      <span className="badge-dot" aria-hidden="true" />
      {ok ? yes : no}
    </span>
  );
}

// צ׳יפ מתנדב (שם + טלפון + רכב)
function VolunteerChip({ name, phone, hasVehicle, tail }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-white border border-brand-cream-dark rounded-full px-2.5 py-0.5 text-sm">
      <span className="font-medium text-brand-burgundy">{name}</span>
      {phone && <span className="text-brand-burgundy/50 text-xs" dir="ltr">{phone}</span>}
      {hasVehicle && <span className="text-xs" title="יש רכב">🚗</span>}
      {tail}
    </span>
  );
}

const pickerSelectCls =
  'border border-brand-cream-dark rounded-lg px-3 py-1.5 text-sm text-brand-burgundy bg-white focus:border-brand-gold outline-none';

// טופס מתנדב חדש אינליין (משותף לבורר הבישול ולבורר המשימות): שם/טלפון/תחום/רכב,
// עם אפשרות לקשר ללקוח קיים (השם והטלפון מושלמים מכרטיס הלקוח, כמו בטופס המלא).
// onCreate מקבל payload מוכן ל-api.createVolunteer.
function NewVolunteerForm({ areas, customers, busy, defaultAreaId = '', onCreate, onCancel }) {
  const areaList = areas || [];
  const customerList = customers || [];
  const [form, setForm] = useState({ customer_id: '', first_name: '', last_name: '', phone: '', has_vehicle: false, area_id: defaultAreaId });
  const [customerSearch, setCustomerSearch] = useState('');

  const normalizedSearch = customerSearch.trim().toLocaleLowerCase('he-IL');
  const visibleCustomers = normalizedSearch
    ? customerList.filter((c) => [c.full_name, c.phone, c.email].filter(Boolean)
      .some((v) => String(v).toLocaleLowerCase('he-IL').includes(normalizedSearch)))
    : customerList;
  const linkedCustomer = customerList.find((c) => c.id === form.customer_id);

  // בחירת לקוח קיים משלימה שם/טלפון מכרטיס הלקוח (בדומה לטופס המתנדב המלא)
  function setCustomer(cid) {
    const c = customerList.find((x) => x.id === cid);
    setForm((prev) => ({
      ...prev,
      customer_id: cid,
      first_name: c?.first_name || prev.first_name,
      last_name: c?.last_name ?? prev.last_name,
      phone: c?.phone || prev.phone,
    }));
  }

  return (
    <div className="rounded-lg border border-brand-cream-dark bg-white p-3 space-y-2">
      <div className="text-sm font-medium text-brand-burgundy">מתנדב חדש</div>
      {/* קישור ללקוח קיים - השם והטלפון מושלמים מכרטיס הלקוח */}
      <div className="space-y-1.5">
        <div className="text-xs text-brand-burgundy/60">קישור ללקוח קיים (לא חובה)</div>
        <div className="flex flex-wrap gap-2">
          <input type="search" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="חיפוש לקוח לפי שם / טלפון / מייל..." aria-label="חיפוש לקוח קיים" className={pickerSelectCls} />
          <select value={form.customer_id} onChange={(e) => setCustomer(e.target.value)} className={pickerSelectCls}>
            <option value="">- מתנדב עצמאי -</option>
            {visibleCustomers.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name}{c.phone ? ` (${c.phone})` : ''}</option>
            ))}
            {visibleCustomers.length === 0 && <option disabled>לא נמצאו לקוחות מתאימים</option>}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
          placeholder="שם פרטי *" className={pickerSelectCls} readOnly={!!linkedCustomer} />
        <input value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
          placeholder="שם משפחה" className={pickerSelectCls} readOnly={!!linkedCustomer} />
        <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          placeholder="טלפון" dir="ltr" className={pickerSelectCls} readOnly={!!linkedCustomer} />
        <select value={form.area_id} onChange={(e) => setForm((f) => ({ ...f, area_id: e.target.value }))} className={pickerSelectCls}>
          <option value="">תחום...</option>
          {areaList.map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.is_cooking ? ' 🍲' : ''}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-brand-burgundy/80">
          <input type="checkbox" checked={form.has_vehicle}
            onChange={(e) => setForm((f) => ({ ...f, has_vehicle: e.target.checked }))} />
          יש רכב
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || !form.area_id || (!form.customer_id && !form.first_name.trim())}
          onClick={() => onCreate({
            customer_id: form.customer_id || undefined,
            first_name: form.first_name.trim() || undefined,
            last_name: form.last_name.trim() || undefined,
            phone: form.phone.trim() || undefined,
            has_vehicle: form.has_vehicle,
            area_ids: form.area_id ? [form.area_id] : [],
          })}
          className="btn-secondary text-sm disabled:opacity-50">הוספה ושיבוץ לשבת זו</button>
        <button type="button" disabled={busy} onClick={onCancel}
          className="text-xs text-brand-burgundy/60 underline">ביטול</button>
      </div>
      <p className="text-[11px] text-brand-burgundy/40">
        המתנדב יתווסף לרשימה הכללית וישובץ לשבת זו בלבד. שיוך קבוע נעשה בניהול המתנדבים.
      </p>
    </div>
  );
}

// בורר מחליף לבישול: בחירת מתנדב מתוך כל רשימת המתנדבים הפעילים לשבת זו בלבד,
// או הוספת מתנדב חדש (טופס משותף) ושיבוצו מיד כמחליף.
function MealCookPicker({ meal, volunteers, areas, customers, busy, onAssign, onReset, onCreateAndAssign }) {
  const [sel, setSel] = useState('');
  const [adding, setAdding] = useState(false);
  const list = volunteers || [];
  const defaultArea = (areas || []).find((a) => a.is_cooking)?.id || (areas || [])[0]?.id || '';

  return (
    <div className="space-y-3">
      <div className="text-sm text-brand-burgundy/70">
        שיבוץ מבשל מחליף לשבת זו למאכל <span className="font-medium">{meal.meal_name}</span> - מתוך רשימת המתנדבים הכללית.
      </div>

      {!adding ? (
        <>
          {/* הצעות מהירות: המחליפים הקבועים של המאכל (סעיף 24.2) */}
          {meal.backup_cooks?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {meal.backup_cooks.map((c) => (
                <button key={c.volunteer_id} type="button" onClick={() => onAssign(meal, c.volunteer_id)} disabled={busy}
                  className="text-sm bg-brand-burgundy/5 hover:bg-brand-gold/20 border border-brand-cream-dark rounded-full px-3 py-1">
                  {c.volunteer_name} · מחליף קבוע{c.has_vehicle ? ' 🚗' : ''}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select value={sel} onChange={(e) => setSel(e.target.value)} className={pickerSelectCls}>
              <option value="">בחירת מתנדב...</option>
              {list.map((v) => (
                <option key={v.id} value={v.id}>{v.full_name}{v.has_vehicle ? ' 🚗' : ''}</option>
              ))}
            </select>
            <button type="button" disabled={!sel || busy} onClick={() => onAssign(meal, sel)}
              className="btn-secondary text-sm disabled:opacity-50">שיבוץ מחליף</button>
            <button type="button" disabled={busy} onClick={() => setAdding(true)}
              className="text-xs text-brand-burgundy/70 hover:text-brand-burgundy underline">+ מתנדב חדש</button>
            {meal.is_override && (
              <button type="button" disabled={busy} onClick={() => onReset(meal)}
                className="text-xs text-brand-gold-dark underline">החזרה למבשלים הקבועים</button>
            )}
          </div>
        </>
      ) : (
        <NewVolunteerForm areas={areas} customers={customers} busy={busy} defaultAreaId={defaultArea}
          onCreate={(payload) => onCreateAndAssign(meal, payload)} onCancel={() => setAdding(false)} />
      )}

      {meal.permanent_cooks?.length > 0 && (
        <div className="text-xs text-brand-burgundy/50">
          מבשלים קבועים: {meal.permanent_cooks.map((c) => c.volunteer_name).join(', ')}
        </div>
      )}
      {meal.backup_cooks?.length > 0 && (
        <div className="text-xs text-brand-burgundy/50">
          מחליפים קבועים: {meal.backup_cooks.map((c) => c.volunteer_name).join(', ')}
        </div>
      )}
      {list.length === 0 && !adding && (
        <div className="text-xs text-brand-burgundy/40">אין מתנדבים פעילים - אפשר להוסיף מתנדב חדש.</div>
      )}
    </div>
  );
}

// בורר החלפת אחראי למשימה לשבת זו (דריסה): הצעות מהירות (מחליפים ומתנדבי התחום),
// בחירה מכל רשימת המתנדבים הכללית, או הוספת מתנדב חדש (טופס משותף).
function TaskOverridePicker({ task, volunteers, areas, customers, busy, onOverride, onCreateAndAssign }) {
  const [sel, setSel] = useState('');
  const [adding, setAdding] = useState(false);
  const suggestions = overrideSuggestions(task, volunteers);
  const list = volunteers || [];

  return (
    <div className="space-y-3">
      <div className="text-sm text-brand-burgundy/70">
        החלפת האחראי למשימה <span className="font-medium">{task.name}</span> לשבת זו בלבד:
      </div>

      {!adding ? (
        <>
          {/* הצעות מהירות: מחליפים ומתנדבי התחום */}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((v) => (
                <button key={v.id} type="button" onClick={() => onOverride(task, v.id)} disabled={busy}
                  className="text-sm bg-brand-burgundy/5 hover:bg-brand-gold/20 border border-brand-cream-dark rounded-full px-3 py-1">
                  {v.full_name}{v.priority ? ` · מחליף ${v.priority}` : ''}{v.has_vehicle ? ' 🚗' : ''}
                </button>
              ))}
            </div>
          )}
          {/* בחירה מכל רשימת המתנדבים + הוספת מתנדב חדש */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={sel} onChange={(e) => setSel(e.target.value)} className={pickerSelectCls}>
              <option value="">בחירה מכל המתנדבים...</option>
              {list.map((v) => (
                <option key={v.id} value={v.id}>{v.full_name}{v.has_vehicle ? ' 🚗' : ''}</option>
              ))}
            </select>
            <button type="button" disabled={!sel || busy} onClick={() => onOverride(task, sel)}
              className="btn-secondary text-sm disabled:opacity-50">שיבוץ</button>
            <button type="button" disabled={busy} onClick={() => setAdding(true)}
              className="text-xs text-brand-burgundy/70 hover:text-brand-burgundy underline">+ מתנדב חדש</button>
          </div>
        </>
      ) : (
        <NewVolunteerForm areas={areas} customers={customers} busy={busy} defaultAreaId={task.area_id || ''}
          onCreate={(payload) => onCreateAndAssign(task, payload)} onCancel={() => setAdding(false)} />
      )}
    </div>
  );
}

function VolunteersTab({ id, onAuthError }) {
  const [data, setData] = useState(null);
  const [volunteers, setVolunteers] = useState(null); // כל המתנדבים הפעילים (לדריסה)
  const [areas, setAreas] = useState(null); // תחומי ההתנדבות (ליצירת מתנדב חדש מהבורר)
  const [customers, setCustomers] = useState(null); // לקוחות (לקישור מתנדב חדש ללקוח קיים)
  const [busy, setBusy] = useState(false);
  const [assigningTask, setAssigningTask] = useState(null); // task_id שנפתח לדריסה
  const [assigningMeal, setAssigningMeal] = useState(null); // meal_id שנפתח לשיבוץ מחליף

  const load = useCallback(() => {
    Promise.all([api.shabbatVolunteers(id), api.volunteers('?active=true'), api.volunteerAreas(), api.adminCustomers()])
      .then(([rep, vols, ars, custs]) => { setData(rep); setVolunteers(vols); setAreas(ars); setCustomers(custs); })
      .catch(onAuthError);
  }, [id, onAuthError]);

  useEffect(() => { load(); }, [load]);

  async function refresh() {
    setBusy(true);
    try { await api.shabbatVolunteerAutoAssign(id); load(); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  // דריסת האחראי הקבוע למשימה זו בשבת הנוכחית
  async function override(task, volunteerId) {
    setBusy(true);
    try {
      await api.shabbatVolunteerAssign(id, { task_id: task.task_id, volunteer_id: volunteerId });
      setAssigningTask(null);
      load();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  // הסרת דריסה - חזרה לאחראי הקבוע מהתבנית
  async function resetLead(task) {
    setBusy(true);
    try { await api.shabbatVolunteerReset(id, task.task_id); setAssigningTask(null); load(); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  // שיבוץ מבשל מחליף למאכל בשבת זו
  async function overrideMeal(meal, volunteerId) {
    setBusy(true);
    try {
      await api.shabbatVolunteerMealAssign(id, meal.meal_id, { volunteer_id: volunteerId });
      setAssigningMeal(null);
      load();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  // הסרת דריסת מבשל - חזרה למבשלים הקבועים
  async function resetMeal(meal) {
    setBusy(true);
    try { await api.shabbatVolunteerMealReset(id, meal.meal_id); setAssigningMeal(null); load(); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  // יצירת מתנדב חדש מתוך בורר המחליף ושיבוצו מיד כמבשל מחליף לשבת זו
  async function createAndAssignMeal(meal, payload) {
    setBusy(true);
    try {
      const res = await api.createVolunteer(payload);
      const newId = res?.volunteer?.id;
      if (!newId) throw new Error('יצירת המתנדב נכשלה.');
      await api.shabbatVolunteerMealAssign(id, meal.meal_id, { volunteer_id: newId });
      setAssigningMeal(null);
      load();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  // יצירת מתנדב חדש מתוך בורר המשימות ושיבוצו מיד כאחראי (דריסה) לשבת זו
  async function createAndAssignTask(task, payload) {
    setBusy(true);
    try {
      const res = await api.createVolunteer(payload);
      const newId = res?.volunteer?.id;
      if (!newId) throw new Error('יצירת המתנדב נכשלה.');
      await api.shabbatVolunteerAssign(id, { task_id: task.task_id, volunteer_id: newId });
      setAssigningTask(null);
      load();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }

  if (!data) return <p>טוען...</p>;

  const cookingMeals = data.cooking_meals || [];
  const tasks = data.tasks || [];

  // אפשרויות סינון התחום (enum) מתוך התחומים שקיימים בפועל בשורות המשימות
  const areaOptions = [...new Set(tasks.map((t) => t.area_name).filter(Boolean))]
    .map((name) => ({ value: name, label: name }));

  // עמודות טבלת הבישול (מאכל, מנות, מבשלים, משובץ)
  const cookingColumns = [
    { key: 'meal_name', label: 'מאכל', type: 'text',
      render: (m) => <span className="font-medium text-brand-burgundy">{m.meal_name}</span> },
    { key: 'portions', label: 'מנות', type: 'number',
      render: (m) => <span className="font-bold text-brand-gold-dark">{m.portions}</span> },
    { key: 'cooks', label: 'מבשלים', type: 'text',
      value: (m) => m.cooks.map((c) => c.volunteer_name).join(', '),
      render: (m) => (
        m.is_unassigned ? (
          <span className="text-red-700 text-sm font-medium">אין מתנדב משובץ לבישול</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {m.cooks.map((c) => (
              <VolunteerChip key={c.volunteer_id} name={c.volunteer_name} phone={c.phone} hasVehicle={c.has_vehicle} />
            ))}
            {m.is_override && <span className="text-[10px] text-brand-gold-dark self-center" title="מחליף לשבת זו">מחליף</span>}
          </div>
        )
      ) },
    { key: 'backup_cooks', label: 'מחליפים', filterable: false, sortable: false,
      render: (m) => (m.backup_cooks?.length
        ? <span className="text-xs text-brand-burgundy/60">{m.backup_cooks.map((c) => c.volunteer_name).join(', ')}</span>
        : <span className="text-brand-burgundy/30">-</span>) },
    { key: 'assigned', label: 'משובץ', type: 'boolean',
      trueLabel: 'יש מבשל', falseLabel: 'אין מבשל',
      value: (m) => !m.is_unassigned,
      render: (m) => <AssignedBadge ok={!m.is_unassigned} yes="יש מבשל" no="אין מבשל" /> },
  ];

  // עמודות טבלת המשימות (תחום, משימה, עיתוי, אחראי, מחליפים, משובץ)
  const taskColumns = [
    { key: 'area_name', label: 'תחום', type: 'enum', options: areaOptions,
      render: (t) => <span className="text-brand-burgundy/80">{t.area_name || 'ללא תחום'}</span> },
    { key: 'name', label: 'משימה', type: 'text',
      render: (t) => (
        <div>
          <span className="font-medium text-brand-burgundy">{t.name}</span>
          {t.linked_meal_name && <span className="text-xs text-brand-burgundy/50 mr-1">({t.linked_meal_name})</span>}
          {t.meal_is_ordered && t.is_unassigned && (
            <div className="text-xs text-red-700 font-bold">מוזמן בשבת, אין מתנדב</div>
          )}
        </div>
      ) },
    { key: 'timing', label: 'עיתוי', type: 'text',
      value: (t) => timingLabel(t),
      render: (t) => <span className="text-brand-burgundy/70">{timingLabel(t)}</span> },
    { key: 'lead', label: 'אחראי בפועל', type: 'text',
      value: (t) => t.lead?.volunteer_name || '',
      render: (t) => (
        t.lead ? (
          <VolunteerChip name={t.lead.volunteer_name} phone={t.lead.phone} hasVehicle={t.lead.has_vehicle}
            tail={
              t.lead.source === 'override' ? <span className="text-[10px] text-brand-gold-dark" title="הוחלף לשבת זו">החלפה</span>
                : t.lead.source === 'meal' ? <span className="text-[10px] text-brand-gold-dark" title="לפי שיוך מאכל">בישול</span>
                  : null
            } />
        ) : <span className="text-brand-burgundy/40 text-sm">ללא אחראי</span>
      ) },
    { key: 'backups', label: 'מחליפים', filterable: false, sortable: false,
      render: (t) => t.backups?.length
        ? <span className="text-xs text-brand-burgundy/60">{t.backups.map((b) => b.volunteer_name).join(', ')}</span>
        : <span className="text-brand-burgundy/30">-</span> },
    { key: 'assigned', label: 'משובץ', type: 'boolean',
      trueLabel: 'משובץ', falseLabel: 'לא משובץ',
      value: (t) => !t.is_unassigned,
      render: (t) => <AssignedBadge ok={!t.is_unassigned} yes="משובץ" no="לא משובץ" /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-brand-burgundy/70 flex flex-wrap gap-x-4 gap-y-1">
          <span>משימות ללא שיבוץ: <span className={`font-bold ${data.unassigned_count > 0 ? 'text-red-700' : 'text-green-700'}`}>
            {data.unassigned_count}
          </span></span>
          <span>מאכלים ללא מבשל: <span className={`font-bold ${data.cooking_unassigned_count > 0 ? 'text-red-700' : 'text-green-700'}`}>
            {data.cooking_unassigned_count || 0}
          </span></span>
        </div>
        <button onClick={refresh} disabled={busy} className="btn-secondary text-sm">
          רענון
        </button>
      </div>

      {/* בישול - פירוט מאכלים: כל מאכל שהוזמן בשבת + מי מכין אותו (טבלה) */}
      {cookingMeals.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-bold text-brand-burgundy text-lg">
            בישול - פירוט מאכלים <span className="text-sm font-normal text-brand-burgundy/50">(מי מכין כל מאכל)</span>
          </h3>
          <DataTable
            rows={cookingMeals}
            columns={cookingColumns}
            rowKey={(m) => m.meal_id}
            rowClassName={(m) => (m.is_unassigned ? 'bg-red-50/40' : '')}
            actions={(m) => (
              <button type="button"
                onClick={() => setAssigningMeal(assigningMeal === m.meal_id ? null : m.meal_id)}
                className="text-xs text-brand-burgundy/70 hover:text-brand-burgundy underline whitespace-nowrap">
                {assigningMeal === m.meal_id ? 'סגירה' : 'שיבוץ מחליף'}
              </button>
            )}
            actionsLabel="פעולות"
            expandedId={assigningMeal}
            renderExpanded={(m) => (
              <MealCookPicker meal={m} volunteers={volunteers} areas={areas || []} customers={customers || []} busy={busy}
                onAssign={overrideMeal} onReset={resetMeal} onCreateAndAssign={createAndAssignMeal} />
            )}
            empty="אין מאכלים בהכנה בשבת זו."
          />
          <p className="text-xs text-brand-burgundy/40">
            השיוך הקבוע נעשה במסך ניהול המתנדבים (בכרטיס המתנדב, תחת תחום בישול). כאן אפשר לשבץ מחליף לשבת בודדת בלבד.
          </p>
        </section>
      )}

      {/* משימות מתנדבים (טבלה) */}
      <section className="space-y-2">
        <h3 className="font-bold text-brand-burgundy text-lg">משימות מתנדבים</h3>
        {tasks.length === 0 ? (
          <div className="card text-center py-8 text-brand-burgundy/60">
            אין משימות רלוונטיות לשבת זו. יש להגדיר משימות בניהול המתנדבים.
          </div>
        ) : (
          <DataTable
            rows={tasks}
            columns={taskColumns}
            rowKey={(t) => t.task_id}
            rowClassName={(t) => (t.is_unassigned ? 'bg-red-50/40' : '')}
            actions={(t) => (
              <div className="flex flex-col items-start gap-1">
                <button type="button"
                  onClick={() => setAssigningTask(assigningTask === t.task_id ? null : t.task_id)}
                  className="text-xs text-brand-burgundy/70 hover:text-brand-burgundy underline whitespace-nowrap">
                  {assigningTask === t.task_id ? 'סגירה' : 'החלפה לשבת זו'}
                </button>
                {t.is_override && (
                  <button type="button" onClick={() => resetLead(t)} disabled={busy}
                    className="text-xs text-brand-gold-dark underline whitespace-nowrap">החזרת הקבוע</button>
                )}
              </div>
            )}
            actionsLabel="פעולות"
            expandedId={assigningTask}
            renderExpanded={(t) => (
              <TaskOverridePicker task={t} volunteers={volunteers} areas={areas || []} customers={customers || []} busy={busy}
                onOverride={override} onCreateAndAssign={createAndAssignTask} />
            )}
          />
        )}
      </section>

      <div className="text-xs text-brand-burgundy/40">
        האחראי הקבוע נקבע במסך "משימות קבועות". שיבוץ בישול מחושב אוטומטית לפי המאכל שהוזמן. אפשר להחליף אחראי או מבשל לשבת בודדת בלי לשנות את הקבוע.
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

// רשימת הדוחות הניתנים לבחירה בלשונית הדפסות - רק המסומנים נכנסים ל-.print-area (סעיף 33)
const PRINT_REPORTS = [
  { key: 'workSlips', label: 'דוח עבודה מרוכז' },
  { key: 'cooking', label: 'שיבוץ מבשלים' },
  { key: 'volunteers', label: 'שיבוץ מתנדבים' },
  { key: 'customerSlips', label: 'פירוט ללקוח' },
  { key: 'kitchen', label: 'דוח עבודה למטבח' },
  { key: 'inventory', label: 'חומרי גלם וחוסרים' },
  { key: 'transport', label: 'דוח שינוע' },
  { key: 'summary', label: 'סיכום הזמנות' },
];

function PrintTab({ id, onAuthError }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(() => Object.fromEntries(PRINT_REPORTS.map((r) => [r.key, r.key === 'workSlips'])));
  useEffect(() => { api.shabbatWorkFile(id).then(setData).catch(onAuthError); }, [id, onAuthError]);

  if (!data) return <p>טוען...</p>;

  const toggleReport = (key) => setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  const anySelected = PRINT_REPORTS.some((r) => selected[r.key]);

  const sh = data.shabbat;
  const genDate = new Date(data.generated_at).toLocaleString('he-IL');
  const s = data.summary;
  const k = data.kitchen;
  const inv = data.inventory;
  const tr = data.transport;
  const vol = data.volunteers;
  const slips = data.customer_slips;

  const hasOperational = (s?.operational_orders || 0) > 0;

  // דוח עבודה מרוכז פנימי (סעיף 33.6/33.7): מבשל לכל מאכל + שאר משימות ההתנדבות
  const cookByMeal = Object.fromEntries((vol?.cooking_meals || []).map((m) => [m.meal_id, m]));
  const otherVolunteerTasks = (vol?.tasks || []).filter((t) => !t.area_is_cooking);

  return (
    <div>
      {/* סרגל פעולות - לא מודפס */}
      <div className="no-print card mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="text-sm text-brand-burgundy/70">
            תיק עבודה מרוכז לשבת - מוכן להדפסה. הופק: {genDate}
          </div>
          <div className="flex items-center gap-3">
            {!anySelected && <span className="text-sm text-red-700">לא נבחרו דוחות להדפסה</span>}
            <button onClick={() => window.print()} disabled={!anySelected} className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
              🖨️ הדפסת תיק העבודה
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-3 border-t border-brand-cream-dark">
          {PRINT_REPORTS.map((r) => (
            <label key={r.key} className="flex items-center gap-1.5 text-sm text-brand-burgundy cursor-pointer">
              <input type="checkbox" checked={!!selected[r.key]} onChange={() => toggleReport(r.key)} />
              {r.label}
            </label>
          ))}
        </div>
      </div>

      {!hasOperational && (
        <div className="no-print card border-r-4 border-brand-gold mb-4 text-sm text-brand-burgundy/70">
          אין עדיין הזמנות שנכנסות להכנות (מאושרות ושולמו). תיק העבודה יכיל את השער בלבד.
          דוחות המטבח, האריזה, השינוע והמלאי מתמלאים כשההזמנות נכנסות להכנות (כלל 8.7).
        </div>
      )}

      {/* אזור ההדפסה בפועל */}
      <div className="print-area bg-white">
        {/* 1. דוח עבודה מרוכז להזמנה - פנימי בלבד, כולל שיבוץ מתנדבים (לא ניתן ללקוח) */}
        {selected.workSlips && slips?.orders?.length > 0 && slips.orders.map((o) => (
          <OrderSlipSection key={`work-${o.order_id}`} sh={sh} o={o} withVolunteers
            cookByMeal={cookByMeal} otherVolunteerTasks={otherVolunteerTasks} />
        ))}

        {/* 2. שיבוץ מבשלים - מי מכין כל מאכל */}
        {selected.cooking && vol?.cooking_meals?.length > 0 && (
          <ReportBlock title="שיבוץ מבשלים"
            subtitle={`${vol.cooking_unassigned_count || 0} מאכלים ללא מבשל`}>
            <PrintTable head={['מאכל', 'מנות', 'מבשל/ים', 'מחליפים']}>
              {vol.cooking_meals.map((meal) => (
                <tr key={meal.meal_id}>
                  <td className="border border-brand-cream-dark p-2 font-medium">{meal.meal_name}</td>
                  <td className="border border-brand-cream-dark p-2 font-bold">{meal.portions}</td>
                  <td className="border border-brand-cream-dark p-2">
                    {meal.is_unassigned
                      ? <span className="text-red-700 font-bold">ללא מבשל</span>
                      : (
                        <>
                          {meal.cooks.map((c) => (
                            <span key={c.volunteer_id} className="inline-block ml-3">
                              {c.volunteer_name}{c.phone && <span className="text-brand-burgundy/50 text-xs mr-1" dir="ltr">{c.phone}</span>}{c.has_vehicle ? ' 🚗' : ''}
                            </span>
                          ))}
                          {meal.is_override && <span className="text-xs text-brand-gold-dark">(מחליף לשבת זו)</span>}
                        </>
                      )}
                  </td>
                  <td className="border border-brand-cream-dark p-2 text-brand-burgundy/60">
                    {meal.backup_cooks?.length
                      ? meal.backup_cooks.map((c) => (
                        <span key={c.volunteer_id} className="inline-block ml-3">
                          {c.volunteer_name}{c.phone && <span className="text-brand-burgundy/50 text-xs mr-1" dir="ltr">{c.phone}</span>}
                        </span>
                      ))
                      : '-'}
                  </td>
                </tr>
              ))}
            </PrintTable>
          </ReportBlock>
        )}

        {/* 3. שיבוץ מתנדבים (סעיף 33.2) */}
        {selected.volunteers && (
        <ReportBlock title="שיבוץ מתנדבים"
          subtitle={vol ? `${vol.unassigned_count} משימות ללא שיבוץ` : ''}>
          {!vol?.tasks?.length ? (
            <p className="text-brand-burgundy/50 text-sm">אין משימות מוגדרות.</p>
          ) : (
            <PrintTable head={['תחום', 'מועד', 'משימה', 'אחראי']}>
              {vol.tasks.map((t) => (
                <tr key={t.task_id}>
                  <td className="border border-brand-cream-dark p-2 text-brand-burgundy/70">
                    {t.area_name || '-'}
                  </td>
                  <td className="border border-brand-cream-dark p-2 text-brand-burgundy/70">
                    {DAY_LABELS[t.execution_day] || 'כללי'}{t.shift ? ` · ${SHIFT_LABELS[t.shift]}` : ''}{t.timing_note ? ` · ${t.timing_note}` : ''}
                  </td>
                  <td className="border border-brand-cream-dark p-2">
                    {t.name}
                    {t.linked_meal_name && <span className="text-xs text-brand-burgundy/50 mr-1">({t.linked_meal_name})</span>}
                  </td>
                  <td className="border border-brand-cream-dark p-2">
                    {!t.lead
                      ? <span className="text-red-700 font-bold">ללא שיבוץ</span>
                      : (
                        <span className="inline-block ml-3">
                          {t.lead.volunteer_name}{t.lead.phone && <span className="text-brand-burgundy/50 text-xs mr-1" dir="ltr">{t.lead.phone}</span>}{t.lead.has_vehicle ? ' 🚗' : ''}
                          {t.is_override && <span className="text-[10px] text-brand-gold-dark mr-1">(החלפה)</span>}
                        </span>
                      )}
                  </td>
                </tr>
              ))}
            </PrintTable>
          )}
        </ReportBlock>
        )}

        {/* 4. דפי פירוט ללקוח - כל הזמנה בעמוד נפרד, נשאר אצל הלקוח (סעיף 33.6, ללא מחירים, בלי מתנדבים) */}
        {/* כולל דף ההוראות ללקוח (נוסח order_instructions_print) מתחת לפירוט ההזמנה */}
        {selected.customerSlips && slips?.orders?.length > 0 && slips.orders.map((o) => (
          <OrderSlipSection key={`customer-${o.order_id}`} sh={sh} o={o} instructionsText={data.print_instructions_text} />
        ))}

        {/* 5. דוח עבודה למטבח + חומרי גלם (סעיף 33.3) */}
        {selected.kitchen && (
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
        )}

        {/* 6. דוח חוסרים וקניות (סעיף 33.2, 26) */}
        {selected.inventory && (
        <ReportBlock title="חומרי גלם וחוסרים">
          {!inv?.suppliers?.length && !inv?.direct_suppliers?.length && !inv?.unlinked?.length ? (
            <p className="text-brand-burgundy/50 text-sm">אין צורך מחושב.</p>
          ) : (
            <>
              {(inv.direct_suppliers || []).map((g) => (
                <div key={`direct-${g.supplier_id || '_none'}`} className="mb-4 print-avoid">
                  <h3 className="font-bold text-brand-burgundy flex justify-between px-1">
                    <span>רכש ישיר · {g.supplier_name || 'ללא ספק מוגדר'}</span>
                    {g.supplier_phone && <span className="text-sm font-normal" dir="ltr">{g.supplier_phone}</span>}
                  </h3>
                  <PrintTable head={['פריט', 'נדרש', 'הוזמן', 'התקבל', 'נותר להזמנה', 'הזמנת יתר']}>
                    {g.items.map((it) => (
                      <tr key={it.item_id}>
                        <td className="border border-brand-cream-dark p-2">{it.name}</td>
                        <td className="border border-brand-cream-dark p-2 font-bold">{formatInventoryQuantity(it.required, it)}</td>
                        <td className="border border-brand-cream-dark p-2">{formatInventoryQuantity(it.ordered, it)}</td>
                        <td className="border border-brand-cream-dark p-2">{formatInventoryQuantity(it.received, it)}</td>
                        <td className="border border-brand-cream-dark p-2 font-bold">
                          {it.remaining_to_order > 0 ? formatInventoryQuantity(it.remaining_to_order, it) : '✓'}
                        </td>
                        <td className="border border-brand-cream-dark p-2">
                          {it.over_ordered > 0 ? formatInventoryQuantity(it.over_ordered, it) : '-'}
                        </td>
                      </tr>
                    ))}
                  </PrintTable>
                </div>
              ))}
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
                        <td className="border border-brand-cream-dark p-2 font-bold">{formatInventoryQuantity(it.required, it)}</td>
                        <td className="border border-brand-cream-dark p-2 text-brand-burgundy/60">{formatInventoryQuantity(it.on_hand, it)}</td>
                        <td className={`border border-brand-cream-dark p-2 font-bold ${it.missing > 0 ? 'text-red-700' : ''}`}>
                          {it.missing > 0 ? formatInventoryQuantity(it.missing, it) : '✓'}
                        </td>
                        <td className="border border-brand-cream-dark p-2 font-bold text-brand-gold-dark">
                          {it.suggested_purchase > 0 ? formatInventoryQuantity(it.suggested_purchase, it) : '-'}
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
        )}

        {/* 7. דוח שינוע (סעיף 33.5) */}
        {selected.transport && (
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
                  <td className="border border-brand-cream-dark p-2">{[o.venue_name, o.venue_address].filter(Boolean).join(' · ') || '-'}</td>
                  <td className="border border-brand-cream-dark p-2 font-bold">{o.total_portions}</td>
                  <td className="border border-brand-cream-dark p-2 text-brand-burgundy/60">{o.transport_notes || '-'}</td>
                </tr>
              ))}
            </PrintTable>
          )}
        </ReportBlock>
        )}

        {/* 8. סיכום הזמנות (סעיף 33.2) */}
        {selected.summary && s && (
          <ReportBlock title="סיכום הזמנות">
            <div className="grid grid-cols-4 gap-3 mb-3 text-center">
              <SlipStat label="סך הזמנות" value={s.total_orders} />
              <SlipStat label="סך מנות" value={s.total_portions} />
              <SlipStat label="נכנסות להכנות" value={s.operational_orders} />
              <SlipStat label="מנות בהכנה" value={s.operational_portions} />
            </div>
          </ReportBlock>
        )}
      </div>
    </div>
  );
}

// כרטיס פירוט הזמנה - קלף אחד לכל הזמנה. משמש גם לדף הלקוח הנקי (withVolunteers
// לא מסופק - נשאר אצל הלקוח עם האוכל, בלי מידע מתנדבים) וגם לדוח העבודה הפנימי
// המרוכז (withVolunteers=true - כולל מבשל לכל מאכל, מתנדב שינוע ושאר משימות ההתנדבות).
function OrderSlipSection({ sh, o, withVolunteers, cookByMeal, otherVolunteerTasks, instructionsText }) {
  // דוח העבודה הפנימי (withVolunteers) צריך להיות ברור וגדול ככל האפשר לצוות
  // המטבח: כיתוב רץ בשחור מלא (לא מוחלש/צבע מותג), בלי מסגרת חיצונית ובלי
  // הגבלת רוחב, שוליים מצומצמים. דף הלקוח (הרגיל) שומר על העיצוב שלו אבל
  // הטקסט הרץ גם בו בשחור מלא, כדי שיהיה קריא בהדפסת שחור-לבן.
  const boxCls = withVolunteers ? 'p-1' : 'border border-brand-cream-dark rounded-lg p-4 max-w-xl mx-auto';
  const checkboxCls = 'border-black';
  return (
    <section className={`print-section print-avoid ${withVolunteers ? 'py-2' : 'py-6'}`}>
      <div className="text-center mb-4">
        <div className="text-brand-gold-dark font-bold">מטבח החסד · ברכת שמואל</div>
        <h2 className="text-2xl font-extrabold text-brand-burgundy">
          {withVolunteers ? 'דוח עבודה מרוכז' : 'פירוט ללקוח'}
        </h2>
        <div className="text-sm font-medium text-black">
          {formatShabbatTitle(sh)} · <span className="text-brand-gold-dark/90">{formatShabbatHebrewDate(sh)}</span>
        </div>
      </div>
      <div className={boxCls}>
        <div className={`flex justify-between pb-2 mb-3 ${withVolunteers ? 'border-b-2 border-black' : 'border-b border-brand-cream-dark'}`}>
          <span className={`font-bold ${withVolunteers ? 'text-black text-2xl' : 'text-brand-burgundy text-lg'}`}>
            {o.customer_name}
            {withVolunteers && (
              <span className="font-normal text-lg text-black mr-2">· {o.total_portions} מנות</span>
            )}
          </span>
          <span className={`font-mono ${withVolunteers ? 'text-black text-lg' : 'text-brand-burgundy/60'}`}>#{o.order_number}</span>
        </div>
        <div className={`text-black ${withVolunteers ? 'text-base' : 'text-sm'} mb-3 space-y-0.5 bg-brand-cream/40 rounded-lg p-2.5`}>
          {withVolunteers ? (
            <div>איש קשר: {o.contact_name} {o.contact_phone && <span dir="ltr">({o.contact_phone})</span>}
              {(o.venue_name || o.venue_address) && ` · ${[o.venue_name, o.venue_address].filter(Boolean).join(' · ')}`}</div>
          ) : (
            <>
              <div>איש קשר: {o.contact_name} {o.contact_phone && <span dir="ltr">({o.contact_phone})</span>}</div>
              <div>אספקה: {DELIVERY_LABELS[o.delivery_method] || o.delivery_method}
                {(o.venue_name || o.venue_address) && ` · ${[o.venue_name, o.venue_address].filter(Boolean).join(' · ')}`}</div>
            </>
          )}
          {!withVolunteers && <div>סך מנות: <span className="font-bold text-brand-burgundy">{o.total_portions}</span></div>}
        </div>
        <div className={withVolunteers ? '' : 'grid grid-cols-2 gap-x-4'}>
          {o.slots.map((slot) => (
            <div key={slot.slot_id} className={withVolunteers ? 'mb-4 print-avoid' : 'mb-2'}>
              <div className={`font-bold ${withVolunteers ? 'text-black text-lg' : 'text-brand-burgundy'}`}>{slot.slot_name}
                <span className={`font-normal text-black ${withVolunteers ? 'text-base' : 'text-sm'}`}> · {slot.portions} מנות</span>
              </div>
              {withVolunteers ? (
                <table className="w-full border-collapse text-black mt-1">
                  <thead>
                    <tr>
                      <th className="border border-black p-1.5 w-10 bg-brand-cream"></th>
                      <th className="border border-black p-1.5 text-right bg-brand-cream text-brand-burgundy font-bold">מאכל</th>
                      <th className="border border-black p-1.5 text-right bg-brand-cream text-brand-burgundy font-bold">אריזה</th>
                      <th className="border border-black p-1.5 text-right bg-brand-cream text-brand-burgundy font-bold">מבשל</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slot.meals.map((meal) => {
                      const cooks = cookByMeal?.[meal.meal_id]?.cooks || [];
                      return (
                        <tr key={meal.meal_id}>
                          <td className="border border-black p-1.5 text-center align-middle">
                            <span className="inline-block w-4 h-4 border border-black" />
                          </td>
                          <td className="border border-black p-1.5 align-middle font-bold text-base">{meal.name}</td>
                          <td className="border border-black p-1.5 align-middle text-sm">
                            {meal.packages?.length > 0
                              ? meal.packages.map((p) => `${p.count} × ${p.packaging_label}`).join(', ')
                              : '-'}
                          </td>
                          <td className={`border border-black p-1.5 align-middle text-sm ${cooks.length > 0 ? '' : 'text-red-700 font-semibold'}`}>
                            {cooks.length > 0 ? cooks.map((c) => c.volunteer_name).join(', ') : 'ללא מבשל'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <ul className="pr-1 text-sm text-black space-y-0.5">
                  {slot.meals.map((meal) => (
                    <li key={meal.meal_id} className="flex items-start gap-1.5">
                      <span className={`mt-0.5 w-3 h-3 shrink-0 border rounded-sm ${checkboxCls}`} />
                      <span>
                        {meal.name}
                        {meal.packages?.length > 0 && (
                          <span className="text-black text-xs mr-1">
                            ({meal.packages.map((p) => `${p.count} × ${p.packaging_label}`).join(', ')})
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        {o.extras?.length > 0 && (
          <div className={withVolunteers ? 'mt-4 print-avoid' : 'mt-3 pt-2 border-t border-brand-cream-dark'}>
            <div className={withVolunteers ? 'font-bold text-black text-lg' : 'font-bold text-sm mb-1 text-brand-burgundy'}>תוספות בתשלום</div>
            {withVolunteers ? (
              <table className="w-full border-collapse text-black mt-1">
                <thead>
                  <tr>
                    <th className="border border-black p-1.5 w-10 bg-brand-cream"></th>
                    <th className="border border-black p-1.5 text-right bg-brand-cream text-brand-burgundy font-bold">תוספת</th>
                    <th className="border border-black p-1.5 text-right bg-brand-cream text-brand-burgundy font-bold">כמות</th>
                    <th className="border border-black p-1.5 text-right bg-brand-cream text-brand-burgundy font-bold">מתנדב משובץ</th>
                  </tr>
                </thead>
                <tbody>
                  {o.extras.map((e) => (
                    <tr key={e.extra_id}>
                      <td className="border border-black p-1.5 text-center align-middle">
                        <span className="inline-block w-4 h-4 border border-black" />
                      </td>
                      <td className="border border-black p-1.5 align-middle font-bold text-base">{e.name}</td>
                      <td className="border border-black p-1.5 align-middle text-sm">{e.quantity}</td>
                      <td className="border border-black p-1.5 align-middle text-sm"></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ul className="space-y-0.5 text-sm text-black">
                {o.extras.map((e) => (
                  <li key={e.extra_id} className="flex items-start gap-1.5">
                    <span className={`mt-0.5 w-3 h-3 shrink-0 border rounded-sm ${checkboxCls}`} />
                    <span>{e.name} × {e.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!withVolunteers && instructionsText && (
          <div className="mt-3 pt-2 border-t border-brand-cream-dark">
            <div className="font-bold text-sm mb-1 text-brand-burgundy">הוראות</div>
            <div className="text-sm text-black whitespace-pre-wrap">{instructionsText}</div>
          </div>
        )}
        {withVolunteers && otherVolunteerTasks?.length > 0 && (
          <div className="mt-4 print-avoid">
            <div className="font-bold text-black text-lg">שאר משימות ההתנדבות</div>
            <table className="w-full border-collapse text-black mt-1">
              <thead>
                <tr>
                  <th className="border border-black p-1.5 w-10 bg-brand-cream"></th>
                  <th className="border border-black p-1.5 text-right bg-brand-cream text-brand-burgundy font-bold">קטגוריה</th>
                  <th className="border border-black p-1.5 text-right bg-brand-cream text-brand-burgundy font-bold">משימה</th>
                  <th className="border border-black p-1.5 text-right bg-brand-cream text-brand-burgundy font-bold">מתנדב משובץ</th>
                </tr>
              </thead>
              <tbody>
                {otherVolunteerTasks.map((t) => (
                  <tr key={t.task_id}>
                    <td className="border border-black p-1.5 text-center align-middle">
                      <span className="inline-block w-4 h-4 border border-black" />
                    </td>
                    <td className="border border-black p-1.5 align-middle text-sm">{t.area_name}</td>
                    <td className="border border-black p-1.5 align-middle font-bold text-base">{t.name}</td>
                    <td className={`border border-black p-1.5 align-middle text-sm ${t.lead ? '' : 'text-red-700 font-semibold'}`}>
                      {t.lead ? t.lead.volunteer_name : 'ללא שיבוץ'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
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
