// נתיבי CRON — מופעלים ע"י שירות תזמון חיצוני (cron-job.org / Render Cron / GitHub Action),
// כי שרת ה-Render החינמי נרדם ואינו יכול להריץ timer פנימי אמין.
// אבטחה: מפתח סודי CRON_SECRET בכותרת (x-cron-secret) או בפרמטר ?secret= — לא לוגין מנהל.
// נרשם ב-index.js תחת /api/cron (מחוץ ל-requireAdmin).
import { Router } from 'express';
import net from 'node:net';
import dns from 'node:dns/promises';
import nodemailer from 'nodemailer';
import { asyncHandler, fail } from '../lib/helpers.js';
import { generateForMonth, monthKeyOf, isMonthKey } from '../services/recurringExpenses.js';

const router = Router();

// שער אבטחה — משווה מפתח בזמן קבוע. אם CRON_SECRET לא הוגדר, ה-CRON מושבת (403).
function checkSecret(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected) { fail(res, 503, 'CRON אינו מוגדר בשרת (חסר CRON_SECRET).'); return false; }
  const got = req.get('x-cron-secret') || req.query.secret || '';
  if (got !== expected) { fail(res, 401, 'מפתח CRON שגוי.'); return false; }
  return true;
}

// ---------------------------------------------------------------------------
// POST /run-due — מפיק את ההוצאות הקבועות שיום-החודש שלהן = היום, לחודש הנוכחי.
// מיועד להרצה יומית. idempotent — הרצה חוזרת באותו יום לא משכפלת.
// אפשר לכפות יום/חודש לבדיקה: body { day, month } (שניהם אופציונליים).
// ---------------------------------------------------------------------------
router.post('/run-due', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;

  const now = new Date();
  // יום היעד: 1..28. אם היום 29/30/31 — מטפלים בו כ-28 כדי לא לפספס תבניות של סוף החודש
  // (day_of_month מוגבל ל-1..28, ולכן ה-29+ לעולם לא "מגיע" אחרת).
  const rawDay = Number(req.body?.day) || now.getDate();
  const day = Math.min(Math.max(rawDay, 1), 28);
  const month = req.body?.month || monthKeyOf(now);
  if (!isMonthKey(month)) return fail(res, 400, 'חודש לא תקין (נדרש YYYY-MM).');

  const result = await generateForMonth({ month, onlyDayOfMonth: day });
  res.json({ ...result, day });
}));

// ---------------------------------------------------------------------------
// POST /run-month — גיבוי: מפיק את כל התבניות הפעילות לחודש הנוכחי (ללא סינון יום).
// שימושי אם החמיצו הרצות יומיות — הריצו פעם בחודש להשלמה. idempotent.
// ---------------------------------------------------------------------------
router.post('/run-month', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;

  const month = req.body?.month || monthKeyOf(new Date());
  if (!isMonthKey(month)) return fail(res, 400, 'חודש לא תקין (נדרש YYYY-MM).');
  const result = await generateForMonth({ month });
  res.json(result);
}));

// ---------------------------------------------------------------------------
// GET /net-diag — אבחון רשת יוצא (זמני). בודק אם השרת (Render) מסוגל להתחבר
// ל-SMTP של Gmail מעל IPv4 ומעל IPv6, ומריץ verify() מלא. מאובטח ב-CRON_SECRET.
// למחיקה אחרי האבחון.
// ---------------------------------------------------------------------------
router.get('/net-diag', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT) || 587;
  const out = { host, port, node: process.version };

  // רזולוציית DNS — אילו כתובות מוחזרות ובאיזה סדר
  try { out.dns_a = await dns.resolve4(host); } catch (e) { out.dns_a = 'ERR: ' + e.message; }
  try { out.dns_aaaa = await dns.resolve6(host); } catch (e) { out.dns_aaaa = 'ERR: ' + e.message; }

  // בדיקת TCP גולמית לכתובת מסוימת עם timeout
  const tcpTest = (address, family) => new Promise((resolve) => {
    const started = Date.now();
    const sock = net.connect({ host: address, port, family });
    const done = (result) => { sock.destroy(); resolve({ address, family, ms: Date.now() - started, ...result }); };
    sock.setTimeout(8000);
    sock.once('connect', () => done({ ok: true }));
    sock.once('timeout', () => done({ ok: false, err: 'timeout' }));
    sock.once('error', (e) => done({ ok: false, err: e.message }));
  });

  const a4 = Array.isArray(out.dns_a) ? out.dns_a[0] : null;
  const a6 = Array.isArray(out.dns_aaaa) ? out.dns_aaaa[0] : null;
  out.tcp_ipv4 = a4 ? await tcpTest(a4, 4) : 'no A record';
  out.tcp_ipv6 = a6 ? await tcpTest(a6, 6) : 'no AAAA record';

  // verify() מלא דרך nodemailer (עם family:4 כמו בקוד הייצור)
  try {
    const t = nodemailer.createTransport({
      host, port,
      secure: String(process.env.SMTP_SECURE) === 'true',
      family: 4,
      connectionTimeout: 8000, greetingTimeout: 8000,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await t.verify();
    out.verify = 'OK';
  } catch (e) {
    out.verify = 'FAILED: ' + e.message + (e.code ? ` (${e.code})` : '');
  }

  res.json(out);
}));

export default router;
