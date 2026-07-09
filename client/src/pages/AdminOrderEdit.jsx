import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { MealCategoryPicker } from '../components/MealCategoryPicker.jsx';

const MIN_PORTIONS = 50;
const MAX_PORTIONS = 100;

// עריכה מלאה של הזמנה קיימת ע"י מנהל — פרטי לקוח, אספקה, סעודות, מנות, מאכלים, תוספות.
// המחיר מחושב מחדש בשרת בעת השמירה (הערכה בלבד כאן).
export default function AdminOrderEdit({ onAuthError }) {
  const { id } = useParams();
  const nav = useNavigate();
  const [catalog, setCatalog] = useState(null);
  const [shabbatot, setShabbatot] = useState([]);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // מצב ההזמנה הנערכת
  const [shabbatId, setShabbatId] = useState('');
  const [slots, setSlots] = useState({});      // { slotId: portions }
  const [meals, setMeals] = useState({});       // { "slotId:mealId": true }
  const [extras, setExtras] = useState({});     // { extraId: quantity }
  const [delivery, setDelivery] = useState('volunteer_transport');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [transportNotes, setTransportNotes] = useState('');
  const [payMethod, setPayMethod] = useState('');
  // פרטי לקוח
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custAddress, setCustAddress] = useState('');

  function handleErr(e) {
    if (e.name === 'AdminAuthError') { onAuthError?.(); return true; }
    return false;
  }

  useEffect(() => {
    Promise.all([api.adminOrder(id), api.catalog(), api.allShabbatot()])
      .then(([ord, cat, shab]) => {
        setCatalog(cat); setShabbatot(shab); setOrder(ord);

        // אתחול מצב מההזמנה הקיימת
        setShabbatId(ord.shabbat_id);
        setSlots(Object.fromEntries((ord.slots || []).map((s) => [s.meal_slot_id, String(s.portions)])));
        setMeals(Object.fromEntries((ord.meals || []).map((m) => [`${m.meal_slot_id}:${m.meal_id}`, true])));
        setExtras(Object.fromEntries((ord.extras || []).map((e) => [e.extra_id, String(e.actual_quantity)])));
        setDelivery(ord.delivery_method || 'volunteer_transport');
        setContactName(ord.contact_name || '');
        setContactPhone(ord.contact_phone || '');
        setVenueAddress(ord.venue_address || '');
        setTransportNotes(ord.transport_notes || '');
        setPayMethod(ord.preferred_payment_method || '');
        setCustName(ord.customers?.full_name || '');
        setCustPhone(ord.customers?.phone || '');
        setCustEmail(ord.customers?.email || '');
        setCustAddress(ord.customers?.address || '');
      })
      .catch((e) => { if (!handleErr(e)) setError(e.message); })
      .finally(() => setLoading(false));
  }, [id]);

  const selectedSlots = useMemo(
    () => Object.entries(slots).filter(([, p]) => Number(p) > 0).map(([sid, p]) => ({ meal_slot_id: sid, portions: Number(p) })),
    [slots]
  );

  // אומדן מחיר בצד לקוח (השרת סמכותי)
  const priceEstimate = useMemo(() => {
    if (!catalog) return { base: 0, extras: 0, total: 0 };
    const count = selectedSlots.length;
    const track = catalog.price_tracks.find((t) => t.meals_count === count)
      || [...catalog.price_tracks].filter((t) => (t.meals_count || 0) <= count).sort((a, b) => b.meals_count - a.meals_count)[0];
    const perPortion = track ? Number(track.price_per_portion) : 0;
    const totalPortions = selectedSlots.reduce((s, x) => s + x.portions, 0);
    const base = totalPortions * perPortion;
    let ex = 0;
    for (const [eid, qty] of Object.entries(extras)) {
      const e = catalog.extras.find((x) => x.id === eid);
      if (e && Number(qty) > 0) ex += Number(e.unit_price) * Number(qty);
    }
    return { base, extras: ex, total: base + ex };
  }, [catalog, selectedSlots, extras]);

  function toggleMeal(slotId, mealId) {
    const key = `${slotId}:${mealId}`;
    setMeals((m) => ({ ...m, [key]: !m[key] }));
  }

  const customerChanged = order && (
    custName !== (order.customers?.full_name || '') ||
    custPhone !== (order.customers?.phone || '') ||
    custEmail !== (order.customers?.email || '') ||
    custAddress !== (order.customers?.address || '')
  );

  async function save() {
    setError('');
    if (!shabbatId) return setError('נא לבחור שבת.');
    if (selectedSlots.length === 0) return setError('נא לבחור לפחות סעודה אחת עם מספר מנות.');
    if (selectedSlots.some((slot) => slot.portions < MIN_PORTIONS || slot.portions > MAX_PORTIONS)) {
      return setError(`מספר המנות בכל סעודה חייב להיות בין ${MIN_PORTIONS} ל-${MAX_PORTIONS}.`);
    }

    setSaving(true);
    try {
      // 1) פרטי לקוח — רק אם השתנו
      if (customerChanged) {
        await api.updateOrderCustomer(id, {
          full_name: custName, phone: custPhone, email: custEmail, address: custAddress,
        });
      }

      // 2) גוף ההזמנה — מחיר מחושב מחדש בשרת
      const mealsPayload = Object.entries(meals).filter(([, v]) => v).map(([k]) => {
        const [meal_slot_id, meal_id] = k.split(':');
        return { meal_slot_id, meal_id };
      });
      const extrasPayload = Object.entries(extras).filter(([, q]) => Number(q) > 0)
        .map(([extra_id, q]) => ({ extra_id, actual_quantity: Number(q) }));

      await api.updateOrder(id, {
        shabbat_id: shabbatId,
        slots: selectedSlots,
        meals: mealsPayload,
        extras: extrasPayload,
        delivery_method: delivery,
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        venue_address: venueAddress || null,
        transport_notes: transportNotes || null,
        preferred_payment_method: payMethod || null,
      });
      nav(`/admin/orders/${id}`);
    } catch (e) { if (!handleErr(e)) setError(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <Page title="עריכת הזמנה"><p>טוען...</p></Page>;
  if (!order) return <Page title="עריכת הזמנה"><p>ההזמנה לא נמצאה.</p></Page>;
  if (order.order_status === 'cancelled') {
    return (
      <Page title="עריכת הזמנה">
        <div className="card">
          <p className="text-brand-burgundy/70">לא ניתן לערוך הזמנה מבוטלת.</p>
          <Link to={`/admin/orders/${id}`} className="btn-ghost mt-3 inline-block">← חזרה לפרטי ההזמנה</Link>
        </div>
      </Page>
    );
  }

  return (
    <Page title={`עריכת הזמנה ${order.order_number}`} subtitle="שינויים נשמרים והמחיר מחושב מחדש">
      <div className="mb-4">
        <Link to={`/admin/orders/${id}`} className="btn-ghost">← ביטול וחזרה לפרטים</Link>
      </div>

      {error && <div className="bg-red-50 text-red-700 rounded-xl p-3 mb-4">{error}</div>}

      {/* פרטי לקוח */}
      <section className="card mb-5">
        <h2 className="font-bold text-brand-burgundy mb-3">פרטי לקוח</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <LabeledInput label="שם מלא" value={custName} onChange={setCustName} />
          <LabeledInput label="טלפון" value={custPhone} onChange={setCustPhone} />
          <LabeledInput label="דוא״ל" value={custEmail} onChange={setCustEmail} />
          <LabeledInput label="כתובת" value={custAddress} onChange={setCustAddress} />
        </div>
      </section>

      {/* אספקה ותשלום */}
      <section className="card mb-5">
        <h2 className="font-bold text-brand-burgundy mb-3">אספקה ותשלום</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-brand-burgundy/60">אופן אספקה</span>
            <select className="input w-full" value={delivery} onChange={(e) => setDelivery(e.target.value)}>
              <option value="volunteer_transport">שינוע ע"י מתנדבים</option>
              <option value="self_pickup">איסוף עצמי מהמטבח</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-brand-burgundy/60">אמצעי תשלום מועדף</span>
            <select className="input w-full" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              <option value="">— לא נבחר —</option>
              <option value="bank_transfer">העברה בנקאית</option>
              <option value="cash">מזומן</option>
              <option value="check">צ׳ק</option>
            </select>
          </label>
          <LabeledInput label="איש קשר לקבלה" value={contactName} onChange={setContactName} />
          <LabeledInput label="טלפון איש קשר" value={contactPhone} onChange={setContactPhone} />
          <LabeledInput label="כתובת האולם" value={venueAddress} onChange={setVenueAddress} />
          <LabeledInput label="הערות שינוע" value={transportNotes} onChange={setTransportNotes} />
        </div>
      </section>

      {/* בחירת שבת */}
      <section className="card mb-5">
        <h2 className="font-bold text-brand-burgundy mb-3">שבת</h2>
        <select className="input w-full" value={shabbatId} onChange={(e) => setShabbatId(e.target.value)}>
          {shabbatot.map((s) => (
            <option key={s.id} value={s.id}>
              {s.parasha} · {s.gregorian_date}{s.status !== 'open' ? ' (סגורה)' : ''}
            </option>
          ))}
        </select>
      </section>

      {/* סעודות ומנות */}
      <section className="card mb-5">
        <h2 className="font-bold text-brand-burgundy mb-3">סעודות ומספר מנות</h2>
        <div className="space-y-2">
          {catalog.meal_slots.map((slot) => (
            <div key={slot.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-brand-cream/40">
              <span className="font-medium">{slot.name}{slot.requires_companion && <span className="text-xs text-brand-gold-dark mr-1"> (דורש עוד סעודה)</span>}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-brand-burgundy/60">מנות:</span>
                <input type="number" min={MIN_PORTIONS} max={MAX_PORTIONS} className="input w-24 py-1 text-center"
                  value={slots[slot.id] || ''} placeholder="0"
                  onChange={(e) => setSlots({ ...slots, [slot.id]: e.target.value })} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* מאכלים לפי סעודה */}
      {selectedSlots.length > 0 && (
        <section className="card mb-5">
          <h2 className="font-bold text-brand-burgundy mb-3">בחירת מאכלים</h2>
          {selectedSlots.map(({ meal_slot_id }) => {
            const slot = catalog.meal_slots.find((s) => s.id === meal_slot_id);
            return (
              <div key={meal_slot_id} className="mb-3 last:mb-0">
                <h3 className="font-bold text-brand-gold-dark mb-1.5">{slot?.name}</h3>
                <MealCategoryPicker
                  catalog={catalog}
                  mealSlotId={meal_slot_id}
                  selectedMeals={meals}
                  onToggleMeal={toggleMeal}
                />
              </div>
            );
          })}
        </section>
      )}

      {/* תוספות */}
      <section className="card mb-5">
        <h2 className="font-bold text-brand-burgundy mb-3">תוספות בתשלום</h2>
        <div className="space-y-2">
          {catalog.extras.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-brand-cream/40">
              <div>
                <span className="font-medium">{e.name}</span>
                <span className="text-sm text-brand-burgundy/60"> — {e.unit_price}₪ ל{e.billing_unit}</span>
              </div>
              <input type="number" min="0" className="input w-24 py-1 text-center" placeholder="0"
                value={extras[e.id] || ''} onChange={(ev) => setExtras({ ...extras, [e.id]: ev.target.value })} />
            </div>
          ))}
        </div>
      </section>

      {/* שמירה */}
      <section className="card sticky bottom-4 border-2 border-brand-gold">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm text-brand-burgundy/60">סה"כ משוער</div>
            <div className="text-2xl font-extrabold text-brand-burgundy">{priceEstimate.total.toFixed(2)} ₪</div>
            <div className="text-xs text-brand-burgundy/50">בסיס {priceEstimate.base.toFixed(0)}₪ + תוספות {priceEstimate.extras.toFixed(0)}₪</div>
          </div>
          <button className="btn-primary text-lg px-8" onClick={save} disabled={saving}>
            {saving ? 'שומר...' : 'שמירת שינויים'}
          </button>
        </div>
        <p className="text-xs text-brand-burgundy/50 mt-2">המחיר הסופי מחושב מחדש ע"י המערכת מהמחירון הפעיל.</p>
      </section>
    </Page>
  );
}

function LabeledInput({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-sm text-brand-burgundy/60">{label}</span>
      <input className="input w-full" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
