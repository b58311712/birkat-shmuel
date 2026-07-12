import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { ACTIVE_STATUS, Badge } from '../lib/status.jsx';

// ניהול מלאי CRUD (סעיף 25). מסך ניהול גלובלי: פריטי מלאי, קטגוריות, שינוי ידני.
// דוח החוסרים והפחתה לאחר הכנות נמצאים בתיק שבת (לשונית מלאי).

// סיבות לשינוי ידני (סעיף 25.5)
const ADJUST_REASONS = [
  { value: 'count_error', label: 'טעות ספירה' },
  { value: 'waste', label: 'בלאי' },
  { value: 'spoiled', label: 'מוצר שהתקלקל' },
  { value: 'unusual_use', label: 'שימוש חריג' },
  { value: 'return', label: 'החזרת מוצר' },
  { value: 'correction', label: 'תיקון מלאי' },
];
const REASON_LABEL = Object.fromEntries(ADJUST_REASONS.map((r) => [r.value, r.label]));

const MOVEMENT_LABEL = {
  shabbat_deduction: 'הפחתה לשבת',
  purchase_receipt: 'קבלת סחורה',
  manual_adjustment: 'שינוי ידני',
};

export default function AdminInventory({ onAuthError, currentAdmin }) {
  const [view, setView] = useState('items'); // items | categories
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  return (
    <Page title="ניהול מלאי" subtitle="פריטי מלאי, קטגוריות ושינוי ידני (סעיף 25)">
      <div className="flex gap-1 mb-5 border-b border-brand-cream-dark">
        {[['items', 'פריטי מלאי'], ['categories', 'קטגוריות']].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
              view === k ? 'border-brand-gold text-brand-burgundy' : 'border-transparent text-brand-burgundy/50 hover:text-brand-burgundy'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'items' && <ItemsManager onErr={handleErr} canDelete={canDelete} />}
      {view === 'categories' && <CategoriesManager onErr={handleErr} canDelete={canDelete} />}
    </Page>
  );
}

