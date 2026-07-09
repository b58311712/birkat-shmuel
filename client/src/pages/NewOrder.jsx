import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { MealCategoryPicker } from '../components/MealCategoryPicker.jsx';
import { formatGregorianDate, formatShabbatHebrewDate, formatShabbatTitle } from '../lib/dates.js';

export default function NewOrder({ customer }) {
  const nav = useNavigate();
  const [catalog, setCatalog] = useState(null);
  const [shabbatot, setShabbatot] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState('');

  const [shabbatId, setShabbatId] = useState('');
  const [slots, setSlots] = useState({});
  const [meals, setMeals] = useState({});
  const [extras, setExtras] = useState({});
  const [contactName, setContactName] = useState(customer?.full_name || '');
  const [contactPhone, setContactPhone] = useState(customer?.phone || '');
  const [venueAddress, setVenueAddress] = useState('');

  useEffect(() => {
    Promise.all([api.catalog(), api.openShabbatot()])
      .then(([cat, shab]) => { setCatalog(cat); setShabbatot(shab); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const selectedSlots = useMemo(
    () => Object.entries(slots)
      .filter(([, p]) => Number(p) > 0)
      .map(([id, p]) => ({ meal_slot_id: id, portions: Number(p) })),
    [slots]
  );

  const selectedShabbat = useMemo(
    () => shabbatot.find((s) => s.id === shabbatId),
    [shabbatId, shabbatot]
  );

  const priceEstimate = useMemo(() => {
    if (!catalog) return { base: 0, extras: 0, total: 0 };
    const count = selectedSlots.length;
    const track = catalog.price_tracks.find((t) => t.meals_count === count)
      || [...catalog.price_tracks]
        .filter((t) => (t.meals_count || 0) <= count)
        .sort((a, b) => b.meals_count - a.meals_count)[0];
    const perPortion = track ? Number(track.price_per_portion) : 0;
    const totalPortions = selectedSlots.reduce((s, x) => s + x.portions, 0);
    const base = totalPortions * perPortion;
    let ex = 0;
    for (const [id, qty] of Object.entries(extras)) {
      const e = catalog.extras.find((x) => x.id === id);
      if (e && Number(qty) > 0) ex += Number(e.unit_price) * Number(qty);
    }
    return { base, extras: ex, total: base + ex };
  }, [catalog, selectedSlots, extras]);

  const orderPreview = useMemo(() => {
    if (!catalog) return { slots: [], extras: [] };

    return {
      slots: selectedSlots.map(({ meal_slot_id, portions }) => {
        const slot = catalog.meal_slots.find((s) => s.id === meal_slot_id);
        const selectedMeals = Object.entries(meals)
          .filter(([key, chosen]) => chosen && key.startsWith(`${meal_slot_id}:`))
          .map(([key]) => {
            const mealId = key.split(':')[1];
            const meal = catalog.meals.find((m) => m.id === mealId);
            const category = catalog.categories.find((c) => c.id === meal?.category_id);
            return meal ? { ...meal, category_name: category?.name || 'ללא קטגוריה' } : null;
          })
          .filter(Boolean);

        return {
          meal_slot_id,
          name: slot?.name || 'סעודה',
          portions,
          meals: selectedMeals,
        };
      }),
      extras: Object.entries(extras)
        .filter(([, qty]) => Number(qty) > 0)
        .map(([extra_id, qty]) => {
          const extra = catalog.extras.find((e) => e.id === extra_id);
          return extra ? { ...extra, quantity: Number(qty) } : null;
        })
        .filter(Boolean),
    };
  }, [catalog, selectedSlots, meals, extras]);

  function toggleMeal(slotId, mealId) {
    const key = `${slotId}:${mealId}`;
    setMeals((m) => ({ ...m, [key]: !m[key] }));
  }

  function validateOrder() {
    setError('');
    if (!shabbatId) {
      setError('נא לבחור שבת.');
      return false;
    }
    if (selectedSlots.length === 0) {
      setError('נא לבחור לפחות סעודה אחת עם מספר מנות.');
      return false;
    }
    return true;
  }

  function openPreview() {
    if (!validateOrder()) return;
    setPreviewOpen(true);
  }

  async function submit() {
    if (!validateOrder()) return;

    setSubmitting(true);
    try {
      const mealsPayload = Object.entries(meals).filter(([, v]) => v).map(([k]) => {
        const [meal_slot_id, meal_id] = k.split(':');
        return { meal_slot_id, meal_id };
      });
      const extrasPayload = Object.entries(extras).filter(([, q]) => Number(q) > 0)
        .map(([extra_id, q]) => ({ extra_id, actual_quantity: Number(q) }));

      const res = await api.createOrder({
        customer_id: customer.id,
        shabbat_id: shabbatId,
        slots: selectedSlots,
        meals: mealsPayload,
        extras: extrasPayload,
        contact_name: contactName.trim() || null,
        contact_phone: contactPhone.trim() || null,
        venue_address: venueAddress.trim() || null,
      });
      nav(`/order/${res.order.id}?created=1`);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  if (loading) return <Page title="הזמנה חדשה"><p>טוען...</p></Page>;

  return (
    <Page title="הזמנה חדשה" subtitle="בחר/י שבת, סעודות, מאכלים ותוספות">
      {error && <div className="bg-red-50 text-red-700 rounded-xl p-3 mb-4">{error}</div>}

      <section className="card mb-5">
        <h2 className="font-bold text-brand-burgundy mb-3">1. בחירת שבת</h2>
        {shabbatot.length === 0 ? (
          <p className="text-brand-burgundy/60">אין שבתות פתוחות להזמנה כרגע.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {shabbatot.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setShabbatId(s.id)}
                className={`p-3 rounded-xl border text-center transition-colors ${
                  shabbatId === s.id
                    ? 'bg-brand-gold border-brand-gold-dark text-brand-burgundy-dark font-bold'
                    : 'bg-white border-brand-cream-dark hover:border-brand-gold'
                }`}
              >
                <div className="font-bold">{formatShabbatTitle(s)}</div>
                <div className="text-sm font-medium text-brand-gold-dark/90">{formatShabbatHebrewDate(s)}</div>
                <div className="text-xs opacity-70">{formatGregorianDate(s.gregorian_date)}</div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card mb-5 p-4">
        <h2 className="font-bold text-brand-burgundy mb-3">2. סעודות ומספר מנות</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {catalog.meal_slots.map((slot) => {
            const hasPortions = Number(slots[slot.id]) > 0;

            return (
              <div
                key={slot.id}
                className={`flex items-center justify-between gap-2 rounded-lg border p-2 transition-colors ${
                  hasPortions
                    ? 'border-brand-gold-dark bg-brand-gold/25 shadow-card'
                    : 'border-brand-cream-dark bg-white hover:border-brand-gold hover:bg-brand-cream/25'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-brand-burgundy-dark">{slot.name}</div>
                  {slot.requires_companion && (
                    <div className="truncate text-xs text-brand-gold-dark">דורש עוד סעודה</div>
                  )}
                </div>
                <label className="flex shrink-0 items-center gap-1.5">
                  <span className="text-xs text-brand-burgundy/60">מנות</span>
                  <input
                    type="number"
                    min="0"
                    className="input w-16 px-2 py-1 text-center text-base"
                    value={slots[slot.id] || ''}
                    placeholder="0"
                    onChange={(e) => setSlots({ ...slots, [slot.id]: e.target.value })}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </section>

      {selectedSlots.length > 0 && (
        <section className="card mb-5">
          <h2 className="font-bold text-brand-burgundy mb-3">3. בחירת מאכלים</h2>
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

      <section className="card mb-5">
        <h2 className="font-bold text-brand-burgundy mb-3">4. תוספות בתשלום</h2>
        <div className="space-y-2">
          {catalog.extras.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-brand-cream/40">
              <div>
                <span className="font-medium">{e.name}</span>
                <span className="text-sm text-brand-burgundy/60"> - {e.unit_price} ש"ח ל{e.billing_unit}</span>
                {e.customer_note && <div className="text-xs text-brand-gold-dark">{e.customer_note}</div>}
              </div>
              <input
                type="number"
                min="0"
                className="input w-24 py-1 text-center"
                placeholder="0"
                value={extras[e.id] || ''}
                onChange={(ev) => setExtras({ ...extras, [e.id]: ev.target.value })}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="card mb-5">
        <h2 className="font-bold text-brand-burgundy mb-3">5. פרטי משלוח</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <LabeledInput label="כתובת האולם" value={venueAddress} onChange={setVenueAddress} />
          <LabeledInput label="איש קשר לקבלת המשלוח" value={contactName} onChange={setContactName} />
          <LabeledInput label="טלפון איש קשר" value={contactPhone} onChange={setContactPhone} dir="ltr" />
        </div>
      </section>

      <section className="card sticky bottom-4 border-2 border-brand-gold">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm text-brand-burgundy/60">סה"כ משוער</div>
            <div className="text-2xl font-extrabold text-brand-burgundy">{priceEstimate.total.toFixed(2)} ש"ח</div>
            <div className="text-xs text-brand-burgundy/50">
              בסיס {priceEstimate.base.toFixed(0)} ש"ח + תוספות {priceEstimate.extras.toFixed(0)} ש"ח
            </div>
          </div>
          <button className="btn-primary text-lg px-8" type="button" onClick={openPreview} disabled={submitting}>
            הצגת ההזמנה לפני שליחה
          </button>
        </div>
        <p className="text-xs text-brand-burgundy/50 mt-2">
          לפני השליחה תוצג ההזמנה המלאה לאישור. המחיר הסופי מחושב על ידי המערכת.
        </p>
      </section>

      {previewOpen && (
        <OrderPreviewModal
          customer={customer}
          shabbat={selectedShabbat}
          preview={orderPreview}
          priceEstimate={priceEstimate}
          deliveryDetails={{ contactName, contactPhone, venueAddress }}
          submitting={submitting}
          onClose={() => setPreviewOpen(false)}
          onSubmit={submit}
        />
      )}
    </Page>
  );
}

function OrderPreviewModal({ customer, shabbat, preview, priceEstimate, deliveryDetails, submitting, onClose, onSubmit }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-brand-burgundy-dark/55 p-3 sm:p-6">
      <section className="w-full max-w-3xl max-h-[92vh] overflow-hidden rounded-xl bg-white shadow-card border border-brand-cream-dark">
        <div className="flex items-start justify-between gap-3 border-b border-brand-cream-dark p-4">
          <div>
            <h2 className="text-xl font-extrabold text-brand-burgundy">בדיקת ההזמנה לפני שליחה</h2>
            <p className="text-sm text-brand-burgundy/60 mt-1">
              {customer?.full_name} · {shabbat ? `${formatShabbatTitle(shabbat)} · ${formatGregorianDate(shabbat.gregorian_date)}` : 'לא נבחרה שבת'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5" aria-label="סגירה">×</button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4 max-h-[calc(92vh-150px)]">
          {preview.slots.map((slot) => (
            <div key={slot.meal_slot_id} className="rounded-lg border border-brand-cream-dark p-3">
              <div className="flex items-center justify-between gap-3 border-b border-brand-cream-dark pb-2 mb-2">
                <h3 className="font-bold text-brand-gold-dark">{slot.name}</h3>
                <span className="badge bg-brand-cream text-brand-burgundy">{slot.portions} מנות</span>
              </div>
              {slot.meals.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {slot.meals.map((meal) => (
                    <span key={meal.id} className="rounded-lg bg-brand-cream/70 px-2.5 py-1 text-sm text-brand-burgundy">
                      {meal.name}
                      <span className="text-brand-burgundy/45"> · {meal.category_name}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-brand-burgundy/45">לא נבחרו מאכלים לסעודה זו.</p>
              )}
            </div>
          ))}

          <div className="rounded-lg border border-brand-cream-dark p-3">
            <h3 className="font-bold text-brand-gold-dark mb-2">תוספות בתשלום</h3>
            {preview.extras.length > 0 ? (
              <div className="space-y-1.5">
                {preview.extras.map((extra) => (
                  <div key={extra.id} className="flex justify-between gap-3 text-sm">
                    <span>{extra.name} × {extra.quantity}</span>
                    <span>{(Number(extra.unit_price) * extra.quantity).toFixed(2)} ש"ח</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-brand-burgundy/45">לא נבחרו תוספות.</p>
            )}
          </div>

          <div className="rounded-lg border border-brand-cream-dark p-3">
            <h3 className="font-bold text-brand-gold-dark mb-2">פרטי משלוח</h3>
            <div className="grid sm:grid-cols-2 gap-2 text-sm">
              <PreviewField label="כתובת האולם" value={deliveryDetails.venueAddress} />
              <PreviewField label="איש קשר לקבלת המשלוח" value={deliveryDetails.contactName} />
              <PreviewField label="טלפון איש קשר" value={deliveryDetails.contactPhone} dir="ltr" />
            </div>
          </div>

          <div className="rounded-lg bg-brand-cream/50 p-3 space-y-1">
            <SummaryRow label="מחיר בסיס" value={priceEstimate.base} />
            <SummaryRow label="תוספות" value={priceEstimate.extras} />
            <div className="flex justify-between font-extrabold text-lg text-brand-burgundy pt-2 border-t border-brand-cream-dark">
              <span>סה"כ משוער</span>
              <span>{priceEstimate.total.toFixed(2)} ש"ח</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand-cream-dark p-4 bg-brand-cream/25">
          <button type="button" onClick={onClose} className="btn-ghost">חזרה לעריכה</button>
          <button type="button" onClick={onSubmit} disabled={submitting} className="btn-primary px-7">
            {submitting ? 'שולח...' : 'אישור ושליחת ההזמנה'}
          </button>
        </div>
      </section>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex justify-between text-brand-burgundy/80">
      <span>{label}</span>
      <span>{Number(value).toFixed(2)} ש"ח</span>
    </div>
  );
}

function LabeledInput({ label, value, onChange, dir }) {
  return (
    <label className="block">
      <span className="text-sm text-brand-burgundy/60">{label}</span>
      <input className="input w-full" value={value} dir={dir} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function PreviewField({ label, value, dir }) {
  return (
    <div>
      <div className="text-xs text-brand-burgundy/50">{label}</div>
      <div className="font-medium text-brand-burgundy" dir={dir}>{value || '—'}</div>
    </div>
  );
}
