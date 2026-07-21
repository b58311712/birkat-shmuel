// הגדרות מערכת ציבוריות לקריאה בצד הלקוח (system_settings).
// כרגע: שיעור מע"מ (vat_rate) — נדרש לחישוב מחיר כולל מע"מ בכל מסכי הניהול.
// ערך לא-רגיש, ולכן נחשף בקריאה פתוחה (ללא טוקן מנהל).
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/helpers.js';

const router = Router();

const DEFAULT_VAT_RATE = 18;

// GET /api/settings/public — הגדרות ציבוריות לקליינט
router.get('/public', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('system_settings').select('value').eq('key', 'vat_rate').maybeSingle();
  if (error) throw error;
  // value נשמר כ-jsonb (מספר או מחרוזת); ממירים בזהירות עם נפילה לברירת מחדל.
  const parsed = data?.value != null ? Number(data.value) : NaN;
  const vat_rate = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_VAT_RATE;
  res.json({ vat_rate });
}));

export default router;
