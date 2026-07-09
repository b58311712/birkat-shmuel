// אימות משתמשי מערכת (מנהל/רכז/מפתחת) — שלב ביניים לפני Supabase Auth.
// כניסה: אימייל + סיסמה -> hash מושווה מול app_users.password_hash (bcrypt).
// הצלחה מחזירה JWT חתום שנשלח בכל קריאה ל-/api/admin בכותרת Authorization.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { fail } from './helpers.js';

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = process.env.JWT_TTL || '12h';

// אזהרה קשה אם אין סוד — טוקנים לא בטוחים בלי סוד יציב.
if (!JWT_SECRET) {
  console.error('\n❌ חסר משתנה סביבה JWT_SECRET — אזור הניהול לא יאובטח.');
  console.error('   הוסיפי JWT_SECRET (מחרוזת אקראית ארוכה) ל-server/.env\n');
}

const BCRYPT_ROUNDS = 12;

export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(plain, hash);
}

// יוצר טוקן עבור משתמש מערכת. שומרים מינימום מידע (id, role, שם).
export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.full_name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

// שולף ומאמת טוקן מכותרת Authorization: Bearer <token>
function readToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// middleware: דורש משתמש מערכת מחובר. מציב req.appUser.
export function requireAdmin(req, res, next) {
  if (!JWT_SECRET) return fail(res, 500, 'אימות אינו מוגדר בשרת. פני למנהל המערכת.');
  const claims = readToken(req);
  if (!claims) return fail(res, 401, 'נדרשת התחברות מנהל.');
  req.appUser = claims;
  next();
}

// middleware: דורש אחד מהתפקידים הנתונים (משתמש כבר עבר requireAdmin).
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.appUser || !roles.includes(req.appUser.role)) {
      return fail(res, 403, 'אין לך הרשאה לפעולה זו.');
    }
    next();
  };
}
