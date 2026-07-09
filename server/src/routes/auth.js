// כניסת לקוח לפי טלפון (סעיף 7) + בקשת רישום + כניסת מנהל (סעיף 5)
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { normalizePhone, isValidPhone, asyncHandler, fail } from '../lib/helpers.js';
import { verifyPassword, signToken } from '../lib/auth.js';

const router = Router();

// POST /api/auth/login  { phone }
// מזהה לקוח לפי טלפון מנורמל. מחזיר את הלקוח אם פעיל, אחרת מנחה לרישום.
router.post('/login', asyncHandler(async (req, res) => {
  const normalized = normalizePhone(req.body.phone);
  if (!isValidPhone(normalized)) {
    return fail(res, 400, 'מספר טלפון לא תקין. נא להזין מספר טלפון מלא.');
  }

  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, full_name, phone, email, status')
    .eq('phone_normalized', normalized)
    .maybeSingle();
  if (error) throw error;

  if (!customer) {
    return res.json({ found: false, message: 'המספר לא נמצא במערכת. ניתן לשלוח בקשת רישום.' });
  }

  if (customer.status === 'blocked') {
    return fail(res, 403, 'הגישה למספר זה חסומה. נא לפנות למנהל.');
  }
  if (customer.status !== 'active') {
    return res.json({
      found: true,
      active: false,
      message: 'המשתמש קיים אך ממתין לאישור מנהל.',
    });
  }

  return res.json({ found: true, active: true, customer });
}));

// POST /api/auth/register  { full_name, phone, email, address }
// יוצר בקשת רישום לקוח חדש הממתינה לאישור (סעיף 7).
router.post('/register', asyncHandler(async (req, res) => {
  const { full_name, email, address } = req.body;
  const normalized = normalizePhone(req.body.phone);

  if (!full_name || !full_name.trim()) return fail(res, 400, 'נא להזין שם מלא.');
  if (!isValidPhone(normalized)) return fail(res, 400, 'מספר טלפון לא תקין.');

  // אם כבר קיים לקוח עם הטלפון הזה — לא יוצרים כפילות (סעיף 6.1)
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('phone_normalized', normalized)
    .maybeSingle();
  if (existing) {
    return fail(res, 409, 'מספר הטלפון כבר קיים במערכת.');
  }

  const { data: pendingRequest, error: pendingErr } = await supabase
    .from('customer_registration_requests')
    .select('id')
    .eq('phone_normalized', normalized)
    .eq('is_handled', false)
    .maybeSingle();
  if (pendingErr) throw pendingErr;
  if (pendingRequest) {
    return fail(res, 409, 'כבר קיימת בקשת רישום שממתינה לאישור עבור מספר הטלפון הזה.');
  }

  const { error } = await supabase.from('customer_registration_requests').insert({
    full_name: full_name.trim(),
    phone: req.body.phone,
    phone_normalized: normalized,
    email: email || null,
    address: address || null,
  });
  if (error) throw error;

  return res.json({ ok: true, message: 'בקשת הרישום נשלחה. לאחר אישור מנהל תוכל/י להזמין.' });
}));

// POST /api/auth/admin-login  { email, password }
// כניסת משתמש מערכת (מנהל/רכז/מפתחת). מחזיר טוקן חתום ופרטי משתמש (סעיף 5).
router.post('/admin-login', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!email || !password) return fail(res, 400, 'נא להזין אימייל וסיסמה.');

  const { data: user, error } = await supabase
    .from('app_users')
    .select('id, full_name, email, role, is_active, password_hash')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;

  // הודעה אחידה לכל כשל כדי לא לחשוף אילו אימיילים קיימים.
  const bad = () => fail(res, 401, 'אימייל או סיסמה שגויים.');
  if (!user || !user.is_active) return bad();

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return bad();

  await supabase.from('app_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id);

  const token = signToken(user);
  return res.json({
    token,
    user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role },
  });
}));

export default router;
