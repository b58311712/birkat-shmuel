import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { Badge, SUPPLIER_CHANNEL, PO_STATUS } from '../lib/status.jsx';

// ניהול ספקים — כרטיס ספק מלא (סעיף 27.1) + מוצרים שהספק מספק (סעיף 25.3).
// הזמנות רכש נמצאות במסך נפרד (/admin/purchase-orders).

const CHANNELS = [
  { value: '', label: '— ללא —' },
  { value: 'phone', label: 'טלפון' },
  { value: 'email', label: 'מייל' },
  { value: 'whatsapp', label: 'וואטסאפ' },
  { value: 'other', label: 'אחר' },
];

export default function AdminSuppliers({ onAuthError, currentAdmin }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);   // אובייקט ספק או {} = חדש
  const [detail, setDetail] = useState(null);      // ספק לפירוט (מוצרים + הזמנות)
  const [filter, setFilter] = useState({ active: 'true' });
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  const load = useCallback(() => {
    const q = filter.active ? `?active=${filter.active}` : '';
    api.suppliers(q).then(setList).catch(handleErr);
  }, [filter, handleErr]);

  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateSupplier(form.id, form);
      else await api.createSupplier(form);
      setEditing(null);
      load();
    } catch (e) { handleErr(e); }
  }

  async function toggleActive(s) {
    try { await api.updateSupplier(s.id, { is_active: !s.is_active }); load(); }
    catch (e) { handleErr(e); }
  }

  async function deleteSupplier(s) {
    if (!confirm(`למחוק לצמיתות את הספק ${s.name}?`)) return;
    try {
      await api.deleteSupplier(s.id);
      if (detail?.supplier?.id === s.id) setDetail(null);
      load();
    } catch (e) { handleErr(e); }
  }

  async function openDetail(s) {
    try { setDetail(await api.supplier(s.id)); }
    catch (e) { handleErr(e); }
  }

  if (!list) return <Page title="ניהול ספקים"><p>טוען...</p></Page>;

  return (
    <Page title="ניהול ספקים" subtitle="כרטיס ספק, פרטי קשר ומוצרים שהספק מספק (סעיף 27)">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <button onClick={() => setEditing({})} className="btn-primary">+ ספק חדש</button>
        <Field label="סטטוס">
          <select value={filter.active} onChange={(e) => setFilter({ active: e.target.value })} className={inputCls}>
            <option value="true">פעילים</option>
            <option value="false">לא פעילים</option>
            <option value="">הכל</option>
          </select>
        </Field>
        <Link to="/admin/purchase-orders" className="btn-ghost pb-2">הזמנות רכש ←</Link>
      </div>

      {editing && (
        <SupplierForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />
      )}
      {detail && (
        <SupplierDetail data={detail} onClose={() => setDetail(null)} onErr={handleErr} onChanged={() => openDetail(detail.supplier)} />
      )}

      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
          <thead className="bg-brand-burgundy text-brand-cream text-sm">
            <tr>
              <th className="p-3 text-right">שם ספק</th>
              <th className="p-3 text-right">איש קשר</th>
              <th className="p-3 text-right">טלפון</th>
              <th className="p-3 text-right">אמצעי הזמנה</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${!s.is_active ? 'opacity-50' : ''}`}>
                <td className="p-3 font-medium">
                  <button onClick={() => openDetail(s)} className="text-brand-burgundy hover:underline">{s.name}</button>
                </td>
                <td className="p-3 text-sm">{s.contact_name || '—'}</td>
                <td className="p-3 text-sm" dir="ltr">{s.phone || '—'}</td>
                <td className="p-3 text-sm">{SUPPLIER_CHANNEL[s.preferred_channel] || '—'}</td>
                <td className="p-3 text-sm">{s.is_active ? 'פעיל' : 'לא פעיל'}</td>
                <td className="p-3 text-sm whitespace-nowrap">
                  <button onClick={() => openDetail(s)} className="text-brand-burgundy hover:underline ml-3">פירוט</button>
                  <button onClick={() => setEditing(s)} className="text-brand-burgundy hover:underline ml-3">עריכה</button>
                  <button onClick={() => toggleActive(s)} className="text-brand-burgundy/60 hover:underline">
                    {s.is_active ? 'השבתה' : 'הפעלה'}
                  </button>
                  {canDelete && (
                    <button onClick={() => deleteSupplier(s)} className="text-red-600 hover:underline mr-3">
                      מחיקה
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-brand-burgundy/50">אין ספקים עדיין.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// טופס כרטיס ספק (סעיף 27.1)
// ---------------------------------------------------------------------------
function SupplierForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    contact_name: initial.contact_name || '',
    phone: initial.phone || '',
    email: initial.email || '',
    preferred_channel: initial.preferred_channel || '',
    order_notes: initial.order_notes || '',
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם ספק.');
    onSave({ ...f, preferred_channel: f.preferred_channel || null });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold mb-4">
      <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת ספק' : 'ספק חדש'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם ספק *">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="איש קשר">
          <input value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="טלפון">
          <input value={f.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="מייל">
          <input value={f.email} onChange={(e) => set('email', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="אמצעי הזמנה מועדף">
          <select value={f.preferred_channel} onChange={(e) => set('preferred_channel', e.target.value)} className={inputCls}>
            {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="הערות הזמנה">
        <textarea value={f.order_notes} onChange={(e) => set('order_notes', e.target.value)} className={inputCls} rows={2} />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// פירוט ספק: מוצרים שהוא מספק (סעיף 25.3) + הזמנות רכש אחרונות
// ---------------------------------------------------------------------------
function SupplierDetail({ data, onClose, onErr, onChanged }) {
  const { supplier, items, orders } = data;
  const [allItems, setAllItems] = useState(null);
  const [editingItems, setEditingItems] = useState(false);
  const [rows, setRows] = useState([]); // [{ inventory_item_id, last_purchase_price }]

  function startEdit() {
    setRows(items.map((i) => ({ inventory_item_id: i.item_id, last_purchase_price: i.last_purchase_price ?? '' })));
    api.invItems('?active=true').then(setAllItems).catch(onErr);
    setEditingItems(true);
  }

  function addRow() { setRows((r) => [...r, { inventory_item_id: '', last_purchase_price: '' }]); }
  function setRow(idx, patch) { setRows((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x))); }
  function removeRow(idx) { setRows((r) => r.filter((_, i) => i !== idx)); }

  async function saveItems() {
    const clean = rows
      .filter((r) => r.inventory_item_id)
      .map((r) => ({
        inventory_item_id: r.inventory_item_id,
        last_purchase_price: r.last_purchase_price === '' ? null : Number(r.last_purchase_price),
      }));
    try {
      await api.setSupplierItems(supplier.id, clean);
      setEditingItems(false);
      onChanged?.();
    } catch (e) { onErr(e); }
  }

  // מוצרים שכבר נבחרו — לסינון מהרשימה הנפתחת
  const chosen = new Set(rows.map((r) => r.inventory_item_id));

  return (
    <div className="card space-y-4 border-r-4 border-brand-burgundy mb-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-brand-burgundy text-lg">{supplier.name}</h3>
          <div className="text-sm text-brand-burgundy/70 space-y-0.5 mt-1">
            {supplier.contact_name && <div>איש קשר: {supplier.contact_name}</div>}
            {supplier.phone && <div dir="ltr" className="text-right">טלפון: {supplier.phone}</div>}
            {supplier.email && <div dir="ltr" className="text-right">מייל: {supplier.email}</div>}
            {supplier.preferred_channel && <div>אמצעי הזמנה: {SUPPLIER_CHANNEL[supplier.preferred_channel]}</div>}
            {supplier.order_notes && <div className="text-brand-burgundy/50">הערות: {supplier.order_notes}</div>}
          </div>
        </div>
        <button onClick={onClose} className="text-brand-burgundy/60 hover:underline text-sm">סגירה</button>
      </div>

      {/* מוצרים שהספק מספק */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold text-brand-burgundy">מוצרים שהספק מספק (סעיף 25.3)</h4>
          {!editingItems && <button onClick={startEdit} className="text-brand-burgundy hover:underline text-sm">עריכת מוצרים</button>}
        </div>

        {!editingItems ? (
          items.length === 0 ? (
            <p className="text-sm text-brand-burgundy/50">לא שויכו מוצרים לספק זה.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-brand-burgundy/60 border-b border-brand-cream-dark">
                <tr><th className="p-2 text-right">מוצר</th><th className="p-2 text-right">יחידה</th><th className="p-2 text-right">מחיר קנייה אחרון</th></tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.item_id} className="border-b border-brand-cream-dark/50">
                    <td className="p-2">{it.name}{!it.is_active && <span className="text-xs text-brand-burgundy/40 mr-1">(לא פעיל)</span>}</td>
                    <td className="p-2">{it.unit}</td>
                    <td className="p-2" dir="ltr">{it.last_purchase_price != null ? `₪${it.last_purchase_price}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : !allItems ? <p className="text-sm">טוען מוצרים...</p> : (
          <div className="space-y-2">
            {rows.map((r, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <select value={r.inventory_item_id} onChange={(e) => setRow(idx, { inventory_item_id: e.target.value })} className={`${inputCls} flex-1`}>
                  <option value="">— בחר מוצר —</option>
                  {allItems
                    .filter((i) => i.id === r.inventory_item_id || !chosen.has(i.id))
                    .map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                </select>
                <input type="number" step="any" value={r.last_purchase_price} placeholder="מחיר"
                  onChange={(e) => setRow(idx, { last_purchase_price: e.target.value })} className={`${inputCls} w-28`} dir="ltr" />
                <button type="button" onClick={() => removeRow(idx)} className="text-red-600 hover:underline text-sm px-1">הסר</button>
              </div>
            ))}
            <button type="button" onClick={addRow} className="btn-ghost text-sm">+ הוסף מוצר</button>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={saveItems} className="btn-primary">שמירת מוצרים</button>
              <button type="button" onClick={() => setEditingItems(false)} className="btn-ghost">ביטול</button>
            </div>
          </div>
        )}
      </div>

      {/* הזמנות רכש אחרונות */}
      <div>
        <h4 className="font-semibold text-brand-burgundy mb-2">הזמנות רכש אחרונות</h4>
        {(!orders || orders.length === 0) ? (
          <p className="text-sm text-brand-burgundy/50">אין הזמנות רכש לספק זה.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-brand-burgundy/60 border-b border-brand-cream-dark">
              <tr><th className="p-2 text-right">מס׳</th><th className="p-2 text-right">סטטוס</th><th className="p-2 text-right">אספקה צפויה</th><th className="p-2 text-right">משוער</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-brand-cream-dark/50">
                  <td className="p-2"><Link to={`/admin/purchase-orders/${o.id}`} className="text-brand-burgundy hover:underline">{o.po_number}</Link></td>
                  <td className="p-2"><Badge map={PO_STATUS} value={o.status} /></td>
                  <td className="p-2" dir="ltr">{o.expected_delivery_date || '—'}</td>
                  <td className="p-2" dir="ltr">{o.estimated_amount != null ? `₪${o.estimated_amount}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// עזרים
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
