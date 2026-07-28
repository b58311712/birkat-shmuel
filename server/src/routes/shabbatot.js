// שבתות (סעיף 8)
//
// מאז מיגרציה 52 טבלת shabbatot מכילה גם אירועים (kind='event'). כל שליפת
// *רשימה* כאן חייבת לסנן kind='shabbat', אחרת אירוע פרטי של חבר קהילה יוצג
// לכל הקהילה בטופס ההזמנה. האירועים נשלפים דרך /api/admin/events בלבד.
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/helpers.js';

const router = Router();

// GET /api/shabbatot/open - שבתות פתוחות עתידיות עד חודש קדימה (ללקוח, סעיף 8.3)
router.get('/open', asyncHandler(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const inMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('shabbatot')
    .select('id, parasha, hebrew_date, gregorian_date, status, payment_deadline')
    .eq('kind', 'shabbat')
    .eq('status', 'open')
    .gte('gregorian_date', today)
    .lte('gregorian_date', inMonth)
    .order('gregorian_date');
  if (error) throw error;
  res.json(data);
}));

// GET /api/shabbatot - כל השבתות (לניהול)
router.get('/', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('shabbatot')
    .select('*')
    .eq('kind', 'shabbat')
    .order('gregorian_date', { ascending: false });
  if (error) throw error;
  res.json(data);
}));

export default router;
