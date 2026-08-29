import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { Badge, PO_STATUS, EMAIL_SEND_STATUS } from '../lib/status.jsx';
import PurchaseOrderLinkFields from '../components/PurchaseOrderLinkFields.jsx';
import PurchaseOrderLinesEditor, {
  emptyPurchaseOrderLine,
  useSupplierCatalog,
  purchaseOrderLinesTotal,
  validPurchaseOrderLines,
  buildPurchaseOrderLinesPayload,
  hasDirectEventLine,
} from '../components/PurchaseOrderLinesEditor.jsx';

// הזמנות רכש (סעיף 27.2-27.3): רשימה, סינון ויצירת הזמנה חדשה (טיוטה).
// פירוט/קבלת סחורה/תשלום נמצאים במסך הפירוט (/admin/purchase-orders/:id).

export default function AdminPurchaseOrders({ onAuthError, currentAdmin }) {
  const [list, setList] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [creating, setCreating] = useState(false);
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  // טוענים את כל הזמנות הרכש; הסינון (ספק/סטטוס) נעשה בזיכרון ב-DataTable.
  const load = useCallback(() => {
    api.purchaseOrders('').then(setList).catch(handleErr);
  }, [handleErr]);

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

  const columns = [
    {
      key: 'po_number',
      label: 'מס׳',
      type: 'text',
      className: 'font-medium',
      render: (po) => (
        <Link to={`/admin/purchase-orders/${po.id}`} className="text-brand-burgundy hover:underline">{po.po_number}</Link>
      ),
    },
    {
      key: 'supplier',
      label: 'ספק',
      type: 'enum',
      value: (po) => po.supplier_id || '',
      options: suppliers.map((s) => ({ value: s.id, label: s.name })),
      render: (po) => po.supplier?.name || '-',
    },
    {
      key: 'status',
      label: 'סטטוס',
      type: 'enum',
      map: PO_STATUS,
      render: (po) => <Badge map={PO_STATUS} value={po.status} />,
    },
    {
      key: 'shabbat',
      label: 'אירוע',
      type: 'text',
      render: (po) => po.shabbat
        ? `${po.shabbat.parasha} · ${po.shabbat.gregorian_date}`
        : '-',
    },
    {
      key: 'order',
      label: 'הזמנת לקוח',
      type: 'text',
      value: (po) => (po.order ? `#${po.order.order_number}` : ''),
      render: (po) => (po.order
        ? <Link to={`/admin/orders/${po.order.id}`} className="text-brand-burgundy hover:underline">#{po.order.order_number}</Link>
        : <span className="text-brand-burgundy/40">כל האירוע</span>),
    },
    {
      key: 'email_status',
      label: 'מייל לספק',
      type: 'enum',
      map: EMAIL_SEND_STATUS,
      value: (po) => po.email_status || '',
      render: (po) => (po.email_status
        ? <Badge map={EMAIL_SEND_STATUS} value={po.email_status} />
        : <span className="text-brand-burgundy/40">לא נשלח</span>),
    },
    { key: 'expected_delivery_date', label: 'אספקה צפויה', type: 'date', dir: 'ltr', render: (po) => po.expected_delivery_date || '-' },
    { key: 'estimated_amount', label: 'משוער (לפני מע"מ)', type: 'number', dir: 'ltr', render: (po) => (po.estimated_amount != null ? `₪${po.estimated_amount}` : '-') },
    { key: 'actual_amount', label: 'בפועל (לפני מע"מ)', type: 'number', dir: 'ltr', render: (po) => (po.actual_amount != null ? `₪${po.actual_amount}` : '-') },
    { key: 'created_at', label: 'נוצרה', type: 'date', dir: 'ltr', className: 'text-brand-burgundy/60', render: (po) => new Date(po.created_at).toLocaleDateString('he-IL') },
  ];

  return (
    <Page title="הזמנות רכש" subtitle="יצירת הזמנות לספקים, קבלת סחורה למלאי ותשלום">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button onClick={() => setCreating(true)} className="btn-primary">+ הזמנת רכש חדשה</button>
        <Link to="/admin/suppliers" className="btn-ghost">→ ניהול ספקים</Link>
      </div>

      {creating && (
        <CreatePurchaseOrder suppliers={suppliers} onCreated={onCreated} onCancel={() => setCreating(false)} onErr={handleErr} />
      )}

      <DataTable
        columns={columns}
        rows={list}
        empty="אין הזמנות רכש."
        actions={canDelete ? (po) => (
          <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deletePurchaseOrder(po)} />
        ) : undefined}
      />
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
  const [link, setLink] = useState({ shabbat_id: '', order_id: '' });
  const [lines, setLines] = useState([emptyPurchaseOrderLine()]);
  const [busy, setBusy] = useState(false);

  const catalog = useSupplierCatalog(supplierId, onErr);
  const { allItems } = catalog;
  const total = purchaseOrderLinesTotal(lines, allItems);

  async function submit(e) {
    e.preventDefault();
    if (!supplierId) return alert('חובה לבחור ספק.');
    const clean = validPurchaseOrderLines(lines, allItems);
    if (clean.length === 0) return alert('חובה להוסיף לפחות פריט אחד עם כמות.');
    if (hasDirectEventLine(clean, allItems) && !link.shabbat_id)
      return alert('מוצר ברכש ישיר מחייב בחירת אירוע.');
    setBusy(true);
    try {
      await api.createPurchaseOrder({
        supplier_id: supplierId,
        shabbat_id: link.shabbat_id || null,
        order_id: link.order_id || null,
        expected_delivery_date: expected || null,
        notes,
        lines: buildPurchaseOrderLinesPayload(clean, allItems),
      });
      onCreated();
    } catch (err) { onErr(err); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold mb-4">
      <h3 className="font-bold text-brand-burgundy">הזמנת רכש חדשה</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="ספק *">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
            <option value="">- בחר ספק -</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="תאריך אספקה צפוי">
          <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <PurchaseOrderLinkFields shabbatId={link.shabbat_id} orderId={link.order_id} onChange={setLink} />
      </div>

      <PurchaseOrderLinesEditor supplierId={supplierId} catalog={catalog} lines={lines} setLines={setLines} />

      <Field label="הערות">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} rows={2} />
      </Field>

      <div className="flex items-center justify-between border-t border-brand-cream-dark pt-3">
        <div className="font-semibold text-brand-burgundy">מחיר משוער כולל (כולל מע"מ): ₪{total.toFixed(2)}</div>
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
