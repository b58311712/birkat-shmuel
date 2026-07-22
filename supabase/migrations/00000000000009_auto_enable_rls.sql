-- =============================================================================
-- מטבח החסד - מיגרציה 09: הפעלת RLS אוטומטית על כל טבלה חדשה
-- =============================================================================
-- מטרה: "נעול כברירת מחדל" (secure by default).
--   כל טבלה חדשה בסכימת public תקבל RLS מופעל אוטומטית, כך שאי אפשר יהיה
--   לגשת אליה דרך ה-API הציבורי (anon/authenticated) עד שיוגדרו policies.
--
-- ⚠️ השלכות שחשוב להכיר:
--   1. טבלה עם RLS מופעל אך ללא policies = חסומה לחלוטין ל-anon/authenticated.
--      הגישה תעבוד רק דרך service_role key (עוקף RLS) - מתאים לשרת Node.
--   2. ליצירת EVENT TRIGGER נדרשות הרשאות superuser.
--      יש להריץ מיגרציה זו דרך ה-SQL Editor של Supabase (שם ההרשאות קיימות),
--      ולא דרך ה-API הרגיל.
--   3. הטריגר תופס רק טבלאות *חדשות*. בסוף הקובץ מופעל RLS גם על כל
--      הטבלאות הקיימות שנוצרו במיגרציות 01-08.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- פונקציית הטריגר: רצה בסיום כל CREATE TABLE ומפעילה RLS על הטבלה החדשה
-- ----------------------------------------------------------------------------
create or replace function auto_enable_rls()
returns event_trigger
language plpgsql
as $$
declare
  obj record;
begin
  -- עוברים על כל האובייקטים שנוצרו בפקודת ה-DDL הנוכחית
  for obj in
    select * from pg_event_trigger_ddl_commands()
    where command_tag = 'CREATE TABLE'
      and object_type = 'table'
  loop
    -- מפעילים RLS רק על טבלאות בסכימת public
    if split_part(obj.object_identity, '.', 1) = 'public' then
      execute format('alter table %s enable row level security;', obj.object_identity);
    end if;
  end loop;
end;
$$;

comment on function auto_enable_rls is
  'מפעיל RLS אוטומטית על כל טבלה חדשה שנוצרת בסכימת public';

-- ----------------------------------------------------------------------------
-- ה-Event Trigger עצמו - נורה בסיום (ddl_command_end) של פקודות DDL
-- ----------------------------------------------------------------------------
drop event trigger if exists trg_auto_enable_rls;

create event trigger trg_auto_enable_rls
  on ddl_command_end
  when tag in ('CREATE TABLE')
  execute function auto_enable_rls();

-- ----------------------------------------------------------------------------
-- הפעלת RLS על כל הטבלאות הקיימות (שנוצרו לפני הטריגר, מיגרציות 01-08)
-- לולאה דינמית - תופסת כל טבלה קיימת ב-public שעדיין אין לה RLS.
-- ----------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end;
$$;

-- =============================================================================
-- הערה חשובה להמשך:
--   כעת כל הטבלאות נעולות ל-API הציבורי. יש שתי דרכים לגשת לנתונים:
--     (א) שרת Node עם service_role key - עוקף RLS, מתאים ללוגיקה עסקית.
--     (ב) הגדרת policies פרטניות לכל טבלה (מיגרציה עתידית) - לגישה ישירה
--         מהפרונט לפי תפקיד המשתמש.
--   בשלב זה, כשהגישה דרך שרת Node עם service_role, אין צורך ב-policies.
-- =============================================================================
