import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { FormDrawer, useRecordNav } from '../components/Drawer.jsx';
import { ACTIVE_STATUS, Badge } from '../lib/status.jsx';

// ניהול מתנדבים ומשימות קבועות (סעיף 24). מסך ניהול גלובלי.
// תחומי ההתנדבות ניתנים לניהול מהממשק (טבלת volunteer_areas) - אין יותר enum קבוע
// ואין קטגוריות נפרדות. דגל is_cooking על תחום מפעיל קישור מאכלים ושיבוץ בישול.
const DAYS = [
  ['general', 'כללי / ללא יום'], ['tuesday', 'יום ג׳'], ['wednesday', 'יום ד׳'],
  ['thursday', 'יום ה׳'], ['friday', 'יום ו׳'], ['shabbat', 'שבת'], ['motzei_shabbat', 'מוצ״ש'],
];
const SHIFTS = [['', 'ללא משמרת'], ['morning', 'בוקר'], ['noon', 'צהריים'], ['evening', 'ערב'], ['night', 'לילה']];

export default function AdminVolunteers({ onAuthError, currentAdmin }) {
  const [view, setView] = useState('volunteers'); // volunteers | tasks | areas
  const [meals, setMeals] = useState([]);
  const [areas, setAreas] = useState([]);
  const [activeVolunteers, setActiveVolunteers] = useState([]);
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  const reloadAreas = useCallback(() => api.volunteerAreas().then(setAreas).catch(handleErr), [handleErr]);

  useEffect(() => {
    api.catalog().then((c) => setMeals(c.meals || [])).catch(() => {});
    reloadAreas();
    api.volunteers('?active=true').then(setActiveVolunteers).catch(handleErr);
  }, [handleErr, reloadAreas]);

  return (
    <Page title="ניהול מתנדבים" subtitle="מתנדבים, משימות קבועות ותחומי התנדבות">
      <div className="flex gap-1 mb-5 border-b border-brand-cream-dark">
        {[['volunteers', 'מתנדבים'], ['tasks', 'משימות קבועות'], ['areas', 'תחומי התנדבות']].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
              view === k ? 'border-brand-gold text-brand-burgundy' : 'border-transparent text-brand-burgundy/50 hover:text-brand-burgundy'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'volunteers' && <VolunteersManager meals={meals} areas={areas} onErr={handleErr} canDelete={canDelete} />}
      {view === 'tasks' && <TasksManager meals={meals} areas={areas} volunteers={activeVolunteers} onErr={handleErr} canDelete={canDelete} />}
      {view === 'areas' && <AreasManager areas={areas} onChanged={reloadAreas} onErr={handleErr} canDelete={canDelete} />}
    </Page>
  );
}

