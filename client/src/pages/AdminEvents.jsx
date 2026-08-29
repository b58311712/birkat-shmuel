import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { Drawer, useRecordNav } from '../components/Drawer.jsx';
import CustomerPicker from '../components/CustomerPicker.jsx';
import {
  Badge, EVENT_TYPE, OCCASION_STATUS, PAYMENT_STATUS, PAYMENT_METHOD,
} from '../lib/status.jsx';

// אירועים: אירוע פנימי של הקהילה ואירוע פרטי חריג של חבר קהילה (מיגרציה 52).
//
// מבחינת המערכת אירוע הוא מועד (אח של שבת) עם הזמנה אחת, ולכן הגבייה כאן היא
// בדיוק אותה גבייה של הזמנה רגילה, וניכוי המלאי הוא אותו ניכוי של תיק שבת.
// ההבדל היחיד הוא התמחור: לפי עלות המוצרים ולא לפי מסלול מחיר.
//
// המסך הזה הוא התצוגה הקלה. כפתור "הפוך למועד מלא" חושף את תיק העבודה המלא
// (מטבח, אריזה, שינוע, מתנדבים, הדפסות) ב-/admin/shabbat.

const inputCls = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none';

const EVENT_TYPE_OPTIONS = [
  { value: 'community', label: 'אירוע פנימי של הקהילה' },
  { value: 'private', label: 'אירוע פרטי של חבר קהילה' },
];

