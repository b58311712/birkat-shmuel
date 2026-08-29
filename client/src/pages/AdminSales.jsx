import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { Drawer, useRecordNav } from '../components/Drawer.jsx';
import OrderPaymentsPanel from '../components/OrderPaymentsPanel.jsx';
import CustomerPicker from '../components/CustomerPicker.jsx';
import { Badge, PAYMENT_STATUS, PAYMENT_METHOD, ORDER_STATUS } from '../lib/status.jsx';
import { formatInventoryQuantity } from '../lib/inventoryPackages.js';

// מכירת מוצרים מהמלאי ללקוח (מיגרציה 55, סעיף 38).
//
// המכירה היא הזמנה עצמאית שאינה משויכת למועד, וכל תוכנה שורות מלאי. מבחינת
// המערכת היא שורת orders, ולכן הגבייה כאן היא בדיוק אותה גבייה של כל הזמנה
// (OrderPaymentsPanel לפי order_id).
//
// שני הבדלים מהותיים ממסך האירועים:
//   המחיר אינו ניתן לעריכה - הוא מחיר העלות של הפריט כולל מע"מ, בלי רווח,
//   ולכן שדה העלות כאן הוא לקריאה בלבד ומגיע מהשרת.
//   המלאי יורד מיד בשמירה ולא בניכוי נפרד, והשרת חוסם כשאין מספיק.

const inputCls = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none';

