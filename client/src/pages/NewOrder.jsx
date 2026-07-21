import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { MealCategoryPicker } from '../components/MealCategoryPicker.jsx';
import { formatGregorianDate, formatShabbatHebrewDate, formatShabbatTitle } from '../lib/dates.js';
import { slotComboKey } from '../lib/pricing.js';
import { splitPercentsFor } from '../lib/splitPercents.js';
import { PAYMENT_METHOD } from '../lib/status.jsx';

// טווח מנות סטנדרטי. כמות מחוץ לטווח מותרת כ"בקשת חריג" הממתינה לאישור מנהל (סעיף 12.2).
const MIN_PORTIONS = 50;
const MAX_PORTIONS = 100;

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
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [payMethod, setPayMethod] = useState('');

  useEffect(() => {
    Promise.all([api.catalog(), api.openShabbatot()])
      .then(([cat, shab]) => { setCatalog(cat); setShabbatot(shab); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // סעודה "נבחרה" אם הוזן בה מספר מנות שלם וחיובי (כולל חריגה מחוץ ל-50–100).
  const selectedSlots = useMemo(
    () => Object.entries(slots)
      .filter(([, p]) => Number.isInteger(Number(p)) && Number(p) > 0)
      .map(([id, p]) => ({ meal_slot_id: id, portions: Number(p) })),
    [slots]
  );

  // כמות לא-תקינה חוסמת שליחה (ריק / לא-שלם / אפס-שלילי). חריגה 50–100 אינה חוסמת.
  const invalidSlotIds = useMemo(
    () => Object.entries(slots)
      .filter(([, p]) => p !== '' && (!Number.isInteger(Number(p)) || Number(p) <= 0))
      .map(([id]) => id),
    [slots]
  );

  // סעודות בכמות חריגה (מחוץ ל-50–100) — מותרות אך יסומנו כבקשת חריג לאישור מנהל.
  const exceptionSlots = useMemo(
    () => selectedSlots.filter((s) => s.portions < MIN_PORTIONS || s.portions > MAX_PORTIONS),
    [selectedSlots]
  );

  const selectedShabbat = useMemo(
    () => shabbatot.find((s) => s.id === shabbatId),
    [shabbatId, shabbatot]
  );

  // מזהי המאכלים שנבחרו בכל הסעודות (מפתח הבחירה הוא `slotId:mealId`).
  const selectedMealIds = useMemo(
    () => new Set(Object.keys(meals).map((key) => key.split(':')[1])),
    [meals]
  );

  // תוספות שמותנות בהזמנת מאכל מסוים (סעיף 14) מוצגות רק כשנבחר לפחות
  // אחד מהמאכלים המקושרים. תוספת בלי קישור מוצגת תמיד.
  const visibleExtras = useMemo(() => {
    if (!catalog) return [];
    return catalog.extras.filter((e) => {
      const required = e.required_meal_ids || [];
      return required.length === 0 || required.some((id) => selectedMealIds.has(id));
    });
  }, [catalog, selectedMealIds]);

  // המאכל שהתנה תוספת בוטל -> מנקים את הכמות שהוזנה לה, כדי שלא תיחשב במחיר ובהזמנה.
  useEffect(() => {
    if (!catalog) return;
    const visibleIds = new Set(visibleExtras.map((e) => e.id));
    setExtras((prev) => {
      const next = {};
      let changed = false;
      for (const [id, qty] of Object.entries(prev)) {
        if (visibleIds.has(id)) next[id] = qty;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [catalog, visibleExtras]);

  const priceEstimate = useMemo(() => {
    if (!catalog) return { base: 0, extras: 0, total: 0, noMatch: false };
    // בחירת מסלול לפי צירוף הסעודות המדויק (סעיף 15).
    const selectedKey = slotComboKey(selectedSlots.map((s) => s.meal_slot_id));
    const track = catalog.price_tracks.find((t) => slotComboKey(t.meal_slot_ids) === selectedKey);
    const perPortion = track ? Number(track.price_per_portion) : 0;
    const totalPortions = selectedSlots.reduce((s, x) => s + x.portions, 0);
    const base = totalPortions * perPortion;
    let ex = 0;
    for (const [id, qty] of Object.entries(extras)) {
      const e = catalog.extras.find((x) => x.id === id);
      if (e && Number(qty) > 0) ex += Number(e.unit_price) * Number(qty);
    }
    // אין מסלול לצירוף שנבחר → אין מחיר בסיס, ההזמנה תיחסם בשרת.
    const noMatch = selectedSlots.length > 0 && !track;
    return { base, extras: ex, total: base + ex, noMatch };
  }, [catalog, selectedSlots, extras]);

  // מפה: category_id -> מצב חלוקה ('equal' | 'additive'). תאימות-לאחור לדגל הישן.
  const splitModeByCategory = useMemo(() => {
    const map = {};
    for (const c of catalog?.categories || []) {
      const mode = c.split_mode || (c.requires_portion_split ? 'equal' : 'none');
      if (mode !== 'none') map[c.id] = mode;
    }
    return map;
  }, [catalog]);

  // קטגוריות שיורשות מאכלים מסעודת-אב (למשל סלטים: הבוקר יורש מליל שבת).
  // מפה: category_id -> { parentSlotId, extraAllowed }.
  const inheritByCategory = useMemo(() => {
    const map = {};
    for (const c of catalog?.categories || []) {
      if (c.inherit_from_slot_id) {
        map[c.id] = { parentSlotId: c.inherit_from_slot_id, extraAllowed: c.extra_allowed ?? 0 };
      }
    }
    return map;
  }, [catalog]);

  // מפתחות המאכלים שנוצרו ע"י ירושה (`childSlotId:mealId`) — מסומנים בבורר כנעולים
  // ואינם נספרים במכסת התוספת. הערך במפה עבורם הוא הסמל 'inherited'.
  const inheritedKeys = useMemo(() => {
    const s = new Set();
    for (const [key, v] of Object.entries(meals)) {
      if (v === 'inherited') s.add(key);
    }
    return s;
  }, [meals]);

  // סנכרון ירושה: בכל שינוי בבחירת סעודת-האב, המאכלים היורשים בסעודות היעד
  // מסונכרנים אוטומטית. תוספות ידניות בבוקר (ערך true) לא נגעות.
  useEffect(() => {
    if (!catalog || Object.keys(inheritByCategory).length === 0) return;
    // מזהי הסעודות שנבחרו כרגע (יש בהן מנות) — רק אליהן משוכפלת הירושה.
    const activeSlotIds = new Set(selectedSlots.map((s) => s.meal_slot_id));

    setMeals((prev) => {
      let changed = false;
      const next = { ...prev };
      // הירושים שאמורים להתקיים כעת: לכל קטגוריה יורשת, כל מאכל שנבחר בסעודת-האב
      // מסומן בכל סעודת-יעד פעילה שהמאכל זמין בה (ושאינה סעודת-האב עצמה).
      const shouldExist = new Set();
      for (const meal of catalog.meals) {
        const inh = inheritByCategory[meal.category_id];
        if (!inh) continue;
        const parentKey = `${inh.parentSlotId}:${meal.id}`;
        if (!Object.prototype.hasOwnProperty.call(prev, parentKey)) continue; // לא נבחר בלילה
        for (const slotId of activeSlotIds) {
          if (slotId === inh.parentSlotId) continue;
          if (!meal.available_slot_ids.includes(slotId)) continue;
          shouldExist.add(`${slotId}:${meal.id}`);
        }
      }
      // הוספת ירושים חסרים (בלי לדרוס תוספת ידנית קיימת של אותו מאכל).
      for (const key of shouldExist) {
        if (!Object.prototype.hasOwnProperty.call(next, key)) {
          next[key] = 'inherited';
          changed = true;
        }
      }
      // הסרת ירושים שכבר אינם רלוונטיים (בוטלו בלילה / הסעודה נסגרה).
      for (const [key, v] of Object.entries(next)) {
        if (v === 'inherited' && !shouldExist.has(key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [catalog, inheritByCategory, meals, selectedSlots]);

  const orderPreview = useMemo(() => {
    if (!catalog) return { slots: [], extras: [] };

    return {
      slots: selectedSlots.map(({ meal_slot_id, portions }) => {
        const slot = catalog.meal_slots.find((s) => s.id === meal_slot_id);
        // כמה מאכלים נבחרו בכל קטגוריה בסעודה זו — לחישוב "מאכל יחיד → 100%" ב-additive.
        const countByCategory = {};
        for (const key of Object.keys(meals)) {
          if (!key.startsWith(`${meal_slot_id}:`)) continue;
          const meal = catalog.meals.find((m) => m.id === key.split(':')[1]);
          if (meal) countByCategory[meal.category_id] = (countByCategory[meal.category_id] || 0) + 1;
        }
        const selectedMeals = Object.entries(meals)
          .filter(([key]) => key.startsWith(`${meal_slot_id}:`))
          .map(([key, value]) => {
            const mealId = key.split(':')[1];
            const meal = catalog.meals.find((m) => m.id === mealId);
            const category = catalog.categories.find((c) => c.id === meal?.category_id);
            const mode = meal ? splitModeByCategory[meal.category_id] : undefined;
            // equal: הכמות שהוזנה. additive: מחושבת מקומית (זהה לשרת, עיגול כלפי מעלה).
            let mealPortions = typeof value === 'number' ? value : null;
            if (mode === 'additive' && meal) {
              if ((countByCategory[meal.category_id] || 0) < 2) {
                mealPortions = portions;                               // מאכל יחיד → 100%
              } else {
                const pcts = splitPercentsFor(category, meal_slot_id);
                const pct = meal.is_secondary ? pcts.secondary : pcts.primary;
                mealPortions = Math.ceil((portions * pct) / 100);
              }
            }
            return meal ? { ...meal, category_name: category?.name || 'ללא קטגוריה', meal_portions: mealPortions } : null;
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
  }, [catalog, selectedSlots, meals, extras, splitModeByCategory]);

  function categoryOfMeal(mealId) {
    const meal = catalog?.meals.find((m) => m.id === mealId);
    return meal?.category_id || null;
  }
  // מצב חלוקה של המאכל: 'equal' | 'additive' | undefined (רגיל).
  function splitModeOfMeal(mealId) {
    const catId = categoryOfMeal(mealId);
    return catId ? splitModeByCategory[catId] : undefined;
  }

  function toggleMeal(slotId, mealId) {
    const key = `${slotId}:${mealId}`;
    setMeals((m) => {
      // מאכל ירוש נעול — לא ניתן לבטלו ידנית (מבוטל רק ע"י ביטול בסעודת-האב).
      if (m[key] === 'inherited') return m;
      const next = { ...m };
      // "נבחר" = המפתח קיים (הערך יכול להיות 0 בקטגוריה במצב equal).
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        delete next[key];
      } else {
        // equal: שומרים מספר (0 עד שהלקוח יזין). additive/רגיל: true (השרת מחשב).
        next[key] = splitModeOfMeal(mealId) === 'equal' ? 0 : true;
      }
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
    const groups = {}; // `${slotId}:${catId}` -> { slotId, catId, mode, sum, count, primaryCount }
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
      // equal
      if (g.count < 2) continue; // סוג יחיד → השרת ישייך את כל המנות
      const target = portionsBySlot[g.slotId] || 0;
      if (g.sum !== target) {
        errs.push(`${label}: סך המנות ${g.sum} מתוך ${target} הנדרשות.`);
      }
    }
    return errs;
  }, [catalog, meals, selectedSlots, splitModeByCategory]);

  function validateOrder() {
    setError('');
    if (!shabbatId) {
      setError('נא לבחור שבת.');
      return false;
    }
    if (invalidSlotIds.length > 0) {
      setError('מספר המנות בכל סעודה שנבחרה חייב להיות מספר שלם וחיובי.');
      return false;
    }
    if (selectedSlots.length === 0) {
      setError('נא לבחור לפחות סעודה אחת עם מספר מנות.');
      return false;
    }
    if (!venueName.trim()) {
      setError('נא להזין את שם האולם.');
      return false;
    }
    if (!venueAddress.trim()) {
      setError('נא להזין את כתובת האולם.');
      return false;
    }
    if (!payMethod) {
      setError('נא לבחור אמצעי תשלום.');
      return false;
    }
    if (splitErrors.length > 0) {
      setError(`יש להתאים את כמויות המנות בקטגוריות המחלקות מנות:\n${splitErrors.join('\n')}`);
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
      // כל מפתח שקיים במפה הוא מאכל שנבחר (הערך יכול להיות 0 בקטגוריה שמחלקת).
      const mealsPayload = Object.entries(meals).map(([k, v]) => {
        const [meal_slot_id, meal_id] = k.split(':');
        // בקטגוריה שמחלקת מנות שולחים את הכמות; אחרת null (השרת ישייך כל מנות הסעודה).
        return { meal_slot_id, meal_id, portions: typeof v === 'number' ? v : null };
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
        venue_name: venueName.trim(),
        venue_address: venueAddress.trim(),
        preferred_payment_method: payMethod,
      });
      nav(`/order/${res.order.id}?created=1`);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  if (loading) return <Page title="הזמנה חדשה"><p>טוען...</p></Page>;

  return (
    <Page title="הזמנה חדשה">
      {error && <div className="bg-red-50 text-red-700 rounded-xl p-3 mb-4 whitespace-pre-line">{error}</div>}

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
            const raw = slots[slot.id];
            const num = Number(raw);
            const isSelected = Number.isInteger(num) && num > 0;
            const invalidPortions = invalidSlotIds.includes(slot.id);
            const isException = isSelected && (num < MIN_PORTIONS || num > MAX_PORTIONS);

            return (
              <div
                key={slot.id}
                className={`flex items-center justify-between gap-2 rounded-lg border p-2 transition-colors ${
                  isException
                    ? 'border-amber-400 bg-amber-50 shadow-card'
                    : isSelected
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
                    min="1"
                    aria-invalid={invalidPortions}
                    className={`input w-20 px-2 py-1 text-center text-base ${invalidPortions ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}`}
                    value={raw || ''}
                    placeholder="50–100"
                    onChange={(e) => setSlots({ ...slots, [slot.id]: e.target.value })}
                  />
                </label>
                {invalidPortions && (
                  <span className="text-xs font-medium text-red-600">מספר לא תקין</span>
                )}
                {isException && (
                  <span className="text-xs font-medium text-amber-700">חריג — יידרש אישור מנהל</span>
                )}
              </div>
            );
          })}
        </div>
        {exceptionSlots.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-300 p-3 text-sm text-amber-800">
            <div className="font-bold">בקשת כמות חריגה (מחוץ לטווח {MIN_PORTIONS}–{MAX_PORTIONS} מנות)</div>
            <p className="mt-0.5">
              ניתן לשלוח את ההזמנה, אך היא תסומן כבקשת חריג ותמתין לאישור מנהל לפני שתאושר.
            </p>
          </div>
        )}
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
                  slotPortions={selectedSlots.find((s) => s.meal_slot_id === meal_slot_id)?.portions || 0}
                  selectedMeals={meals}
                  inheritByCategory={inheritByCategory}
                  inheritedKeys={inheritedKeys}
                  onToggleMeal={toggleMeal}
                  onSetMealPortions={setMealPortions}
                />
              </div>
            );
          })}
        </section>
      )}

      {selectedSlots.length > 0 && (
        <>
          <section className="card mb-5">
            <h2 className="font-bold text-brand-burgundy mb-3">4. תוספות בתשלום</h2>
            {visibleExtras.length === 0 && (
              <p className="text-sm text-brand-burgundy/60">
                אין תוספות זמינות לבחירת המאכלים הנוכחית.
              </p>
            )}
            <div className="space-y-2">
              {visibleExtras.map((e) => (
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:items-end">
              <LabeledInput label="שם האולם" value={venueName} onChange={setVenueName} required />
              <LabeledInput label="כתובת האולם" value={venueAddress} onChange={setVenueAddress} required />
              <LabeledInput label="איש קשר" value={contactName} onChange={setContactName} />
              <LabeledInput label="טלפון" value={contactPhone} onChange={setContactPhone} dir="ltr" />
            </div>
            <label className="block mt-3 sm:max-w-sm">
              <span className="text-sm text-brand-burgundy/60">אמצעי תשלום *</span>
              <select className="input w-full" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} required>
                <option value="">— נא לבחור —</option>
                {Object.entries(PAYMENT_METHOD).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </section>
        </>
      )}

      <section className="card sticky bottom-4 border-2 border-brand-gold">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm text-brand-burgundy/60">סה"כ משוער</div>
            <div className="text-2xl font-extrabold text-brand-burgundy">{priceEstimate.total.toFixed(2)} ש"ח</div>
            <div className="text-xs text-brand-burgundy/50">
              בסיס {priceEstimate.base.toFixed(0)} ש"ח + תוספות {priceEstimate.extras.toFixed(0)} ש"ח
            </div>
          </div>
          <button className="btn-primary text-lg px-8" type="button" onClick={openPreview} disabled={submitting || priceEstimate.noMatch || splitErrors.length > 0}>
            הצגת ההזמנה לפני שליחה
          </button>
        </div>
        {splitErrors.length > 0 && (
          <ul className="text-sm text-amber-700 mt-2 list-disc pr-5 space-y-0.5">
            {splitErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
        {priceEstimate.noMatch && (
          <p className="text-sm text-red-600 mt-2 font-medium">
            לא הוגדר מחיר לצירוף הסעודות שנבחר. יש לבחור צירוף אחר או לפנות למנהל להגדרת מסלול מתאים.
          </p>
        )}
        {exceptionSlots.length > 0 && (
          <p className="text-sm text-amber-700 mt-2 font-medium">
            ההזמנה כוללת כמות מנות חריגה ותסומן כבקשת חריג הממתינה לאישור מנהל.
          </p>
        )}
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
          deliveryDetails={{ contactName, contactPhone, venueName, venueAddress, payMethod }}
          hasException={exceptionSlots.length > 0}
          submitting={submitting}
          onClose={() => setPreviewOpen(false)}
          onSubmit={submit}
        />
      )}
    </Page>
  );
}

function OrderPreviewModal({ customer, shabbat, preview, priceEstimate, deliveryDetails, hasException, submitting, onClose, onSubmit }) {
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
          {hasException && (
            <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-sm text-amber-800">
              <div className="font-bold">בקשת כמות מנות חריגה</div>
              <p className="mt-0.5">
                אחת הסעודות מחוץ לטווח הרגיל (50–100 מנות). ההזמנה תסומן כבקשת חריג ותמתין לאישור מנהל.
              </p>
            </div>
          )}
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
                      {meal.meal_portions != null && (
                        <span className="font-bold text-brand-burgundy-dark"> × {meal.meal_portions}</span>
                      )}
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
              <PreviewField label="שם האולם" value={deliveryDetails.venueName} />
              <PreviewField label="כתובת האולם" value={deliveryDetails.venueAddress} />
              <PreviewField label="איש קשר לקבלת המשלוח" value={deliveryDetails.contactName} />
              <PreviewField label="טלפון איש קשר" value={deliveryDetails.contactPhone} dir="ltr" />
              <PreviewField label="אמצעי תשלום" value={PAYMENT_METHOD[deliveryDetails.payMethod]} />
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

function LabeledInput({ label, value, onChange, dir, required = false }) {
  return (
    <label className="block">
      <span className="text-sm text-brand-burgundy/60">{label}{required && ' *'}</span>
      <input className="input w-full" value={value} dir={dir} required={required} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function PreviewField({ label, value, dir }) {
  return (
    <div>
      <div className="text-xs text-brand-burgundy/50">{label}</div>
      <div className="font-medium text-brand-burgundy text-right" dir={dir}>{value || '—'}</div>
    </div>
  );
}
