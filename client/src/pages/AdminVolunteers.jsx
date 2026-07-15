import { Fragment, useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { DragHandle } from '../components/DragHandle.jsx';
import { ACTIVE_STATUS, Badge } from '../lib/status.jsx';

// ניהול מתנדבים ומשימות קבועות (סעיף 24). מסך ניהול גלובלי.
const AREAS = [
  { value: 'cooking', label: 'בישול' },
  { value: 'packing', label: 'אריזה' },
  { value: 'transport', label: 'שינוע' },
  { value: 'cleaning', label: 'ניקיון' },
  { value: 'general', label: 'כללי' },
];
const AREA_LABEL = Object.fromEntries(AREAS.map((a) => [a.value, a.label]));
const DAYS = [
  ['general', 'כללי / ללא יום'], ['tuesday', 'יום ג׳'], ['wednesday', 'יום ד׳'],
  ['thursday', 'יום ה׳'], ['friday', 'יום ו׳'], ['shabbat', 'שבת'], ['motzei_shabbat', 'מוצ״ש'],
];
const SHIFTS = [['', 'ללא משמרת'], ['morning', 'בוקר'], ['noon', 'צהריים'], ['evening', 'ערב'], ['night', 'לילה']];

export default function AdminVolunteers({ onAuthError, currentAdmin }) {
  const [view, setView] = useState('volunteers'); // volunteers | tasks
  const [meals, setMeals] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeVolunteers, setActiveVolunteers] = useState([]);
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  useEffect(() => {
    api.catalog().then((c) => setMeals(c.meals || [])).catch(() => {});
    api.volunteerTaskCategories().then(setCategories).catch(handleErr);
    api.volunteers('?active=true').then(setActiveVolunteers).catch(handleErr);
  }, [handleErr]);

  const reloadCategories = useCallback(() => api.volunteerTaskCategories().then(setCategories).catch(handleErr), [handleErr]);

  return (
    <Page title="ניהול מתנדבים" subtitle="מתנדבים ומשימות קבועות">
      <div className="flex gap-1 mb-5 border-b border-brand-cream-dark">
        {[['volunteers', 'מתנדבים'], ['tasks', 'משימות קבועות'], ['categories', 'קטגוריות משימה']].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
              view === k ? 'border-brand-gold text-brand-burgundy' : 'border-transparent text-brand-burgundy/50 hover:text-brand-burgundy'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'volunteers' && <VolunteersManager meals={meals} onErr={handleErr} canDelete={canDelete} />}
      {view === 'tasks' && <TasksManager meals={meals} categories={categories} volunteers={activeVolunteers} onErr={handleErr} canDelete={canDelete} />}
      {view === 'categories' && <TaskCategoriesManager categories={categories} onChanged={reloadCategories} onErr={handleErr} canDelete={canDelete} />}
    </Page>
  );
}