const shekel = (n) => `${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
const today = () => new Date().toISOString().slice(0, 10);

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-brand-burgundy/70">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-surface-muted">{hint}</span>}
    </label>
  );
}

export default function AdminSales({ onAuthError, currentAdmin }) {
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);   // מכירה מלאה מהשרת
  const [creating, setCreating] = useState(false);
  const canDelete = currentAdmin?.role === 'developer';

  // מחזיר true תמיד: "השגיאה טופלה, אין להתריע עליה שוב". זה החוזה של
  // OrderPaymentsPanel, שמתריע בעצמו רק כשהמטפל מחזיר false.
  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
    return true;
  }, [onAuthError]);

  const load = useCallback(() => {
    api.sales().then(setList).catch(handleErr);
  }, [handleErr]);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (row) => {
    setCreating(false);
    try { setDetail(await api.sale(row.id)); }
    catch (e) { handleErr(e); }
  }, [handleErr]);

  // רענון הפאנל אחרי פעולה שמשנה את המכירה, יחד עם הרשימה מאחוריו.
  const refresh = useCallback(async () => {
    if (detail?.sale?.id) {
      try { setDetail(await api.sale(detail.sale.id)); }
      catch (e) { handleErr(e); }
    }
    load();
  }, [detail?.sale?.id, handleErr, load]);

  async function create(payload) {
    try {
      const { sale } = await api.createSale(payload);
      setCreating(false);
      load();
      openDetail({ id: sale.id });
    } catch (e) { handleErr(e); }
  }

  async function cancelSale(sale) {
    if (!confirm(`לבטל את מכירה ${sale.order_number}? המלאי יוחזר לכמות שלפני המכירה.`)) return;
    try { await api.cancelSale(sale.id); refresh(); }
    catch (e) { handleErr(e); }
  }

  async function removeSale(sale) {
    if (!confirm(`למחוק לצמיתות את מכירה ${sale.order_number}? המלאי יוחזר.`)) return;
    try { await api.deleteSale(sale.id); setDetail(null); load(); }
    catch (e) { handleErr(e); }
  }

  const nav = useRecordNav(openDetail, detail?.sale?.id || null);

  const columns = [
    { key: 'order_number', label: 'מספר', type: 'text', className: 'font-mono text-xs font-bold', dir: 'ltr' },
    { key: 'sale_date', label: 'תאריך', type: 'date' },
    {
      key: 'customer_name',
      label: 'לקוח',
      type: 'text',
      className: 'font-medium',
      render: (r) => (
        <div className="flex flex-col items-start">
          <span className="text-brand-burgundy">{r.customer_name || '-'}</span>
          {r.customer_phone && <span className="text-xs text-surface-muted" dir="ltr">{r.customer_phone}</span>}
        </div>
      ),
    },
    { key: 'items_count', label: 'פריטים', type: 'number' },
    {
      key: 'final_amount', label: 'סכום', type: 'number',
      className: 'tabular-nums font-bold', render: (r) => shekel(r.final_amount),
    },
    {
      key: 'paid_amount', label: 'שולם', type: 'number',
      className: 'tabular-nums text-surface-muted', render: (r) => shekel(r.paid_amount),
    },
    {
      key: 'balance', label: 'יתרה', type: 'number',
      className: 'tabular-nums',
      render: (r) => (
        <span className={r.balance > 0.001 ? 'font-bold text-red-700' : 'text-surface-muted'}>
          {shekel(r.balance)}
        </span>
      ),
    },
    {
      key: 'payment_status', label: 'תשלום', type: 'enum', map: PAYMENT_STATUS,
      render: (r) => <Badge map={PAYMENT_STATUS} value={r.payment_status} />,
    },
    {
      key: 'order_status', label: 'סטטוס', type: 'enum', map: ORDER_STATUS,
      render: (r) => <Badge map={ORDER_STATUS} value={r.order_status} />,
    },
  ];

  return (
    <Page
      title="מכירת מוצרים"
      subtitle="מכירת פריטי מלאי ללקוח במחיר העלות, וניהול הגבייה"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={() => { setDetail(null); setCreating(true); }} className="btn-primary">+ מכירה חדשה</button>
      </div>

      <DataTable
        columns={columns}
        rows={list}
        empty="לא נרשמו מכירות."
        rowClassName={(r) => (r.order_status === 'cancelled' ? 'opacity-50' : '')}
        onRowClick={openDetail}
        onVisibleRowsChange={nav.setVisibleRows}
      />

      <Drawer
        open={creating}
        onClose={() => setCreating(false)}
        eyebrow="מכירת מוצרים"
        title="מכירה חדשה"
        width="3xl"
      >
        {creating && <SaleCreateForm onSave={create} onCancel={() => setCreating(false)} onErr={handleErr} />}
      </Drawer>

      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        eyebrow="מכירת מוצרים"
        title={detail ? `מכירה ${detail.sale.order_number}` : ''}
        subtitle={detail ? `${detail.customer?.full_name || '-'} · ${detail.sale.sale_date}` : ''}
        width="4xl"
        onPrev={nav.onPrev}
        onNext={nav.onNext}
        position={nav.position}
        contentKey={detail?.sale?.id}
        footer={detail && (
          <div className="flex flex-wrap gap-2">
            {detail.sale.order_status !== 'cancelled' && (
              <button onClick={() => cancelSale(detail.sale)} className="btn-ghost text-sm text-red-700">
                ביטול המכירה והחזרת המלאי
              </button>
            )}
            {canDelete && (
              <button onClick={() => removeSale(detail.sale)} className="btn-ghost text-sm text-red-700">מחיקה</button>
            )}
          </div>
        )}
      >
        {detail && <SaleDetailBody data={detail} onErr={handleErr} onChanged={refresh} />}
      </Drawer>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// טופס יצירה: פרטי המכירה + שורות המוצרים, בשמירה אחת
// ---------------------------------------------------------------------------
// היצירה כוללת את השורות במכוון: המלאי יורד ביצירה, ומכירה בלי מוצרים אינה
// מסמך שיש בו טעם.
function SaleCreateForm({ onSave, onCancel, onErr }) {
  const [f, setF] = useState({
    customer_id: '', sale_date: today(), preferred_payment_method: 'cash',
    contact_name: '', contact_phone: '', notes: '',
  });
  const [lines, setLines] = useState([]);
  const [customers, setCustomers] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.adminCustomers('?status=active').then(setCustomers).catch(onErr);
  }, [onErr]);

  const set = (patch) => setF((s) => ({ ...s, ...patch }));

  async function submit(e) {
    e.preventDefault();
    if (!f.customer_id) return alert('יש לבחור לקוח.');
    if (lines.length === 0) return alert('יש להוסיף לפחות מוצר אחד.');
    setBusy(true);
    try { await onSave({ ...f, lines }); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="לקוח *">
          <CustomerPicker
            customers={customers}
            value={f.customer_id}
            onChange={(id) => set({ customer_id: id })}
            ariaLabel="לקוח"
            inputClassName={inputCls}
          />
        </Field>
        <Field label="תאריך המכירה *">
          <input type="date" value={f.sale_date} onChange={(e) => set({ sale_date: e.target.value })} className={inputCls} />
        </Field>
        <Field label="אמצעי תשלום">
          <select value={f.preferred_payment_method} onChange={(e) => set({ preferred_payment_method: e.target.value })} className={inputCls}>
            {Object.entries(PAYMENT_METHOD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="הערות">
          <input value={f.notes} onChange={(e) => set({ notes: e.target.value })} className={inputCls} />
        </Field>
      </div>

      <SaleLinesEditor lines={lines} setLines={setLines} onErr={onErr} />

      <div className="flex gap-2 border-t border-brand-cream-dark pt-3">
        <button type="submit" disabled={busy} className="btn-primary">שמירה וניכוי מהמלאי</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// פאנל המכירה: פרטים, מוצרים, גבייה
// ---------------------------------------------------------------------------
function SaleDetailBody({ data, onErr, onChanged }) {
  const { sale, customer, lines, summary } = data;
  const cancelled = sale.order_status === 'cancelled';

  return (
    <div className="space-y-4">
      {cancelled && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          המכירה בוטלה והמלאי הוחזר. הסכומים והתשלומים נשמרו לצורך מסלול ההחזר.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat label="לתשלום" value={shekel(summary.final)} />
        <Stat label="שולם" value={shekel(summary.paid)} tone="green" />
        <Stat label="יתרה" value={shekel(summary.balance)} tone={summary.balance > 0.001 ? 'red' : null} />
        <Stat label="פריטים" value={lines.length} />
      </div>

      <SaleDetailsSection sale={sale} customer={customer} onErr={onErr} onChanged={onChanged} />
      <SaleLinesSection sale={sale} lines={lines} disabled={cancelled} onErr={onErr} onChanged={onChanged} />

      <OrderPaymentsPanel order={sale} onError={onErr} onChanged={onChanged} />
    </div>
  );
}

function Stat({ label, value, tone }) {
  const cls = tone === 'green' ? 'bg-green-50 text-green-700'
    : tone === 'red' ? 'bg-red-50 text-red-700'
      : 'bg-brand-cream/50 text-brand-burgundy';
  return (
    <div className={`rounded-xl p-3 ${cls}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="font-extrabold tabular-nums">{value}</div>
    </div>
  );
}

