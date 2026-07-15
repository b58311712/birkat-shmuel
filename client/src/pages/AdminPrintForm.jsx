// טופס הזמנה פיזי להדפסה (סעיף 8 / דף הזמנה ידני).
// ------------------------------------------------------------------------
// מסך למנהל שמייצר דף הזמנה מודפס לחלוקה ללקוחות שאינם מזמינים דרך הממשק.
// שואב את הקטלוג החי (GET /api/catalog) — אותו מקור של אשף ההזמנה — כך שהטופס
// המודפס תמיד תואם למאכלים, לקטגוריות ולתוספות שבמערכת. משתמש בתשתית ההדפסה
// הקיימת (.print-area / .no-print ב-index.css) כדי להדפיס רק את הטופס.
//
// המבנה מופרד לפי סעודה בדיוק כמו במסך ההזמנה של הלקוח (ליל שבת / יום שבת /
// סעודה שלישית): בכל סעודה מופיעות רק הקטגוריות והמאכלים הזמינים בה, והכללים
// המיוחדים משתקפים דינמית מהקטלוג —
//   • דגים (split_mode='additive'): תיוג דג עיקרי / דג נוסף + כלל האחוזים
//     (primary_percent / secondary_percent) בבחירת שני סוגים.
//   • חלוקה ידנית (split_mode='equal'): הערה + שדה "מנות" לכל סוג.
//   • ירושת סלטים (inherit_from_slot_id): הקטגוריה מוצגת פעם אחת בלבד בסעודת-האב
//     עם שני טורי סימון (לילה / בוקר). בסעודת היעד מוצגת הפניה לטור זה.
//   • אמצעי תשלום: שדה סימון בגוש הפרטים (מ-PAYMENT_METHOD).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { PAYMENT_METHOD } from '../lib/status.jsx';

// מידות עמוד A4 להדפסה (ב-CSS px @96dpi) בניכוי שוליים 1.4cm מכל צד.
// רוחב שימושי ≈ (21 - 2.8)ס"מ, גובה שימושי ≈ (29.7 - 2.8)ס"מ.
const CM_TO_PX = 96 / 2.54;
const PRINT_MARGIN_CM = 1.4;
const A4_PRINT_W = (21 - 2 * PRINT_MARGIN_CM) * CM_TO_PX;   // ≈ 688px
const A4_PRINT_H = (29.7 - 2 * PRINT_MARGIN_CM) * CM_TO_PX; // ≈ 1017px

// מצב חלוקת המנות של קטגוריה: 'none' | 'equal' | 'additive'.
// תאימות-לאחור: קטגוריה ישנה עם requires_portion_split בלבד נחשבת 'equal'.
function splitModeOf(category) {
  if (!category) return 'none';
  if (category.split_mode) return category.split_mode;
  return category.requires_portion_split ? 'equal' : 'none';
}