// ===========================================================================
// ניהול מתנדבים
// ===========================================================================
function VolunteersManager({ meals, areas, onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [editing, setEditing] = useState(null); // אובייקט מתנדב או null; {} = חדש
  const areaName = Object.fromEntries(areas.map((a) => [a.id, a.name]));

  const load = useCallback(() => {
    api.volunteers().then(setList).catch(onErr);
  }, [onErr]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.adminCustomers().then(setCustomers).catch(onErr);
  }, [onErr]);

  async function save(form) {
    try {
      if (form.id) await api.updateVolunteer(form.id, form);
      else await api.createVolunteer(form);
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
  }

  async function toggleActive(v) {
    try {
      await api.updateVolunteer(v.id, { is_active: !v.is_active });
      setEditing((e) => (e && e.id === v.id ? { ...e, is_active: !v.is_active } : e));
      load();
    } catch (e) { onErr(e); }
  }

  async function deleteVolunteer(v) {
    if (!confirm(`למחוק לצמיתות את ${v.full_name}?`)) return;
    try { await api.deleteVolunteer(v.id); setEditing(null); load(); }
    catch (e) { onErr(e); }
  }

  const nav = useRecordNav(setEditing, editing?.id ?? null);

  const areaText = (v) => (v.area_ids || []).map((id) => areaName[id]).filter(Boolean).join(', ');
  const mealsText = (v) => (v.linked_meals?.length
    ? v.linked_meals.map((m) => m.name)
    : (v.meals?.name ? [v.meals.name] : [])
  ).join(', ');

  const columns = [
    { key: 'full_name', label: 'שם מלא', type: 'text', className: 'font-medium' },
    { key: 'first_name', label: 'שם פרטי', type: 'text', render: (v) => v.first_name || '-' },
    { key: 'last_name', label: 'שם משפחה', type: 'text', render: (v) => v.last_name || '-' },
    {
      key: 'customer_id',
      label: 'כרטיס לקוח',
      type: 'boolean',
      trueLabel: 'מקושר',
      falseLabel: 'עצמאי',
      className: 'text-brand-burgundy/60',
      value: (v) => !!v.customer_id,
      render: (v) => (v.customer_id ? 'מקושר' : 'עצמאי'),
    },
    { key: 'phone', label: 'טלפון', type: 'text', dir: 'ltr', render: (v) => v.phone || '-' },
    { key: 'area', label: 'תחום', type: 'text', value: areaText, render: (v) => areaText(v) || '-' },
    {
      key: 'meals',
      label: 'מאכלים',
      type: 'text',
      className: 'text-brand-burgundy/60',
      value: mealsText,
      render: (v) => mealsText(v) || '-',
    },
    {
      key: 'has_vehicle',
      label: 'רכב',
      type: 'boolean',
      trueLabel: 'עם רכב',
      falseLabel: 'ללא',
      className: 'text-center',
      render: (v) => (v.has_vehicle ? '🚗' : '-'),
    },
    {
      key: 'is_regular',
      label: 'קבוע',
      type: 'boolean',
      className: 'text-center',
      render: (v) => (v.is_regular ? '✓' : '-'),
    },
    {
      key: 'is_active',
      label: 'סטטוס',
      type: 'boolean',
      trueLabel: 'פעיל',
      falseLabel: 'לא פעיל',
      render: (v) => <Badge map={ACTIVE_STATUS} value={v.is_active ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <div className="space-y-4">
      <button onClick={() => setEditing({})} className="btn-primary">+ מתנדב חדש</button>

      <DataTable
        columns={columns}
        rows={list}
        empty="אין מתנדבים עדיין."
        rowClassName={(v) => `${!v.is_active ? 'opacity-50' : ''} ${editing?.id === v.id ? 'bg-brand-cream/40' : ''}`}
        onRowClick={setEditing}
        onVisibleRowsChange={nav.setVisibleRows}
      />

      <FormDrawer
        editing={editing}
        onClose={() => setEditing(null)}
        entity="מתנדב"
        title={editing?.full_name}
        width="xl"
        onPrev={nav.onPrev}
        onNext={nav.onNext}
        position={nav.position}
        footer={editing?.id ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => toggleActive(editing)} className="btn-ghost">{editing.is_active ? 'השבתה' : 'הפעלה'}</button>
            {canDelete && (
              <button onClick={() => deleteVolunteer(editing)} className="btn-ghost text-red-600 hover:bg-red-50">מחיקה</button>
            )}
          </div>
        ) : undefined}
      >
        {editing && (
          <VolunteerForm meals={meals} areas={areas} customers={customers} initial={editing}
            onSave={save} onCancel={() => setEditing(null)} embedded />
        )}
      </FormDrawer>
    </div>
  );
}

function VolunteerForm({ meals, areas, customers, initial, onSave, onCancel, embedded = false }) {
  const activeAreas = areas.filter((a) => a.is_active);
  const [customerSearch, setCustomerSearch] = useState('');
  const [f, setF] = useState({
    id: initial.id,
    customer_id: initial.customer_id || '',
    first_name: initial.first_name || '',
    last_name: initial.last_name || '',
    phone: initial.phone || '',
    email: initial.email || '',
    has_vehicle: initial.has_vehicle || false,
    is_regular: initial.is_regular || false,
  });
  const [areaIds, setAreaIds] = useState(
    initial.area_ids?.length ? initial.area_ids : (initial.area_id ? [initial.area_id] : []),
  );
  const toggleArea = (id) => setAreaIds((selected) => (
    selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
  ));
  // בורר המאכלים מוצג רק אם נבחר תחום בישול (is_cooking)
  const hasCookingArea = areaIds.some((id) => activeAreas.find((a) => a.id === id)?.is_cooking);
  const [mealIds, setMealIds] = useState(
    initial.meal_ids || (initial.linked_meal_id ? [initial.linked_meal_id] : []),
  );
  const [mealSearch, setMealSearch] = useState('');
  const toggleMeal = (id) => setMealIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const normalizedMealSearch = mealSearch.trim().toLocaleLowerCase('he-IL');
  const visibleMeals = normalizedMealSearch
    ? meals.filter((meal) => meal.name.toLocaleLowerCase('he-IL').includes(normalizedMealSearch))
    : meals;
  const normalizedCustomerSearch = customerSearch.trim().toLocaleLowerCase('he-IL');
  const visibleCustomers = normalizedCustomerSearch
    ? customers.filter((customer) => [customer.full_name, customer.phone, customer.email]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('he-IL').includes(normalizedCustomerSearch)))
    : customers;
  const linkedCustomer = customers.find((customer) => customer.id === f.customer_id);
  const set = (k, v) => setF((s) => {
    if (k !== 'customer_id') return { ...s, [k]: v };
    const customer = customers.find((c) => c.id === v);
    return {
      ...s,
      customer_id: v,
      first_name: customer?.first_name || s.first_name,
      last_name: customer?.last_name ?? s.last_name,
      phone: customer?.phone || s.phone,
      email: customer?.email || s.email,
    };
  });

  function submit(e) {
    e.preventDefault();
    if (!f.customer_id && !f.first_name.trim()) return alert('חובה להזין שם פרטי.');
    if (areaIds.length === 0) return alert('יש לבחור לפחות תחום התנדבות אחד.');
    // מאכלים נשמרים רק אם נבחר תחום בישול; לתחומים אחרים אין קישור מאכל.
    const meal_ids = hasCookingArea ? mealIds : [];
    onSave({
      ...f,
      customer_id: f.customer_id || null,
      area_id: areaIds[0],
      area_ids: areaIds,
      meal_ids,
    });
  }

  return (
    <form onSubmit={submit} className={embedded ? 'space-y-3' : 'card space-y-3 border-r-4 border-brand-gold'}>
      {!embedded && <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת מתנדב' : 'מתנדב חדש'}</h3>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="קישור ללקוח קיים">
          <div className="space-y-2">
            <input
              type="search"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              className={inputCls}
              placeholder="חיפוש לפי שם, טלפון או אימייל..."
              aria-label="חיפוש לקוח קיים"
            />
            <select value={f.customer_id} onChange={(e) => set('customer_id', e.target.value)} className={inputCls}>
              <option value="">- מתנדב עצמאי -</option>
              {visibleCustomers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.full_name} {customer.phone ? `(${customer.phone})` : ''}
                </option>
              ))}
              {visibleCustomers.length === 0 && (
                <option disabled>לא נמצאו לקוחות מתאימים</option>
              )}
            </select>
          </div>
        </Field>
        <Field label="שם פרטי *">
          <input
            value={f.first_name}
            onChange={(e) => set('first_name', e.target.value)}
            className={inputCls}
            readOnly={!!linkedCustomer}
          />
        </Field>
        <Field label="שם משפחה">
          <input
            value={f.last_name}
            onChange={(e) => set('last_name', e.target.value)}
            className={inputCls}
            readOnly={!!linkedCustomer}
          />
        </Field>
        <Field label="טלפון">
          <input
            value={f.phone}
            onChange={(e) => set('phone', e.target.value)}
            className={inputCls}
            dir="ltr"
            readOnly={!!linkedCustomer}
          />
        </Field>
        <Field label="מייל">
          <input
            value={f.email}
            onChange={(e) => set('email', e.target.value)}
            className={inputCls}
            dir="ltr"
            readOnly={!!linkedCustomer}
          />
        </Field>
        <Field label="תחומי התנדבות (ניתן לסמן כמה)">
          {activeAreas.length === 0 ? (
            <p className="text-xs text-brand-burgundy/40">אין תחומים מוגדרים. יש להוסיף בלשונית "תחומי התנדבות".</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-brand-cream-dark p-2">
              {activeAreas.map((area) => (
                <span key={area.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={areaIds.includes(area.id)}
                    onChange={() => toggleArea(area.id)}
                  />
                  <span>{area.name}{area.is_cooking ? ' 🍲' : ''}</span>
                </span>
              ))}
            </div>
          )}
        </Field>
      </div>

      {hasCookingArea && (
        <div>
          <span className="text-sm text-brand-burgundy/70 block mb-1">
            מאכלים לבישול (לשיבוץ בישול אוטומטי - ניתן לסמן כמה)
          </span>
          {meals.length === 0 ? (
            <p className="text-xs text-brand-burgundy/40">אין מאכלים מוגדרים בקטלוג.</p>
          ) : (
            <div className="space-y-2">
              <input
                type="search"
                value={mealSearch}
                onChange={(e) => setMealSearch(e.target.value)}
                className={inputCls}
                placeholder="חיפוש מאכל..."
                aria-label="חיפוש מאכל לשיבוץ קבוע"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 border border-brand-cream-dark rounded-lg p-3 max-h-52 overflow-y-auto">
                {visibleMeals.length === 0 ? (
                  <p className="text-xs text-brand-burgundy/40 sm:col-span-2">לא נמצאו מאכלים מתאימים לחיפוש.</p>
                ) : visibleMeals.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={mealIds.includes(m.id)} onChange={() => toggleMeal(m.id)} />
                    <span>{m.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.has_vehicle} onChange={(e) => set('has_vehicle', e.target.checked)} />
          יש רכב לשינוע
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.is_regular} onChange={(e) => set('is_regular', e.target.checked)} />
          מתנדב קבוע
        </label>
      </div>

      <p className="text-xs text-brand-burgundy/40">
        שיוך המתנדב למשימות (אחראי קבוע / מחליף) נעשה בלשונית "משימות קבועות".
      </p>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

// ===========================================================================
// ניהול משימות קבועות
// ===========================================================================
function TasksManager({ meals, areas, volunteers, onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const areaName = Object.fromEntries(areas.map((a) => [a.id, a.name]));

  const load = useCallback(() => {
    api.volunteerTasks().then(setList).catch(onErr);
  }, [onErr]);
  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateVolunteerTask(form.id, form);
      else {
        const lastOrder = Math.max(0, ...(list || []).map((task) => Number(task.display_order) || 0));
        await api.createVolunteerTask({ ...form, display_order: lastOrder + 1 });
      }
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
  }

  async function handleReorder(reordered) {
    const previous = list;
    const normalized = reordered.map((task, index) => ({ ...task, display_order: index + 1 }));
    setList(normalized);
    setSavingOrder(true);
    try {
      await Promise.all(normalized.map((task) =>
        api.updateVolunteerTask(task.id, { display_order: task.display_order })));
    } catch (e) {
      setList(previous);
      onErr(e);
    } finally {
      setSavingOrder(false);
    }
  }

  async function toggleActive(t) {
    try {
      await api.updateVolunteerTask(t.id, { is_active: !t.is_active });
      setEditing((e) => (e && e.id === t.id ? { ...e, is_active: !t.is_active } : e));
      load();
    } catch (e) { onErr(e); }
  }

  async function deleteTask(t) {
    if (!confirm(`למחוק לצמיתות את המשימה ${t.name}?`)) return;
    try { await api.deleteVolunteerTask(t.id); setEditing(null); load(); }
    catch (e) { onErr(e); }
  }

  const nav = useRecordNav(setEditing, editing?.id ?? null);

  if (!list) return <p>טוען...</p>;

  const areaText = (t) => t.area?.name || areaName[t.area_id] || '';
  const columns = [
    { key: 'name', label: 'משימה', type: 'text', className: 'font-medium' },
    {
      key: 'area',
      label: 'תחום',
      type: 'enum',
      value: (t) => t.area_id || '',
      options: areas.map((a) => ({ value: a.id, label: a.name })),
      render: (t) => (
        <>
          <div>{areaText(t) || '-'}</div>
          <div className="text-xs text-brand-burgundy/50">{DAYS.find(([value]) => value === t.execution_day)?.[1] || 'כללי'}</div>
          <div className="text-xs text-brand-burgundy/60">אחראי: {t.primary_volunteer?.full_name || 'ללא'}</div>
        </>
      ),
    },
    {
      key: 'meal',
      label: 'מאכל',
      type: 'text',
      className: 'text-brand-burgundy/60',
      value: (t) => t.meals?.name || '',
      render: (t) => t.meals?.name || '-',
    },
    {
      key: 'is_active',
      label: 'סטטוס',
      type: 'boolean',
      trueLabel: 'פעיל',
      falseLabel: 'לא פעיל',
      render: (t) => <Badge map={ACTIVE_STATUS} value={t.is_active ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ משימה חדשה</button>
        {savingOrder && <span className="text-xs text-brand-burgundy/55">שומר את סדר המשימות...</span>}
      </div>

      <DataTable
        columns={columns}
        rows={list}
        empty="אין משימות עדיין."
        reorderable
        onReorder={handleReorder}
        reorderHint="אפשר לגרור שורות כדי לקבוע את סדר המשימות"
        reorderDisabledHint="כדי לשנות סדר יש לנקות את הסינון"
        rowClassName={(t) => `${!t.is_active ? 'opacity-50' : ''} ${editing?.id === t.id ? 'bg-brand-cream/40' : ''}`}
        onRowClick={setEditing}
        onVisibleRowsChange={nav.setVisibleRows}
      />

      <FormDrawer
        editing={editing}
        onClose={() => setEditing(null)}
        entity="משימה"
        article="חדשה"
        title={editing?.name}
        width="xl"
        onPrev={nav.onPrev}
        onNext={nav.onNext}
        position={nav.position}
        footer={editing?.id ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => toggleActive(editing)} className="btn-ghost">{editing.is_active ? 'השבתה' : 'הפעלה'}</button>
            {canDelete && (
              <button onClick={() => deleteTask(editing)} className="btn-ghost text-red-600 hover:bg-red-50">מחיקה</button>
            )}
          </div>
        ) : undefined}
      >
        {editing && (
          <TaskForm meals={meals} areas={areas} volunteers={volunteers} initial={editing} onSave={save} onCancel={() => setEditing(null)} embedded />
        )}
      </FormDrawer>
    </div>
  );
}

// ===========================================================================
// ניהול תחומי התנדבות (טבלה ניתנת-לניהול, כולל דגל "תחום בישול")
// ===========================================================================
function AreasManager({ areas, onChanged, onErr, canDelete }) {
  const [form, setForm] = useState({ name: '', is_cooking: false });
  async function create(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      await api.createVolunteerArea({ name: form.name.trim(), is_cooking: form.is_cooking, display_order: areas.length + 1 });
      setForm({ name: '', is_cooking: false });
      onChanged();
    } catch (error) { onErr(error); }
  }
  async function toggle(area) {
    try { await api.updateVolunteerArea(area.id, { is_active: !area.is_active }); onChanged(); }
    catch (error) { onErr(error); }
  }
  async function toggleCooking(area) {
    try { await api.updateVolunteerArea(area.id, { is_cooking: !area.is_cooking }); onChanged(); }
    catch (error) { onErr(error); }
  }
  async function rename(area) {
    const name = prompt('שם התחום', area.name);
    if (!name?.trim() || name.trim() === area.name) return;
    try { await api.updateVolunteerArea(area.id, { name: name.trim() }); onChanged(); }
    catch (error) { onErr(error); }
  }
  async function remove(area) {
    if (!confirm(`למחוק את התחום "${area.name}"?`)) return;
    try { await api.deleteVolunteerArea(area.id); onChanged(); }
    catch (error) { onErr(error); }
  }
  async function move(area, direction) {
    const sorted = [...areas].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, 'he'));
    const index = sorted.findIndex((item) => item.id === area.id);
    const target = sorted[index + direction];
    if (!target) return;
    try {
      await Promise.all([
        api.updateVolunteerArea(area.id, { display_order: target.display_order }),
        api.updateVolunteerArea(target.id, { display_order: area.display_order }),
      ]);
      onChanged();
    } catch (error) { onErr(error); }
  }
  const sorted = [...areas].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, 'he'));
  return (
    <div className="space-y-4">
      <form onSubmit={create} className="card grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
        <Field label="שם תחום"><input className={inputCls} value={form.name} onChange={(e) => setForm((state) => ({ ...state, name: e.target.value }))} /></Field>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={form.is_cooking} onChange={(e) => setForm((state) => ({ ...state, is_cooking: e.target.checked }))} />
          תחום בישול 🍲
        </label>
        <button className="btn-primary" type="submit">הוספה</button>
      </form>
      <p className="text-xs text-brand-burgundy/50">
        סימון "תחום בישול" מפעיל קישור מאכלים למתנדב ולמשימה, ושיבוץ בישול אוטומטי לפי המאכל שהוזמן.
      </p>
      <div className="card divide-y divide-brand-cream-dark">
        {sorted.map((area) => (
          <div key={area.id} className="flex items-center gap-2 py-2">
            <span className={`flex-1 ${area.is_active ? 'font-medium' : 'text-brand-burgundy/40'}`}>
              {area.name}{area.is_cooking ? ' 🍲' : ''}
            </span>
            <button type="button" title="העלאה" onClick={() => move(area, -1)}>↑</button>
            <button type="button" title="הורדה" onClick={() => move(area, 1)}>↓</button>
            <button type="button" className="btn-ghost text-xs" onClick={() => toggleCooking(area)}>{area.is_cooking ? 'בטל בישול' : 'סמן בישול'}</button>
            <button type="button" className="btn-ghost text-xs" onClick={() => rename(area)}>עריכה</button>
            <button type="button" className="btn-ghost text-xs" onClick={() => toggle(area)}>{area.is_active ? 'השבתה' : 'הפעלה'}</button>
            {canDelete && <button type="button" className="text-red-700 text-xs" onClick={() => remove(area)}>מחיקה</button>}
          </div>
        ))}
        {sorted.length === 0 && <p className="py-4 text-center text-brand-burgundy/50">אין תחומים עדיין.</p>}
      </div>
    </div>
  );
}

