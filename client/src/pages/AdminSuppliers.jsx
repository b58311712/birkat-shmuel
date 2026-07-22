import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { Drawer, useRecordNav } from '../components/Drawer.jsx';
import { ACTIVE_STATUS, Badge, SUPPLIER_CHANNEL, PO_STATUS } from '../lib/status.jsx';
import PriceInput from '../components/PriceInput.jsx';
import { formatWithVat } from '../lib/vat.js';

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
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  // טוענים את כל הספקים; הסינון (כולל סטטוס פעיל) נעשה בזיכרון ב-DataTable.
  const load = useCallback(() => {
    api.suppliers().then(setList).catch(handleErr);
  }, [handleErr]);

  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateSupplier(form.id, form);
      else await api.createSupplier(form);
      setEditing(null);
      load();
      // אם ערכנו ספק שהכרטיס שלו פתוח - מרעננים את התצוגה בפאנל.
      if (form.id && detail?.supplier?.id === form.id) openDetail({ id: form.id });
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
    setEditing(null);
    try { setDetail(await api.supplier(s.id)); }
    catch (e) { handleErr(e); }
  }

  function openEdit(s) { setDetail(null); setEditing(s); }
  function closeDrawer() { setDetail(null); setEditing(null); }

  const drawerOpen = !!detail || !!editing;
  const supplier = detail?.supplier;
  const nav = useRecordNav(openDetail, !editing && detail ? supplier.id : null);

  const columns = [
    {
      key: 'name',
      label: 'שם ספק',
      type: 'text',
      className: 'font-medium',
      render: (s) => <span className="text-brand-burgundy">{s.name}</span>,
    },
    { key: 'contact_name', label: 'איש קשר', type: 'text' },
    { key: 'phone', label: 'טלפון', type: 'text', dir: 'ltr' },
    {
      key: 'preferred_channel',
      label: 'אמצעי הזמנה',
      type: 'enum',
      options: Object.entries(SUPPLIER_CHANNEL).map(([value, label]) => ({ value, label })),
      render: (s) => SUPPLIER_CHANNEL[s.preferred_channel] || '—',
    },
    {
      key: 'is_active',
      label: 'סטטוס',
      type: 'boolean',
      trueLabel: 'פעיל',
      falseLabel: 'לא פעיל',
      render: (s) => <Badge map={ACTIVE_STATUS} value={s.is_active ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <Page title="ניהול ספקים" subtitle="כרטיס ספק, פרטי קשר ומוצרים שהספק מספק">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button onClick={() => openEdit({})} className="btn-primary">+ ספק חדש</button>
        <Link to="/admin/purchase-orders" className="btn-ghost">הזמנות רכש ←</Link>
      </div>

      <DataTable
        columns={columns}
        rows={list}
        empty="אין ספקים עדיין."
        rowClassName={(s) => `${!s.is_active ? 'opacity-50' : ''} ${supplier?.id === s.id ? 'bg-brand-cream/40' : ''}`}
        onRowClick={openDetail}
        onVisibleRowsChange={nav.setVisibleRows}
      />

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        onPrev={nav.onPrev}
        onNext={nav.onNext}
        position={nav.position}
        contentKey={editing ? `e${editing.id ?? 'new'}` : `v${supplier?.id ?? ''}`}
        width="lg"
        eyebrow={editing ? (editing.id ? 'עריכת ספק' : 'ספק חדש') : 'כרטיס ספק'}
        title={editing ? (editing.name || (editing.id ? 'עריכת ספק' : 'ספק חדש')) : (supplier?.name || 'טוען...')}
        footer={!editing && detail ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setEditing(supplier)} className="btn-primary">עריכה</button>
            <button onClick={() => toggleActive(supplier)} className="btn-ghost">{supplier.is_active ? 'השבתה' : 'הפעלה'}</button>
            {canDelete && (
              <button onClick={() => deleteSupplier(supplier)} className="btn-ghost text-red-600 hover:bg-red-50">מחיקה</button>
            )}
          </div>
        ) : undefined}
      >
        {editing ? (
          <SupplierForm initial={editing} onSave={save} onCancel={() => setEditing(null)} embedded />
        ) : detail ? (
          <SupplierDetailBody data={detail} onErr={handleErr} onChanged={() => openDetail(detail.supplier)} />
        ) : (
          <p className="text-sm text-surface-muted">טוען...</p>
        )}
      </Drawer>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// טופס כרטיס ספק (סעיף 27.1)
// ---------------------------------------------------------------------------
function SupplierForm({ initial, onSave, onCancel, embedded = false }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    contact_name: initial.contact_name || '',
    phone: initial.phone || '',
    email: initial.email || '',
    preferred_channel: initial.preferred_channel || '',
    order_notes: initial.order_notes || '',
    default_price_includes_vat: initial.default_price_includes_vat || false,
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם ספק.');
    onSave({ ...f, preferred_channel: f.preferred_channel || null });
  }

  return (
    <form onSubmit={submit} className={embedded ? 'space-y-3' : 'card space-y-3 border-r-4 border-brand-gold mb-4'}>
      {!embedded && <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת ספק' : 'ספק חדש'}</h3>}
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
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.default_price_includes_vat} onChange={(e) => set('default_price_includes_vat', e.target.checked)} />
        הספק נוקב מחירים כולל מע"מ (ברירת מחדל להזנת מחיר)
      </label>
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
function SupplierDetailBody({ data, onErr, onChanged }) {
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge map={ACTIVE_STATUS} value={supplier.is_active ? 'active' : 'inactive'} />
      </div>
      <div className="text-sm text-brand-burgundy/70 space-y-0.5">
        {supplier.contact_name && <div>איש קשר: {supplier.contact_name}</div>}
        {supplier.phone && <div dir="ltr" className="text-right">טלפון: {supplier.phone}</div>}
        {supplier.email && <div dir="ltr" className="text-right">מייל: {supplier.email}</div>}
        {supplier.preferred_channel && <div>אמצעי הזמנה: {SUPPLIER_CHANNEL[supplier.preferred_channel]}</div>}
        {supplier.order_notes && <div className="text-brand-burgundy/50">הערות: {supplier.order_notes}</div>}
      </div>

      {/* מוצרים שהספק מספק */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold text-brand-burgundy">מוצרים שהספק מספק</h4>
          {!editingItems && <button onClick={startEdit} className="text-brand-burgundy hover:underline text-sm">עריכת מוצרים</button>}
        </div>

        {!editingItems ? (
          items.length === 0 ? (
            <p className="text-sm text-brand-burgundy/50">לא שויכו מוצרים לספק זה.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-brand-burgundy/60 border-b border-brand-cream-dark">
                <tr><th className="p-2 text-right">מוצר</th><th className="p-2 text-right">יחידה</th><th className="p-2 text-right">מחיר קנייה אחרון (כולל מע"מ)</th></tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.item_id} className="border-b border-brand-cream-dark/50">
                    <td className="p-2">{it.name}{!it.is_active && <span className="text-xs text-brand-burgundy/40 mr-1">(לא פעיל)</span>}</td>
                    <td className="p-2">{it.unit}</td>
                    <td className="p-2" dir="ltr">
                      {formatWithVat(it.last_purchase_price, { exempt: it.vat_exempt })}
                      {it.vat_exempt && <span className="text-xs text-brand-burgundy/40 mr-1">(פטור)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : !allItems ? <p className="text-sm">טוען מוצרים...</p> : (
          <div className="space-y-3">
            {rows.map((r, idx) => {
              const rowItem = allItems.find((i) => i.id === r.inventory_item_id);
              return (
              <div key={idx} className="flex gap-2 items-start">
                <select value={r.inventory_item_id} onChange={(e) => setRow(idx, { inventory_item_id: e.target.value })} className={`${inputCls} flex-1`}>
                  <option value="">— בחר מוצר —</option>
                  {allItems
                    .filter((i) => i.id === r.inventory_item_id || !chosen.has(i.id))
                    .map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                </select>
                <div className="w-40">
                  <PriceInput
                    value={r.last_purchase_price}
                    onChange={(base) => setRow(idx, { last_purchase_price: base ?? '' })}
                    exempt={rowItem?.vat_exempt || false}
                    defaultIncludesVat={supplier.default_price_includes_vat || false}
                    className={inputCls}
                    placeholder="מחיר"
                  />
                </div>
                <button type="button" onClick={() => removeRow(idx)} className="text-red-600 hover:underline text-sm px-1 pt-2">הסר</button>
              </div>
            );
            })}
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
