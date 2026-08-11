// עריכה עצמית של הזמנה ע"י לקוח באמצעות קוד בן 6 ספרות (במקום קישור/טוקן ארוך -
// הלקוח מזין אותו כמו סיסמה במסך ההזמנה הקיים, לא לוחץ על קישור במייל).
// חתך הזמן ("עד שבועיים לפני האירוע") נגזר דינמית מ-shabbatot.gregorian_date בכל
// בדיקה, ולא נשמר כתאריך תפוגה קבוע - כך שאינו "קופא" אם מועד השבת/האירוע משתנה.
import crypto from 'node:crypto';

export const EDIT_CUTOFF_DAYS = 14;

// הגנת ניחוש-בכוח: קוד בן 6 ספרות (בניגוד לטוקן ארוך אקראי) חייב הגבלת קצב.
export const MAX_CODE_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

// קוד בן 6 ספרות, כולל אפסים מובילים (למשל "004821").
export function generateEditCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// תאריך החתך: שבועיים לפני מועד השבת/האירוע. null אם אין תאריך מועד.
export function editCutoffDate(gregorianDate) {
  if (!gregorianDate) return null;
  const d = new Date(gregorianDate);
  d.setDate(d.getDate() - EDIT_CUTOFF_DAYS);
  return d;
}

// true אם עדיין ניתן לערוך (לפני חתך הזמן).
export function isEditWindowOpen(gregorianDate, now = new Date()) {
  const cutoff = editCutoffDate(gregorianDate);
  return Boolean(cutoff) && now < cutoff;
}