// ------------------------------------------------------------------------
// פריסת הטופס לפי סעודה: לכל סעודה (meal_slot) רשימת הקטגוריות והמאכלים
// הזמינים בה. קטגוריה שיורשת מסעודת-אב (inherit_from_slot_id) מוצגת רק
// בסעודת-האב עם טורי לילה/בוקר, ובסעודת היעד מוחלפת בהערת הפניה.
function buildSlotLayout(catalog) {
  const slotById = Object.fromEntries(catalog.meal_slots.map((s) => [s.id, s]));
  const slots = catalog.meal_slots
    .slice()
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

  // מאכלים לפי קטגוריה, ממוינים לפי display_order של המאכל.
  const mealsByCat = {};
  for (const meal of catalog.meals) {
    (mealsByCat[meal.category_id] ||= []).push(meal);
  }
  for (const list of Object.values(mealsByCat)) {
    list.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  }

  const sortedCats = catalog.categories
    .slice()
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

  return slots.map((slot) => {
    const blocks = [];
    // הפניות לסעודות-יעד של ירושה שסעודת-האב שלהן היא הסעודה הנוכחית — נאספות
    // כדי להציג הערה "יש לסמן בטור בוקר" בסעודת היעד.
    const inheritNotes = [];

    for (const category of sortedCats) {
      const meals = (mealsByCat[category.id] || []).filter((m) =>
        m.available_slot_ids.includes(slot.id)
      );
      if (meals.length === 0) continue;

      const parentSlotId = category.inherit_from_slot_id || null;
      const isInheriting = !!parentSlotId;

      if (isInheriting && parentSlotId !== slot.id) {
        // סעודת-יעד של ירושה: לא מציגים את הקטגוריה — היא מסומנת בסעודת-האב
        // (טור בוקר). נרשום הערת הפניה אחת לכל קטגוריה יורשת בסעודה זו.
        inheritNotes.push({
          categoryName: category.name,
          parentSlotName: slotById[parentSlotId]?.name || 'סעודת-האב',
          extraAllowed: category.extra_allowed ?? null,
        });
        continue;
      }

      blocks.push({
        category,
        meals,
        mode: splitModeOf(category),
        // סעודת-אב של ירושה: מציגים טור "יעד" (בוקר) לצד טור הלילה.
        inheritTarget: isInheriting && parentSlotId === slot.id
          ? {
              // שם סעודת-היעד לצורך כותרת הטור: הסעודה הראשונה שאיננה האב
              // שהקטגוריה זמינה בה. אם אין — מדלגים על הטור.
              targetSlotName: targetSlotNameFor(category, slot.id, catalog, slotById),
              extraAllowed: category.extra_allowed ?? null,
            }
          : null,
      });
    }

    return { slot, blocks, inheritNotes };
  }).filter((s) => s.blocks.length > 0 || s.inheritNotes.length > 0);
}

// שם סעודת-היעד של ירושה: הסעודה (שאינה האב) שבה מאכלי הקטגוריה זמינים.
function targetSlotNameFor(category, parentSlotId, catalog, slotById) {
  const mealIds = new Set(
    catalog.meals.filter((m) => m.category_id === category.id).map((m) => m.id)
  );
  for (const s of catalog.meal_slots) {
    if (s.id === parentSlotId) continue;
    const anyAvailable = catalog.meals.some(
      (m) => mealIds.has(m.id) && m.available_slot_ids.includes(s.id)
    );
    if (anyAvailable) return slotById[s.id]?.name || s.name;
  }
  return null;
}