// ===========================================================================
// ניהול מתנדבים
// ===========================================================================
function VolunteersManager({ meals, onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [tasks, setTasks] = useState([]); // משימות קבועות פעילות — לשיוך מרובה למתנדב
  const [editing, setEditing] = useState(null); // אובייקט מתנדב או null; {} = חדש

  const load = useCallback(() => {
    api.volunteers().then(setList).catch(onErr);
  }, [onErr]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.adminCustomers().then(setCustomers).catch(onErr);
    api.volunteerTasks('?active=true').then(setTasks).catch(onErr);
  }, [onErr]);
  const taskName = Object.fromEntries(tasks.map((t) => [t.id, t.name]));

  async function save(form) {
    try {
      if (form.id) await api.updateVolunteer(form.id, form);
      else await api.createVolunteer(form);
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
  }

  async function toggleActive(v) {
    try { await api.updateVolunteer(v.id, { is_active: !v.is_active }); load(); }
    catch (e) { onErr(e); }
  }

  async function deleteVolunteer(v) {
    if (!confirm(`למחוק לצמיתות את ${v.full_name}?`)) return;
    try { await api.deleteVolunteer(v.id); load(); }
    catch (e) { onErr(e); }
  }

  if (!list) return <p>טוען...</p>;

  return (
    <div className="space-y-4">
      <button onClick={() => setEditing({})} className="btn-primary">+ מתנדב חדש</button>

      {editing && !editing.id && (
        <VolunteerForm
          meals={meals}
          customers={customers}
          tasks={tasks}
          initial={editing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
          <thead className="bg-brand-burgundy text-brand-cream text-sm">
            <tr>
              <th className="p-3 text-right">שם</th>
              <th className="p-3 text-right">כרטיס לקוח</th>
              <th className="p-3 text-right">טלפון</th>
              <th className="p-3 text-right">תחום</th>
              <th className="p-3 text-right">משימות קבועות</th>
              <th className="p-3 text-right">מאכלים</th>
              <th className="p-3 text-right">רכב</th>
              <th className="p-3 text-right">קבוע</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <Fragment key={v.id}>
              <tr className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${!v.is_active ? 'opacity-50' : ''} ${editing?.id === v.id ? 'bg-brand-cream/40' : ''}`}>
                <td className="p-3 font-medium">{v.full_name}</td>
                <td className="p-3 text-sm text-brand-burgundy/60">{v.customer_id ? 'מקושר' : 'עצמאי'}</td>
                <td className="p-3 text-sm" dir="ltr">{v.phone || '—'}</td>
                <td className="p-3 text-sm">
                  {(v.areas?.length ? v.areas : [v.area]).map((area) => AREA_LABEL[area]).filter(Boolean).join(', ')}
                </td>
                <td className="p-3 text-sm text-brand-burgundy/70">
                  {(v.task_ids || []).length === 0
                    ? '—'
                    : (v.task_ids || []).map((tid) => taskName[tid]).filter(Boolean).join(', ')}
                </td>
                <td className="p-3 text-sm text-brand-burgundy/60">
                  {(v.linked_meals?.length
                    ? v.linked_meals.map((m) => m.name)
                    : (v.meals?.name ? [v.meals.name] : [])
                  ).join(', ') || '—'}
                </td>
                <td className="p-3 text-center">{v.has_vehicle ? '🚗' : '—'}</td>
                <td className="p-3 text-center">{v.is_regular ? '✓' : '—'}</td>
                <td className="p-3 text-sm"><Badge map={ACTIVE_STATUS} value={v.is_active ? 'active' : 'inactive'} /></td>
                <td className="p-3 text-sm whitespace-nowrap">
                  <div className="flex flex-wrap gap-1">
                  <ActionIconButton icon={editing?.id === v.id ? 'cancel' : 'edit'} label={editing?.id === v.id ? 'סגירה' : 'עריכה'} onClick={() => setEditing(editing?.id === v.id ? null : v)} />
                  <ActionIconButton
                    icon={v.is_active ? 'deactivate' : 'activate'}
                    label={v.is_active ? 'השבתה' : 'הפעלה'}
                    tone="muted"
                    onClick={() => toggleActive(v)}
                  />
                  {canDelete && (
                    <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deleteVolunteer(v)} />
                  )}
                  </div>
                </td>
              </tr>
              {editing?.id === v.id && (
                <tr className="border-b border-brand-cream-dark bg-brand-cream/20">
                  <td colSpan={10} className="p-3 sm:p-4">
                    <VolunteerForm meals={meals} customers={customers} tasks={tasks} initial={editing}
                      onSave={save} onCancel={() => setEditing(null)} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={10} className="p-6 text-center text-brand-burgundy/50">אין מתנדבים עדיין.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VolunteerForm({ meals, customers, tasks, initial, onSave, onCancel }) {
  const [customerSearch, setCustomerSearch] = useState('');
  const [f, setF] = useState({
    id: initial.id,
    customer_id: initial.customer_id || '',
    full_name: initial.full_name || '',
    phone: initial.phone || '',
    email: initial.email || '',
    area: initial.area || 'cooking',
    has_vehicle: initial.has_vehicle || false,
    is_regular: initial.is_regular || false,
  });
  const [areaIds, setAreaIds] = useState(initial.areas?.length ? initial.areas : [initial.area || 'cooking']);
  const toggleArea = (area) => setAreaIds((selected) => (
    selected.includes(area) ? selected.filter((value) => value !== area) : [...selected, area]
  ));
  const [taskIds, setTaskIds] = useState(initial.task_ids || []); // שיוך מרובה למשימות קבועות
  const toggleTask = (id) => setTaskIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const [mealIds, setMealIds] = useState(
    initial.meal_ids || (initial.linked_meal_id ? [initial.linked_meal_id] : []), // שיוך מרובה למאכלי בישול
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
      full_name: customer?.full_name || s.full_name,
      phone: customer?.phone || s.phone,
      email: customer?.email || s.email,
    };
  });

  function submit(e) {
    e.preventDefault();
    if (!f.customer_id && !f.full_name.trim()) return alert('חובה להזין שם מלא.');
    if (areaIds.length === 0) return alert('יש לבחור לפחות תחום התנדבות אחד.');
    // בישול משבץ לפי meal_ids; לתחומים אחרים אין קישור מאכל.
    const meal_ids = areaIds.includes('cooking') ? mealIds : [];
    onSave({
      ...f,
      customer_id: f.customer_id || null,
      area: areaIds[0],
      areas: areaIds,
      task_ids: taskIds,
      meal_ids,
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת מתנדב' : 'מתנדב חדש'}</h3>
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
              <option value="">— מתנדב עצמאי —</option>
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
        <Field label="שם מלא *">
          <input
            value={f.full_name}
            onChange={(e) => set('full_name', e.target.value)}
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
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-brand-cream-dark p-2">
            {AREAS.map((area) => (
              <span key={area.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={areaIds.includes(area.value)}
                  onChange={() => toggleArea(area.value)}
                />
                <span>{area.label}</span>
              </span>
            ))}
          </div>
        </Field>
      </div>

      {areaIds.includes('cooking') && (
        <div>
          <span className="text-sm text-brand-burgundy/70 block mb-1">
            מאכלים לבישול (לשיבוץ בישול אוטומטי — ניתן לסמן כמה)
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

      <div>
        <span className="text-sm text-brand-burgundy/70 block mb-1">משימות קבועות (ניתן לסמן כמה)</span>
        {tasks.length === 0 ? (
          <p className="text-xs text-brand-burgundy/40">אין משימות קבועות מוגדרות. יש להגדיר משימות בלשונית "משימות קבועות".</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 border border-brand-cream-dark rounded-lg p-3">
            {tasks.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={taskIds.includes(t.id)} onChange={() => toggleTask(t.id)} />
                <span>{t.name}</span>
                <span className="text-xs text-brand-burgundy/40">({AREA_LABEL[t.area]})</span>
              </label>
            ))}
          </div>
        )}
      </div>

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
function TasksManager({ meals, categories, volunteers, onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const categoryById = Object.fromEntries((categories || []).map((category) => [category.id, category]));
  const categoryPath = (task) => {
    const category = categoryById[task.category_id];
    const parent = category?.parent_id ? categoryById[category.parent_id] : null;
    return [parent?.name, category?.name].filter(Boolean).join(' / ') || 'לא מסווג';
  };

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

  async function moveTask(targetTaskId) {
    if (savingOrder || !draggedTaskId || draggedTaskId === targetTaskId) return;
    const previous = list;
    const fromIndex = previous.findIndex((task) => task.id === draggedTaskId);
    const toIndex = previous.findIndex((task) => task.id === targetTaskId);
    if (fromIndex < 0 || toIndex < 0) return;

    const reordered = [...previous];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const normalized = reordered.map((task, index) => ({ ...task, display_order: index + 1 }));

    setList(normalized);
    setDraggedTaskId(null);
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
    try { await api.updateVolunteerTask(t.id, { is_active: !t.is_active }); load(); }
    catch (e) { onErr(e); }
  }

  async function deleteTask(t) {
    if (!confirm(`למחוק לצמיתות את המשימה ${t.name}?`)) return;
    try { await api.deleteVolunteerTask(t.id); load(); }
    catch (e) { onErr(e); }
  }

  if (!list) return <p>טוען...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ משימה חדשה</button>
        <span className="text-xs text-brand-burgundy/55">
          {savingOrder ? 'שומר את סדר המשימות...' : 'אפשר לגרור שורות כדי לקבוע את סדר המשימות'}
        </span>
      </div>

      {editing && !editing.id && (
        <TaskForm meals={meals} categories={categories} volunteers={volunteers} initial={editing} onSave={save} onCancel={() => setEditing(null)} />
      )}

      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
          <thead className="bg-brand-burgundy text-brand-cream text-sm">
            <tr>
              <th className="p-3 text-right">סדר</th>
              <th className="p-3 text-right">משימה</th>
              <th className="p-3 text-right">תחום</th>
              <th className="p-3 text-right">מאכל</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <Fragment key={t.id}>
              <tr
                draggable={!savingOrder && editing?.id !== t.id}
                onDragStart={(e) => {
                  setDraggedTaskId(t.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', t.id);
                }}
                onDragOver={(e) => {
                  if (draggedTaskId && draggedTaskId !== t.id) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDrop={(e) => { e.preventDefault(); moveTask(t.id); }}
                onDragEnd={() => setDraggedTaskId(null)}
                className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 cursor-grab active:cursor-grabbing ${draggedTaskId === t.id ? 'opacity-40' : ''} ${!t.is_active ? 'opacity-50' : ''}`}
              >
                <td className="p-3"><DragHandle label={`גרירת ${t.name}`} /></td>
                <td className="p-3 font-medium">{t.name}</td>
                <td className="p-3 text-sm">
                  <div>{categoryPath(t)}</div>
                  <div className="text-xs text-brand-burgundy/50">{AREA_LABEL[t.area]} · {DAYS.find(([value]) => value === t.execution_day)?.[1] || 'כללי'}</div>
                  <div className="text-xs text-brand-burgundy/60">אחראי: {t.primary_volunteer?.full_name || 'ללא'}</div>
                </td>
                <td className="p-3 text-sm text-brand-burgundy/60">{t.meals?.name || '—'}</td>
                <td className="p-3 text-sm"><Badge map={ACTIVE_STATUS} value={t.is_active ? 'active' : 'inactive'} /></td>
                <td className="p-3 text-sm whitespace-nowrap">
                  <div className="flex flex-wrap gap-1">
                  <ActionIconButton icon={editing?.id === t.id ? 'cancel' : 'edit'} label={editing?.id === t.id ? 'סגירה' : 'עריכה'} onClick={() => setEditing(editing?.id === t.id ? null : t)} />
                  <ActionIconButton
                    icon={t.is_active ? 'deactivate' : 'activate'}
                    label={t.is_active ? 'השבתה' : 'הפעלה'}
                    tone="muted"
                    onClick={() => toggleActive(t)}
                  />
                  {canDelete && (
                    <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deleteTask(t)} />
                  )}
                  </div>
                </td>
              </tr>
              {editing?.id === t.id && (
                <tr className="border-b border-brand-cream-dark bg-brand-cream/20">
                  <td colSpan={6} className="p-3 sm:p-4">
                    <TaskForm meals={meals} categories={categories} volunteers={volunteers} initial={editing} onSave={save} onCancel={() => setEditing(null)} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-brand-burgundy/50">אין משימות עדיין.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaskCategoriesManager({ categories, onChanged, onErr, canDelete }) {
  const [form, setForm] = useState({ name: '', parent_id: '' });
  const roots = categories.filter((category) => !category.parent_id);
  async function create(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      await api.createVolunteerTaskCategory({ name: form.name, parent_id: form.parent_id || null, display_order: categories.length + 1 });
      setForm({ name: '', parent_id: '' });
      onChanged();
    } catch (error) { onErr(error); }
  }
  async function toggle(category) {
    try { await api.updateVolunteerTaskCategory(category.id, { is_active: !category.is_active }); onChanged(); }
    catch (error) { onErr(error); }
  }
  async function rename(category) {
    const name = prompt('שם הקטגוריה', category.name);
    if (!name?.trim() || name.trim() === category.name) return;
    try { await api.updateVolunteerTaskCategory(category.id, { name: name.trim() }); onChanged(); }
    catch (error) { onErr(error); }
  }
  async function remove(category) {
    if (!confirm(`למחוק את הקטגוריה "${category.name}"?`)) return;
    try { await api.deleteVolunteerTaskCategory(category.id); onChanged(); }
    catch (error) { onErr(error); }
  }
  async function move(category, direction) {
    const siblings = categories.filter((item) => (item.parent_id || null) === (category.parent_id || null))
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, 'he'));
    const index = siblings.findIndex((item) => item.id === category.id);
    const target = siblings[index + direction];
    if (!target) return;
    try {
      await Promise.all([
        api.updateVolunteerTaskCategory(category.id, { display_order: target.display_order }),
        api.updateVolunteerTaskCategory(target.id, { display_order: category.display_order }),
      ]);
      onChanged();
    } catch (error) { onErr(error); }
  }
  return (
    <div className="space-y-4">
      <form onSubmit={create} className="card grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <Field label="שם קטגוריה"><input className={inputCls} value={form.name} onChange={(e) => setForm((state) => ({ ...state, name: e.target.value }))} /></Field>
        <Field label="קטגוריית אב (אופציונלי)">
          <select className={inputCls} value={form.parent_id} onChange={(e) => setForm((state) => ({ ...state, parent_id: e.target.value }))}>
            <option value="">קטגוריה ראשית</option>
            {roots.filter((root) => root.is_active).map((root) => <option key={root.id} value={root.id}>{root.name}</option>)}
          </select>
        </Field>
        <button className="btn-primary" type="submit">הוספה</button>
      </form>
      <div className="space-y-3">
        {roots.map((root) => (
          <div key={root.id} className="card">
            <CategoryRow category={root} onRename={rename} onToggle={toggle} onDelete={remove} onMove={move} canDelete={canDelete} />
            <div className="mr-6 mt-2 space-y-1 border-r-2 border-brand-cream-dark pr-3">
              {categories.filter((category) => category.parent_id === root.id).map((category) => (
                <CategoryRow key={category.id} category={category} onRename={rename} onToggle={toggle} onDelete={remove} onMove={move} canDelete={canDelete} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryRow({ category, onRename, onToggle, onDelete, onMove, canDelete }) {
  return <div className="flex items-center gap-2 py-1">
    <span className={`flex-1 ${category.is_active ? 'font-medium' : 'text-brand-burgundy/40'}`}>{category.name}</span>
    <button type="button" title="העלאה" onClick={() => onMove(category, -1)}>↑</button>
    <button type="button" title="הורדה" onClick={() => onMove(category, 1)}>↓</button>
    <button type="button" className="btn-ghost text-xs" onClick={() => onRename(category)}>עריכה</button>
    <button type="button" className="btn-ghost text-xs" onClick={() => onToggle(category)}>{category.is_active ? 'השבתה' : 'הפעלה'}</button>
    {canDelete && <button type="button" className="text-red-700 text-xs" onClick={() => onDelete(category)}>מחיקה</button>}
  </div>;
}

function TaskForm({ meals, categories, volunteers, initial, onSave, onCancel }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    area: initial.area || 'cooking',
    category_id: initial.category_id || categories.find((category) => category.is_active)?.id || '',
    linked_meal_id: initial.linked_meal_id || '',
    execution_day: initial.execution_day || 'general',
    shift: initial.shift || '',
    timing_note: initial.timing_note || '',
    primary_volunteer_id: initial.primary_volunteer_id || '',
    backup_volunteer_ids: initial.backup_volunteer_ids || [],
    candidate_volunteer_ids: initial.candidate_volunteer_ids || [],
    display_order: initial.display_order ?? 0,
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const rootCategories = categories.filter((category) => !category.parent_id && category.is_active);
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
    if (!f.category_id) return alert('חובה לבחור קטגוריה.');
    const staffing = [f.primary_volunteer_id, ...f.backup_volunteer_ids, ...f.candidate_volunteer_ids].filter(Boolean);
    if (new Set(staffing).size !== staffing.length) return alert('אותו מתנדב לא יכול להופיע ביותר מתפקיד אחד.');
    onSave({
      ...f,
      linked_meal_id: f.area === 'cooking' ? (f.linked_meal_id || null) : null,
      shift: f.shift || null,
      primary_volunteer_id: f.primary_volunteer_id || null,
      display_order: Number(f.display_order) || 0,
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת משימה' : 'משימה חדשה'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם משימה *">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="תחום">
          <select value={f.area} onChange={(e) => set('area', e.target.value)} className={inputCls}>
            {AREAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </Field>
        <Field label="קטגוריה *">
          <select value={f.category_id} onChange={(e) => set('category_id', e.target.value)} className={inputCls}>
            <option value="">בחר קטגוריה</option>
            {rootCategories.map((root) => (
              <Fragment key={root.id}>
                <option value={root.id}>{root.name}</option>
                {categories.filter((category) => category.parent_id === root.id && category.is_active)
                  .map((category) => <option key={category.id} value={category.id}>↳ {root.name} / {category.name}</option>)}
              </Fragment>
            ))}
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
        {f.area === 'cooking' && (
          <Field label="קישור למאכל (לשיבוץ בישול אוטומטי)">
            <select value={f.linked_meal_id} onChange={(e) => set('linked_meal_id', e.target.value)} className={inputCls}>
              <option value="">— ללא —</option>
              {meals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Field label="אחראי ראשי">
          <select value={f.primary_volunteer_id} onChange={(e) => {
            const id = e.target.value;
            setF((state) => ({
              ...state,
              primary_volunteer_id: id,
              backup_volunteer_ids: state.backup_volunteer_ids.filter((value) => value !== id),
              candidate_volunteer_ids: state.candidate_volunteer_ids.filter((value) => value !== id),
            }));
          }} className={inputCls}>
            <option value="">ללא אחראי</option>
            {volunteers.map((volunteer) => <option key={volunteer.id} value={volunteer.id}>{volunteer.full_name}</option>)}
          </select>
        </Field>
        <VolunteerMultiPicker label="מחליפים לפי סדר עדיפות" volunteers={volunteers}
          selected={f.backup_volunteer_ids} onChange={(ids) => set('backup_volunteer_ids', ids)}
          onMove={moveBackup} excluded={[f.primary_volunteer_id, ...f.candidate_volunteer_ids]} ordered />
        <VolunteerMultiPicker label="מועמדים נוספים" volunteers={volunteers}
          selected={f.candidate_volunteer_ids} onChange={(ids) => set('candidate_volunteer_ids', ids)}
          excluded={[f.primary_volunteer_id, ...f.backup_volunteer_ids]} />
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
