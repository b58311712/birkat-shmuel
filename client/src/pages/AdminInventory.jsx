import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { DragHandle } from '../components/DragHandle.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { ACTIVE_STATUS, Badge } from '../lib/status.jsx';
import PriceInput from '../components/PriceInput.jsx';
import { formatWithVat } from '../lib/vat.js';

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
  const [view, setView] = useState('items'); // items | categories | units
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  return (
    <Page title="ניהול מלאי" subtitle="פריטי מלאי, קטגוריות, יחידות מידה ושינוי ידני">
      <div className="flex gap-1 mb-5 border-b border-brand-cream-dark">
        {[['items', 'פריטי מלאי'], ['categories', 'קטגוריות'], ['units', 'יחידות מידה']].map(([k, label]) => (
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
      {view === 'units' && <UnitsManager onErr={handleErr} canDelete={canDelete} />}
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
  const [units, setUnits] = useState([]);
  const [editing, setEditing] = useState(null);  // אובייקט פריט או {} = חדש
  const [adjusting, setAdjusting] = useState(null); // פריט לשינוי כמות
  const [history, setHistory] = useState(null);   // פריט להצגת תנועות
  const [lowStockOnly, setLowStockOnly] = useState(false); // מסנן-על "מתחת למינימום" (חוצה-שדות)

  const loadRefs = useCallback(() => {
    api.invCategories('?active=true').then(setCategories).catch(() => {});
    api.invSuppliers('?active=true').then(setSuppliers).catch(() => {});
    api.invUnits('?active=true').then(setUnits).catch(() => {});
  }, []);

  // טוענים את כל הפריטים; הסינון (קטגוריה/סטטוס/חיפוש) נעשה בזיכרון ב-DataTable.
  const load = useCallback(() => {
    api.invItems('').then(setList).catch(onErr);
  }, [onErr]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateInvItem(form.id, form);
      else await api.createInvItem(form);
      setEditing(null);
      load();
      return true;
    } catch (e) {
      onErr(e);
      return false;
    }
  }

  async function saveInline(itemId, patch) {
    try {
      await api.updateInvItem(itemId, patch);
      load();
      return true;
    } catch (e) {
      onErr(e);
      return false;
    }
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

  const isLow = (it) => it.min_alert_quantity != null && Number(it.quantity_on_hand) < Number(it.min_alert_quantity);

  // מסנן-על "מתחת למינימום" הוא חוצה-שדות (כמות מול מינימום), לכן קדם-סינון לפני DataTable.
  const rows = useMemo(
    () => (list && lowStockOnly ? list.filter(isLow) : list),
    [list, lowStockOnly],
  );

  const columns = [
    {
      key: 'name',
      label: 'מוצר',
      type: 'text',
      rawCell: true,
      render: (it) => (
        <QuickEditCell
          value={it.name}
          ariaLabel="שם מוצר"
          className="font-medium"
          onSave={(value) => {
            const name = value.trim();
            if (!name) { alert('חובה להזין שם מוצר.'); return false; }
            return saveInline(it.id, { name });
          }}
        >
          {it.name}
          {it.is_packaging && <span className="text-xs text-brand-burgundy/50 mr-1">(אריזה)</span>}
        </QuickEditCell>
      ),
    },
    {
      key: 'category',
      label: 'קטגוריה',
      type: 'enum',
      value: (it) => it.category_id || '',
      options: categories.map((c) => ({ value: c.id, label: c.name })),
      rawCell: true,
      render: (it) => (
        <QuickEditCell
          value={it.category_id || ''}
          ariaLabel="קטגוריה"
          type="select"
          options={[{ value: '', label: '— ללא —' }, ...categories.map((category) => ({ value: category.id, label: category.name }))]}
          onSave={(value) => saveInline(it.id, { category_id: value || null })}
        >
          {it.category?.name || '—'}
        </QuickEditCell>
      ),
    },
    {
      key: 'unit',
      label: 'יחידה',
      type: 'enum',
      value: (it) => it.unit_id || '',
      options: units.map((u) => ({ value: u.id, label: u.name })),
      rawCell: true,
      render: (it) => (
        <QuickEditCell
          value={it.unit_id || ''}
          ariaLabel="יחידת מידה"
          type="select"
          options={units.map((u) => ({ value: u.id, label: u.name }))}
          onSave={(value) => {
            if (!value) { alert('חובה לבחור יחידת מידה.'); return false; }
            return saveInline(it.id, { unit_id: value });
          }}
        >
          {it.unit_ref?.name || it.unit || '—'}
        </QuickEditCell>
      ),
    },
    {
      key: 'quantity_on_hand',
      label: 'כמות',
      type: 'number',
      rawCell: true,
      render: (it) => {
        const low = isLow(it);
        return (
          <td className={`p-0 text-sm font-medium ${low ? 'text-red-600' : ''}`}>
            <button type="button" onClick={() => setAdjusting(it)} className="w-full p-3 text-right hover:bg-brand-gold/10" title="לחיצה לשינוי כמות">
              {fmt(it.quantity_on_hand)}{low && ' ⚠'}
            </button>
          </td>
        );
      },
    },
    {
      key: 'min_alert_quantity',
      label: 'מינימום',
      type: 'number',
      rawCell: true,
      render: (it) => (
        <QuickEditCell
          value={it.min_alert_quantity ?? ''}
          ariaLabel="כמות מינימום"
          type="number"
          className="text-brand-burgundy/60"
          onSave={(value) => saveInline(it.id, { min_alert_quantity: value === '' ? null : Number(value) })}
        >
          {it.min_alert_quantity != null ? fmt(it.min_alert_quantity) : '—'}
        </QuickEditCell>
      ),
    },
    {
      key: 'supplier',
      label: 'ספק',
      type: 'enum',
      value: (it) => it.default_supplier_id || '',
      options: suppliers.map((s) => ({ value: s.id, label: s.name })),
      rawCell: true,
      render: (it) => (
        <QuickEditCell
          value={it.default_supplier_id || ''}
          ariaLabel="ספק ברירת מחדל"
          type="select"
          className="text-brand-burgundy/60"
          options={[{ value: '', label: '— ללא —' }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]}
          onSave={(value) => saveInline(it.id, { default_supplier_id: value || null })}
        >
          {it.default_supplier?.name || '—'}
        </QuickEditCell>
      ),
    },
    {
      key: 'last_purchase_price',
      label: 'מחיר (כולל מע"מ)',
      type: 'number',
      dir: 'ltr',
      className: 'whitespace-nowrap',
      render: (it) => (
        it.last_purchase_price != null ? (
          <span className="text-right block">
            {formatWithVat(it.last_purchase_price, { exempt: it.vat_exempt })}
            {it.vat_exempt && <span className="text-xs text-brand-burgundy/45 mr-1">(פטור)</span>}
          </span>
        ) : <span className="text-brand-burgundy/40">—</span>
      ),
    },
    {
      key: 'is_active',
      label: 'סטטוס',
      type: 'boolean',
      trueLabel: 'פעיל',
      falseLabel: 'לא פעיל',
      rawCell: true,
      render: (it) => (
        <QuickEditCell
          value={it.is_active ? 'true' : 'false'}
          ariaLabel="סטטוס"
          type="select"
          options={[{ value: 'true', label: 'פעיל' }, { value: 'false', label: 'לא פעיל' }]}
          onSave={(value) => saveInline(it.id, { is_active: value === 'true' })}
        >
          <Badge map={ACTIVE_STATUS} value={it.is_active ? 'active' : 'inactive'} />
        </QuickEditCell>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ מוצר חדש</button>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
          מתחת למינימום בלבד
        </label>
        <span className="pb-2 text-xs text-brand-burgundy/55">לחיצה על תא מאפשרת לערוך אותו במקום</span>
      </div>

      {editing && !editing.id && (
        <ItemForm categories={categories} suppliers={suppliers} units={units} initial={editing}
          onSave={save} onCancel={() => setEditing(null)} onSuppliersChanged={loadRefs} onErr={onErr} />
      )}
      {adjusting && (
        <AdjustForm item={adjusting} onSubmit={submitAdjust} onCancel={() => setAdjusting(null)} />
      )}
      {history && (
        <HistoryPanel item={history.item} movements={history.movements} onClose={() => setHistory(null)} />
      )}

      <DataTable
        columns={columns}
        rows={rows}
        empty="אין פריטי מלאי."
        expandedId={editing?.id}
        rowClassName={(it) => `${!it.is_active ? 'opacity-50' : ''} ${editing?.id === it.id ? 'bg-brand-cream/40' : ''}`}
        renderExpanded={() => (
          <ItemForm categories={categories} suppliers={suppliers} units={units} initial={editing}
            onSave={save} onCancel={() => setEditing(null)} onSuppliersChanged={loadRefs} onErr={onErr} />
        )}
        actions={(it) => (
          <>
            <ActionIconButton icon="adjust" label="שינוי כמות" onClick={() => setAdjusting(it)} />
            <ActionIconButton icon={editing?.id === it.id ? 'cancel' : 'open'} label={editing?.id === it.id ? 'סגירת פרטי הרשומה' : 'פתיחת כל פרטי הרשומה'} onClick={() => setEditing(editing?.id === it.id ? null : it)} />
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
          </>
        )}
      />
    </div>
  );
}

function QuickEditCell({ value, children, onSave, ariaLabel, type = 'text', options = [], className = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [saving, setSaving] = useState(false);
  const skipBlur = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value == null ? '' : String(value));
  }, [value, editing]);

  async function commit(nextValue = draft) {
    if (saving || String(nextValue) === String(value ?? '')) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const saved = await onSave(String(nextValue));
    setSaving(false);
    if (saved !== false) setEditing(false);
  }

  function cancel() {
    skipBlur.current = true;
    setDraft(value == null ? '' : String(value));
    setEditing(false);
  }

  function keyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  }

  if (!editing) {
    return (
      <td
        className={`group cursor-pointer p-3 text-sm hover:bg-brand-gold/10 ${className}`}
        onClick={() => { skipBlur.current = false; setEditing(true); }}
        title={`לחיצה לעריכת ${ariaLabel}`}
      >
        <div className="flex min-h-5 items-center gap-1.5">
          <span className="min-w-0">{children}</span>
          <span aria-hidden="true" className="text-xs text-brand-burgundy/0 transition-colors group-hover:text-brand-burgundy/35">✎</span>
        </div>
      </td>
    );
  }

  const controlClass = `${inputCls} min-w-[7rem] bg-white py-1.5 text-sm disabled:opacity-60`;
  return (
    <td className={`p-2 text-sm ${className}`}>
      {type === 'select' ? (
        <select
          value={draft}
          onChange={(event) => { const next = event.target.value; setDraft(next); commit(next); }}
          onBlur={() => { if (!skipBlur.current) commit(); }}
          onKeyDown={keyDown}
          className={controlClass}
          aria-label={ariaLabel}
          disabled={saving}
          autoFocus
        >
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <input
          type={type}
          step={type === 'number' ? 'any' : undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => { if (!skipBlur.current) commit(); }}
          onKeyDown={keyDown}
          className={controlClass}
          aria-label={ariaLabel}
          disabled={saving}
          dir={type === 'number' ? 'ltr' : undefined}
          autoFocus
        />
      )}
    </td>
  );
}

function ItemForm({ categories, suppliers, units, initial, onSave, onCancel, onSuppliersChanged, onErr }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    category_id: initial.category_id || '',
    unit_id: initial.unit_id || '',
    quantity_on_hand: initial.quantity_on_hand ?? 0,
    min_alert_quantity: initial.min_alert_quantity ?? '',
    default_supplier_id: initial.default_supplier_id || '',
    last_purchase_price: initial.last_purchase_price ?? '',
    is_packaging: initial.is_packaging || false,
    vat_exempt: initial.vat_exempt || false,
    notes: initial.notes || '',
  });
  const [newSupplier, setNewSupplier] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const isEdit = !!f.id;
  // ברירת המחדל של מתג "לפני/כולל מע"מ" נגזרת מהספק הנבחר (איך הוא נוקב מחירים)
  const selectedSupplierIncludesVat =
    suppliers.find((s) => s.id === f.default_supplier_id)?.default_price_includes_vat || false;
  // שם יחידת הבסיס של הפריט (לתצוגה בטבלת ההמרות ובכמות הקיימת)
  const baseUnitName = units.find((u) => u.id === f.unit_id)?.name || initial.unit_ref?.name || initial.unit || '';

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
    if (!f.unit_id) return alert('חובה לבחור יחידת מידה.');
    const payload = {
      ...f,
      category_id: f.category_id || null,
      default_supplier_id: f.default_supplier_id || null,
      min_alert_quantity: f.min_alert_quantity === '' ? null : Number(f.min_alert_quantity),
      // last_purchase_price כבר מגיע כמחיר בסיס מנורמל (או null) מרכיב PriceInput
      last_purchase_price: f.last_purchase_price === '' || f.last_purchase_price == null ? null : Number(f.last_purchase_price),
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
        <Field label="יחידת מידה *">
          <select value={f.unit_id} onChange={(e) => set('unit_id', e.target.value)} className={inputCls}>
            <option value="">— בחר יחידה —</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
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
            <div className="p-2 text-brand-burgundy/60 text-sm">{fmt(initial.quantity_on_hand)} {baseUnitName} — לשינוי השתמש ב״שינוי כמות״</div>
          </Field>
        )}
        <Field label="כמות מינימום להתראה">
          <input type="number" step="any" value={f.min_alert_quantity} onChange={(e) => set('min_alert_quantity', e.target.value)} className={inputCls} dir="ltr" placeholder="ללא" />
        </Field>
        <Field label="מחיר קנייה אחרון (₪)">
          <PriceInput
            value={f.last_purchase_price}
            onChange={(base) => set('last_purchase_price', base ?? '')}
            exempt={f.vat_exempt}
            defaultIncludesVat={selectedSupplierIncludesVat}
            className={inputCls}
            placeholder="לא ידוע"
          />
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
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.is_packaging} onChange={(e) => set('is_packaging', e.target.checked)} />
          פריט אריזה (קופסה, תבנית, שקית)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.vat_exempt} onChange={(e) => set('vat_exempt', e.target.checked)} />
          פטור ממע"מ (פירות, ירקות טריים)
        </label>
      </div>

      {/* טבלת המרות פר-פריט — זמינה רק לאחר שמירת הפריט (צריך item_id) */}
      {isEdit && (
        <ConversionsEditor
          itemId={f.id}
          units={units}
          baseUnitId={f.unit_id}
          baseUnitName={baseUnitName}
          onErr={onErr}
        />
      )}

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
  const [draggedCategoryId, setDraggedCategoryId] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);

  const load = useCallback(() => {
    api.invCategories().then(setList).catch(onErr);
  }, [onErr]);
  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateInvCategory(form.id, form);
      else {
        const lastOrder = Math.max(0, ...(list || []).map((category) => Number(category.display_order) || 0));
        await api.createInvCategory({ ...form, display_order: lastOrder + 1 });
      }
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
  }

  async function moveCategory(targetCategoryId) {
    if (savingOrder || !draggedCategoryId || draggedCategoryId === targetCategoryId) return;
    const previous = list;
    const fromIndex = previous.findIndex((category) => category.id === draggedCategoryId);
    const toIndex = previous.findIndex((category) => category.id === targetCategoryId);
    if (fromIndex < 0 || toIndex < 0) return;

    const reordered = [...previous];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const normalized = reordered.map((category, index) => ({ ...category, display_order: index + 1 }));

    setList(normalized);
    setDraggedCategoryId(null);
    setSavingOrder(true);
    try {
      await Promise.all(normalized.map((category) =>
        api.updateInvCategory(category.id, { display_order: category.display_order })));
    } catch (e) {
      setList(previous);
      onErr(e);
    } finally {
      setSavingOrder(false);
    }
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
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ קטגוריה חדשה</button>
        <span className="text-xs text-brand-burgundy/55">
          {savingOrder ? 'שומר את סדר הקטגוריות...' : 'אפשר לגרור שורות כדי לקבוע את סדר הקטגוריות'}
        </span>
      </div>
      {editing && !editing.id && <CategoryForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}

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
              <Fragment key={c.id}>
              <tr
                draggable={!savingOrder && editing?.id !== c.id}
                onDragStart={(e) => {
                  setDraggedCategoryId(c.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', c.id);
                }}
                onDragOver={(e) => {
                  if (draggedCategoryId && draggedCategoryId !== c.id) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDrop={(e) => { e.preventDefault(); moveCategory(c.id); }}
                onDragEnd={() => setDraggedCategoryId(null)}
                className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 cursor-grab active:cursor-grabbing ${draggedCategoryId === c.id ? 'opacity-40' : ''} ${!c.is_active ? 'opacity-50' : ''}`}
              >
                <td className="p-3"><DragHandle label={`גרירת ${c.name}`} /></td>
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3 text-sm"><Badge map={ACTIVE_STATUS} value={c.is_active ? 'active' : 'inactive'} /></td>
                <td className="p-3 text-sm whitespace-nowrap">
                  <div className="flex flex-wrap gap-1">
                  <ActionIconButton icon={editing?.id === c.id ? 'cancel' : 'edit'} label={editing?.id === c.id ? 'סגירה' : 'עריכה'} onClick={() => setEditing(editing?.id === c.id ? null : c)} />
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
              {editing?.id === c.id && (
                <tr className="border-b border-brand-cream-dark bg-brand-cream/20">
                  <td colSpan={4} className="p-3 sm:p-4">
                    <CategoryForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />
                  </td>
                </tr>
              )}
              </Fragment>
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
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

// ===========================================================================
// טבלת המרות יחידה פר-פריט (סעיף 25.4) — בתוך כרטיס הפריט
// ===========================================================================
// לכל פריט: אילו יחידות-מתכון ניתן להמיר ליחידת הבסיס שלו, ובאיזה פקטור.
// דוגמה: פריט "סוכר" ביחידת בסיס "גרם" — המרה "כף" → 12.5 (1 כף = 12.5 גרם).
// יחידת הבסיס עצמה תמיד ניתנת לניכוי (פקטור 1) ואינה דורשת שורת המרה.
function ConversionsEditor({ itemId, units, baseUnitId, baseUnitName, onErr }) {
  const [rows, setRows] = useState(null);
  const [fromUnitId, setFromUnitId] = useState('');
  const [factor, setFactor] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.invItemConversions(itemId).then(setRows).catch(onErr);
  }, [itemId, onErr]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!fromUnitId) return alert('יש לבחור יחידת מקור.');
    const f = Number(factor);
    if (!Number.isFinite(f) || f <= 0) return alert('פקטור ההמרה חייב להיות מספר חיובי.');
    setSaving(true);
    try {
      await api.createInvConversion(itemId, { from_unit_id: fromUnitId, factor_to_base: f });
      setFromUnitId(''); setFactor('');
      load();
    } catch (e) { onErr(e); }
    finally { setSaving(false); }
  }

  async function updateFactor(id, value) {
    const f = Number(value);
    if (!Number.isFinite(f) || f <= 0) { alert('פקטור לא תקין.'); return false; }
    try { await api.updateInvConversion(id, { factor_to_base: f }); load(); return true; }
    catch (e) { onErr(e); return false; }
  }

  async function remove(id) {
    if (!confirm('למחוק המרה זו?')) return;
    try { await api.deleteInvConversion(id); load(); }
    catch (e) { onErr(e); }
  }

  // יחידות זמינות להוספה: לא יחידת הבסיס, ולא כאלה שכבר הוגדרו
  const usedIds = new Set((rows || []).map((r) => r.from_unit_id));
  const available = units.filter((u) => u.id !== baseUnitId && !usedIds.has(u.id));

  return (
    <section className="border border-brand-cream-dark rounded-lg p-3 space-y-3 bg-brand-cream/20">
      <div>
        <h4 className="font-bold text-brand-burgundy">המרות יחידה למתכון</h4>
        <p className="text-xs text-brand-burgundy/55 mt-1">
          כשמתכון משתמש ביחידה שונה מיחידת הבסיס ({baseUnitName || '—'}), הגדירו כאן כמה
          {' '}{baseUnitName || 'יחידות בסיס'} שוות ל-1 מהיחידה. נדרש לניכוי מלאי אוטומטי.
        </p>
      </div>

      {rows == null ? (
        <p className="text-sm text-brand-burgundy/50">טוען...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-brand-burgundy/50">אין המרות מוגדרות. יחידת הבסיס ({baseUnitName || '—'}) תמיד זמינה.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-brand-burgundy/60 border-b border-brand-cream-dark">
            <tr>
              <th className="p-2 text-right">מ־יחידה</th>
              <th className="p-2 text-right">פקטור (כמה {baseUnitName || 'בסיס'} ב-1)</th>
              <th className="p-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-brand-cream-dark/50">
                <td className="p-2 font-medium">{r.from_unit_ref?.name || r.from_unit || '—'}</td>
                <td className="p-2">
                  <InlineFactor value={r.factor_to_base} onSave={(v) => updateFactor(r.id, v)} />
                </td>
                <td className="p-2 text-left">
                  <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => remove(r.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* הוספת המרה חדשה */}
      <div className="flex flex-wrap items-end gap-2 pt-1">
        <label className="block">
          <span className="text-xs text-brand-burgundy/70 block mb-1">יחידת מקור</span>
          <select value={fromUnitId} onChange={(e) => setFromUnitId(e.target.value)} className={`${inputCls} min-w-[8rem]`}>
            <option value="">— בחר —</option>
            {available.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-brand-burgundy/70 block mb-1">פקטור לבסיס</span>
          <input type="number" step="any" value={factor} onChange={(e) => setFactor(e.target.value)}
            className={`${inputCls} min-w-[7rem]`} dir="ltr" placeholder="למשל 12.5" />
        </label>
        <button type="button" onClick={add} disabled={saving}
          className="btn-ghost whitespace-nowrap disabled:opacity-50 relative z-10">
          + הוספת המרה
        </button>
      </div>
    </section>
  );
}

// עריכה מהירה של פקטור המרה בשורה (Enter לשמירה, Esc לביטול)
function InlineFactor({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="hover:bg-brand-gold/10 rounded px-2 py-1" dir="ltr">
        {fmt(value)} ✎
      </button>
    );
  }
  return (
    <input
      type="number" step="any" value={draft} autoFocus dir="ltr"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={async () => { if (String(draft) !== String(value)) { const ok = await onSave(draft); if (ok !== false) setEditing(false); } else setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { setDraft(String(value)); setEditing(false); }
      }}
      className={`${inputCls} min-w-[6rem] py-1`}
    />
  );
}

// ===========================================================================
// ניהול יחידות מידה גלובליות (סעיף 25)
// ===========================================================================
const UNIT_KINDS = [
  { value: 'weight', label: 'משקל' },
  { value: 'volume', label: 'נפח' },
  { value: 'count', label: 'ספירה/יחידות' },
  { value: 'length', label: 'אורך' },
  { value: 'other', label: 'אחר' },
];
const UNIT_KIND_LABEL = Object.fromEntries(UNIT_KINDS.map((k) => [k.value, k.label]));

function UnitsManager({ onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [merging, setMerging] = useState(null); // [כלי מיזוג זמני] יחידת המקור למיזוג

  const load = useCallback(() => {
    api.invUnits('?with_usage=true').then(setList).catch(onErr);
  }, [onErr]);
  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateInvUnit(form.id, form);
      else await api.createInvUnit(form);
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
  }

  async function toggleActive(u) {
    try { await api.updateInvUnit(u.id, { is_active: !u.is_active }); load(); }
    catch (e) { onErr(e); }
  }

  async function deleteUnit(u) {
    if (!confirm(`למחוק לצמיתות את היחידה ${u.name}?`)) return;
    try { await api.deleteInvUnit(u.id); load(); }
    catch (e) { onErr(e); }
  }

  // [כלי מיזוג זמני] מיזוג יחידת המקור ליעד: ממפה מחדש הכל ומוחק את המקור
  async function doMerge(targetId) {
    try {
      const res = await api.mergeInvUnit(merging.id, targetId);
      const target = (list || []).find((u) => u.id === targetId);
      alert(`מוזג בהצלחה אל "${target?.name || ''}".\n` +
        `פריטי מלאי: ${res.items_remapped} · מתכונים: ${res.recipes_remapped} · המרות: ${res.conversions_remapped}`);
      setMerging(null);
      load();
    } catch (e) { onErr(e); }
  }

  const columns = [
    { key: 'name', label: 'יחידה', type: 'text', render: (u) => <span className="font-medium">{u.name}</span> },
    { key: 'kind', label: 'מימד', type: 'enum',
      value: (u) => u.kind, options: UNIT_KINDS,
      render: (u) => UNIT_KIND_LABEL[u.kind] || u.kind },
    { key: 'usage_count', label: 'שימושים', type: 'number',
      render: (u) => (
        u.usage_count > 0
          ? <span className="font-medium">{u.usage_count}</span>
          : <span className="text-brand-burgundy/40">0 (לא בשימוש)</span>
      ) },
    { key: 'is_active', label: 'סטטוס', type: 'boolean', trueLabel: 'פעיל', falseLabel: 'לא פעיל',
      render: (u) => <Badge map={ACTIVE_STATUS} value={u.is_active ? 'active' : 'inactive'} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ יחידה חדשה</button>
        <span className="text-xs text-brand-burgundy/55">
          עמודת "שימושים" מראה בכמה פריטים/מתכונים היחידה מקושרת. למיזוג כפילויות
          (למשל יח'→יחידה) לחצו על 🔗 מיזוג.
        </span>
      </div>
      {editing && !editing.id && <UnitForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
      {merging && (
        <MergeUnitPanel source={merging} units={list || []} onMerge={doMerge} onCancel={() => setMerging(null)} />
      )}

      <DataTable
        columns={columns}
        rows={list}
        empty="אין יחידות מידה."
        expandedId={editing?.id}
        rowClassName={(u) => `${!u.is_active ? 'opacity-50' : ''} ${editing?.id === u.id ? 'bg-brand-cream/40' : ''}`}
        renderExpanded={() => <UnitForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
        actions={(u) => (
          <>
            {/* [כלי מיזוג זמני] */}
            <ActionIconButton icon="merge" label="מיזוג ליחידה אחרת" tone="muted" onClick={() => setMerging(u)} />
            <ActionIconButton icon={editing?.id === u.id ? 'cancel' : 'edit'} label={editing?.id === u.id ? 'סגירה' : 'עריכה'} onClick={() => setEditing(editing?.id === u.id ? null : u)} />
            <ActionIconButton icon={u.is_active ? 'deactivate' : 'activate'} label={u.is_active ? 'השבתה' : 'הפעלה'} tone="muted" onClick={() => toggleActive(u)} />
            {canDelete && <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deleteUnit(u)} />}
          </>
        )}
      />
    </div>
  );
}

// [כלי מיזוג זמני] פאנל מיזוג: בוחרים יחידת יעד, וכל הרשומות של המקור עוברות אליה
function MergeUnitPanel({ source, units, onMerge, onCancel }) {
  const [targetId, setTargetId] = useState('');
  const targets = units.filter((u) => u.id !== source.id);

  function submit(e) {
    e.preventDefault();
    if (!targetId) return alert('יש לבחור יחידת יעד.');
    const target = units.find((u) => u.id === targetId);
    if (!confirm(
      `למזג את "${source.name}" (${source.usage_count || 0} שימושים) אל "${target?.name}"?\n` +
      `כל הפריטים והמתכונים יעברו ל"${target?.name}", והיחידה "${source.name}" תימחק. הפעולה בלתי הפיכה.`
    )) return;
    onMerge(targetId);
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-burgundy">
      <h3 className="font-bold text-brand-burgundy">מיזוג יחידה — {source.name}</h3>
      <p className="text-sm text-brand-burgundy/60">
        כל {source.usage_count || 0} השימושים של "{source.name}" יועברו ליחידת היעד, והיחידה תימחק.
      </p>
      <Field label="למזג אל יחידת היעד">
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={inputCls}>
          <option value="">— בחר יחידת יעד —</option>
          {targets.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.usage_count || 0} שימושים)</option>)}
        </select>
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">מיזוג</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

function UnitForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    kind: initial.kind || 'other',
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם יחידה.');
    onSave({ ...f, name: f.name.trim() });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת יחידה' : 'יחידה חדשה'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם יחידה * (גרם, ק״ג, כף, יחידה...)">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="מימד">
          <select value={f.kind} onChange={(e) => set('kind', e.target.value)} className={inputCls}>
            {UNIT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
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
