// חישוב פרשת השבוע מתוך תאריך לועזי - לפי לוח ארץ ישראל (@hebcal/core).
// מחליף את רשימת-הפרשות שהייתה מקודדת-קשיח ב-seedDemo; מטפל נכון בפרשות
// מחוברות (למשל "מטות-מסעי") ובלוח א"י מול חו"ל.
import { HebrewCalendar, HDate, flags } from '@hebcal/core';

// מסירים ניקוד ואת המילה "פרשת" - הפרונט כבר מוסיף "פרשת" מעל השם.
function cleanName(rendered) {
  return rendered
    .normalize('NFC')
    .replace(/־/g, '-')                       // מקף עברי → מקף רגיל (מטות-מסעי) - לפני הסרת הניקוד
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

// מחזיר את השבת הקרובה (כולל היום אם היום שבת) עבור ערך תאריך נתון, מנורמלת
// לשעה 12:00 מקומית כדי למנוע גלישת יום בהמרת אזור-זמן. מחזיר Date או null.
export function comingSaturday(value = new Date()) {
  const base = value instanceof Date ? new Date(value) : new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const sat = new Date(base);
  sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7));
  sat.setHours(12, 0, 0, 0);
  return sat;
}

// מחזיר מידע מלא לשבת שחלה בתאריך הנתון או אחריו: תאריך לועזי (יום שבת),
// שם לתצוגה (parasha), ותווית עברית (hebrew_date). בשבת שהיא חג/מועד (בלי
// פרשת שבוע) מחזיר את שם החג במקום, כדי שלא ייווצר "חור" בלוח - מערכת
// הקייטרינג צריכה גם את שבתות החג. מחזיר null רק אם התאריך פסול.
export function shabbatInfoForDate(value, { il = true } = {}) {
  const sat = comingSaturday(value);
  if (!sat) return null;
  const gregorian_date = sat.toISOString().slice(0, 10);

  const hd = new HDate(sat);
  const events = HebrewCalendar.calendar({ start: hd, end: hd, il, sedrot: true });

  const parshaEv = events.find((e) => e.getFlags() & flags.PARSHA_HASHAVUA);
  if (parshaEv) {
    const parasha = cleanName(parshaEv.render('he'));
    return { gregorian_date, parasha, hebrew_date: `שבת פרשת ${parasha}` };
  }

  // שבת שהיא חג/מועד - אין פרשת שבוע; לוקחים את שם האירוע (למשל "סוכות א׳").
  const holidayEv = events.find((e) => !(e.getFlags() & flags.PARSHA_HASHAVUA));
  if (holidayEv) {
    const name = cleanName(holidayEv.render('he'));
    return { gregorian_date, parasha: name, hebrew_date: `שבת ${name}` };
  }

  // גיבוי נדיר: אין פרשה ואין חג - נשתמש בתאריך העברי כתווית.
  const heb = cleanName(hd.render('he'));
  return { gregorian_date, parasha: heb, hebrew_date: `שבת ${heb}` };
}
