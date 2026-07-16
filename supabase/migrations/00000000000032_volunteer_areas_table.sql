-- =============================================================================
-- מטבח החסד — מיגרציה 32: תחומי התנדבות כטבלה ניתנת-לניהול + ביטול קטגוריות
-- =============================================================================
-- 'תחום' היה enum קבוע (cooking/packing/transport/cleaning/general) ו'קטגוריה'
-- הייתה טבלה נפרדת ששכפלה אותו — כפילות. מאחדים: התחום הופך לטבלה ניתנת-לניהול
-- מהממשק (הוספה/עריכה/מחיקה/סדר) והוא המבנה היחיד. דגל is_cooking מחליף את
-- ההסתמכות על המחרוזת 'cooking' (מפעיל קישור מאכלים + שיבוץ בישול אוטומטי).
-- הנתונים דמו — ניתן לאפס.

-- ----------------------------------------------------------------------------
-- 1. טבלת התחומים
-- ----------------------------------------------------------------------------
create table volunteer_areas (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  is_cooking    boolean not null default false,  -- מפעיל קישור מאכלים ושיבוץ בישול
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint volunteer_areas_name_not_blank check (btrim(name) <> '')
);
create unique index uq_volunteer_areas_name on volunteer_areas (lower(name));
create trigger trg_volunteer_areas_updated_at
  before update on volunteer_areas for each row execute function set_updated_at();

-- זריעת חמשת התחומים הקיימים (שמם בעברית; 'בישול' מסומן is_cooking).
insert into volunteer_areas (name, is_cooking, display_order) values
  ('בישול', true, 1), ('אריזה', false, 2), ('שינוע', false, 3),
  ('ניקיון', false, 4), ('כללי', false, 5);

-- מיפוי מערך ה-enum הישן לשם התחום, לצורך ה-backfill.
create or replace function _area_enum_to_name(a volunteer_area) returns text language sql immutable as $$
  select case a
    when 'cooking' then 'בישול' when 'packing' then 'אריזה' when 'transport' then 'שינוע'
    when 'cleaning' then 'ניקיון' else 'כללי' end;
$$;

-- ----------------------------------------------------------------------------
-- 2. volunteers.area_id
-- ----------------------------------------------------------------------------
alter table volunteers add column area_id uuid references volunteer_areas(id) on delete restrict;
update volunteers v set area_id = a.id
  from volunteer_areas a where a.name = _area_enum_to_name(v.area);
alter table volunteers alter column area_id set not null;
drop index if exists idx_volunteers_area;
alter table volunteers drop column area;
create index idx_volunteers_area on volunteers (area_id);

-- ----------------------------------------------------------------------------
-- 3. volunteer_tasks.area_id
-- ----------------------------------------------------------------------------
alter table volunteer_tasks add column area_id uuid references volunteer_areas(id) on delete restrict;
update volunteer_tasks t set area_id = a.id
  from volunteer_areas a where a.name = _area_enum_to_name(t.area);
alter table volunteer_tasks alter column area_id set not null;
alter table volunteer_tasks drop column area;

-- ----------------------------------------------------------------------------
-- 4. volunteer_area_links.area_id (שיוך מתנדב לתחומים מרובים)
-- ----------------------------------------------------------------------------
alter table volunteer_area_links add column area_id uuid references volunteer_areas(id) on delete cascade;
update volunteer_area_links l set area_id = a.id
  from volunteer_areas a where a.name = _area_enum_to_name(l.area);
alter table volunteer_area_links alter column area_id set not null;
drop index if exists idx_volunteer_area_links_area;
alter table volunteer_area_links drop constraint volunteer_area_links_volunteer_id_area_key;
alter table volunteer_area_links drop column area;
create unique index uq_volunteer_area_links on volunteer_area_links (volunteer_id, area_id);
create index idx_volunteer_area_links_area on volunteer_area_links (area_id);

-- ----------------------------------------------------------------------------
-- 5. ביטול הקטגוריות (הוחלפו על ידי התחומים)
-- ----------------------------------------------------------------------------
alter table volunteer_tasks drop column if exists category_id;
drop table if exists volunteer_task_categories cascade;

-- ----------------------------------------------------------------------------
-- ניקוי
-- ----------------------------------------------------------------------------
drop function if exists _area_enum_to_name(volunteer_area);
-- ה-enum volunteer_area כבר לא בשימוש בשום עמודה; משאירים אותו (ללא נזק) כדי לא
-- לשבור מיגרציות היסטוריות שמתייחסות אליו.

comment on table volunteer_areas is 'תחומי התנדבות ניתנים-לניהול. is_cooking מפעיל קישור מאכלים ושיבוץ בישול אוטומטי';
