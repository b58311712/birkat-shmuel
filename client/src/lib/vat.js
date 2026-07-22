// עזרי מע"מ בצד הלקוח.
//
// עיקרון: כל המחירים השמורים במערכת הם **מחיר בסיס (לפני מע"מ)**. המחיר "כולל
// מע"מ" הוא נגזרת שמחושבת כאן בזמן התצוגה, ולעולם אינו נשמר. שיעור המע"מ הוא
// גלובלי אחד (מגיע מהשרת), כך שביום שהמע"מ משתנה - משנים ערך אחד והכל מתעדכן.
//
// זרימת ההזנה:
//   • המשתמש מקליד מחיר בדיוק כפי שכתוב בחשבונית של הספק.
//   • מתג "לפני מע"מ / כולל מע"מ" קובע איך לפרש את המספר.
//   • toBasePrice() מנרמל תמיד למחיר בסיס לפני השמירה.
// זרימת התצוגה:
//   • withVat() מוסיף מע"מ בחזרה (אלא אם הפריט פטור) → המחיר הסופי המוצג.

import { api } from './api.js';

const DEFAULT_VAT_RATE = 18;
let vatRate = DEFAULT_VAT_RATE;
let loadPromise = null;

// טוען את שיעור המע"מ מהשרת פעם אחת ומאחסן במטמון. נכשל בשקט לברירת המחדל
// (18%) כדי שהתצוגה תמשיך לעבוד גם אם ההגדרה חסרה.
export function loadVatRate() {
  if (!loadPromise) {
    loadPromise = api.publicSettings()
      .then((s) => {
        const r = Number(s?.vat_rate);
        if (Number.isFinite(r) && r >= 0) vatRate = r;
        return vatRate;
      })
      .catch(() => vatRate);
  }
  return loadPromise;
}

// שיעור המע"מ הנוכחי (באחוזים), למשל 18.
export function getVatRate() {
  return vatRate;
}

// מקדם ההכפלה למחיר כולל מע"מ, למשל 1.18.
function vatMultiplier() {
  return 1 + vatRate / 100;
}

// מחיר סופי כולל מע"מ מתוך מחיר בסיס. פריט פטור → המחיר הבסיס ללא תוספת.
// מקבל מחיר בסיס (מספר או null) ומחזיר מספר, או null אם אין מחיר.
export function withVat(basePrice, { exempt = false } = {}) {
  if (basePrice == null || basePrice === '') return null;
  const base = Number(basePrice);
  if (!Number.isFinite(base)) return null;
  return exempt ? base : round2(base * vatMultiplier());
}

// נרמול קלט מההזנה למחיר בסיס לפני שמירה.
//   • includesVat=false או פטור → הערך כבר בסיס, מוחזר כמו שהוא.
//   • includesVat=true → מחלקים במקדם המע"מ כדי לחלץ את הבסיס.
// מחזיר מספר, או null אם הקלט ריק/לא תקין.
export function toBasePrice(input, { includesVat = false, exempt = false } = {}) {
  if (input == null || input === '') return null;
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  if (!includesVat || exempt) return round2(n);
  return round2(n / vatMultiplier());
}

// עיצוב מחיר כולל מע"מ להצגה, למשל "₪118.00". מחזיר '-' אם אין מחיר.
export function formatWithVat(basePrice, { exempt = false } = {}) {
  const v = withVat(basePrice, { exempt });
  if (v == null) return '-';
  return `₪${v.toFixed(2)}`;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
