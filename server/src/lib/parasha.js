// חישוב פרשת השבוע מתוך תאריך לועזי — לפי לוח ארץ ישראל (@hebcal/core).
// מחליף את רשימת-הפרשות שהייתה מקודדת-קשיח ב-seedDemo; מטפל נכון בפרשות
// מחוברות (למשל "מטות-מסעי") ובלוח א"י מול חו"ל.
import { HebrewCalendar, HDate, flags } from '@hebcal/core';

// מסירים ניקוד ואת המילה "פרשת" — הפרונט כבר מוסיף "פרשת" מעל השם.
function cleanName(rendered) {
  return rendered
    .normalize('NFC')
    .replace(/־/g, '-')                       // מקף עברי → מקף רגיל (מטות-מסעי) — לפני הסרת הניקוד
    .replace(/[֑-ׇ]/g, '')          // טעמים וניקוד בלבד (לא כולל אותיות/מקף)
    .replace(/^פרשת\s+/, '')
    .trim();
}

// מחזיר את שם הפרשה (ללא "פרשת", ללא ניקוד) של השבת שחלה בתאריך הנתון
// או אחריו. מקבל מחרוזת 'YYYY-MM-DD' או Date. מחזיר null אם אין (חג/מועד).
export function parashaForDate(value, { il = true } = {}) {
  const base = value instanceof Date ? new Date(value) : new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(base.getTime())) return null;

  const sat = new Date(base);
  sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7)); // קידום לשבת הקרובה (כולל היום אם שבת)

  const hd = new HDate(sat);
  const events = HebrewCalendar.calendar({ start: hd, end: hd, il, sedrot: true, noHolidays: true });
  const ev = events.find((e) => e.getFlags() & flags.PARSHA_HASHAVUA);
  return ev ? cleanName(ev.render('he')) : null;
}
