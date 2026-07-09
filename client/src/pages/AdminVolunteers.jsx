import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';

// ניהול מתנדבים ומשימות קבועות (סעיף 24). מסך ניהול גלובלי.
const AREAS = [
  { value: 'cooking', label: 'בישול' },
  { value: 'packing', label: 'אריזה' },
  { value: 'transport', label: 'שינוע' },
  { value: 'cleaning', label: 'ניקיון' },
  { value: 'general', label: 'כללי' },
];
const AREA_LABEL = Object.fromEntries(AREAS.map((a) => [a.value, a.label]));

export default function AdminVolunteers({ onAuthError, currentAdmin }) {
  const [view, setView] = useState('volunteers'); // volunteers | tasks
  const [meals, setMeals] = useState([]);
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  useEffect(() => {
    api.catalog().then((c) => setMeals(c.meals || [])).catch(() => {});
  }, []);

  return (
    <Page title="ניהול מתנדבים" subtitle="מתנדבים ומשימות קבועות (סעיף 24)">
      <div className="flex gap-1 mb-5 border-b border-brand-cream-dark">
        {[['volunteers', 'מתנדבים'], ['tasks', 'משימות קבועות']].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
              view === k ? 'border-brand-gold text-brand-burgundy' : 'border-transparent text-brand-burgundy/50 hover:text-brand-burgundy'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'volunteers' && <VolunteersManager meals={meals} onErr={handleErr} canDelete={canDelete} />}
      {view === 'tasks' && <TasksManager meals={meals} onErr={handleErr} canDelete={canDelete} />}
    </Page>
  );
}

// ===========================================================================
// ניהול מתנדבים
// ===========================================================================
function VolunteersManager({ meals, onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [editing, setEditing] = useState(null); // אובייקט מתנדב או null; {} = חדש

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

      {editing && (
        <VolunteerForm
          meals={meals}
          customers={customers}
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
              <th className="p-3 text-right">מאכל</th>
              <th className="p-3 text-right">רכב</th>
              <th className="p-3 text-right">קבוע</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id} className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${!v.is_active ? 'opacity-50' : ''}`}>
                <td className="p-3 font-medium">{v.full_name}</td>
                <td className="p-3 text-sm text-brand-burgundy/60">{v.customer_id ? 'מקושר' : 'עצמאי'}</td>
                <td className="p-3 text-sm" dir="ltr">{v.phone || '—'}</td>
                <td className="p-3 text-sm">{AREA_LABEL[v.area]}</td>
                <td className="p-3 text-sm text-brand-burgundy/60">{v.meals?.name || '—'}</td>
                <td className="p-3 text-center">{v.has_vehicle ? '🚗' : '—'}</td>
                <td className="p-3 text-center">{v.is_regular ? '✓' : '—'}</td>
                <td className="p-3 text-sm">{v.is_active ? 'פעיל' : 'לא פעיל'}</td>
                <td className="p-3 text-sm whitespace-nowrap">
                  <button onClick={() => setEditing(v)} className="text-brand-burgundy hover:underline ml-3">עריכה</button>
                  <button onClick={() => toggleActive(v)} className="text-brand-burgundy/60 hover:underline">
                    {v.is_active ? 'השבתה' : 'הפעלה'}
                  </button>
                  {canDelete && (
                    <button onClick={() => deleteVolunteer(v)} className="text-red-600 hover:underline mr-3">
                      מחיקה
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-brand-burgundy/50">אין מתנדבים עדיין.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VolunteerForm({ meals, customers, initial, onSave, onCancel }) {
  const [f, setF] = useState({
    id: initial.id,
    customer_id: initial.customer_id || '',
    full_name: initial.full_name || '',
    phone: initial.phone || '',
    email: initial.email || '',
    area: initial.area || 'cooking',
    linked_meal_id: initial.linked_meal_id || '',
    has_vehicle: initial.has_vehicle || false,
    is_regular: initial.is_regular || false,
  });
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
    onSave({ ...f, customer_id: f.customer_id || null, linked_meal_id: f.linked_meal_id || null });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת מתנדב' : 'מתנדב חדש'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="קישור ללקוח קיים">
          <select value={f.customer_id} onChange={(e) => set('customer_id', e.target.value)} className={inputCls}>
            <option value="">— מתנדב עצמאי —</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.full_name} {customer.phone ? `(${customer.phone})` : ''}
              </option>
            ))}
          </select>
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
        <Field label="תחום התנדבות">
          <select value={f.area} onChange={(e) => set('area', e.target.value)} className={inputCls}>
            {AREAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
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
function TasksManager({ meals, onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    api.volunteerTasks().then(setList).catch(onErr);
  }, [onErr]);
  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateVolunteerTask(form.id, form);
      else await api.createVolunteerTask(form);
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
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
      <p className="text-sm text-brand-burgundy/60">משימות קבועות אינן נוצרות מחדש בכל שבת — בכל שבת משבצים אליהן מתנדבים (סעיף 24.3).</p>
      <button onClick={() => setEditing({})} className="btn-primary">+ משימה חדשה</button>

      {editing && (
        <TaskForm meals={meals} initial={editing} onSave={save} onCancel={() => setEditing(null)} />
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
              <tr key={t.id} className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${!t.is_active ? 'opacity-50' : ''}`}>
                <td className="p-3 text-sm text-brand-burgundy/50">{t.display_order}</td>
                <td className="p-3 font-medium">{t.name}</td>
                <td className="p-3 text-sm">{AREA_LABEL[t.area]}</td>
                <td className="p-3 text-sm text-brand-burgundy/60">{t.meals?.name || '—'}</td>
                <td className="p-3 text-sm">{t.is_active ? 'פעיל' : 'לא פעיל'}</td>
                <td className="p-3 text-sm whitespace-nowrap">
                  <button onClick={() => setEditing(t)} className="text-brand-burgundy hover:underline ml-3">עריכה</button>
                  <button onClick={() => toggleActive(t)} className="text-brand-burgundy/60 hover:underline">
                    {t.is_active ? 'השבתה' : 'הפעלה'}
                  </button>
                  {canDelete && (
                    <button onClick={() => deleteTask(t)} className="text-red-600 hover:underline mr-3">
                      מחיקה
                    </button>
                  )}
                </td>
              </tr>
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

function TaskForm({ meals, initial, onSave, onCancel }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    area: initial.area || 'cooking',
    linked_meal_id: initial.linked_meal_id || '',
    display_order: initial.display_order ?? 0,
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם משימה.');
    onSave({ ...f, linked_meal_id: f.linked_meal_id || null, display_order: Number(f.display_order) || 0 });
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
        {f.area === 'cooking' && (
          <Field label="קישור למאכל (לשיבוץ בישול אוטומטי)">
            <select value={f.linked_meal_id} onChange={(e) => set('linked_meal_id', e.target.value)} className={inputCls}>
              <option value="">— ללא —</option>
              {meals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="סדר תצוגה">
          <input type="number" value={f.display_order} onChange={(e) => set('display_order', e.target.value)} className={inputCls} />
        </Field>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
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