const shekel = (n) => `${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-brand-burgundy/70">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-surface-muted">{hint}</span>}
    </label>
  );
}

export default function AdminEvents({ onAuthError, currentAdmin }) {
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);   // אירוע מלא מהשרת
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  const load = useCallback(() => {
    api.events().then(setList).catch(handleErr);
  }, [handleErr]);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (row) => {
    setCreating(false);
    try { setDetail(await api.event(row.id)); }
    catch (e) { handleErr(e); }
  }, [handleErr]);

  // רענון הפאנל אחרי פעולה שמשנה את האירוע, יחד עם רענון הרשימה מאחוריו.
  const refresh = useCallback(async () => {
    if (detail?.id) {
      try { setDetail(await api.event(detail.id)); }
      catch (e) { handleErr(e); }
    }
    load();
  }, [detail?.id, handleErr, load]);

  async function create(form) {
    try {
      const { id } = await api.createEvent(form);
      setCreating(false);
      load();
      openDetail({ id });
    } catch (e) { handleErr(e); }
  }

  async function removeEvent(d) {
    const title = d.event?.title || '';
    if (!confirm(`למחוק לצמיתות את האירוע "${title}"? הפעולה תמחק גם את ההזמנה והתשלומים שלו.`)) return;
    try {
      await api.deleteEvent(d.id);
      setDetail(null);
      load();
    } catch (e) { handleErr(e); }
  }

  async function promote(d) {
    if (!confirm('להפוך את האירוע לתיק עבודה מלא? האירוע יופיע ברשימת תיקי השבת עם כל הלשוניות.')) return;
    try {
      const { shabbat_file_path } = await api.promoteEvent(d.id);
      navigate(shabbat_file_path);
    } catch (e) { handleErr(e); }
  }

  // אחרי קישור אירוע קיים לשבת - המזהה שאיתו פותחים אותו מתחלף למזהה ההזמנה.
  const afterLink = useCallback((newId) => {
    load();
    openDetail({ id: newId });
  }, [load, openDetail]);

  const nav = useRecordNav(openDetail, detail?.id || null);

  const columns = [
    {
      key: 'gregorian_date',
      label: 'תאריך',
      type: 'date',
      render: (r) => (
        <span className="whitespace-nowrap">
          {r.gregorian_date}
          {r.event_time && <span className="text-surface-muted"> · {String(r.event_time).slice(0, 5)}</span>}
        </span>
      ),
    },
    {
      key: 'title',
      label: 'שם האירוע',
      type: 'text',
      className: 'font-medium',
      render: (r) => (
        <span className="text-brand-burgundy">
          {r.title}
          {r.linked && (
            <span className="ms-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">
              משויך לשבת
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'event_type',
      label: 'סוג',
      type: 'enum',
      options: EVENT_TYPE_OPTIONS.map((o) => ({ value: o.value, label: EVENT_TYPE[o.value].label })),
      render: (r) => <Badge map={EVENT_TYPE} value={r.event_type} />,
    },
    { key: 'payer_name', label: 'משלם', type: 'text' },
    { key: 'portions', label: 'מנות', type: 'number' },
    {
      key: 'final_amount',
      label: 'סכום',
      type: 'number',
      render: (r) => <span className="tabular-nums">{shekel(r.final_amount)}</span>,
    },
    {
      key: 'balance',
      label: 'יתרה',
      type: 'number',
      render: (r) => (
        <span className={`tabular-nums ${r.balance > 0.001 ? 'font-semibold text-red-700' : 'text-green-700'}`}>
          {shekel(r.balance)}
        </span>
      ),
    },
    {
      key: 'payment_status',
      label: 'תשלום',
      type: 'enum',
      map: PAYMENT_STATUS,
      render: (r) => <Badge map={PAYMENT_STATUS} value={r.payment_status} />,
    },
    {
      key: 'is_inventory_deducted',
      label: 'מלאי נוכה',
      type: 'boolean',
      trueLabel: 'נוכה',
      falseLabel: 'טרם',
      render: (r) => (r.is_inventory_deducted
        ? <span className="text-xs font-semibold text-green-700">נוכה</span>
        : <span className="text-xs text-surface-muted">טרם</span>),
    },
  ];

  const ev = detail?.event;

  return (
    <Page
      title="אירועים"
      subtitle="אירועים פנימיים של הקהילה ואירועים פרטיים חריגים - תיעוד, ניכוי מלאי וגבייה"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={() => { setDetail(null); setCreating(true); }} className="btn-primary">+ אירוע חדש</button>
      </div>

      <DataTable
        columns={columns}
        rows={list}
        empty="אין אירועים עדיין."
        rowClassName={(r) => (detail?.id === r.id ? 'bg-brand-cream/40' : '')}
        onRowClick={openDetail}
        onVisibleRowsChange={nav.setVisibleRows}
      />

      <Drawer
        open={!!detail || creating}
        onClose={() => { setDetail(null); setCreating(false); }}
        onPrev={creating ? null : nav.onPrev}
        onNext={creating ? null : nav.onNext}
        position={creating ? null : nav.position}
        contentKey={creating ? 'new' : `v${detail?.id ?? ''}`}
        width="5xl"
        eyebrow={creating ? 'אירוע חדש' : 'כרטיס אירוע'}
        title={creating ? 'אירוע חדש' : (ev?.title || 'טוען...')}
        subtitle={!creating && ev ? (
          `${ev.gregorian_date} · ${EVENT_TYPE[ev.event_type]?.label || ''}${detail.linked ? ` · משויך לשבת פרשת ${ev.parasha || ''}` : ''}`
        ) : undefined}
        footer={!creating && detail ? (
          <div className="flex flex-wrap gap-2">
            {!ev.use_full_workfile && (
              <button onClick={() => promote(detail)} className="btn-ghost">הפוך למועד מלא</button>
            )}
            {ev.use_full_workfile && (
              <button onClick={() => navigate(`/admin/shabbat/${ev.id}`)} className="btn-ghost">פתיחת תיק העבודה ←</button>
            )}
            {canDelete && (
              <button onClick={() => removeEvent(detail)} className="btn-ghost text-red-600 hover:bg-red-50">מחיקה</button>
            )}
          </div>
        ) : undefined}
      >
        {creating ? (
          <EventCreateForm onSave={create} onCancel={() => setCreating(false)} onErr={handleErr} />
        ) : detail ? (
          <EventDetailBody data={detail} onErr={handleErr} onChanged={refresh} onLinked={afterLink} />
        ) : (
          <p className="text-sm text-surface-muted">טוען...</p>
        )}
      </Drawer>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// טופס יצירת אירוע
// ---------------------------------------------------------------------------
function EventCreateForm({ onSave, onCancel, onErr }) {
  const [f, setF] = useState({
    title: '',
    gregorian_date: new Date().toISOString().slice(0, 10),
    event_time: '',
    event_type: 'community',
    link_to_shabbat_id: '',
    customer_id: '',
    venue_name: '',
    venue_address: '',
    contact_name: '',
    contact_phone: '',
    preferred_payment_method: 'bank_transfer',
    payment_deadline: '',
    delivery_method: 'self_pickup',
    notes: '',
  });
  const [shabbatot, setShabbatot] = useState(null);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const linked = f.event_type === 'private' && !!f.link_to_shabbat_id;

  useEffect(() => {
    if (f.event_type === 'private' && !shabbatot) {
      api.allShabbatot().then(setShabbatot).catch(onErr);
    }
  }, [f.event_type, shabbatot, onErr]);

  function changeEventType(value) {
    set('event_type', value);
    if (value !== 'private') set('link_to_shabbat_id', '');
  }

  function submit(e) {
    e.preventDefault();
    if (!f.title.trim()) return alert('יש להזין שם לאירוע.');
    if (!linked && !f.gregorian_date) return alert('יש לבחור תאריך.');
    if (!f.customer_id) return alert('יש לבחור גורם משלם.');
    if (!f.venue_name.trim()) return alert('יש להזין את מקום האירוע.');
    if (!f.venue_address.trim()) return alert('יש להזין את כתובת האירוע.');
    onSave(f);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="שם האירוע *">
          <input value={f.title} onChange={(e) => set('title', e.target.value)} className={inputCls} placeholder="למשל: קידוש לרגל הולדת הבן" />
        </Field>
        <Field label="סוג האירוע *">
          <select value={f.event_type} onChange={(e) => changeEventType(e.target.value)} className={inputCls}>
            {EVENT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>

        {f.event_type === 'private' && (
          <Field
            label="קישור לשבת קיימת"
            hint="לאירוע פרטי שחל בזמן שבת קהילתית - למשל קידוש בר מצווה. האירוע ייכנס לאותו תיק עבודה, אותו ניכוי מלאי ואותו מטבח של השבת שנבחרה, בלי תיק נפרד משלו."
          >
            <select value={f.link_to_shabbat_id} onChange={(e) => set('link_to_shabbat_id', e.target.value)} className={inputCls}>
              <option value="">- אירוע עצמאי, בלי קישור -</option>
              {(shabbatot || []).map((s) => (
                <option key={s.id} value={s.id}>{s.gregorian_date} · {s.parasha}</option>
              ))}
            </select>
          </Field>
        )}

        {!linked && (
          <Field label="תאריך *">
            <input type="date" value={f.gregorian_date} onChange={(e) => set('gregorian_date', e.target.value)} className={inputCls} />
          </Field>
        )}
        <Field label="שעה">
          <input type="time" value={f.event_time} onChange={(e) => set('event_time', e.target.value)} className={inputCls} />
        </Field>
      </div>

      <PayerPicker value={f.customer_id} onChange={(id) => set('customer_id', id)} onErr={onErr} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="מקום האירוע *">
          <input value={f.venue_name} onChange={(e) => set('venue_name', e.target.value)} className={inputCls} placeholder="אולם / בית כנסת" />
        </Field>
        <Field label="כתובת *">
          <input value={f.venue_address} onChange={(e) => set('venue_address', e.target.value)} className={inputCls} />
        </Field>
        <Field label="איש קשר">
          <input value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="טלפון איש קשר">
          <input value={f.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="אמצעי תשלום *">
          <select value={f.preferred_payment_method} onChange={(e) => set('preferred_payment_method', e.target.value)} className={inputCls}>
            {Object.entries(PAYMENT_METHOD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {!linked && (
          <Field label="מועד אחרון לתשלום">
            <input type="date" value={f.payment_deadline} onChange={(e) => set('payment_deadline', e.target.value)} className={inputCls} />
          </Field>
        )}
        <Field label="אופן מסירה">
          <select value={f.delivery_method} onChange={(e) => set('delivery_method', e.target.value)} className={inputCls}>
            <option value="self_pickup">איסוף עצמי מהמטבח</option>
            <option value="volunteer_transport">שינוע ע"י מתנדבים</option>
          </select>
        </Field>
      </div>

      <Field label="הערות">
        <textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} rows={2} />
      </Field>

      <div className="rounded-lg border border-brand-cream-dark bg-brand-cream/30 p-3 text-sm text-surface-muted">
        התפריט והתמחור נקבעים אחרי יצירת האירוע, בכרטיס שלו.
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary">יצירת אירוע</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// בורר גורם משלם: לקוח קיים, ארגון קיים, או יצירת ארגון חדש
// ---------------------------------------------------------------------------
// ארגון (ועד הקהילה, גבאי, קרן) הוא רשומת לקוח עם is_organization, שאינה מופיעה
// ברשימת הלקוחות הרגילה ואינה נכנסת לממשק הלקוח (מיגרציה 54).
function PayerPicker({ value, onChange, onErr }) {
  const [customers, setCustomers] = useState(null);
  const [addingOrg, setAddingOrg] = useState(false);
  const [org, setOrg] = useState({ first_name: '', phone: '', email: '' });

  const load = useCallback(() => {
    api.adminCustomers('?include_organizations=1').then(setCustomers).catch(onErr);
  }, [onErr]);

  useEffect(() => { load(); }, [load]);

  async function createOrg(e) {
    e.preventDefault();
    if (!org.first_name.trim()) return alert('יש להזין שם לגורם המשלם.');
    if (!org.phone.trim()) return alert('יש להזין טלפון (משמש לזיהוי הרשומה).');
    try {
      const { customer } = await api.createCustomer({
        first_name: org.first_name.trim(),
        phone: org.phone.trim(),
        email: org.email.trim() || null,
        status: 'active',
        is_organization: true,
      });
      setAddingOrg(false);
      setOrg({ first_name: '', phone: '', email: '' });
      load();
      onChange(customer.id);
    } catch (e2) { onErr(e2); }
  }

  return (
    <div className="rounded-lg border border-brand-cream-dark p-3">
      <Field label="גורם משלם *" hint="חבר קהילה, או גורם משלם כמו ועד הקהילה / גבאי / קרן">
        {/* priority מקבץ ארגונים בראש הרשימה - הבחירה השכיחה באירוע פנימי;
            בתוך כל קבוצה המיון הוא א"ב לפי שם משפחה. */}
        <CustomerPicker
          customers={customers}
          value={value}
          onChange={onChange}
          ariaLabel="גורם משלם"
          inputClassName={inputCls}
          placeholder="חיפוש לפי שם משפחה, שם או טלפון..."
          priority={(c) => (c.is_organization ? 0 : 1)}
          meta={(c) => (c.is_organization ? 'גורם משלם' : c.phone || '')}
        />
      </Field>

      {!addingOrg ? (
        <button type="button" onClick={() => setAddingOrg(true)} className="btn-ghost mt-2 text-sm">
          + גורם משלם חדש (ועד / קרן)
        </button>
      ) : (
        <div className="mt-3 space-y-2 rounded-lg bg-brand-cream/30 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="שם *">
              <input value={org.first_name} onChange={(e) => setOrg((s) => ({ ...s, first_name: e.target.value }))} className={inputCls} placeholder="ועד הקהילה" />
            </Field>
            <Field label="טלפון *">
              <input value={org.phone} onChange={(e) => setOrg((s) => ({ ...s, phone: e.target.value }))} className={inputCls} dir="ltr" />
            </Field>
            <Field label="מייל">
              <input value={org.email} onChange={(e) => setOrg((s) => ({ ...s, email: e.target.value }))} className={inputCls} dir="ltr" />
            </Field>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={createOrg} className="btn-primary text-sm">שמירה</button>
            <button type="button" onClick={() => setAddingOrg(false)} className="btn-ghost text-sm">ביטול</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// כרטיס אירוע: תפריט, תמחור, גבייה ומלאי
// ---------------------------------------------------------------------------
function EventDetailBody({ data, onErr, onChanged, onLinked }) {
  const [tab, setTab] = useState('menu');
  const tabs = [
    { id: 'menu', label: 'תפריט' },
    { id: 'pricing', label: 'תמחור' },
    { id: 'payments', label: 'גבייה' },
    { id: 'inventory', label: 'מלאי' },
    { id: 'details', label: 'פרטים' },
  ];

  return (
    <div className="space-y-4">
      <EventSummaryStrip data={data} />

      <div className="flex flex-wrap gap-1 border-b border-brand-cream-dark">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium transition ${
              tab === t.id
                ? 'border-b-2 border-brand-gold text-brand-burgundy'
                : 'text-surface-muted hover:text-brand-burgundy'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'menu' && <EventMenuTab data={data} onErr={onErr} onChanged={onChanged} />}
      {tab === 'pricing' && <EventPricingTab data={data} onErr={onErr} onChanged={onChanged} />}
      {tab === 'payments' && <EventPaymentsTab data={data} onErr={onErr} onChanged={onChanged} />}
      {tab === 'inventory' && <EventInventoryTab data={data} onErr={onErr} onChanged={onChanged} />}
      {tab === 'details' && <EventDetailsTab data={data} onErr={onErr} onChanged={onChanged} onLinked={onLinked} />}
    </div>
  );
}

function EventSummaryStrip({ data }) {
  const { summary, event, order, payer, linked } = data;
  const cells = [
    { label: 'סכום סופי', value: shekel(summary.final) },
    { label: 'שולם', value: shekel(summary.paid) },
    { label: 'יתרה', value: shekel(summary.balance), danger: summary.balance > 0.001 },
    { label: 'משלם', value: payer?.full_name || '-' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg border border-brand-cream-dark p-2.5">
            <div className="text-[11px] uppercase tracking-wide text-surface-muted">{c.label}</div>
            <div className={`mt-0.5 text-sm font-semibold tabular-nums ${c.danger ? 'text-red-700' : 'text-brand-burgundy'}`}>
              {c.value}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge map={OCCASION_STATUS} value={event.status} />
        <Badge map={PAYMENT_STATUS} value={order.payment_status} />
        <span className="text-xs text-surface-muted">הזמנה {order.order_number}</span>
        {linked ? (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">
            משויך לשבת פרשת {event.parasha}
          </span>
        ) : event.use_full_workfile && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">מועד מלא</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// לשונית תפריט: מאכלים מהקטלוג + שורות מלאי חופשיות
// ---------------------------------------------------------------------------
function EventMenuTab({ data, onErr, onChanged }) {
  const [slots, setSlots] = useState([]);       // [{ meal_slot_id, portions }]
  const [meals, setMeals] = useState([]);       // [{ meal_slot_id, meal_id, portions }]
  const [lines, setLines] = useState([]);       // שורות מלאי חופשיות
  const [catalog, setCatalog] = useState(null); // { slots, meals }
  const [items, setItems] = useState(null);
  const [units, setUnits] = useState(null);
  const [saving, setSaving] = useState(false);

  // אתחול מהמצב השמור בשרת.
  useEffect(() => {
    setSlots((data.slots || []).map((s) => ({ meal_slot_id: s.meal_slot_id, portions: s.portions })));
    setMeals((data.meals || []).map((m) => ({
      meal_slot_id: m.meal_slot_id, meal_id: m.meal_id, portions: m.portions,
    })));
    setLines((data.inventory_lines || []).map((l) => ({
      inventory_item_id: l.inventory_item_id,
      quantity: l.quantity,
      unit_id: l.unit_id || '',
      unit_cost: l.unit_cost,
      note: l.note || '',
    })));
  }, [data]);

  useEffect(() => {
    Promise.all([
      api.catalogMealSlots('?active=true'),
      api.catalogMeals('?active=true'),
      api.invItems(),
      api.invUnits(),
    ])
      .then(([s, m, i, u]) => { setCatalog({ slots: s, meals: m }); setItems(i); setUnits(u); })
      .catch(onErr);
  }, [onErr]);

  const mealsBySlot = useMemo(() => {
    const map = {};
    for (const m of meals) (map[m.meal_slot_id] ||= []).push(m);
    return map;
  }, [meals]);

  function toggleSlot(slotId) {
    setSlots((s) => (s.some((x) => x.meal_slot_id === slotId)
      ? s.filter((x) => x.meal_slot_id !== slotId)
      : [...s, { meal_slot_id: slotId, portions: 50 }]));
    setMeals((m) => m.filter((x) => x.meal_slot_id !== slotId));
  }

  function toggleMeal(slotId, mealId) {
    setMeals((m) => (m.some((x) => x.meal_slot_id === slotId && x.meal_id === mealId)
      ? m.filter((x) => !(x.meal_slot_id === slotId && x.meal_id === mealId))
      : [...m, { meal_slot_id: slotId, meal_id: mealId, portions: null }]));
  }

  async function save() {
    setSaving(true);
    try {
      await api.setEventMenu(data.id, { slots, meals, inventory_lines: lines });
      onChanged();
    } catch (e) { onErr(e); }
    finally { setSaving(false); }
  }

  if (!catalog || !items) return <p className="text-sm text-surface-muted">טוען קטלוג...</p>;

  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <h4 className="text-sm font-bold text-brand-burgundy">סעודות ומאכלים</h4>
        <p className="text-xs text-surface-muted">
          באירוע אין אכיפה של מינימום/מקסימום לפי קטגוריה - הבחירה חופשית.
        </p>

        <div className="flex flex-wrap gap-2">
          {catalog.slots.map((s) => {
            const on = slots.some((x) => x.meal_slot_id === s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSlot(s.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  on ? 'border-brand-gold bg-brand-cream/60 font-semibold text-brand-burgundy'
                     : 'border-brand-cream-dark text-surface-muted hover:border-brand-gold'
                }`}
              >
                {s.name}
              </button>
            );
          })}
        </div>

        {slots.map((slot) => {
          const slotDef = catalog.slots.find((s) => s.id === slot.meal_slot_id);
          const selected = mealsBySlot[slot.meal_slot_id] || [];
          return (
            <div key={slot.meal_slot_id} className="rounded-lg border border-brand-cream-dark p-3">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <span className="font-semibold text-brand-burgundy">{slotDef?.name || 'סעודה'}</span>
                <label className="flex items-center gap-2 text-sm">
                  מנות:
                  <input
                    type="number"
                    min="1"
                    value={slot.portions}
                    onChange={(e) => setSlots((s) => s.map((x) => (
                      x.meal_slot_id === slot.meal_slot_id ? { ...x, portions: Number(e.target.value) } : x
                    )))}
                    className="w-24 rounded-lg border border-brand-cream-dark p-1.5 text-center"
                  />
                </label>
                <span className="text-xs text-surface-muted">{selected.length} מאכלים</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {catalog.meals.map((m) => {
                  const on = selected.some((x) => x.meal_id === m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMeal(slot.meal_slot_id, m.id)}
                      className={`rounded border px-2 py-1 text-xs transition ${
                        on ? 'border-brand-gold bg-brand-cream/60 font-semibold text-brand-burgundy'
                           : 'border-brand-cream-dark text-surface-muted hover:border-brand-gold'
                      }`}
                    >
                      {m.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <InventoryLinesEditor lines={lines} setLines={setLines} items={items} units={units} />

      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'שומר...' : 'שמירת התפריט וחישוב מחיר'}
        </button>
      </div>
    </div>
  );
}

// שורות מלאי חופשיות: פריט שנצרך ישירות בלי מאכל מתווך (כלים, שתייה).
function InventoryLinesEditor({ lines, setLines, items, units }) {
  const itemById = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);

  const setLine = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { inventory_item_id: '', quantity: 1, unit_id: '', unit_cost: '', note: '' }]);
  const removeLine = (idx) => setLines((ls) => ls.filter((_, i) => i !== idx));

  // בבחירת פריט: ברירת המחדל ליחידה היא יחידת הבסיס שלו, והעלות מהמחיר האחרון.
  function pickItem(idx, itemId) {
    const item = itemById[itemId];
    setLine(idx, {
      inventory_item_id: itemId,
      unit_id: item?.unit_id || '',
      unit_cost: item?.last_purchase_price ?? '',
    });
  }

  return (
    <section className="space-y-2">
      <h4 className="text-sm font-bold text-brand-burgundy">שורות מלאי ישירות</h4>
      <p className="text-xs text-surface-muted">
        פריטים שנצרכים באירוע בלי מאכל: כלים חד-פעמיים, שתייה, מפות. הכמות מוחלטת ואינה מוכפלת במנות.
      </p>

      {lines.map((l, idx) => (
        <div key={idx} className="flex flex-wrap items-end gap-2 rounded-lg border border-brand-cream-dark p-2">
          <div className="min-w-[12rem] flex-1">
            <span className="mb-1 block text-xs text-surface-muted">פריט</span>
            <select value={l.inventory_item_id} onChange={(e) => pickItem(idx, e.target.value)} className={inputCls}>
              <option value="">- בחירה -</option>
              {(items || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="w-24">
            <span className="mb-1 block text-xs text-surface-muted">כמות</span>
            <input
              type="number" step="0.01" min="0"
              value={l.quantity}
              onChange={(e) => setLine(idx, { quantity: e.target.value })}
              className={inputCls}
            />
          </div>
          <div className="w-32">
            <span className="mb-1 block text-xs text-surface-muted">יחידה</span>
            <select value={l.unit_id || ''} onChange={(e) => setLine(idx, { unit_id: e.target.value })} className={inputCls}>
              <option value="">- יחידת בסיס -</option>
              {(units || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="w-28">
            <span className="mb-1 block text-xs text-surface-muted">עלות ליחידה</span>
            <input
              type="number" step="0.01" min="0"
              value={l.unit_cost}
              onChange={(e) => setLine(idx, { unit_cost: e.target.value })}
              className={inputCls}
            />
          </div>
          <button type="button" onClick={() => removeLine(idx)} className="px-1 pb-2 text-sm text-red-600 hover:underline">
            הסר
          </button>
        </div>
      ))}

      <button type="button" onClick={addLine} className="btn-ghost text-sm">+ הוסף שורת מלאי</button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// לשונית תמחור
// ---------------------------------------------------------------------------
function EventPricingTab({ data, onErr, onChanged }) {
  const { costing, order } = data;
  const [override, setOverride] = useState(order.base_amount_override ?? '');
  const [busy, setBusy] = useState(false);

  const priceWarnings = (costing.warnings || []).filter((w) => w.type === 'missing_price');
  const conversionWarnings = (costing.warnings || []).filter((w) => w.type === 'missing_conversion');
  const unlinkedWarnings = (costing.warnings || []).filter((w) => w.type === 'unlinked_ingredient');

  async function recalc() {
    setBusy(true);
    try { await api.recalcEventPrice(data.id); onChanged(); }
    catch (e) { onErr(e); }
    finally { setBusy(false); }
  }

  async function saveOverride(value) {
    setBusy(true);
    try { await api.setEventPricing(data.id, { base_amount_override: value }); onChanged(); }
    catch (e) { onErr(e); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {(priceWarnings.length > 0 || conversionWarnings.length > 0 || unlinkedWarnings.length > 0) && (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">העלות המחושבת חלקית</p>
          {priceWarnings.length > 0 && (
            <p>חסר מחיר קנייה: {[...new Set(priceWarnings.map((w) => w.item_name))].join(', ')}</p>
          )}
          {conversionWarnings.length > 0 && (
            <p>חסרה המרת יחידות: {[...new Set(conversionWarnings.map((w) => `${w.item_name} (${w.from_unit} → ${w.base_unit})`))].join(', ')}</p>
          )}
          {unlinkedWarnings.length > 0 && (
            <p>מרכיבים בלי קישור למלאי: {[...new Set(unlinkedWarnings.map((w) => w.name))].join(', ')}</p>
          )}
        </div>
      )}

      <section>
        <h4 className="mb-2 text-sm font-bold text-brand-burgundy">עלות המאכלים</h4>
        {costing.meal_breakdown.length === 0 ? (
          <p className="text-sm text-surface-muted">לא נבחרו מאכלים.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-surface-muted">
                <tr>
                  <th className="p-2 text-right">מאכל</th>
                  <th className="p-2 text-right">עלות למנה</th>
                  <th className="p-2 text-right">מנות</th>
                  <th className="p-2 text-right">סה"כ</th>
                </tr>
              </thead>
              <tbody>
                {costing.meal_breakdown.map((m) => (
                  <tr key={m.meal_id} className="border-t border-brand-cream-dark">
                    <td className="p-2">{m.meal_name}</td>
                    <td className="p-2 tabular-nums">{shekel(m.cost_per_portion)}</td>
                    <td className="p-2 tabular-nums">{m.portions}</td>
                    <td className="p-2 font-medium tabular-nums">{shekel(m.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {costing.inventory_line_breakdown.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-bold text-brand-burgundy">שורות מלאי ישירות</h4>
          <div className="overflow-x-auto">
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
                {costing.inventory_line_breakdown.map((l, i) => (
                  <tr key={i} className="border-t border-brand-cream-dark">
                    <td className="p-2">{l.item_name}</td>
                    <td className="p-2 tabular-nums">{l.quantity}</td>
                    <td className="p-2 tabular-nums">{shekel(l.unit_cost)}</td>
                    <td className="p-2 font-medium tabular-nums">{shekel(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-brand-cream-dark p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-surface-muted">עלות מחושבת (מאכלים)</span>
          <span className="font-semibold tabular-nums">{shekel(costing.meals_total)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-surface-muted">שורות מלאי</span>
          <span className="font-semibold tabular-nums">{shekel(costing.inventory_lines_total)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand-cream-dark pt-2 text-sm">
          <span className="text-surface-muted">מחיר בסיס שנשמר</span>
          <span className="font-semibold tabular-nums">{shekel(order.base_amount)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="font-bold text-brand-burgundy">סכום סופי</span>
          <span className="font-bold tabular-nums text-brand-burgundy">{shekel(order.final_amount)}</span>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-brand-cream-dark p-3">
        <Field
          label="תיקון ידני של מחיר הבסיס"
          hint="השאירו ריק כדי לתמחר לפי העלות המחושבת. שימושי להוספת תקורה או לעיגול לסכום נוח."
        >
          <input
            type="number" step="0.01" min="0"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            className={inputCls}
            placeholder={String(costing.meals_total)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => saveOverride(override)} disabled={busy} className="btn-primary text-sm">שמירת התיקון</button>
          {order.base_amount_override != null && (
            <button onClick={() => { setOverride(''); saveOverride(null); }} disabled={busy} className="btn-ghost text-sm">
              ביטול התיקון
            </button>
          )}
          <button onClick={recalc} disabled={busy} className="btn-ghost text-sm">חישוב מחיר מחדש</button>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// לשונית גבייה - משתמשת בנתיבי התשלומים הרגילים לפי order_id
// ---------------------------------------------------------------------------
function EventPaymentsTab({ data, onErr, onChanged }) {
  const { order, summary, payments } = data;
  const [f, setF] = useState({
    amount: '', payment_method: 'bank_transfer',
    paid_at: new Date().toISOString().slice(0, 10), internal_note: '',
  });
  const [busy, setBusy] = useState(false);

  async function addPayment(e) {
    e.preventDefault();
    if (!(Number(f.amount) > 0)) return alert('סכום התשלום חייב להיות גדול מאפס.');
    setBusy(true);
    try {
      await api.addOrderPayment(order.id, { ...f, amount: Number(f.amount) });
      setF((s) => ({ ...s, amount: '', internal_note: '' }));
      onChanged();
    } catch (e2) { onErr(e2); }
    finally { setBusy(false); }
  }

  async function removePayment(pid) {
    if (!confirm('למחוק את תיעוד התשלום?')) return;
    try { await api.removeOrderPayment(order.id, pid); onChanged(); }
    catch (e) { onErr(e); }
  }

  return (
    <div className="space-y-4">
      {summary.balance > 0.001 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          נותרה יתרה לתשלום של {shekel(summary.balance)}. האירוע נכנס לחישובים התפעוליים ממילא (כלל 8.7),
          והיתרה ממשיכה להופיע כאן וברשימת ההזמנות עד שתיסגר.
        </div>
      )}

      <form onSubmit={addPayment} className="space-y-2 rounded-lg border border-brand-cream-dark p-3">
        <h4 className="text-sm font-bold text-brand-burgundy">תיעוד תשלום</h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Field label="סכום *">
            <input type="number" step="0.01" min="0" value={f.amount}
              onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="אמצעי">
            <select value={f.payment_method} onChange={(e) => setF((s) => ({ ...s, payment_method: e.target.value }))} className={inputCls}>
              {Object.entries(PAYMENT_METHOD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="תאריך">
            <input type="date" value={f.paid_at} onChange={(e) => setF((s) => ({ ...s, paid_at: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="הערה">
            <input value={f.internal_note} onChange={(e) => setF((s) => ({ ...s, internal_note: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className="btn-primary text-sm">רישום תשלום</button>
        </div>
      </form>

      {payments.length === 0 ? (
        <p className="text-sm text-surface-muted">טרם תועדו תשלומים.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-surface-muted">
            <tr>
              <th className="p-2 text-right">תאריך</th>
              <th className="p-2 text-right">סכום</th>
              <th className="p-2 text-right">אמצעי</th>
              <th className="p-2 text-right">הערה</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-brand-cream-dark">
                <td className="p-2">{p.paid_at}</td>
                <td className="p-2 font-medium tabular-nums">{shekel(p.amount)}</td>
                <td className="p-2">{PAYMENT_METHOD[p.payment_method] || p.payment_method}</td>
                <td className="p-2 text-surface-muted">{p.internal_note || '-'}</td>
                <td className="p-2">
                  <button onClick={() => removePayment(p.id)} className="text-xs text-red-600 hover:underline">מחיקה</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// לשונית מלאי - תצוגה מקדימה וניכוי, דרך נתיבי המלאי של תיק השבת
// ---------------------------------------------------------------------------
function EventInventoryTab({ data, onErr, onChanged }) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const deducted = data.shabbat_file?.is_inventory_deducted;

  useEffect(() => {
    api.shabbatInventory(data.event.id).then(setPreview).catch(onErr);
  }, [data.event.id, onErr]);

  async function deduct() {
    if (!confirm('לנכות את המלאי של האירוע? הפעולה מתבצעת פעם אחת ואינה הפיכה.')) return;
    setBusy(true);
    try {
      const res = await api.invDeductAuto(data.event.id);
      alert(`נוכו ${res.deducted_items} פריטים.`);
      onChanged();
    } catch (e) { onErr(e); }
    finally { setBusy(false); }
  }

  if (!preview) return <p className="text-sm text-surface-muted">טוען דוח מלאי...</p>;

  // הדוח מגיע מקובץ לפי ספק (אותו דוח חוסרים של תיק השבת). באירוע התצוגה
  // הפשוטה יותר היא רשימה שטוחה אחת, ולכן משטחים את כל הקבוצות.
  const rows = [
    ...(preview.suppliers || []).flatMap((g) => g.items || []),
    ...(preview.direct_suppliers || []).flatMap((g) => g.items || []),
  ];

  return (
    <div className="space-y-3">
      {data.linked && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <p>האירוע מקושר לתיק העבודה של השבת - הדוח כאן הוא דוח המלאי המלא של כל השבת, וניכוי המלאי מתבצע יחד עם כל הזמנות השבת, לא בנפרד מכאן.</p>
          <button onClick={() => navigate(`/admin/shabbat/${data.event.id}`)} className="btn-ghost mt-2 text-sm">
            מעבר לתיק השבת ←
          </button>
        </div>
      )}

      {deducted ? (
        <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          המלאי {data.linked ? 'של השבת המקושרת' : 'של האירוע'} כבר נוכה.
        </div>
      ) : !data.linked && (
        <button onClick={deduct} disabled={busy} className="btn-primary text-sm">
          {busy ? 'מנכה...' : 'ניכוי מלאי לאירוע'}
        </button>
      )}

      {(preview.unlinked || []).length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">שורות שאינן ניתנות לניכוי</p>
          <p>{preview.unlinked.map((u) => u.name).join(', ')}</p>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-surface-muted">
          אין צריכת מלאי מחושבת לאירוע. ודאו שתועד תפריט ושלמאכלים מוגדרים מרכיבים מהמלאי.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-surface-muted">
              <tr>
                <th className="p-2 text-right">פריט</th>
                <th className="p-2 text-right">נדרש</th>
                <th className="p-2 text-right">במלאי</th>
                <th className="p-2 text-right">חוסר</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_id} className="border-t border-brand-cream-dark">
                  <td className="p-2">{r.name}</td>
                  <td className="p-2 tabular-nums">{r.required} {r.unit}</td>
                  <td className="p-2 tabular-nums">{r.on_hand == null ? '-' : `${r.on_hand} ${r.unit}`}</td>
                  <td className={`p-2 tabular-nums ${r.missing > 0 ? 'font-semibold text-red-700' : ''}`}>
                    {r.missing > 0 ? `${r.missing} ${r.unit}` : '-'}
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

// ---------------------------------------------------------------------------
// לשונית פרטים
// ---------------------------------------------------------------------------
function EventDetailsTab({ data, onErr, onChanged, onLinked }) {
  const { event, order, linked } = data;
  const [f, setF] = useState({
    title: event.title || '',
    gregorian_date: event.gregorian_date || '',
    event_time: event.event_time ? String(event.event_time).slice(0, 5) : '',
    event_type: event.event_type || 'community',
    status: event.status || 'open',
    payment_deadline: event.payment_deadline || '',
    notes: (linked ? order.notes : event.notes) || '',
    customer_id: order.customer_id || '',
    venue_name: order.venue_name || '',
    venue_address: order.venue_address || '',
    contact_name: order.contact_name || '',
    contact_phone: order.contact_phone || '',
    preferred_payment_method: order.preferred_payment_method || 'bank_transfer',
    delivery_method: order.delivery_method || 'self_pickup',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try { await api.updateEvent(data.id, f); onChanged(); }
    catch (e2) { onErr(e2); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      {linked && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900">
          האירוע מקושר לשבת פרשת {event.parasha}. תאריך, סטטוס ומועד תשלום נקבעים לפי השבת ואינם ניתנים לעריכה מכאן.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="שם האירוע *">
          <input value={f.title} onChange={(e) => set('title', e.target.value)} className={inputCls} />
        </Field>
        {!linked && (
          <Field label="סוג האירוע">
            <select value={f.event_type} onChange={(e) => set('event_type', e.target.value)} className={inputCls}>
              {EVENT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}
        {!linked && (
          <Field label="תאריך">
            <input type="date" value={f.gregorian_date} onChange={(e) => set('gregorian_date', e.target.value)} className={inputCls} />
          </Field>
        )}
        <Field label="שעה">
          <input type="time" value={f.event_time} onChange={(e) => set('event_time', e.target.value)} className={inputCls} />
        </Field>
        {!linked && (
          <Field label="סטטוס">
            <select value={f.status} onChange={(e) => set('status', e.target.value)} className={inputCls}>
              {Object.entries(OCCASION_STATUS).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
            </select>
          </Field>
        )}
        {!linked && (
          <Field label="מועד אחרון לתשלום">
            <input type="date" value={f.payment_deadline} onChange={(e) => set('payment_deadline', e.target.value)} className={inputCls} />
          </Field>
        )}
      </div>

      <PayerPicker value={f.customer_id} onChange={(id) => set('customer_id', id)} onErr={onErr} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="מקום האירוע *">
          <input value={f.venue_name} onChange={(e) => set('venue_name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="כתובת *">
          <input value={f.venue_address} onChange={(e) => set('venue_address', e.target.value)} className={inputCls} />
        </Field>
        <Field label="איש קשר">
          <input value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="טלפון איש קשר">
          <input value={f.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="אמצעי תשלום">
          <select value={f.preferred_payment_method} onChange={(e) => set('preferred_payment_method', e.target.value)} className={inputCls}>
            {Object.entries(PAYMENT_METHOD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="אופן מסירה">
          <select value={f.delivery_method} onChange={(e) => set('delivery_method', e.target.value)} className={inputCls}>
            <option value="self_pickup">איסוף עצמי מהמטבח</option>
            <option value="volunteer_transport">שינוע ע"י מתנדבים</option>
          </select>
        </Field>
      </div>

      <Field label="הערות">
        <textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} rows={2} />
      </Field>

      <button type="submit" disabled={busy} className="btn-primary">{busy ? 'שומר...' : 'שמירה'}</button>

      {!linked && event.event_type === 'private' && (
        <LinkToShabbatPanel data={data} onErr={onErr} onLinked={onLinked} />
      )}
    </form>
  );
}

// קישור אירוע עצמאי קיים לשבת קיימת: הופך אותו לאירוע מקושר בלי לאבד את
// התפריט/התמחור/התשלומים שכבר הוזנו (הם תלויים ב-order_id ולא נוגעים בשינוי).
function LinkToShabbatPanel({ data, onErr, onLinked }) {
  const [open, setOpen] = useState(false);
  const [shabbatot, setShabbatot] = useState(null);
  const [shabbatId, setShabbatId] = useState('');
  const [busy, setBusy] = useState(false);
  const deducted = data.shabbat_file?.is_inventory_deducted;

  useEffect(() => {
    if (open && !shabbatot) api.allShabbatot().then(setShabbatot).catch(onErr);
  }, [open, shabbatot, onErr]);

  async function link() {
    if (!shabbatId) return alert('יש לבחור שבת לקישור.');
    if (!confirm('לקשר את האירוע לשבת הנבחרת? המועד ותיק העבודה העצמאיים של האירוע יימחקו, והתפריט/התמחור/התשלומים יעברו לתיק העבודה של השבת.')) return;
    setBusy(true);
    try {
      const { id } = await api.linkEventToShabbat(data.id, shabbatId);
      onLinked(id);
    } catch (e) { onErr(e); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-brand-cream-dark p-3">
      {deducted ? (
        <p className="text-xs text-surface-muted">
          לא ניתן לקשר את האירוע לשבת קיימת אחרי שהמלאי שלו כבר נוכה.
        </p>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost text-sm">
          קישור לשבת קיימת
        </button>
      ) : (
        <div className="space-y-2">
          <Field
            label="קישור לשבת קיימת"
            hint="האירוע ייכנס לתיק העבודה, ניכוי המלאי והמטבח של השבת שתיבחר, במקום לתיק העצמאי שלו."
          >
            <select value={shabbatId} onChange={(e) => setShabbatId(e.target.value)} className={inputCls}>
              <option value="">- בחירת שבת -</option>
              {(shabbatot || []).map((s) => (
                <option key={s.id} value={s.id}>{s.gregorian_date} · {s.parasha}</option>
              ))}
            </select>
          </Field>
          <div className="flex gap-2">
            <button type="button" onClick={link} disabled={busy} className="btn-primary text-sm">
              {busy ? 'מקשר...' : 'קישור'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost text-sm">ביטול</button>
          </div>
        </div>
      )}
    </div>
  );
}