export default function AdminPrintForm({ onAuthError }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const printRef = useRef(null);
  const [fit, setFit] = useState({ zoom: 1, pages: 2, measuredH: 0 });

  useEffect(() => {
    api.catalog()
      .then((cat) => { setCatalog(cat); })
      .catch((e) => {
        if (e.name === 'AdminAuthError') onAuthError?.();
        else setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [onAuthError]);

  const slotSections = useMemo(() => (catalog ? buildSlotLayout(catalog) : []), [catalog]);

  // חישוב "התאמה ל-2 עמודים": מודדים את גובה הטופס כולו (כותרת + פרטים + מנות
  // + תוספות) ברוחב ההדפסה האמיתי, וגוזרים zoom שמכווץ רק אם התוכן חורג
  // מ-2 עמודים. ברוב המקרים הכול נכנס בגודל מלא (zoom = 1) והטקסט נוח לקריאה.
  useLayoutEffect(() => {
    if (!catalog) return undefined;
    const card = printRef.current?.firstElementChild;
    if (!card) return undefined;

    function measure() {
      // אם מצב ההדפסה פעיל (למשל תצוגה מקדימה) — לא מודדים מחדש, כדי לא לחשב
      // zoom חדש על בסיס פונט ההדפסה בזמן שההדפסה רצה. המדידה נעשית במצב מסך.
      if (window.matchMedia && window.matchMedia('print').matches) return;

      // מודדים את פריסת ההדפסה: רוחב A4 שימושי, פונט הדפסה (13px — מסונכרן עם
      // הכלל @media print ב-index.css), בלי zoom.
      const prev = { width: card.style.width, maxWidth: card.style.maxWidth, zoom: card.style.zoom, fontSize: card.style.fontSize, lineHeight: card.style.lineHeight };
      card.style.zoom = '1';
      card.style.maxWidth = 'none';
      card.style.width = `${Math.round(A4_PRINT_W)}px`;
      card.style.fontSize = '13px';
      card.style.lineHeight = '1.32';

      // eslint-disable-next-line no-unused-expressions
      card.offsetHeight; // כפיית reflow
      const h = card.scrollHeight;

      Object.assign(card.style, prev);

      // גובה היעד: 2 עמודים עם רזרבה קטנה (SAFETY). מכווצים רק אם צריך; zoom ≥ 0.7
      // כדי לשמור על טקסט קריא (אם התוכן גדול מדי — עדיף שיגלוש מעט מלהקטין מדי).
      const SAFETY = 0.97;
      const budget = 2 * A4_PRINT_H * SAFETY;
      const zoom = h > budget ? Math.max(0.7, budget / h) : 1;
      const pages = Math.max(1, Math.ceil((h * zoom) / A4_PRINT_H - 0.03));
      setFit({ zoom: Number(zoom.toFixed(3)), pages, measuredH: Math.round(h) });
    }

    measure();
    // מדידה חוזרת אחרי טעינת הלוגו (משפיע על הגובה) ואחרי frame נוסף.
    const raf = requestAnimationFrame(measure);
    const img = card.querySelector('img');
    if (img && !img.complete) img.addEventListener('load', measure, { once: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      if (img) img.removeEventListener('load', measure);
    };
  }, [catalog, slotSections]);


  // מסלולי מחיר לתצוגת "מחיר למנה" בטופס (מ-DB, לא מקודד-קשיח)
  const priceLines = useMemo(() => {
    if (!catalog) return [];
    return (catalog.price_tracks || [])
      .filter((t) => Number(t.price_per_portion) > 0)
      .sort((a, b) => (a.meals_count ?? 0) - (b.meals_count ?? 0))
      .map((t) => ({ name: t.name, price: Number(t.price_per_portion) }));
  }, [catalog]);

  if (loading) return <Page title="דף הזמנה להדפסה"><p>טוען קטלוג...</p></Page>;
  if (error) return <Page title="דף הזמנה להדפסה"><div className="bg-red-50 text-red-700 rounded-xl p-3">{error}</div></Page>;

  return (
    <Page
      title="דף הזמנה להדפסה"
      subtitle="טופס פיזי לחלוקה ללקוחות שאינם מזמינים דרך הממשק — נשאב מהקטלוג החי, מופרד לפי סעודה"
    >
      {/* פס פעולות — לא מודפס */}
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-brand-burgundy/70">
          <p>
            הטופס משקף את המאכלים והתוספות הפעילים במערכת, מופרד לפי סעודה. לעריכת התוכן — מסך
            <span className="font-semibold"> מאכלים וקטגוריות</span>.
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-cream px-2 py-0.5 font-semibold text-brand-burgundy-dark">
              📄 {fit.pages} {fit.pages === 1 ? 'עמוד' : 'עמודים'} (דף דו-צדדי)
            </span>
            {fit.zoom < 1 && (
              <span className="text-brand-gold-dark">כווץ ל-{Math.round(fit.zoom * 100)}% כדי להיכנס ל-2 עמודים</span>
            )}
            <span className="text-brand-burgundy/60">
              להורדת PDF: בחרו ביעד <span className="font-semibold">"שמירה כ-PDF"</span> בחלון ההדפסה.
            </span>
          </p>
        </div>
        <button type="button" onClick={() => window.print()} className="btn-primary">
          🖨️ הדפסה / הורדת PDF
        </button>
      </div>

      {/* אזור ההדפסה — מכוון לדף דו-צדדי (עד 2 עמודי A4). מחלקה print-form
          מפעילה דחיסה ייעודית בהדפסה (ראה index.css) בלי להשפיע על הדפסות אחרות.
          zoom מחושב ב-JS מבטיח שהתוכן נכנס ל-2 עמודים בכל גודל קטלוג. */}
      <div ref={printRef} className="print-area print-form">
        <div
          className="mx-auto max-w-4xl rounded-lg border border-brand-cream-dark bg-white p-6 shadow-card print:border-0 print:shadow-none"
          style={{ zoom: fit.zoom }}
        >
          <FormHeader priceLines={priceLines} />

          <OrderMetaFields />

          {/* גוף התפריט — סעודה אחר סעודה. בכל סעודה הקטגוריות זורמות בשתי עמודות
              (.print-slot-body); ה-zoom מכווץ רק אם צריך כדי לא לחרוג מ-2 עמודים. */}
          <div className="mt-5 space-y-4">
            {slotSections.map((section) => (
              <SlotSection key={section.slot.id} section={section} />
            ))}
          </div>

          {/* תוספות בתשלום + הנחיות — זורמות אחרי המנות (אין מעבר עמוד כפוי). */}
          {catalog.extras?.length > 0 && (
            <ExtrasBlock extras={catalog.extras} />
          )}

          <FormFooter />
        </div>
      </div>
    </Page>
  );
}

function FormHeader({ priceLines }) {
  return (
    <div className="relative border-b-2 border-brand-gold pb-4 text-center">
      <div className="absolute right-0 top-0 text-xs font-bold tracking-wide text-brand-gold-dark">בס״ד</div>
      {/* לוגו בשורה אחת עם הכותרות */}
      <div className="flex items-center justify-center gap-4">
        <img
          src="/logo.png"
          alt='מטבח החסד "ברכת שמואל"'
          width={72}
          height={72}
          className="h-16 w-16 shrink-0 object-contain print:h-14 print:w-14"
        />
        <div className="text-right">
          <h2 className="text-3xl font-extrabold text-brand-burgundy">טופס הזמנה לשבת קודש</h2>
          <p className="mt-0.5 text-sm text-brand-burgundy/70">מטבח החסד "ברכת שמואל"</p>
        </div>
      </div>
      {priceLines.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm font-semibold text-brand-burgundy-dark">
          {priceLines.map((p) => (
            <span key={p.name} className="rounded-full bg-brand-cream px-3 py-0.5">
              {p.name}: {p.price} ש״ח למנה
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// שדות פרטי ההזמנה (שם / פרשה / אירוע / מס' מנות / אולם + אמצעי תשלום) — לכתיבה ידנית
function OrderMetaFields() {
  return (
    <div className="mt-4 rounded-lg border border-brand-cream-dark bg-brand-cream/30 p-4">
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <BlankField label="שם המזמין" />
        <BlankField label="טלפון" />
        <BlankField label="אירוע" />
        <BlankField label="פרשת" />
        <BlankField label="אולם / כתובת" />
        <BlankField label="תאריך" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-x-6 gap-y-3">
        <BlankField label="מס׳ מנות ליל שבת" small />
        <BlankField label="מס׳ מנות יום שבת" small />
        <BlankField label="סה״כ מנות" small />
      </div>
      {/* אמצעי תשלום — סימון (מקור: PAYMENT_METHOD) */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-brand-cream-dark pt-3">
        <span className="text-sm font-semibold text-brand-burgundy-dark">אמצעי תשלום:</span>
        {Object.values(PAYMENT_METHOD).map((label) => (
          <span key={label} className="flex items-center gap-1.5 text-sm text-brand-burgundy-dark">
            <CheckBox />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function BlankField({ label, hint, small }) {
  return (
    <label className="block">
      <span className={`font-semibold text-brand-burgundy-dark ${small ? 'text-xs' : 'text-sm'}`}>{label}</span>
      <div className="mt-1 h-6 border-b border-dashed border-brand-burgundy/40" />
      {hint && <span className="mt-0.5 block text-[11px] text-brand-gold-dark">{hint}</span>}
    </label>
  );
}

// תיבת סימון ריקה לכתיבה ידנית
function CheckBox() {
  return (
    <span
      className="inline-block h-4 w-4 shrink-0 rounded border border-brand-burgundy/50 print:border-black"
      aria-hidden="true"
    />
  );
}

// קו-סימון קצר לכתיבת ערך ידני (כמות / מנות)
function BlankLine({ w = 'w-10' }) {
  return (
    <span
      className={`inline-block h-4 ${w} shrink-0 border-b border-dashed border-brand-burgundy/40`}
      aria-hidden="true"
    />
  );
}

// סעודה שלמה: כותרת + שדה מנות + קטגוריות הזמינות בה (בשתי עמודות)
function SlotSection({ section }) {
  const { slot, blocks, inheritNotes } = section;
  return (
    <section className="print-slot rounded-lg border border-brand-cream-dark">
      <div className="rounded-t-lg bg-brand-burgundy px-3 py-1.5 text-brand-cream print:bg-brand-cream print:text-brand-burgundy-dark">
        <h3 className="text-base font-extrabold">{slot.name}</h3>
      </div>
      <div className="print-slot-body px-3 py-2">
        {/* הפניית סלטי-הבוקר (וכל קטגוריה יורשת אחרת) — משתרעת על שתי העמודות */}
        {inheritNotes.map((n) => (
          <div
            key={n.categoryName}
            className="print-slot-note span-all mb-2 rounded-lg border border-dashed border-brand-gold bg-brand-gold/10 px-3 py-1.5 text-xs text-brand-burgundy-dark"
          >
            <b>{n.categoryName} ל{slot.name}:</b> יש לסמן את ה{n.categoryName} ל{slot.name} בטור{' '}
            <b>"{slot.name}"</b> שברשימת ה{n.categoryName} של {n.parentSlotName}
            {n.extraAllowed != null && ` (עד ${n.extraAllowed})`}.
          </div>
        ))}
        {blocks.map((block) => (
          <CategoryBlock key={block.category.id} block={block} slot={slot} />
        ))}
      </div>
    </section>
  );
}

// בלוק קטגוריה בתוך סעודה: כותרת + כלל דינמי + רשימת מאכלים.
function CategoryBlock({ block, slot }) {
  const { category, meals, mode, inheritTarget } = block;
  const primaryPct = Number(category.primary_percent ?? 80);
  const secondaryPct = Number(category.secondary_percent ?? 50);
  const isEqual = mode === 'equal';
  const isAdditive = mode === 'additive';
  // קטגוריה יורשת עם סעודת-יעד: שני טורי סימון (הסעודה הנוכחית + היעד).
  const twoColumns = !!(inheritTarget && inheritTarget.targetSlotName);

  return (
    <section className="print-cat rounded-lg border border-brand-cream-dark">
      <h4 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-t-lg bg-brand-cream px-3 py-1.5 text-sm font-extrabold text-brand-burgundy-dark print:bg-brand-cream">
        <span>{category.name}</span>
        <CategoryLimit category={category} inheritTarget={inheritTarget} />
        {isEqual && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">חלוקה ידנית</span>
        )}
        {isAdditive && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">דג עיקרי + דג נוסף</span>
        )}
      </h4>

      {/* כלל דינמי לפי מצב החלוקה */}
      {isAdditive && (
        <p className="border-b border-brand-cream-dark/70 bg-brand-gold/10 px-3 py-1 text-[11px] leading-snug text-brand-burgundy-dark">
          בבחירת 2 סוגים: הדג העיקרי מיוצר לפי <b>{primaryPct}%</b> מהמנות, והדג הנוסף לפי <b>{secondaryPct}%</b> מהמנות.
        </p>
      )}
      {isEqual && (
        <p className="border-b border-brand-cream-dark/70 bg-brand-gold/10 px-3 py-1 text-[11px] leading-snug text-brand-burgundy-dark">
          חלוקה ידנית — יש לרשום את מספר המנות לכל סוג שנבחר. סך המנות בקטגוריה חייב להתאים למספר מנות הסעודה.
        </p>
      )}

      {/* מקרא טורי הסימון בקטגוריה יורשת: טור ראשון = הסעודה הנוכחית, טור שני = היעד */}
      {twoColumns && (
        <p className="border-b border-brand-cream-dark/70 px-3 pt-1 text-[11px] font-bold text-brand-gold-dark">
          סימון: טור ימין = {slot.name} · טור שמאל = {inheritTarget.targetSlotName}
        </p>
      )}

      <ul className="divide-y divide-brand-cream-dark/60 px-3 py-1">
        {meals.map((meal) => (
          <li key={meal.id} className="flex items-center gap-2 py-1.5">
            {/* תיבות סימון: קטגוריה יורשת עם יעד → שתי תיבות (נוכחית / יעד); אחרת → אחת */}
            {twoColumns ? (
              <span className="flex shrink-0 gap-1">
                <CheckBox />
                <CheckBox />
              </span>
            ) : (
              <CheckBox />
            )}

            <span className="flex-1 text-sm font-medium text-black">
              {meal.name}
              {meal.requires_extra_charge && meal.extra_charge_amount != null && (
                <span className="text-brand-gold-dark"> (+{Number(meal.extra_charge_amount)} ש״ח)</span>
              )}
            </span>

            {/* additive: תיוג דג עיקרי / דג נוסף */}
            {isAdditive && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                  meal.is_secondary ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {meal.is_secondary ? 'דג נוסף' : 'דג עיקרי'}
              </span>
            )}

            {/* equal: שדה "מנות" לכתיבה ידנית לכל סוג */}
            {isEqual && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-brand-burgundy/60">
                מנות: <BlankLine w="w-10" />
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// טקסט מגבלת הבחירה של הקטגוריה (max_allowed / recommended_min + תוספת ירושה).
function CategoryLimit({ category, inheritTarget }) {
  const parts = [];
  if (category.max_allowed) parts.push(`בחרו עד ${category.max_allowed}`);
  else if (category.recommended_min) parts.push(`מומלץ ${category.recommended_min}`);
  if (inheritTarget && inheritTarget.extraAllowed != null && inheritTarget.targetSlotName) {
    parts.push(`סמנו עד ${inheritTarget.extraAllowed} גם ל${inheritTarget.targetSlotName}`);
  }
  if (parts.length === 0) return null;
  return <span className="text-[11.5px] font-medium text-brand-gold-dark">{parts.join(' · ')}</span>;
}

function ExtrasBlock({ extras }) {
  return (
    <section className="print-extras mt-4 rounded-lg border border-brand-gold">
      <h3 className="rounded-t-lg bg-brand-gold px-3 py-1.5 text-sm font-extrabold text-brand-burgundy-dark">
        תוספות בתשלום (מעבר למחיר הבסיס)
      </h3>
      <ul className="grid grid-cols-1 gap-x-6 px-3 py-1 sm:grid-cols-2">
        {extras.map((e) => (
          <li key={e.id} className="flex items-center gap-2 py-1.5">
            <CheckBox />
            <span className="flex-1 text-sm font-medium text-black">
              {e.name}
              <span className="text-brand-burgundy/70"> — {Number(e.unit_price)} ש״ח ל{e.billing_unit}</span>
              {e.customer_note && <span className="block text-[11px] text-brand-gold-dark">{e.customer_note}</span>}
            </span>
            <span className="shrink-0 text-xs text-brand-burgundy/60">כמות:</span>
            <BlankLine w="w-10" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function FormFooter() {
  return (
    <div className="mt-5 border-t-2 border-brand-gold pt-3 text-xs leading-relaxed text-brand-burgundy/80">
      <p className="font-bold text-brand-burgundy-dark">הנחיות:</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5">
        <li>את הטופס יש להחזיר בצירוף התשלום (מזומן / שיק) לא יאוחר משבועיים לפני השמחה.</li>
        <li>יתכנו שינויים קלים הקשורים לסוגי המוצרים המופיעים בתפריט.</li>
        <li>שתייה קרה: חצי ליטר למנה לכל סעודה. לחמניות: ליל שבת 1.5 למנה, בוקר וסעודה שלישית 1 למנה.</li>
        <li>המטבח בכשרות בד״ץ העדה החרדית. לתיאום ובירורים ניתן לפנות למטבח.</li>
      </ul>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div className="flex-1">
          <div className="h-6 border-b border-brand-burgundy/40" />
          <div className="mt-0.5 text-center text-[11px]">חתימת המזמין</div>
        </div>
        <div className="flex-1">
          <div className="h-6 border-b border-brand-burgundy/40" />
          <div className="mt-0.5 text-center text-[11px]">סכום לתשלום</div>
        </div>
        <div className="flex-1">
          <div className="h-6 border-b border-brand-burgundy/40" />
          <div className="mt-0.5 text-center text-[11px]">התקבל ע״י</div>
        </div>
      </div>
    </div>
  );
}
