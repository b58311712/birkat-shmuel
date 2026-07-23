-- =============================================================================
-- מטבח החסד - מיגרציה 45: מבשל מחליף קבוע למאכל (סעיף 24.2)
-- =============================================================================
-- עד כה volunteer_meal_links היה רשימה שטוחה של מבשלים למאכל, בלי תפקיד: כל מי
-- שמקושר למאכל נחשב מבשל בפועל. המחליף היחיד שהיה קיים הוא דריסה פר-שבת
-- (volunteer_assignments עם meal_id, מיגרציה 42) - כלומר לא ניתן היה להגדיר מראש
-- מי מחליף את המבשל הקבוע.
--
-- כאן נוסף role לקישור, באותו מודל של המשימות (volunteer_task_links):
--   primary = מבשל קבוע, הוא המשובץ בפועל בתיק השבת.
--   backup  = מחליף קבוע, אינו משובץ אוטומטית ומוצג כהצעה מהירה בבורר המחליף
--             ובשורת גיבוי בהדפסה. שיבוצו בפועל נשאר דריסה ידנית פר-שבת.
--
-- ברירת המחדל primary שומרת על התנהגות זהה לכל הקישורים הקיימים.
-- =============================================================================

alter table volunteer_meal_links
  add column if not exists role text not null default 'primary';

alter table volunteer_meal_links
  drop constraint if exists volunteer_meal_links_role_check;
alter table volunteer_meal_links
  add constraint volunteer_meal_links_role_check check (role in ('primary', 'backup'));

comment on column volunteer_meal_links.role is
  'primary = מבשל קבוע (משובץ בפועל), backup = מחליף קבוע (הצעה מהירה בלבד) - סעיף 24.2';
