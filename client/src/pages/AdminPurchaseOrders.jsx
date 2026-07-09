import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { Badge, PO_STATUS } from '../lib/status.jsx';

// הזמנות רכש (סעיף 27.2-27.3): רשימה, סינון ויצירת הזמנה חדשה (טיוטה).
// פירוט/קבלת סחורה/תשלום נמצאים במסך הפירוט (/admin/purchase-orders/:id).

const STATUS_FILTERS = [
  { value: '', label: 'כל הסטטוסים' },
  { value: 'draft', label: 'טיוטה' },
  { value: 'sent', label: 'נשלחה לספק' },
  { value: 'partially_received', label: 'התקבלה חלקית' },
  { value: 'received', label: 'התקבלה במלואה' },
  { value: 'cancelled', label: 'בוטלה' },
];

export default function AdminPurchaseOrders({ onAuthError, currentAdmin }) {
  const [list, setList] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState({ supplier_id: '', status: '' });
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filter.supplier_id) params.set('supplier_id', filter.supplier_id);
    if (filter.status) params.set('status', filter.status);
    const q = params.toString();
    api.purchaseOrders(q ? `?${q}` : '').then(setList).catch(handleErr);
  }, [filter, handleErr]);

  useEffect(() => {
    api.suppliers('?active=true').then(setSuppliers).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function onCreated() {
    setCreating(false);
    load();
  }

  async function deletePurchaseOrder(po) {
    if (!confirm(`למחוק לצמיתות את הזמנת הרכש ${po.po_number}?`)) return;
    try { await api.deletePurchaseOrder(po.id); load(); }
    catch (e) { handleErr(e); }
  }

  if (!list) return <Page title="הזמנות רכש"><p>טוען...</p></Page>;

  return (
    <Page title="הזמנות רכש" subtitle="יצירת הזמנות לספקים, קבלת סחורה למלאי ותשלום (סעיף 27-28)">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <button onClick={() => setCreating(true)} className="btn-primary">+ הזמנת רכש חדשה</button>
        <Field label="ספק">
          <select value={filter.supplier_id} onChange={(e) => setFilter((f) => ({ ...f, supplier_id: e.target.value }))} className={inputCls}>
            <option value="">— כל הספקים —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="סטטוס">
          <select value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))} className={inputCls}>
            {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Link to="/admin/suppliers" className="btn-ghost pb-2">→ ניהול ספקים</Link>
      </div>

      {creating && (
        <CreatePurchaseOrder suppliers={suppliers} onCreated={onCreated} onCancel={() => setCreating(false)} onErr={handleErr} />
      )}

      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
          <thead className="bg-brand-burgundy text-brand-cream text-sm">
            <tr>
              <th className="p-3 text-right">מס׳</th>
              <th className="p-3 text-right">ספק</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right">אספקה צפויה</th>
              <th className="p-3 text-right">משוער</th>
              <th className="p-3 text-right">בפועל</th>
              <th className="p-3 text-right">נוצרה</th>
              {canDelete && <th className="p-3 text-right"></th>}
            </tr>
          </thead>
          <tbody>
            {list.map((po) => (
              <tr key={po.id} className="border-b border-brand-cream-dark hover:bg-brand-cream/30 cursor-pointer">
                <td className="p-3 font-medium">
                  <Link to={`/admin/purchase-orders/${po.id}`} className="text-brand-burgundy hover:underline">{po.po_number}</Link>
                </td>
                <td className="p-3 text-sm">{po.supplier?.name || '—'}</td>
                <td className="p-3 text-sm"><Badge map={PO_STATUS} value={po.status} /></td>
                <td className="p-3 text-sm" dir="ltr">{po.expected_delivery_date || '—'}</td>
                <td className="p-3 text-sm" dir="ltr">{po.estimated_amount != null ? `₪${po.estimated_amount}` : '—'}</td>
                <td className="p-3 text-sm" dir="ltr">{po.actual_amount != null ? `₪${po.actual_amount}` : '—'}</td>
                <td className="p-3 text-sm text-brand-burgundy/60" dir="ltr">{new Date(po.created_at).toLocaleDateString('he-IL')}</td>
                {canDelete && (
                  <td className="p-3 text-sm" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => deletePurchaseOrder(po)} className="text-red-600 hover:underline">
                      מחיקה
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={canDelete ? 8 : 7} className="p-6 text-center text-brand-burgundy/50">אין הזמנות רכש.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// יצירת הזמנת רכש חדשה (טיוטה)
// ---------------------------------------------------------------------------
function CreatePurchaseOrder({ suppliers, onCreated, onCancel, onErr }) {
  const [supplierId, setSupplierId] = useState('');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [allItems, setAllItems] = useState(null);
  const [lines, setLines] = useState([{ inventory_item_id: '', quantity: '', estimated_price: '' }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.invItems('?active=true').then(setAllItems).catch(onErr); }, [onErr]);

  // כשבוחרים ספק — טוענים מחיר קנייה אחרון פר מוצר לספק (לברירת מחדל של מחיר משוער)
  const [supplierPrices, setSupplierPrices] = useState({}); // item_id -> price
  useEffect(() => {
    if (!supplierId) { setSupplierPrices({}); return; }
    api.supplier(supplierId).then((d) => {
      const map = {};
      for (const it of d.items || []) if (it.last_purchase_price != null) map[it.item_id] = it.last_purchase_price;
      setSupplierPrices(map);
    }).catch(() => {});
  }, [supplierId]);

  function setLine(idx, patch) { setLines((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x))); }
  function addLine() { setLines((r) => [...r, { inventory_item_id: '', quantity: '', estimated_price: '' }]); }
  function removeLine(idx) { setLines((r) => r.filter((_, i) => i !== idx)); }

  function onPickItem(idx, itemId) {
    const patch = { inventory_item_id: itemId };
    // ברירת מחדל למחיר משוער: מחיר לספק, אחרת מחיר קנייה אחרון בכרטיס
    const item = allItems?.find((i) => i.id === itemId);
    const price = supplierPrices[itemId] ?? item?.last_purchase_price;
    if (price != null && lines[idx].estimated_price === '') patch.estimated_price = price;
    setLine(idx, patch);
  }

  const total = lines.reduce((sum, l) => {
    const q = Number(l.quantity), p = Number(l.estimated_price);
    return sum + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
  }, 0);

  async function submit(e) {
    e.preventDefault();
    if (!supplierId) return alert('חובה לבחור ספק.');
    const clean = lines.filter((l) => l.inventory_item_id && Number(l.quantity) > 0);
    if (clean.length === 0) return alert('חובה להוסיף לפחות פריט אחד עם כמות.');
    setBusy(true);
    try {
      await api.createPurchaseOrder({
        supplier_id: supplierId,
        expected_delivery_date: expected || null,
        notes,
        lines: clean.map((l) => ({
          inventory_item_id: l.inventory_item_id,
          quantity: Number(l.quantity),
          estimated_price: l.estimated_price === '' ? null : Number(l.estimated_price),
        })),
      });
      onCreated();
    } catch (err) { onErr(err); }
    finally { setBusy(false); }
  }

  const chosen = new Set(lines.map((l) => l.inventory_item_id));

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold mb-4">
      <h3 className="font-bold text-brand-burgundy">הזמנת רכש חדשה</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="ספק *">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
            <option value="">— בחר ספק —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="תאריך אספקה צפוי">
          <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={inputCls} dir="ltr" />
        </Field>
      </div>

      <div>
        <div className="text-sm text-brand-burgundy/70 mb-1">פריטים</div>
        {!allItems ? <p className="text-sm">טוען מוצרים...</p> : (
          <div className="space-y-2">
            <div className="hidden sm:grid grid-cols-12 gap-2 text-xs text-brand-burgundy/50 px-1">
              <div className="col-span-6">מוצר</div><div className="col-span-2">כמות</div><div className="col-span-3">מחיר משוער ליח׳</div><div className="col-span-1"></div>
            </div>
            {lines.map((l, idx) => {
              const item = allItems.find((i) => i.id === l.inventory_item_id);
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select value={l.inventory_item_id} onChange={(e) => onPickItem(idx, e.target.value)} className={`${inputCls} col-span-12 sm:col-span-6`}>
                    <option value="">— בחר מוצר —</option>
                    {allItems
                      .filter((i) => i.id === l.inventory_item_id || !chosen.has(i.id))
                      .map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                  </select>
                  <input type="number" step="any" min="0" placeholder="כמות" value={l.quantity}
                    onChange={(e) => setLine(idx, { quantity: e.target.value })} className={`${inputCls} col-span-5 sm:col-span-2`} dir="ltr" />
                  <input type="number" step="any" min="0" placeholder="מחיר" value={l.estimated_price}
                    onChange={(e) => setLine(idx, { estimated_price: e.target.value })} className={`${inputCls} col-span-5 sm:col-span-3`} dir="ltr" />
                  <button type="button" onClick={() => removeLine(idx)} className="col-span-2 sm:col-span-1 text-red-600 hover:underline text-sm">הסר</button>
                  {item && <div className="col-span-12 sm:hidden text-xs text-brand-burgundy/50">יחידה: {item.unit}</div>}
                </div>
              );
            })}
            <button type="button" onClick={addLine} className="btn-ghost text-sm">+ הוסף פריט</button>
          </div>
        )}
      </div>

      <Field label="הערות">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} rows={2} />
      </Field>

      <div className="flex items-center justify-between border-t border-brand-cream-dark pt-3">
        <div className="font-semibold text-brand-burgundy">מחיר משוער כולל: ₪{total.toFixed(2)}</div>
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'יוצר...' : 'יצירת הזמנה'}</button>
          <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
        </div>
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