// ===========================================================================
// ניהול פריטי מלאי
// ===========================================================================
function ItemsManager({ onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [editing, setEditing] = useState(null);  // אובייקט פריט או {} = חדש
  const [adjusting, setAdjusting] = useState(null); // פריט לשינוי כמות
  const [history, setHistory] = useState(null);   // פריט להצגת תנועות
  const [filter, setFilter] = useState({ category_id: '', low_stock: false, active: 'true' });

  const loadRefs = useCallback(() => {
    api.invCategories('?active=true').then(setCategories).catch(() => {});
    api.invSuppliers('?active=true').then(setSuppliers).catch(() => {});
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filter.category_id) params.set('category_id', filter.category_id);
    if (filter.low_stock) params.set('low_stock', 'true');
    if (filter.active) params.set('active', filter.active);
    const q = params.toString();
    api.invItems(q ? `?${q}` : '').then(setList).catch(onErr);
  }, [filter, onErr]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateInvItem(form.id, form);
      else await api.createInvItem(form);
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
  }

  async function toggleActive(it) {
    try { await api.updateInvItem(it.id, { is_active: !it.is_active }); load(); }
    catch (e) { onErr(e); }
  }

  async function deleteItem(it) {
    if (!confirm(`למחוק לצמיתות את ${it.name}?`)) return;
    try { await api.deleteInvItem(it.id); load(); }
    catch (e) { onErr(e); }
  }

  async function submitAdjust(payload) {
    try {
      await api.adjustInvItem(adjusting.id, payload);
      setAdjusting(null);
      load();
    } catch (e) { onErr(e); }
  }

  async function openHistory(it) {
    try {
      const data = await api.invItem(it.id);
      setHistory({ item: data.item, movements: data.movements || [] });
    } catch (e) { onErr(e); }
  }

  if (!list) return <p>טוען...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ מוצר חדש</button>
        <Field label="קטגוריה">
          <select value={filter.category_id} onChange={(e) => setFilter((f) => ({ ...f, category_id: e.target.value }))} className={inputCls}>
            <option value="">— הכל —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="סטטוס">
          <select value={filter.active} onChange={(e) => setFilter((f) => ({ ...f, active: e.target.value }))} className={inputCls}>
            <option value="true">פעילים</option>
            <option value="false">לא פעילים</option>
            <option value="">הכל</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={filter.low_stock} onChange={(e) => setFilter((f) => ({ ...f, low_stock: e.target.checked }))} />
          מתחת למינימום בלבד
        </label>
      </div>

      {editing && (
        <ItemForm categories={categories} suppliers={suppliers} initial={editing}
          onSave={save} onCancel={() => setEditing(null)} onSuppliersChanged={loadRefs} onErr={onErr} />
      )}
      {adjusting && (
        <AdjustForm item={adjusting} onSubmit={submitAdjust} onCancel={() => setAdjusting(null)} />
      )}
      {history && (
        <HistoryPanel item={history.item} movements={history.movements} onClose={() => setHistory(null)} />
      )}

      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
          <thead className="bg-brand-burgundy text-brand-cream text-sm">
            <tr>
              <th className="p-3 text-right">מוצר</th>
              <th className="p-3 text-right">קטגוריה</th>
              <th className="p-3 text-right">יחידה</th>
              <th className="p-3 text-right">כמות</th>
              <th className="p-3 text-right">מינימום</th>
              <th className="p-3 text-right">ספק</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((it) => {
              const low = it.min_alert_quantity != null && Number(it.quantity_on_hand) < Number(it.min_alert_quantity);
              return (
                <tr key={it.id} className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${!it.is_active ? 'opacity-50' : ''}`}>
                  <td className="p-3 font-medium">
                    {it.name}
                    {it.is_packaging && <span className="text-xs text-brand-burgundy/50 mr-1">(אריזה)</span>}
                  </td>
                  <td className="p-3 text-sm">{it.category?.name || '—'}</td>
                  <td className="p-3 text-sm">{it.unit}</td>
                  <td className={`p-3 text-sm font-medium ${low ? 'text-red-600' : ''}`}>
                    {fmt(it.quantity_on_hand)}{low && ' ⚠'}
                  </td>
                  <td className="p-3 text-sm text-brand-burgundy/60">{it.min_alert_quantity != null ? fmt(it.min_alert_quantity) : '—'}</td>
                  <td className="p-3 text-sm text-brand-burgundy/60">{it.default_supplier?.name || '—'}</td>
                  <td className="p-3 text-sm"><Badge map={ACTIVE_STATUS} value={it.is_active ? 'active' : 'inactive'} /></td>
                  <td className="p-3 text-sm whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                    <ActionIconButton icon="adjust" label="שינוי כמות" onClick={() => setAdjusting(it)} />
                    <ActionIconButton icon="edit" label="עריכה" onClick={() => setEditing(it)} />
                    <ActionIconButton icon="history" label="תנועות" tone="muted" onClick={() => openHistory(it)} />
                    <ActionIconButton
                      icon={it.is_active ? 'deactivate' : 'activate'}
                      label={it.is_active ? 'השבתה' : 'הפעלה'}
                      tone="muted"
                      onClick={() => toggleActive(it)}
                    />
                    {canDelete && (
                      <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deleteItem(it)} />
                    )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-brand-burgundy/50">אין פריטי מלאי.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemForm({ categories, suppliers, initial, onSave, onCancel, onSuppliersChanged, onErr }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    category_id: initial.category_id || '',
    unit: initial.unit || '',
    quantity_on_hand: initial.quantity_on_hand ?? 0,
    min_alert_quantity: initial.min_alert_quantity ?? '',
    default_supplier_id: initial.default_supplier_id || '',
    last_purchase_price: initial.last_purchase_price ?? '',
    is_packaging: initial.is_packaging || false,
    notes: initial.notes || '',
  });
  const [newSupplier, setNewSupplier] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const isEdit = !!f.id;

  async function addSupplier() {
    if (!newSupplier.trim()) return;
    try {
      const { supplier } = await api.createInvSupplier({ name: newSupplier.trim() });
      setNewSupplier('');
      onSuppliersChanged?.();
      set('default_supplier_id', supplier.id);
    } catch (e) { onErr(e); }
  }

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם מוצר.');
    if (!f.unit.trim()) return alert('חובה להזין יחידת מידה.');
    const payload = {
      ...f,
      category_id: f.category_id || null,
      default_supplier_id: f.default_supplier_id || null,
      min_alert_quantity: f.min_alert_quantity === '' ? null : Number(f.min_alert_quantity),
      last_purchase_price: f.last_purchase_price === '' ? null : Number(f.last_purchase_price),
    };
    // בעריכה — הכמות משתנה רק דרך "שינוי כמות" המתועד, לא בטופס הכרטיס
    if (isEdit) delete payload.quantity_on_hand;
    else payload.quantity_on_hand = Number(f.quantity_on_hand) || 0;
    onSave(payload);
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{isEdit ? 'עריכת מוצר' : 'מוצר חדש'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם מוצר *">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="יחידת מידה * (ק״ג, ליטר, יחידה...)">
          <input value={f.unit} onChange={(e) => set('unit', e.target.value)} className={inputCls} />
        </Field>
        <Field label="קטגוריה">
          <select value={f.category_id} onChange={(e) => set('category_id', e.target.value)} className={inputCls}>
            <option value="">— ללא —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {!isEdit ? (
          <Field label="כמות קיימת התחלתית">
            <input type="number" step="any" value={f.quantity_on_hand} onChange={(e) => set('quantity_on_hand', e.target.value)} className={inputCls} dir="ltr" />
          </Field>
        ) : (
          <Field label="כמות קיימת">
            <div className="p-2 text-brand-burgundy/60 text-sm">{fmt(initial.quantity_on_hand)} {f.unit} — לשינוי השתמש ב״שינוי כמות״</div>
          </Field>
        )}
        <Field label="כמות מינימום להתראה">
          <input type="number" step="any" value={f.min_alert_quantity} onChange={(e) => set('min_alert_quantity', e.target.value)} className={inputCls} dir="ltr" placeholder="ללא" />
        </Field>
        <Field label="מחיר קנייה אחרון (₪)">
          <input type="number" step="any" value={f.last_purchase_price} onChange={(e) => set('last_purchase_price', e.target.value)} className={inputCls} dir="ltr" placeholder="לא ידוע" />
        </Field>
        <Field label="ספק ברירת מחדל">
          <select value={f.default_supplier_id} onChange={(e) => set('default_supplier_id', e.target.value)} className={inputCls}>
            <option value="">— ללא —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="הוספת ספק חדש">
          <div className="flex gap-1">
            <input value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} className={inputCls} placeholder="שם ספק" />
            <button type="button" onClick={addSupplier} className="btn-ghost whitespace-nowrap">הוסף</button>
          </div>
        </Field>
      </div>
      <Field label="הערות">
        <input value={f.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.is_packaging} onChange={(e) => set('is_packaging', e.target.checked)} />
        פריט אריזה (קופסה, תבנית, שקית) — סעיף 22.4
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

// שינוי ידני בכמות עם תיעוד (סעיף 25.5)
function AdjustForm({ item, onSubmit, onCancel }) {
  const [mode, setMode] = useState('set'); // set = כמות חדשה | delta = תוספת/הפחתה
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('count_error');
  const [note, setNote] = useState('');

  function submit(e) {
    e.preventDefault();
    if (value === '' || Number.isNaN(Number(value))) return alert('יש להזין כמות.');
    const payload = { reason, note };
    if (mode === 'set') payload.new_quantity = Number(value);
    else payload.delta = Number(value);
    onSubmit(payload);
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-burgundy">
      <h3 className="font-bold text-brand-burgundy">שינוי כמות — {item.name}</h3>
      <p className="text-sm text-brand-burgundy/60">כמות נוכחית: {fmt(item.quantity_on_hand)} {item.unit}</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('set')}
          className={`px-3 py-1.5 rounded-lg text-sm ${mode === 'set' ? 'bg-brand-gold text-brand-burgundy-dark' : 'bg-brand-cream text-brand-burgundy/70'}`}>
          קביעת כמות חדשה
        </button>
        <button type="button" onClick={() => setMode('delta')}
          className={`px-3 py-1.5 rounded-lg text-sm ${mode === 'delta' ? 'bg-brand-gold text-brand-burgundy-dark' : 'bg-brand-cream text-brand-burgundy/70'}`}>
          תוספת / הפחתה
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={mode === 'set' ? 'כמות חדשה' : 'שינוי (חיובי=תוספת, שלילי=הפחתה)'}>
          <input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} dir="ltr" autoFocus />
        </Field>
        <Field label="סיבה">
          <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
            {ADJUST_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="הערה">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">אישור השינוי</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

// היסטוריית תנועות של פריט (ביקורת — סעיף 25.5)
function HistoryPanel({ item, movements, onClose }) {
  return (
    <div className="card space-y-3 border-r-4 border-brand-cream-dark">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-brand-burgundy">תנועות מלאי — {item.name}</h3>
        <button onClick={onClose} className="text-brand-burgundy/60 hover:underline text-sm">סגירה</button>
      </div>
      {movements.length === 0 ? (
        <p className="text-sm text-brand-burgundy/50">אין תנועות רשומות.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-brand-burgundy/60 border-b border-brand-cream-dark">
              <tr>
                <th className="p-2 text-right">תאריך</th>
                <th className="p-2 text-right">סוג</th>
                <th className="p-2 text-right">שינוי</th>
                <th className="p-2 text-right">לפני</th>
                <th className="p-2 text-right">אחרי</th>
                <th className="p-2 text-right">סיבה</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-b border-brand-cream-dark/50">
                  <td className="p-2" dir="ltr">{new Date(m.created_at).toLocaleDateString('he-IL')}</td>
                  <td className="p-2">{MOVEMENT_LABEL[m.movement_type] || m.movement_type}</td>
                  <td className={`p-2 font-medium ${Number(m.quantity_delta) < 0 ? 'text-red-600' : 'text-green-700'}`} dir="ltr">
                    {Number(m.quantity_delta) > 0 ? '+' : ''}{fmt(m.quantity_delta)}
                  </td>
                  <td className="p-2" dir="ltr">{fmt(m.quantity_before)}</td>
                  <td className="p-2" dir="ltr">{fmt(m.quantity_after)}</td>
                  <td className="p-2 text-brand-burgundy/60">
                    {m.shabbatot?.parasha ? `שבת ${m.shabbatot.parasha}` : (REASON_LABEL[m.reason] || m.reason || '—')}
                    {m.note && <span className="text-brand-burgundy/40"> · {m.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// ניהול קטגוריות מלאי (סעיף 25.1)
// ===========================================================================
function CategoriesManager({ onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    api.invCategories().then(setList).catch(onErr);
  }, [onErr]);
  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateInvCategory(form.id, form);
      else await api.createInvCategory(form);
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
  }

  async function toggleActive(c) {
    try { await api.updateInvCategory(c.id, { is_active: !c.is_active }); load(); }
    catch (e) { onErr(e); }
  }

  async function deleteCategory(c) {
    if (!confirm(`למחוק לצמיתות את הקטגוריה ${c.name}?`)) return;
    try { await api.deleteInvCategory(c.id); load(); }
    catch (e) { onErr(e); }
  }

  if (!list) return <p>טוען...</p>;

  return (
    <div className="space-y-4">
      <button onClick={() => setEditing({})} className="btn-primary">+ קטגוריה חדשה</button>
      {editing && <CategoryForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}

      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
          <thead className="bg-brand-burgundy text-brand-cream text-sm">
            <tr>
              <th className="p-3 text-right">סדר</th>
              <th className="p-3 text-right">קטגוריה</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${!c.is_active ? 'opacity-50' : ''}`}>
                <td className="p-3 text-sm text-brand-burgundy/50">{c.display_order}</td>
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3 text-sm"><Badge map={ACTIVE_STATUS} value={c.is_active ? 'active' : 'inactive'} /></td>
                <td className="p-3 text-sm whitespace-nowrap">
                  <div className="flex flex-wrap gap-1">
                  <ActionIconButton icon="edit" label="עריכה" onClick={() => setEditing(c)} />
                  <ActionIconButton
                    icon={c.is_active ? 'deactivate' : 'activate'}
                    label={c.is_active ? 'השבתה' : 'הפעלה'}
                    tone="muted"
                    onClick={() => toggleActive(c)}
                  />
                  {canDelete && (
                    <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deleteCategory(c)} />
                  )}
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={4} className="p-6 text-center text-brand-burgundy/50">אין קטגוריות עדיין.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategoryForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    display_order: initial.display_order ?? 0,
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם קטגוריה.');
    onSave({ ...f, display_order: Number(f.display_order) || 0 });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת קטגוריה' : 'קטגוריה חדשה'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם קטגוריה *">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="סדר תצוגה">
          <input type="number" value={f.display_order} onChange={(e) => set('display_order', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

// ===========================================================================
// עזרים
// ===========================================================================
const inputCls = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm text-brand-burgundy/70 block mb-1">{label}</span>
      {children}
    </label>
  );
}

// מספר נקי: מסיר אפסים עודפים אחרי הנקודה (4.0000 -> 4, 2.5000 -> 2.5)
function fmt(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return n;
  return String(Number(num.toFixed(4)));
}
