-- =============================================================================
-- מטבח החסד - מיגרציה 52: מועדים (שבת / אירוע)
-- =============================================================================
-- עד כה shabbatot ייצגה שבתות בלבד. מעתה היא טבלת **מועדים**: שבת רגילה לפי
-- פרשת השבוע, או אירוע (אירוע פנימי של הקהילה / אירוע פרטי חריג של חבר קהילה).
--
-- הרציונל: כל השרשרת התפעולית והכספית של המערכת מפתחת על shabbat_id -
-- תיק העבודה, ניכוי המלאי האטומי, דוח החוסרים, הזמנות הרכש, המתנדבים, וההזמנה
-- עם הגבייה שלה. אירוע שנכנס לאותה טבלה מקבל את כל אלה בלי שרשרת מקבילה,
-- ובלי מקור אמת שני שיסטה מהראשון.
--
-- ההבדל התפעולי היחיד הוא בתצוגה: אירוע נפתח כברירת מחדל במסך קל ונפרד
-- (/admin/events), ורק אם המנהל מבקש הוא "מקודם" לתיק עבודה מלא. הדגל
-- use_full_workfile הוא מתג התצוגה הזה, ולא הבדל במבנה הנתונים.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- עמודות המועד
-- ----------------------------------------------------------------------------
-- מקום האירוע אינו נשמר כאן במכוון: הוא יושב על ההזמנה (venue_name/venue_address),
-- שם הוא ממילא שדה חובה (מיגרציה 27) ומשם קורא אותו דוח השינוע.
alter table shabbatot
  add column kind              text not null default 'shabbat',
  add column title             text,       -- שם האירוע (בשבת נשאר null; מציגים parasha)
  add column event_type        text,       -- 'community' | 'private' (null בשבת)
  add column event_time        time,       -- שעת האירוע (אופציונלי)
  add column use_full_workfile boolean not null default true;

alter table shabbatot
  add constraint chk_occasion_kind
    check (kind in ('shabbat', 'event')),
  add constraint chk_occasion_event_type
    check (event_type is null or event_type in ('community', 'private'));

-- ----------------------------------------------------------------------------
-- זהות המועד: שבת מזוהה בפרשה, אירוע מזוהה בשם
-- ----------------------------------------------------------------------------
-- parasha ו-hebrew_date היו not null כי כל רשומה הייתה שבת. אירוע אינו קשור
-- לפרשה ולא בהכרח לתאריך עברי, ולכן האילוץ עובר להיות מותנה בסוג המועד.
alter table shabbatot alter column parasha     drop not null;
alter table shabbatot alter column hebrew_date drop not null;

alter table shabbatot
  add constraint chk_occasion_identity check (
    (kind = 'shabbat' and parasha is not null and btrim(parasha) <> '')
    or
    (kind = 'event' and title is not null and btrim(title) <> '')
  );

-- ----------------------------------------------------------------------------
-- ייחודיות התאריך - רק לשבתות
-- ----------------------------------------------------------------------------
-- האינדקס המקורי מנע שתי רשומות באותו תאריך. אצל אירועים זה שגוי משתי סיבות:
-- אירוע יכול לחול על תאריך של שבת קיימת (קידוש בשבת), ויכולים להתקיים שני
-- אירועים נפרדים באותו יום. לשבתות עצמן הייחודיות נשמרת ככתבה - היא מה שמונע
-- כפילויות בלוח ומה שהמתזמן האוטומטי (shabbatGenerator) נשען עליו.
drop index if exists uq_shabbatot_gregorian_date;

create unique index uq_shabbatot_gregorian_date
  on shabbatot (gregorian_date)
  where kind = 'shabbat';

create index idx_shabbatot_kind on shabbatot (kind);

-- ----------------------------------------------------------------------------
-- תיעוד
-- ----------------------------------------------------------------------------
comment on table shabbatot is
  'מועדים: שבת לפי פרשת השבוע (kind=shabbat) או אירוע קהילה/אירוע פרטי (kind=event)';
comment on column shabbatot.kind is
  'shabbat = שבת רגילה בלוח; event = אירוע פנימי של הקהילה או אירוע פרטי חריג';
comment on column shabbatot.title is
  'שם האירוע. חובה כאשר kind=event; בשבת נשאר null והתצוגה משתמשת ב-parasha';
comment on column shabbatot.event_type is
  'community = אירוע פנימי של הקהילה; private = אירוע פרטי של חבר קהילה';
comment on column shabbatot.use_full_workfile is
  'true = מוצג תיק עבודה מלא (מטבח, אריזה, שינוע, מתנדבים, הדפסות). '
  'אירוע נוצר עם false ומוצג במסך האירועים הקל, עד שהמנהל מקדם אותו. '
  'מתג תצוגה בלבד - הנתונים זהים בשני המצבים';
