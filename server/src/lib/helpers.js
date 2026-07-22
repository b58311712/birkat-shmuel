// פונקציות עזר משותפות לשרת

// ניקוי טלפון: משאיר ספרות בלבד (סעיף 7 באיפיון).
// "052-123 4567" -> "0521234567"
export function normalizePhone(raw) {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '');
}

// ולידציה בסיסית של טלפון ישראלי (9-10 ספרות)
export function isValidPhone(normalized) {
  return /^0\d{8,9}$/.test(normalized);
}

// פיצול שם מלא לשם פרטי ושם משפחה: המילה הראשונה = פרטי, השאר = משפחה.
// שם בעל מילה אחת -> last_name ריק (null). משמש כשמתקבל שם מלא בלבד (למשל עריכת
// פרטי לקוח מתוך הזמנה) וצריך לכתוב אותו לעמודות המפוצלות.
export function splitFullName(raw) {
  const trimmed = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return { first_name: '', last_name: null };
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { first_name: trimmed, last_name: null };
  return { first_name: trimmed.slice(0, idx), last_name: trimmed.slice(idx + 1) };
}

// בניית שם מלא לתצוגה בצד השרת (זהה לביטוי המחושב ב-DB).
export function joinName(first, last) {
  const f = String(first || '').trim();
  const l = String(last || '').trim();
  return l ? `${f} ${l}` : f;
}

// עיגול כלפי מעלה (סעיף 14.5, 21.4)
export function roundUp(value) {
  return Math.ceil(value);
}

// עוטף handler אסינכרוני ומעביר שגיאות ל-error middleware
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// תשובת שגיאה אחידה בעברית
export function fail(res, status, message) {
  return res.status(status).json({ error: message });
}
