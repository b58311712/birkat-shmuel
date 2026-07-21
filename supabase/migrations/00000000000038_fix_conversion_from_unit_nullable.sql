-- =============================================================================
-- מטבח החסד — מיגרציה 38: תיקון — from_unit הטקסטואלי בהמרות אינו חובה
-- =============================================================================
-- באג: מיגרציה 35 יצרה את inventory_unit_conversions.from_unit כטקסט NOT NULL.
-- מיגרציה 36 הוסיפה from_unit_id (FK) והפכה אותו למקור-האמת, אך השאירה את
-- from_unit הטקסטואלי כ-NOT NULL. לכן INSERT ששולח רק from_unit_id (כפי שה-UI
-- וה-API עושים) נכשל על הפרת NOT NULL — ההמרה לא נשמרה.
--
-- תיקון:
--   1. from_unit נעשה nullable (הוא מיותר — from_unit_id הוא מקור האמת).
--   2. טריגר sync_conversion_from_unit_text ממלא את from_unit הטקסטואלי מ-
--      from_unit_id (עקבי עם sync_unit_text_from_id בשאר הטבלאות; תאימות-לאחור).
-- =============================================================================

alter table inventory_unit_conversions
  alter column from_unit drop not null;

-- ממלא את עמודת הטקסט משם היחידה (תאימות-לאחור). מקביל ל-sync_unit_text_from_id.
create or replace function sync_conversion_from_unit_text()
returns trigger
language plpgsql
as $$
begin
  if new.from_unit_id is not null then
    select name into new.from_unit from units where id = new.from_unit_id;
  end if;
  return new;
end;
$$;

create trigger trg_conversions_sync_from_unit
  before insert or update of from_unit_id on inventory_unit_conversions
  for each row execute function sync_conversion_from_unit_text();

comment on function sync_conversion_from_unit_text() is
  'ממלא את from_unit הטקסטואלי משם ה-from_unit_id (תאימות-לאחור, מיגרציה 38)';