function TaskForm({ meals, areas, volunteers, initial, onSave, onCancel, embedded = false }) {
  const activeAreas = areas.filter((a) => a.is_active);
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    area_id: initial.area_id || activeAreas[0]?.id || '',
    linked_meal_id: initial.linked_meal_id || '',
    execution_day: initial.execution_day || 'general',
    shift: initial.shift || '',
    timing_note: initial.timing_note || '',
    primary_volunteer_id: initial.primary_volunteer_id || '',
    backup_volunteer_ids: initial.backup_volunteer_ids || [],
    display_order: initial.display_order ?? 0,
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const isCookingArea = activeAreas.find((a) => a.id === f.area_id)?.is_cooking;
  const moveBackup = (from, to) => setF((state) => {
    if (to < 0 || to >= state.backup_volunteer_ids.length) return state;
    const next = [...state.backup_volunteer_ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return { ...state, backup_volunteer_ids: next };
  });

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם משימה.');
    if (!f.area_id) return alert('חובה לבחור תחום.');
    const staffing = [f.primary_volunteer_id, ...f.backup_volunteer_ids].filter(Boolean);
    if (new Set(staffing).size !== staffing.length) return alert('אותו מתנדב לא יכול להופיע ביותר מתפקיד אחד.');
    onSave({
      ...f,
      linked_meal_id: isCookingArea ? (f.linked_meal_id || null) : null,
      shift: f.shift || null,
      primary_volunteer_id: f.primary_volunteer_id || null,
      display_order: Number(f.display_order) || 0,
    });
  }

  return (
    <form onSubmit={submit} className={embedded ? 'space-y-3' : 'card space-y-3 border-r-4 border-brand-gold'}>
      {!embedded && <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת משימה' : 'משימה חדשה'}</h3>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם משימה *">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="תחום *">
          <select value={f.area_id} onChange={(e) => set('area_id', e.target.value)} className={inputCls}>
            <option value="">בחר תחום</option>
            {activeAreas.map((a) => <option key={a.id} value={a.id}>{a.name}{a.is_cooking ? ' 🍲' : ''}</option>)}
          </select>
        </Field>
        <Field label="יום ביצוע">
          <select value={f.execution_day} onChange={(e) => set('execution_day', e.target.value)} className={inputCls}>
            {DAYS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="משמרת">
          <select value={f.shift} onChange={(e) => set('shift', e.target.value)} className={inputCls}>
            {SHIFTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="הערת זמן">
          <input value={f.timing_note} onChange={(e) => set('timing_note', e.target.value)} className={inputCls} placeholder="למשל: אחרי מעריב" />
        </Field>
        {isCookingArea && (
          <Field label="קישור למאכל (לשיבוץ בישול אוטומטי)">
            <select value={f.linked_meal_id} onChange={(e) => set('linked_meal_id', e.target.value)} className={inputCls}>
              <option value="">- ללא -</option>
              {meals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Field label="אחראי קבוע">
          <select value={f.primary_volunteer_id} onChange={(e) => {
            const id = e.target.value;
            setF((state) => ({
              ...state,
              primary_volunteer_id: id,
              backup_volunteer_ids: state.backup_volunteer_ids.filter((value) => value !== id),
            }));
          }} className={inputCls}>
            <option value="">ללא אחראי</option>
            {volunteers.map((volunteer) => <option key={volunteer.id} value={volunteer.id}>{volunteer.full_name}</option>)}
          </select>
        </Field>
        <VolunteerMultiPicker label="מחליפים לפי סדר עדיפות" volunteers={volunteers}
          selected={f.backup_volunteer_ids} onChange={(ids) => set('backup_volunteer_ids', ids)}
          onMove={moveBackup} excluded={[f.primary_volunteer_id]} ordered />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

function VolunteerMultiPicker({ label, volunteers, selected, onChange, excluded, ordered = false, onMove }) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const available = volunteers.filter((volunteer) => !excluded.filter(Boolean).includes(volunteer.id));
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  const nameById = Object.fromEntries(volunteers.map((volunteer) => [volunteer.id, volunteer.full_name]));
  return (
    <div>
      <span className="text-sm text-brand-burgundy/70 block mb-1">{label}</span>
      {ordered && selected.length > 0 && (
        <div className="space-y-1 mb-2">
          {selected.map((id, index) => (
            <div key={id} draggable
              onDragStart={() => setDraggedIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => { if (draggedIndex !== null) onMove(draggedIndex, index); setDraggedIndex(null); }}
              onDragEnd={() => setDraggedIndex(null)}
              className="flex items-center gap-2 rounded border border-brand-cream-dark px-2 py-1 text-sm cursor-grab">
              <span className="font-medium">{index + 1}.</span><span className="flex-1">{nameById[id]}</span>
              <button type="button" onClick={() => onMove(index, index - 1)} disabled={index === 0}>↑</button>
              <button type="button" onClick={() => onMove(index, index + 1)} disabled={index === selected.length - 1}>↓</button>
              <button type="button" onClick={() => toggle(id)} className="text-red-700">✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="max-h-40 overflow-y-auto rounded-lg border border-brand-cream-dark p-2 space-y-1">
        {available.map((volunteer) => (
          <label key={volunteer.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.includes(volunteer.id)} onChange={() => toggle(volunteer.id)} />
            <span>{volunteer.full_name}</span>
          </label>
        ))}
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
