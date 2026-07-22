import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconLink } from '../components/ActionIcon.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { Drawer, useRecordNav } from '../components/Drawer.jsx';
import { Badge, CUSTOMER_STATUS, ORDER_STATUS, PAYMENT_STATUS } from '../lib/status.jsx';

const HEADER_ALIASES = {
  givenName: ['given name', 'first name', 'שם פרטי'],
  familyName: ['family name', 'last name', 'שם משפחה'],
  fullName: ['full_name', 'full name', 'name', 'שם', 'שם מלא', 'לקוח'],
  phone: ['phone 1 - value', 'mobile phone', 'phone', 'טלפון', 'נייד', 'פלאפון'],
  email: ['e-mail 1 - value', 'email', 'e-mail', 'mail', 'מייל', 'אימייל', 'דואל', 'דוא"ל'],
  address: ['address 1 - formatted', 'address', 'כתובת'],
  city: ['address 1 - city', 'city', 'עיר'],
  notes: ['internal_notes', 'notes', 'הערות', 'הערה'],
  status: ['status', 'סטטוס', 'סטטוס '],
};

function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase();
}

function pick(row, key) {
  const aliases = HEADER_ALIASES[key] || [];
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function parseStatus(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return 'active';
  if (s.includes('חסום') || s === 'blocked') return 'blocked';
  if (s.includes('ממתין') || s === 'pending_approval') return 'pending_approval';
  if (s.includes('לא') || s === 'inactive') return 'inactive';
  return 'active';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((v) => String(v).trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.some((v) => String(v).trim())) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values) => {
    const raw = {};
    headers.forEach((header, index) => { raw[header] = values[index] || ''; });
    const fullName = pick(raw, 'fullName') || [pick(raw, 'givenName'), pick(raw, 'familyName')].filter(Boolean).join(' ');
    const address = [pick(raw, 'address'), pick(raw, 'city')].filter(Boolean).join(', ');
    return {
      full_name: fullName,
      phone: pick(raw, 'phone'),
      email: pick(raw, 'email'),
      address,
      status: parseStatus(pick(raw, 'status')),
      internal_notes: pick(raw, 'notes'),
    };
  }).filter((customer) => customer.full_name || customer.phone || customer.email || customer.address);
}

