// טופס הזמנה פיזי להדפסה (סעיף 8 / דף הזמנה ידני).
// ------------------------------------------------------------------------
// מסך למנהל שמייצר דף הזמנה מודפס לחלוקה ללקוחות שאינם מזמינים דרך הממשק.
// שואב את הקטלוג החי (GET /api/catalog) — אותו מקור של אשף ההזמנה — כך שהטופס
// המודפס תמיד תואם למאכלים, לקטגוריות ולתוספות שבמערכת. משתמש בתשתית ההדפסה
// הקיימת (.print-area / .no-print ב-index.css) כדי להדפיס רק את הטופס.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';

// מידות עמוד A4 להדפסה (ב-CSS px @96dpi) בניכוי שוליים 1.4cm מכל צד.
// רוחב שימושי ≈ (21 - 2.8)ס"מ, גובה שימושי ≈ (29.7 - 2.8)ס"מ.
const CM_TO_PX = 96 / 2.54;
const PRINT_MARGIN_CM = 1.4;
const A4_PRINT_W = (21 - 2 * PRINT_MARGIN_CM) * CM_TO_PX;   // ≈ 688px
const A4_PRINT_H = (29.7 - 2 * PRINT_MARGIN_CM) * CM_TO_PX; // ≈ 1017px

// ------------------------------------------------------------------------
// עוזרים לפריסת המאכלים לפי קטגוריה + סעודה זמינה
function groupMealsByCategory(catalog) {
  const catById = Object.fromEntries(catalog.categories.map((c) => [c.id, c]));
  const byCat = {};
  for (const meal of catalog.meals) {
    const cat = catById[meal.category_id];
    if (!cat) continue;
    (byCat[cat.id] ||= { category: cat, meals: [] }).meals.push(meal);
  }
  // ממוין לפי display_order של הקטגוריה, ובתוך כל קטגוריה לפי display_order של המאכל
  return Object.values(byCat)
    .sort((a, b) => (a.category.display_order ?? 0) - (b.category.display_order ?? 0))
    .map((g) => ({
      ...g,
      meals: g.meals.slice().sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    }));
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

  const groups = useMemo(() => (catalog ? groupMealsByCategory(catalog) : []), [catalog]);

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

      // מודדים את פריסת ההדפסה: רוחב A4 שימושי, פונט הדפסה (10px), בלי zoom.
      const prev = { width: card.style.width, maxWidth: card.style.maxWidth, zoom: card.style.zoom, fontSize: card.style.fontSize, lineHeight: card.style.lineHeight };
      card.style.zoom = '1';
      card.style.maxWidth = 'none';
      card.style.width = `${Math.round(A4_PRINT_W)}px`;
      card.style.fontSize = '10px';
      card.style.lineHeight = '1.25';

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
  }, [catalog, groups]);


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
      subtitle="טופס פיזי לחלוקה ללקוחות שאינם מזמינים דרך הממשק — נשאב מהקטלוג החי במערכת"
    >
      {/* פס פעולות — לא מודפס */}
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-brand-burgundy/70">
          <p>
            הטופס משקף את המאכלים והתוספות הפעילים במערכת. לעריכת התוכן — מסך
            <span className="font-semibold"> מאכלים וקטגוריות</span>.
          </p>
          <p className="mt-1 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-cream px-2 py-0.5 font-semibold text-brand-burgundy-dark">
              📄 {fit.pages} {fit.pages === 1 ? 'עמוד' : 'עמודים'} (דף דו-צדדי)
            </span>
            {fit.zoom < 1 && (
              <span className="text-brand-gold-dark">כווץ ל-{Math.round(fit.zoom * 100)}% כדי להיכנס ל-2 עמודים</span>
            )}
          </p>
        </div>
        <button type="button" onClick={() => window.print()} className="btn-primary">
          🖨️ הדפסת הטופס
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

          {/* גוף התפריט — קטגוריות בזרימת עמודות (CSS columns) גם במסך וגם בהדפסה.
              הכול זורם טבעי על פני עד 2 עמודים; ה-zoom מכווץ רק אם צריך כדי לא
              לחרוג מ-2 עמודים, כך שברוב המקרים הטקסט נשאר בגודל מלא. */}
          <div className="print-form-body mt-5">
            {groups.map((g) => (
              <CategoryBlock key={g.category.id} group={g} />
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

// שדות פרטי ההזמנה (שם / פרשה / אירוע / מס' מנות / אולם) — לכתיבה ידנית
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

// בלוק קטגוריה: כותרת + רשימת מאכלים עם תיבת סימון וציון סעודות זמינות
function CategoryBlock({ group }) {
  const { category, meals } = group;
  return (
    <section className="print-cat rounded-lg border border-brand-cream-dark">
      <h3 className="rounded-t-lg bg-brand-burgundy px-3 py-1.5 text-sm font-extrabold text-brand-cream print:bg-brand-cream print:text-brand-burgundy-dark">
        {category.name}
        {(category.recommended_min || category.max_allowed) && (
          <span className="mr-2 text-xs font-medium opacity-90">
            {category.max_allowed ? `לבחירה ${category.max_allowed} סוגים` : `מומלץ ${category.recommended_min}`}
          </span>
        )}
      </h3>
      <ul className="divide-y divide-brand-cream-dark/60 px-3 py-1">
        {meals.length === 0 ? (
          <li className="py-1.5 text-xs text-brand-burgundy/50">אין מאכלים פעילים בקטגוריה זו.</li>
        ) : meals.map((meal) => {
          return (
            <li key={meal.id} className="flex items-center gap-2 py-1.5">
              <span className="inline-block h-4 w-4 shrink-0 rounded border border-brand-burgundy/50 print:border-black" aria-hidden="true" />
              <span className="flex-1 text-sm text-brand-burgundy-dark">
                {meal.name}
                {meal.requires_extra_charge && meal.extra_charge_amount != null && (
                  <span className="text-brand-gold-dark"> (+{Number(meal.extra_charge_amount)} ש״ח)</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
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
            <span className="inline-block h-4 w-4 shrink-0 rounded border border-brand-burgundy/50 print:border-black" aria-hidden="true" />
            <span className="flex-1 text-sm text-brand-burgundy-dark">
              {e.name}
              <span className="text-brand-burgundy/60"> — {Number(e.unit_price)} ש״ח ל{e.billing_unit}</span>
              {e.customer_note && <span className="block text-[11px] text-brand-gold-dark">{e.customer_note}</span>}
            </span>
            <span className="shrink-0 text-xs text-brand-burgundy/60">כמות:</span>
            <span className="inline-block h-4 w-10 shrink-0 border-b border-dashed border-brand-burgundy/40" aria-hidden="true" />
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
