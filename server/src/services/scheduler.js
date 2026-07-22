// מתזמן פנימי של השרת (in-process). מפעיל משימות מחזוריות ישירות מתוך התהליך,
// בלי תלות בשירות תזמון חיצוני - כך שבשרת תמיד-פעיל (בתשלום / שרת אחר) הכל
// רץ לבד. בשרת חינמי שנרדם הטיימר לא יורה בזמן שהוא ישן, ולכן יש גם השלמה
// בכל עליית שרת (startup) שממלאת את הלוח ברגע שהשרת מתעורר.
import cron from 'node-cron';
import { ensureUpcomingShabbatot } from './shabbatGenerator.js';

const TZ = 'Asia/Jerusalem';
const WEEKLY_SHABBAT = '0 22 * * 6'; // מוצ״ש (יום 6) בשעה 22:00 שעון ישראל
const SHABBAT_WINDOW = 8;            // כמה שבתות פעילות לשמור קדימה

// עוטף הרצה בטוחה: לוג ברור + בליעת שגיאות, כדי ששגיאת רשת/DB לא תפיל את השרת.
async function runEnsureShabbatot(trigger) {
  try {
    const result = await ensureUpcomingShabbatot({ count: SHABBAT_WINDOW });
    const created = result.created.map((s) => `${s.gregorian_date} ${s.parasha}`).join(', ');
    console.log(
      `🗓️  [${trigger}] שבתות: נוצרו ${result.created_count}` +
      (result.created_count ? ` (${created})` : '') +
      `, בלוח ${result.existing}/${result.requested}`,
    );
    return result;
  } catch (err) {
    console.error(`⚠️  [${trigger}] יצירת שבתות נכשלה: ${err.message}`);
    return null;
  }
}

let started = false;

// מפעיל את המתזמן הפנימי. בטוח לקריאה חוזרת (מריץ פעם אחת בלבד).
export function startScheduler() {
  if (started) return;
  started = true;

  // 1) השלמה בעליית השרת - ממלא מיד את חלון 8 השבתות. קריטי לשרת חינמי שנרדם:
  //    בכל התעוררות (בקשה ראשונה אחרי שינה) הלוח מתעדכן. fire-and-forget כדי
  //    לא לחסום את עליית השרת.
  runEnsureShabbatot('startup');

  // 2) טיימר שבועי פנימי - מוצ״ש 22:00 שעון ישראל. עובד לבד בשרת תמיד-פעיל.
  //    node-cron מטפל ב-DST של Asia/Jerusalem; noOverlap מונע הצטברות ריצות.
  cron.schedule(WEEKLY_SHABBAT, () => runEnsureShabbatot('weekly'), {
    timezone: TZ,
    noOverlap: true,
  });

  console.log(`⏰ מתזמן פנימי פעיל: יצירת שבתות במוצ״ש 22:00 (${TZ}), שמירת ${SHABBAT_WINDOW} שבתות קדימה.`);
}