export default function AdminCustomers({ onAuthError, currentAdmin }) {
  // דיפ-לינק מהחיפוש הגלובלי (Ctrl+K): ?search= ממלא את סינון השם בטבלה
  const urlSearch = new URLSearchParams(window.location.search).get('search') || '';
  const [customers, setCustomers] = useState(null);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  // טוענים את כל הלקוחות; הסינון (חיפוש + סטטוס) נעשה בזיכרון ב-DataTable.
  const load = useCallback(() => {
    api.adminCustomers().then(setCustomers).catch(handleErr);
  }, [handleErr]);

  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      let savedId = form.id;
      if (form.id) {
        await api.updateCustomer(form.id, form);
      } else {
        const created = await api.createCustomer(form);
        savedId = created?.customer?.id ?? null;
      }
      setEditing(null);
      load();
      // אחרי שמירה: הפאנל עובר ממצב עריכה לתצוגת הכרטיס המעודכן.
      if (savedId) openDetail(savedId);
    } catch (e) { handleErr(e); }
  }

  async function setStatus(customer, status) {
    try {
      await api.updateCustomer(customer.id, { status });
      load();
      if (detail?.customer?.id === customer.id) openDetail(customer.id);
    } catch (e) { handleErr(e); }
  }

  async function deleteCustomer(customer) {
    if (!confirm(`למחוק לצמיתות את ${customer.full_name}?`)) return;
    try {
      await api.deleteCustomer(customer.id);
      if (detail?.customer?.id === customer.id) setDetail(null);
      load();
    } catch (e) { handleErr(e); }
  }

  // פותח את הפאנל במצב תצוגה. מנקה עריכה כדי שהתצוגה תגבר.
  async function openDetail(customerOrId) {
    const id = typeof customerOrId === 'string' ? customerOrId : customerOrId.id;
    setEditing(null);
    try { setDetail(await api.adminCustomer(id)); }
    catch (e) { handleErr(e); }
  }

  // פתיחת הפאנל ישירות במצב עריכה (מאייקון העריכה בשורה).
  function openEdit(customer) {
    setDetail(null);
    setEditing(customer);
  }

  // סגירת הפאנל לגמרי.
  function closeDrawer() {
    setDetail(null);
    setEditing(null);
  }

  // ביטול עריכה: אם נפתח מתוך כרטיס קיים חוזרים לתצוגה, אחרת סוגרים.
  function cancelEdit() {
    setEditing(null);
  }

  const drawerOpen = !!detail || !!editing;
  const drawerCustomer = detail?.customer;
  // דפדוף בין רשומות פעיל רק במצב תצוגה (לא בעריכה/יצירה).
  const nav = useRecordNav(openDetail, !editing && detail ? drawerCustomer.id : null);

  async function importCsv(file) {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new Error('לא נמצאו שורות לייבוא בקובץ.');
      const result = await api.importCustomers(rows);
      setImportResult(result);
      load();
    } catch (e) {
      handleErr(e);
    } finally {
      setImporting(false);
    }
  }

  const columns = [
    {
      key: 'full_name',
      label: 'שם',
      type: 'text',
      className: 'font-medium',
      render: (customer) => (
        <>
          <span className="text-brand-burgundy">{customer.full_name}</span>
          {customer.internal_notes && <div className="text-xs text-brand-burgundy/50 mt-1">{customer.internal_notes}</div>}
        </>
      ),
    },
    { key: 'phone', label: 'טלפון', type: 'text', dir: 'ltr', render: (c) => c.phone || '-' },
    { key: 'email', label: 'מייל', type: 'text', dir: 'ltr', render: (c) => c.email || '-' },
    { key: 'address', label: 'כתובת', type: 'text', render: (c) => c.address || '-' },
    {
      key: 'status',
      label: 'סטטוס',
      type: 'enum',
      map: CUSTOMER_STATUS,
      render: (c) => <Badge map={CUSTOMER_STATUS} value={c.status} />,
    },
    { key: 'created_at', label: 'נוצר', type: 'date', dir: 'ltr', render: (c) => formatDate(c.created_at) },
  ];

  return (
    <Page title="לקוחות" subtitle="כרטיסי לקוח, פרטי קשר, סטטוס והיסטוריית הזמנות">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <button onClick={() => openEdit({})} className="btn-primary">+ לקוח חדש</button>
          <Field label="ייבוא לקוחות CSV">
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              onChange={(e) => {
                importCsv(e.target.files?.[0]);
                e.target.value = '';
              }}
              className="block w-full text-sm text-brand-burgundy file:ml-3 file:rounded-lg file:border-0 file:bg-brand-burgundy file:px-3 file:py-2 file:text-brand-cream hover:file:bg-brand-burgundy/90 disabled:opacity-60"
            />
          </Field>
        </div>

        {importResult && <ImportResult result={importResult} />}

        <DataTable
          columns={columns}
          rows={customers}
          initialFilters={urlSearch ? { full_name: { term: urlSearch } } : undefined}
          empty="לא נמצאו לקוחות."
          rowClassName={(c) => `${c.status !== 'active' ? 'opacity-70' : ''} ${drawerCustomer?.id === c.id ? 'bg-brand-cream/40' : ''}`}
          onRowClick={openDetail}
          onVisibleRowsChange={nav.setVisibleRows}
        />
      </div>

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        onPrev={nav.onPrev}
        onNext={nav.onNext}
        position={nav.position}
        contentKey={editing ? `e${editing.id ?? 'new'}` : `v${drawerCustomer?.id ?? ''}`}
        eyebrow={editing ? (editing.id ? 'עריכת לקוח' : 'לקוח חדש') : 'כרטיס לקוח'}
        title={editing
          ? (editing.full_name || (editing.id ? 'עריכת לקוח' : 'לקוח חדש'))
          : (drawerCustomer?.full_name || 'טוען...')}
        subtitle={!editing ? drawerCustomer?.phone : undefined}
        footer={!editing && detail ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setEditing(drawerCustomer)} className="btn-primary">עריכה</button>
            {drawerCustomer.status !== 'active' && (
              <button onClick={() => setStatus(drawerCustomer, 'active')} className="btn-ghost">הפעלה</button>
            )}
            {drawerCustomer.status !== 'inactive' && (
              <button onClick={() => setStatus(drawerCustomer, 'inactive')} className="btn-ghost">השבתה</button>
            )}
            {drawerCustomer.status !== 'blocked' && (
              <button onClick={() => setStatus(drawerCustomer, 'blocked')} className="btn-ghost">חסימה</button>
            )}
            {canDelete && (
              <button onClick={() => deleteCustomer(drawerCustomer)} className="btn-ghost text-red-600 hover:bg-red-50">מחיקה</button>
            )}
          </div>
        ) : undefined}
      >
        {editing ? (
          <CustomerForm initial={editing} onSave={save} onCancel={cancelEdit} embedded />
        ) : detail ? (
          <CustomerDetailBody data={detail} />
        ) : (
          <p className="text-sm text-surface-muted">טוען...</p>
        )}
      </Drawer>
    </Page>
  );
}

