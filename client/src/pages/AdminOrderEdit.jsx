import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { MealCategoryPicker } from '../components/MealCategoryPicker.jsx';
import { calcMealSurcharges, slotComboKey } from '../lib/pricing.js';

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
  const [venueName, setVenueName] = useState('');
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
        // ערך המאכל: מספר מנות אם נשמר (קטגוריה שמחלקת מנות), אחרת true (בחירה רגילה)
        setMeals(Object.fromEntries((ord.meals || []).map((m) => [
          `${m.meal_slot_id}:${m.meal_id}`,
          m.portions != null ? Number(m.portions) : true,
        ])));
        setExtras(Object.fromEntries((ord.extras || []).map((e) => [e.extra_id, String(e.actual_quantity)])));
        setDelivery(ord.delivery_method || 'volunteer_transport');
        setContactName(ord.contact_name || '');
        setContactPhone(ord.contact_phone || '');
        setVenueName(ord.venue_name || '');
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

  // סעודות בכמות חריגה (מחוץ ל-50–100) — מותרות למנהל אך יסומנו כחריג לתיעוד.
  const exceptionSlots = useMemo(
    () => selectedSlots.filter((s) => s.portions < MIN_PORTIONS || s.portions > MAX_PORTIONS),
    [selectedSlots]
  );

  // מזהי המאכלים שנבחרו בכל הסעודות (מפתח הבחירה הוא `slotId:mealId`).
  const selectedMealIds = useMemo(
    () => new Set(Object.keys(meals).map((key) => key.split(':')[1])),
    [meals]
  );

  // תוספות שמותנות בהזמנת מאכל מסוים (סעיף 14) מוצגות רק כשנבחר לפחות אחד
  // מהמאכלים המקושרים; השרת חוסם שמירה של תוספת כזו בלי המאכל.
  const visibleExtras = useMemo(() => {
    if (!catalog) return [];
    return catalog.extras.filter((e) => {
      const required = e.required_meal_ids || [];
      return required.length === 0 || required.some((id) => selectedMealIds.has(id));
    });
  }, [catalog, selectedMealIds]);

  // המאכל שהתנה תוספת הוסר מההזמנה -> מנקים את הכמות שלה.
  useEffect(() => {
    if (!catalog) return;
    const visibleIds = new Set(visibleExtras.map((e) => e.id));
    setExtras((prev) => {
      const next = {};
      let changed = false;
      for (const [eid, qty] of Object.entries(prev)) {
        if (visibleIds.has(eid)) next[eid] = qty;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [catalog, visibleExtras]);

  // אומדן מחיר בצד לקוח (השרת סמכותי) — בחירת מסלול לפי צירוף הסעודות המדויק (סעיף 15)
  const priceEstimate = useMemo(() => {
    if (!catalog) return { base: 0, extras: 0, total: 0, noMatch: false };
    const selectedKey = slotComboKey(selectedSlots.map((s) => s.meal_slot_id));
    const track = catalog.price_tracks.find((t) => slotComboKey(t.meal_slot_ids) === selectedKey);
    const perPortion = track ? Number(track.price_per_portion) : 0;
    const totalPortions = selectedSlots.reduce((s, x) => s + x.portions, 0);
    const base = totalPortions * perPortion
      + calcMealSurcharges(meals, catalog.meals, selectedSlots);
    let ex = 0;
    for (const [eid, qty] of Object.entries(extras)) {
      const e = catalog.extras.find((x) => x.id === eid);
      if (e && Number(qty) > 0) ex += Number(e.unit_price) * Number(qty);
    }
    const noMatch = selectedSlots.length > 0 && !track;
    return { base, extras: ex, total: base + ex, noMatch };
  }, [catalog, selectedSlots, meals, extras]);

  // מפה: category_id -> מצב חלוקה ('equal' | 'additive'). תאימות-לאחור לדגל הישן.
  const splitModeByCategory = useMemo(() => {
    const map = {};
    for (const c of catalog?.categories || []) {
      const mode = c.split_mode || (c.requires_portion_split ? 'equal' : 'none');
      if (mode !== 'none') map[c.id] = mode;
    }
    return map;
  }, [catalog]);

  function splitModeOfMeal(mealId) {
    const meal = catalog?.meals.find((m) => m.id === mealId);
    return meal ? splitModeByCategory[meal.category_id] : undefined;
  }

  function toggleMeal(slotId, mealId) {
    const key = `${slotId}:${mealId}`;
    setMeals((m) => {
      const next = { ...m };
      // "נבחר" = המפתח קיים. equal: מספר (0 עד שתוזן כמות). additive/רגיל: true.
      if (Object.prototype.hasOwnProperty.call(next, key)) delete next[key];
      else next[key] = splitModeOfMeal(mealId) === 'equal' ? 0 : true;
      return next;
    });
  }

  function setMealPortions(slotId, mealId, portions) {
    const key = `${slotId}:${mealId}`;
    setMeals((m) => ({ ...m, [key]: portions }));
  }

  // ולידציה לקטגוריות מחלקות:
  //   equal    — בכל קבוצה עם 2+ מאכלים, סך הכמויות = מנות הסעודה.
  //   additive — לכל היותר מאכל עיקרי אחד (לא-משני) בקבוצה.
  const splitErrors = useMemo(() => {
    if (!catalog) return [];
    const portionsBySlot = Object.fromEntries(selectedSlots.map((s) => [s.meal_slot_id, s.portions]));
    const groups = {};
    for (const [key, value] of Object.entries(meals)) {
      const [slotId, mealId] = key.split(':');
      const meal = catalog.meals.find((mm) => mm.id === mealId);
      if (!meal) continue;
      const mode = splitModeByCategory[meal.category_id];
      if (!mode) continue;
      const g = (groups[`${slotId}:${meal.category_id}`] ||= {
        slotId, catId: meal.category_id, mode, sum: 0, count: 0, primaryCount: 0,
      });
      g.count += 1;
      g.sum += typeof value === 'number' ? value : 0;
      if (!meal.is_secondary) g.primaryCount += 1;
    }
    const errs = [];
    for (const g of Object.values(groups)) {
      const cat = catalog.categories.find((c) => c.id === g.catId);
      const slot = catalog.meal_slots.find((s) => s.id === g.slotId);
      const label = `${slot?.name || 'סעודה'} · ${cat?.name || 'קטגוריה'}`;
      if (g.mode === 'additive') {
        if (g.primaryCount > 1) {
          errs.push(`${label}: ניתן לבחור רק מאכל עיקרי אחד (המאכל הנוסף חייב להיות מסומן כמאכל משני).`);
        }
        continue;
      }
      if (g.count < 2) continue;
      const target = portionsBySlot[g.slotId] || 0;
      if (g.sum !== target) {
        errs.push(`${label}: סך המנות ${g.sum} מתוך ${target} הנדרשות.`);
      }
    }
    return errs;
  }, [catalog, meals, selectedSlots, splitModeByCategory]);

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
    if (selectedSlots.some((slot) => !Number.isInteger(slot.portions) || slot.portions <= 0)) {
      return setError('מספר המנות בכל סעודה חייב להיות מספר שלם וחיובי.');
    }
    if (!venueName.trim()) return setError('נא להזין את שם האולם.');
    if (!venueAddress.trim()) return setError('נא להזין את כתובת האולם.');
    if (!payMethod) return setError('נא לבחור אמצעי תשלום.');
    if (splitErrors.length > 0) {
      return setError(`יש להתאים את כמויות המנות בקטגוריות המחלקות מנות:\n${splitErrors.join('\n')}`);
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
      // כל מפתח שקיים במפה הוא מאכל שנבחר (הערך יכול להיות 0 בקטגוריה שמחלקת).
      const mealsPayload = Object.entries(meals).map(([k, v]) => {
        const [meal_slot_id, meal_id] = k.split(':');
        return { meal_slot_id, meal_id, portions: typeof v === 'number' ? v : null };
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
        venue_name: venueName.trim(),
        venue_address: venueAddress.trim(),
        transport_notes: transportNotes || null,
        preferred_payment_method: payMethod,
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

      {error && <div className="bg-red-50 text-red-700 rounded-xl p-3 mb-4 whitespace-pre-line">{error}</div>}

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
            <span className="text-sm text-brand-burgundy/60">אמצעי תשלום *</span>
            <select className="input w-full" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} required>
              <option value="">— נא לבחור —</option>
              <option value="bank_transfer">העברה בנקאית</option>
              <option value="cash">מזומן</option>
              <option value="check">צ׳ק</option>
            </select>
          </label>
          <LabeledInput label="איש קשר לקבלה" value={contactName} onChange={setContactName} />
          <LabeledInput label="טלפון איש קשר" value={contactPhone} onChange={setContactPhone} />
          <LabeledInput label="שם האולם *" value={venueName} onChange={setVenueName} />
          <LabeledInput label="כתובת האולם *" value={venueAddress} onChange={setVenueAddress} />
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
          {catalog.meal_slots.map((slot) => {
            const num = Number(slots[slot.id]);
            const isException = Number.isInteger(num) && num > 0 && (num < MIN_PORTIONS || num > MAX_PORTIONS);
            return (
              <div key={slot.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-brand-cream/40">
                <span className="font-medium">{slot.name}{slot.requires_companion && <span className="text-xs text-brand-gold-dark mr-1"> (דורש עוד סעודה)</span>}</span>
                <div className="flex items-center gap-2">
                  {isException && <span className="text-xs font-medium text-amber-700">חריג</span>}
                  <span className="text-sm text-brand-burgundy/60">מנות:</span>
                  <input type="number" min="1" className="input w-24 py-1 text-center"
                    value={slots[slot.id] || ''} placeholder="0"
                    onChange={(e) => setSlots({ ...slots, [slot.id]: e.target.value })} />
                </div>
              </div>
            );
          })}
        </div>
        {exceptionSlots.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-300 p-2.5 text-sm text-amber-800">
            כמות מנות חריגה (מחוץ לטווח {MIN_PORTIONS}–{MAX_PORTIONS}) — תישמר ותסומן כחריג בהזמנה.
          </div>
        )}
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
                  slotPortions={selectedSlots.find((s) => s.meal_slot_id === meal_slot_id)?.portions || 0}
                  selectedMeals={meals}
                  onToggleMeal={toggleMeal}
                  onSetMealPortions={setMealPortions}
                  allowOverMax
                />
              </div>
            );
          })}
        </section>
      )}

      {/* תוספות */}
      <section className="card mb-5">
        <h2 className="font-bold text-brand-burgundy mb-3">תוספות בתשלום</h2>
        {visibleExtras.length === 0 && (
          <p className="text-sm text-brand-burgundy/60">אין תוספות זמינות לבחירת המאכלים הנוכחית.</p>
        )}
        <div className="space-y-2">
          {visibleExtras.map((e) => (
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
          <button className="btn-primary text-lg px-8" onClick={save} disabled={saving || priceEstimate.noMatch || splitErrors.length > 0}>
            {saving ? 'שומר...' : 'שמירת שינויים'}
          </button>
        </div>
        {splitErrors.length > 0 && (
          <ul className="text-sm text-amber-700 mt-2 list-disc pr-5 space-y-0.5">
            {splitErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
        {priceEstimate.noMatch && (
          <p className="text-sm text-red-600 mt-2 font-medium">
            לא הוגדר מחיר לצירוף הסעודות שנבחר. יש להגדיר מסלול מחיר מתאים לפני שמירה.
          </p>
        )}
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
