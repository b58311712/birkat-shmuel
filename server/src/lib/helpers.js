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