function ImportResult({ result }) {
  const skippedRows = result.skipped_rows || [];

  return (
    <div className="card border-r-4 border-brand-gold space-y-2">
      <div className="font-bold text-brand-burgundy">ייבוא לקוחות הסתיים</div>
      <div className="text-sm text-brand-burgundy/70">
        נוספו {result.imported || 0} לקוחות. דולגו {result.skipped || 0} שורות.
      </div>
      {skippedRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-brand-burgundy/60 border-b border-brand-cream-dark">
              <tr>
                <th className="p-2 text-right">שורה</th>
                <th className="p-2 text-right">שם</th>
                <th className="p-2 text-right">טלפון</th>
                <th className="p-2 text-right">סיבה</th>
              </tr>
            </thead>
            <tbody>
              {skippedRows.slice(0, 10).map((row, index) => (
                <tr key={`${row.row}-${index}`} className="border-b border-brand-cream-dark/50">
                  <td className="p-2" dir="ltr">{row.row}</td>
                  <td className="p-2">{row.name || '-'}</td>
                  <td className="p-2" dir="ltr">{row.phone || '-'}</td>
                  <td className="p-2">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {skippedRows.length > 10 && (
            <div className="text-xs text-brand-burgundy/50 mt-2">מוצגות 10 שורות ראשונות מתוך {skippedRows.length}.</div>
          )}
        </div>
      )}
    </div>
  );
}

function CustomerForm({ initial, onSave, onCancel, embedded = false }) {
  const [form, setForm] = useState({
    id: initial.id,
    full_name: initial.full_name || '',
    phone: initial.phone || '',
    email: initial.email || '',
    address: initial.address || '',
    status: initial.status || 'active',
    internal_notes: initial.internal_notes || '',
  });
  const set = (key, value) => setForm((s) => ({ ...s, [key]: value }));
  const isEdit = !!form.id;

  function submit(e) {
    e.preventDefault();
    if (!form.full_name.trim()) return alert('חובה להזין שם מלא.');
    if (!form.phone.trim()) return alert('חובה להזין טלפון.');
    onSave({
      ...form,
      email: form.email || null,
      address: form.address || null,
      internal_notes: form.internal_notes || null,
    });
  }

  // בתוך פאנל צידי הכותרת כבר מופיעה בראש הפאנל, ואין צורך במעטפת כרטיס.
  return (
    <form onSubmit={submit} className={embedded ? 'space-y-3' : 'card space-y-3 border-r-4 border-brand-gold'}>
      {!embedded && <h3 className="font-bold text-brand-burgundy">{isEdit ? 'עריכת לקוח' : 'לקוח חדש'}</h3>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם מלא *">
          <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="טלפון *">
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="מייל">
          <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="סטטוס">
          <select value={form.status} onChange={(e) => set('status', e.target.value)} className={inputCls}>
            <option value="active">פעיל</option>
            <option value="pending_approval">ממתין לאישור</option>
            <option value="inactive">לא פעיל</option>
            <option value="blocked">חסום</option>
          </select>
        </Field>
      </div>
      <Field label="כתובת">
        <input value={form.address} onChange={(e) => set('address', e.target.value)} className={inputCls} />
      </Field>
      <Field label="הערות פנימיות">
        <textarea value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} className={inputCls} rows={2} />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

function InfoRow({ label, value, dir }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-surface-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-surface-body" dir={dir}>{value}</dd>
    </div>
  );
}

// גוף כרטיס הלקוח בתוך הפאנל: פרטי קשר + היסטוריית הזמנות.
// הכותרת (שם) והפעולות מוצגות במעטפת ה-Drawer.
function CustomerDetailBody({ data }) {
  const { customer, orders } = data;

  return (
    <div className="space-y-5">
      <Badge map={CUSTOMER_STATUS} value={customer.status} />

      <dl className="space-y-1.5 text-sm">
        <InfoRow label="טלפון" value={customer.phone} dir="ltr" />
        {customer.email && <InfoRow label="מייל" value={customer.email} dir="ltr" />}
        {customer.address && <InfoRow label="כתובת" value={customer.address} />}
        {customer.internal_notes && <InfoRow label="הערות" value={customer.internal_notes} />}
      </dl>

      <div>
        <h4 className="font-semibold text-ink mb-2">היסטוריית הזמנות</h4>
        {orders.length === 0 ? (
          <p className="text-sm text-brand-burgundy/50">אין הזמנות ללקוח זה.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-brand-burgundy/60 border-b border-brand-cream-dark">
                <tr>
                  <th className="p-2 text-right">מספר</th>
                  <th className="p-2 text-right">שבת</th>
                  <th className="p-2 text-right">סטטוס</th>
                  <th className="p-2 text-right">תשלום</th>
                  <th className="p-2 text-right">סכום</th>
                  <th className="p-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-brand-cream-dark/50">
                    <td className="p-2 font-medium" dir="ltr">{order.order_number}</td>
                    <td className="p-2">{order.shabbatot?.parasha || '-'} {order.shabbatot?.gregorian_date ? `(${formatShortDate(order.shabbatot.gregorian_date)})` : ''}</td>
                    <td className="p-2"><Badge map={ORDER_STATUS} value={order.order_status} /></td>
                    <td className="p-2"><Badge map={PAYMENT_STATUS} value={order.payment_status} /></td>
                    <td className="p-2" dir="ltr">{order.final_amount != null ? `₪${order.final_amount}` : '-'}</td>
                    <td className="p-2">
                      <ActionIconLink as={Link} to={`/admin/orders/${order.id}`} icon="open" label="פתיחה" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const inputCls = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm text-brand-burgundy/70 block mb-1">{label}</span>
      {children}
    </label>
  );
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('he-IL');
}

function formatShortDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
