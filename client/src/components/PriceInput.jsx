import { useEffect, useRef, useState } from 'react';
import { toBasePrice, withVat, getVatRate } from '../lib/vat.js';

// שדה הזנת מחיר עם מתג "לפני מע"מ / כולל מע"מ".
//
// המשתמש מקליד את המחיר בדיוק כפי שכתוב בחשבונית הספק, ובוחר איך לפרש אותו.
// הרכיב מנרמל תמיד ל**מחיר בסיס (לפני מע"מ)** ומדווח אותו החוצה דרך onChange,
// כך שהערך הנשמר אחיד תמיד. מתחת לשדה מוצג המחיר הסופי כולל מע"מ לאישור ויזואלי.
//
// props:
//   value          - מחיר הבסיס הנוכחי (מספר או '' / null). מקור האמת מבחוץ.
//   onChange(base) - נקרא עם מחיר הבסיס המנורמל (מספר או null).
//   exempt         - הפריט פטור ממע"מ → אין תוספת מע"מ, והמתג מוסתר.
//   defaultIncludesVat - מצב התחלתי למתג (ברירת מחדל של הספק). ברירת מחדל: false.
//   className, placeholder, id - מועברים לשדה הקלט.
export default function PriceInput({
  value,
  onChange,
  exempt = false,
  defaultIncludesVat = false,
  className = '',
  placeholder = 'מחיר',
  id,
}) {
  // מצב המתג: האם המספר המוקלד הוא כולל מע"מ. לפריט פטור - תמיד "לפני" (זהה).
  const [includesVat, setIncludesVat] = useState(defaultIncludesVat && !exempt);
  // הטקסט המוצג בשדה. לא נגזר ישירות מ-value כדי לא לשבש הקלדה חופשית.
  const [text, setText] = useState('');
  const lastEmitted = useRef(undefined);

  // סנכרון טקסט השדה כשמחיר הבסיס משתנה מבחוץ (טעינת רשומה, איפוס טופס),
  // אך לא כתגובה לשינוי שאנחנו עצמנו דיווחנו זה עתה (מונע לולאה/דריסת הקלדה).
  useEffect(() => {
    const base = value === '' || value == null ? null : Number(value);
    if (base === lastEmitted.current) return;
    if (base == null) { setText(''); return; }
    // מציגים בשדה לפי מצב המתג הנוכחי: כולל מע"מ → הבסיס × מקדם, אחרת הבסיס.
    const shown = includesVat && !exempt ? withVat(base, { exempt }) : round2(base);
    setText(shown == null ? '' : String(shown));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // כשמשתנה מצב הפטור - מכריחים חזרה ל"לפני מע"מ" (המתג לא רלוונטי לפטור).
  useEffect(() => {
    if (exempt && includesVat) setIncludesVat(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exempt]);

  // ברירת המחדל של הספק מגיעה לעתים אחרי העלייה (טעינה אסינכרונית של הספק).
  // מסנכרנים את המתג כל עוד השדה ריק - כדי לא לדרוס בחירה ידנית של המשתמש.
  useEffect(() => {
    if (text === '' && !exempt) setIncludesVat(defaultIncludesVat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultIncludesVat]);

  function emit(nextText, nextIncludesVat) {
    const base = toBasePrice(nextText, { includesVat: nextIncludesVat, exempt });
    lastEmitted.current = base;
    onChange(base);
  }

  function handleText(e) {
    const t = e.target.value;
    setText(t);
    emit(t, includesVat);
  }

  // החלפת מצב המתג משמרת את **מחיר הבסיס** קבוע, ורק מציגה אותו אחרת:
  // "לפני מע"מ" → הבסיס עצמו, "כולל מע"מ" → הבסיס × מקדם. כך המעבר בין שתי
  // התצוגות אינו משנה את הערך הנשמר, ומציג את אותו מחיר בשתי הצורות.
  function toggleMode(nextIncludesVat) {
    setIncludesVat(nextIncludesVat);
    const currentBase = toBasePrice(text, { includesVat, exempt });
    if (currentBase == null) return; // שדה ריק - רק מחליפים מצב
    const shown = nextIncludesVat && !exempt ? withVat(currentBase, { exempt }) : currentBase;
    setText(shown == null ? '' : String(shown));
    lastEmitted.current = currentBase;
    onChange(currentBase);
  }

  const base = toBasePrice(text, { includesVat, exempt });
  const finalPrice = withVat(base, { exempt });

  return (
    <div className="space-y-1">
      <input
        id={id}
        type="number"
        step="any"
        min="0"
        value={text}
        onChange={handleText}
        placeholder={placeholder}
        className={className}
        dir="ltr"
      />
      {exempt ? (
        <div className="text-xs text-brand-burgundy/50">פטור ממע"מ - המחיר הסופי</div>
      ) : (
        <>
          <div className="flex gap-1 text-xs" dir="rtl">
            <ToggleBtn active={!includesVat} onClick={() => toggleMode(false)}>לפני מע"מ</ToggleBtn>
            <ToggleBtn active={includesVat} onClick={() => toggleMode(true)}>כולל מע"מ</ToggleBtn>
          </div>
          {finalPrice != null && (
            <div className="text-xs text-brand-burgundy/60" dir="ltr">
              ₪{finalPrice.toFixed(2)} כולל מע"מ ({getVatRate()}%)
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ToggleBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 rounded-md transition-colors ${
        active ? 'bg-brand-gold text-brand-burgundy-dark' : 'bg-brand-cream text-brand-burgundy/60 hover:text-brand-burgundy'
      }`}
    >
      {children}
    </button>
  );
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
