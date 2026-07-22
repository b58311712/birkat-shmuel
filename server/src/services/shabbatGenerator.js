// יצירת שבתות אוטומטית מלוח עברי (סעיף 8.2).
// מקור אמת יחיד ללוגיקת "לוודא שתמיד קיימות N שבתות פעילות קדימה".
// משמש את ה-CRON (server/src/routes/cron.js). אידמפוטנטי: יוצר רק את החסרות.
import { supabase } from '../lib/supabase.js';
import { comingSaturday, shabbatInfoForDate } from '../lib/parasha.js';

const WEEK_MS = 7 * 86400000;

// רשימת N השבתות הקרובות (החל מהשבת הקרובה, כולל היום אם היום שבת),
// כמחרוזות 'YYYY-MM-DD'. הראשונה מנורמלת ל-12:00 מקומית, לכן הוספת שבועות
// שלמים לא גולשת ליום אחר גם סביב מעברי שעון קיץ/חורף.
export function upcomingSaturdays(count, from = new Date()) {
  const first = comingSaturday(from);
  if (!first) return [];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(first.getTime() + i * WEEK_MS);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// מוודא שקיימות לפחות `count` שבתות קרובות רצופות בלוח, ויוצר את החסרות בלבד.
// אידמפוטנטי: הרצה חוזרת באותו שבוע לא משכפלת (בדיקה מוקדמת + אינדקס ייחודי
// על gregorian_date שסופג מרוצי-תנאי). כל שבת נוצרת בסטטוס 'open' (פעילה).
export async function ensureUpcomingShabbatot({ count = 8, from = new Date() } = {}) {
  const targets = upcomingSaturdays(count, from);
  if (!targets.length) return { requested: count, range: null, existing: 0, created_count: 0, created: [], skipped: [] };

  const { data: existingRows, error: selErr } = await supabase
    .from('shabbatot')
    .select('gregorian_date')
    .in('gregorian_date', targets);
  if (selErr) throw selErr;
  const existing = new Set((existingRows || []).map((r) => r.gregorian_date));

  const created = [];
  const skipped = [];

  for (const dateStr of targets) {
    if (existing.has(dateStr)) { skipped.push({ gregorian_date: dateStr, reason: 'exists' }); continue; }

    const info = shabbatInfoForDate(dateStr);
    if (!info || !info.parasha) { skipped.push({ gregorian_date: dateStr, reason: 'no_label' }); continue; }

    const { error: insErr } = await supabase.from('shabbatot').insert({
      parasha: info.parasha,
      hebrew_date: info.hebrew_date,
      gregorian_date: info.gregorian_date,
      status: 'open',
    });

    if (insErr) {
      // 23505 = הפרת אינדקס ייחודי (שבת נוצרה במקביל) - לא שגיאה אמיתית, מדלגים.
      if (insErr.code === '23505') { skipped.push({ gregorian_date: dateStr, reason: 'exists' }); continue; }
      throw insErr;
    }
    created.push({ gregorian_date: info.gregorian_date, parasha: info.parasha });
  }

  return {
    requested: count,
    range: { from: targets[0], to: targets[targets.length - 1] },
    existing: existing.size,
    created_count: created.length,
    created,
    skipped,
  };
}
