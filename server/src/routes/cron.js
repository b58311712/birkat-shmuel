// נתיבי CRON — מופעלים ע"י שירות תזמון חיצוני (cron-job.org / Render Cron / GitHub Action),
// כי שרת ה-Render החינמי נרדם ואינו יכול להריץ timer פנימי אמין.
// אבטחה: מפתח סודי CRON_SECRET בכותרת (x-cron-secret) או בפרמטר ?secret= — לא לוגין מנהל.
// נרשם ב-index.js תחת /api/cron (מחוץ ל-requireAdmin).
import { Router } from 'express';
import { asyncHandler, fail } from '../lib/helpers.js';
import { generateForMonth, monthKeyOf } from '../services/recurringExpenses.js';

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
  const result = await generateForMonth({ month });
  res.json(result);
}));

export default router;