function SaleDetailsSection({ sale, customer, onErr, onChanged }) {
  const [f, setF] = useState({
    sale_date: sale.sale_date || today(),
    preferred_payment_method: sale.preferred_payment_method || 'cash',
    notes: sale.notes || '',
  });
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try { await api.updateSale(sale.id, f); onChanged(); }
    catch (e2) { onErr(e2); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border border-brand-cream-dark p-3">
      <h4 className="text-sm font-bold text-brand-burgundy">פרטי המכירה</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="לקוח">
          <div className={`${inputCls} bg-brand-cream/30`}>{customer?.full_name || '-'}</div>
        </Field>
        <Field label="תאריך">
          <input type="date" value={f.sale_date} onChange={(e) => setF((s) => ({ ...s, sale_date: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="אמצעי תשלום">
          <select value={f.preferred_payment_method}
            onChange={(e) => setF((s) => ({ ...s, preferred_payment_method: e.target.value }))} className={inputCls}>
            {Object.entries(PAYMENT_METHOD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>
      <Field label="הערות">
        <input value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} className={inputCls} />
      </Field>
      <button type="submit" disabled={busy} className="btn-secondary text-sm">שמירת פרטים</button>
    </form>
  );
}

// עריכת המוצרים אחרי היצירה. השרת מסנכרן את המלאי להפרש בלבד, ולכן שינוי כמות
// מנכה או מחזיר רק את הדלתא.
function SaleLinesSection({ sale, lines, disabled, onErr, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [busy, setBusy] = useState(false);

  function startEdit() {
    setDraft(lines.map((l) => ({
      inventory_item_id: l.inventory_item_id,
      quantity: l.quantity,
      unit_id: l.unit_id || '',
      unit_cost: l.unit_cost,
      note: l.note || '',
      item_name: l.item_name_snapshot,
    })));
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    try {
      await api.setSaleLines(sale.id, draft);
      setEditing(false);
      onChanged();
    } catch (e) { onErr(e); }
    finally { setBusy(false); }
  }

  if (editing) {
    return (
      <div className="space-y-3 rounded-lg border border-brand-cream-dark p-3">
        <SaleLinesEditor lines={draft} setLines={setDraft} onErr={onErr} />
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="btn-primary text-sm">שמירה וסנכרון המלאי</button>
          <button onClick={() => setEditing(false)} className="btn-ghost text-sm">ביטול</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand-cream-dark p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-brand-burgundy">מוצרים</h4>
        {!disabled && <button onClick={startEdit} className="btn-ghost text-sm">עריכת מוצרים</button>}
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-surface-muted">אין מוצרים במכירה.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-surface-muted">
            <tr>
              <th className="p-2 text-right">פריט</th>
              <th className="p-2 text-right">כמות</th>
              <th className="p-2 text-right">עלות ליחידה</th>
              <th className="p-2 text-right">סה"כ</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-brand-cream-dark">
                <td className="p-2 font-medium">
                  {l.item_name_snapshot}
                  {l.note && <span className="text-xs text-surface-muted"> · {l.note}</span>}
                </td>
                <td className="p-2 tabular-nums">
                  {Number(l.quantity)} {l.units?.name || l.inventory_items?.unit || ''}
                </td>
                <td className="p-2 tabular-nums">{shekel(l.unit_cost)}</td>
                <td className="p-2 font-bold tabular-nums">{shekel(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-brand-cream-dark">
              <td className="p-2 font-bold" colSpan={3}>סה"כ מוצרים (כולל מע"מ)</td>
              <td className="p-2 font-extrabold tabular-nums">{shekel(sale.inventory_lines_amount)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// עורך שורות המוצרים
// ---------------------------------------------------------------------------
// העלות אינה נערכת: המחיר הוא מחיר העלות של הפריט כולל מע"מ, בלי רווח. השרת
// מחשב אותו מחדש בכל שמירה, והתצוגה כאן היא תצוגה מקדימה בלבד (item-cost).
function SaleLinesEditor({ lines, setLines, onErr }) {
  const [items, setItems] = useState([]);
  const [costs, setCosts] = useState({});   // "itemId|unitId" -> { unit_cost, item, warning, conversions }

  useEffect(() => {
    api.invItems('?active=true').then(setItems).catch(onErr);
  }, [onErr]);

  // רק פריטים המנוהלים ככמות במלאי. רכש ישיר לאירוע מוחזק במלאי אפס
  // (מיגרציה 50) ולכן אינו ניתן למכירה, והשרת גם דוחה אותו.
  const sellable = useMemo(
    () => (items || []).filter((i) => i.procurement_type !== 'direct_event'),
    [items],
  );
  const itemById = useMemo(() => Object.fromEntries(sellable.map((i) => [i.id, i])), [sellable]);

  const costKey = (l) => `${l.inventory_item_id}|${l.unit_id || ''}`;

  // טעינת העלות והמלאי הזמין לכל צירוף פריט+יחידה שנבחר.
  useEffect(() => {
    for (const l of lines) {
      if (!l.inventory_item_id) continue;
      const key = costKey(l);
      if (costs[key]) continue;
      api.saleItemCost(l.inventory_item_id, l.unit_id || null)
        .then((res) => setCosts((c) => ({ ...c, [key]: res })))
        .catch(() => setCosts((c) => ({ ...c, [key]: { unit_cost: null, warning: 'load_failed' } })));
    }
  }, [lines, costs]);

  const setLine = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { inventory_item_id: '', quantity: 1, unit_id: '', note: '' }]);
  const removeLine = (idx) => setLines((ls) => ls.filter((_, i) => i !== idx));

  function pickItem(idx, itemId) {
    const item = itemById[itemId];
    setLine(idx, { inventory_item_id: itemId, unit_id: item?.unit_id || '' });
  }

  const total = lines.reduce((s, l) => {
    const c = costs[costKey(l)];
    return s + (Number(l.quantity || 0) * Number(c?.unit_cost || 0));
  }, 0);

  return (
    <section className="space-y-2">
      <h4 className="text-sm font-bold text-brand-burgundy">מוצרים למכירה</h4>
      <p className="text-xs text-surface-muted">
        המחיר הוא מחיר העלות האחרון של הפריט כולל מע"מ, בלי רווח, ואינו ניתן לעריכה.
        הכמות יורדת מהמלאי בשמירה.
      </p>

      {lines.map((l, idx) => {
        const info = costs[costKey(l)];
        const item = itemById[l.inventory_item_id];
        const available = info?.item?.quantity_on_hand ?? item?.quantity_on_hand;
        // ההשוואה ביחידת הבסיס, לפי הפקטור שהשרת החזיר. זו אזהרה מקדימה בלבד:
        // האכיפה האמיתית היא ב-RPC, שנועל את הפריט ובודק מול הכמות העדכנית.
        const overStock = available != null && info?.units_per_entry != null
          && Number(l.quantity || 0) > 0
          && Number(l.quantity || 0) * Number(info.units_per_entry) > Number(available);

        return (
          <div key={idx} className="flex flex-wrap items-end gap-2 rounded-lg border border-brand-cream-dark p-2">
            <div className="min-w-[12rem] flex-1">
              <span className="mb-1 block text-xs text-surface-muted">פריט</span>
              <select value={l.inventory_item_id} onChange={(e) => pickItem(idx, e.target.value)} className={inputCls}>
                <option value="">- בחירה -</option>
                {sellable.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              {item && (
                <span className={`mt-1 block text-xs ${overStock ? 'font-bold text-red-700' : 'text-surface-muted'}`}>
                  במלאי: {formatInventoryQuantity(available, item)}
                  {overStock && ' - הכמות המבוקשת גדולה מהמלאי'}
                </span>
              )}
            </div>
            <div className="w-24">
              <span className="mb-1 block text-xs text-surface-muted">כמות</span>
              <input type="number" step="0.01" min="0" value={l.quantity}
                onChange={(e) => setLine(idx, { quantity: e.target.value })} className={inputCls} />
            </div>
            <div className="w-32">
              <span className="mb-1 block text-xs text-surface-muted">יחידה</span>
              <select value={l.unit_id || ''} onChange={(e) => setLine(idx, { unit_id: e.target.value })} className={inputCls}>
                <option value={item?.unit_id || ''}>{item?.unit || 'יחידת בסיס'}</option>
                {(info?.conversions || []).map((c) => (
                  <option key={c.unit_id} value={c.unit_id}>{c.unit_name}</option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <span className="mb-1 block text-xs text-surface-muted">עלות ליחידה</span>
              <div className={`${inputCls} bg-brand-cream/30 tabular-nums`}>
                {info?.unit_cost != null ? shekel(info.unit_cost) : '-'}
              </div>
            </div>
            <div className="w-28">
              <span className="mb-1 block text-xs text-surface-muted">סה"כ</span>
              <div className={`${inputCls} bg-brand-cream/30 font-bold tabular-nums`}>
                {info?.unit_cost != null ? shekel(Number(l.quantity || 0) * Number(info.unit_cost)) : '-'}
              </div>
            </div>
            <button type="button" onClick={() => removeLine(idx)} className="px-1 pb-2 text-sm text-red-600 hover:underline">
              הסר
            </button>
            {info?.warning && (
              <p className="w-full text-xs font-bold text-red-700">{costWarning(info.warning)}</p>
            )}
          </div>
        );
      })}

      <div className="flex items-center justify-between">
        <button type="button" onClick={addLine} className="btn-ghost text-sm">+ הוסף מוצר</button>
        <span className="text-sm font-bold text-brand-burgundy tabular-nums">
          סה"כ: {shekel(total)} <span className="font-normal text-surface-muted">(כולל מע"מ)</span>
        </span>
      </div>
    </section>
  );
}

function costWarning(warning) {
  if (warning === 'missing_price') return 'לפריט אין מחיר עלות אחרון. יש לעדכן את המחיר בכרטיס הפריט.';
  if (warning === 'missing_conversion') return 'חסרה המרת יחידות לפריט מיחידת ההזנה ליחידת הבסיס.';
  if (warning === 'item_not_found') return 'הפריט לא נמצא.';
  return 'לא ניתן לחשב את העלות של הפריט.';
}
