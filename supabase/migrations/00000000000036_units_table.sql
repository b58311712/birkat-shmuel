-- =============================================================================
-- מטבח החסד — מיגרציה 36: טבלת יחידות מידה גלובלית (ערכים קבועים, לא טקסט חופשי)
-- =============================================================================
-- עד כה יחידת המידה נשמרה כטקסט חופשי בשלושה מקומות:
--   inventory_items.unit  (יחידת הבסיס של הפריט)
--   recipe_lines.unit     (יחידת המתכון)
--   inventory_unit_conversions.from_unit  (יחידת המקור בהמרה — מיגרציה 35)
-- טקסט חופשי גרם לשונוּת ("גרם"/"גר'"/"גרמים") שמקשה על התאמה והמרה.
--
-- כאן מנרמלים ל**טבלת units גלובלית אחת** עם ערכים מנוהלים, ומצביעים אליה
-- ב-FK מכל שלושת המקומות. עמודות הטקסט הישנות (unit) נשמרות לתאימות-לאחור
-- עד שכל הקוד יעבור ל-unit_id — הן מסונכרנות דרך טריגר.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. טבלת יחידות המידה
-- ----------------------------------------------------------------------------
-- kind = מימד היחידה (weight/volume/count/length/other) — לתצוגה ולסינון עתידי
-- של המרות הגיוניות. name ייחודי (case-insensitive) כדי למנוע כפילויות.
create table units (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                    -- שם היחידה כפי שמוצג (גרם, ק"ג, כף, יחידה)
  kind          text not null default 'other',    -- weight | volume | count | length | other
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ייחודיות case-insensitive על שם היחידה ("גרם" = "גרם ")
create unique index uq_units_name_ci on units (lower(btrim(name)));

create trigger trg_units_updated_at
  before update on units for each row execute function set_updated_at();

comment on table units is 'יחידות מידה גלובליות מנוהלות (מחליף טקסט חופשי) (סעיף 25, 21.3)';
comment on column units.kind is 'מימד היחידה: weight/volume/count/length/other';

-- ----------------------------------------------------------------------------
-- 2. Backfill — אוספים את כל ערכי היחידה הקיימים ליצירת units ייחודיים
-- ----------------------------------------------------------------------------
-- מנרמלים בעזרת btrim (רווחים מובילים/סוגרים). מדלגים על ריק/NULL.
-- lower() רק להשוואת ייחודיות; שומרים את הכתיב הראשון שנתקלנו בו כתצוגה.
insert into units (name, kind)
select distinct on (lower(btrim(u.unit))) btrim(u.unit) as name, 'other' as kind
from (
  select unit from inventory_items where unit is not null and btrim(unit) <> ''
  union all
  select unit from recipe_lines   where unit is not null and btrim(unit) <> ''
  union all
  select from_unit as unit from inventory_unit_conversions where from_unit is not null and btrim(from_unit) <> ''
) u
order by lower(btrim(u.unit))
on conflict (lower(btrim(name))) do nothing;

-- ----------------------------------------------------------------------------
-- 3. inventory_items.unit_id — FK ליחידת הבסיס
-- ----------------------------------------------------------------------------
alter table inventory_items
  add column unit_id uuid references units(id);

update inventory_items i
   set unit_id = u.id
  from units u
 where lower(btrim(i.unit)) = lower(btrim(u.name))
   and i.unit is not null and btrim(i.unit) <> '';

create index idx_inventory_items_unit on inventory_items (unit_id);

comment on column inventory_items.unit_id is 'יחידת הבסיס של הפריט (FK ל-units); unit הטקסטואלי נשמר לתאימות';

-- ----------------------------------------------------------------------------
-- 4. recipe_lines.unit_id — FK ליחידת המתכון
-- ----------------------------------------------------------------------------
alter table recipe_lines
  add column unit_id uuid references units(id);

update recipe_lines r
   set unit_id = u.id
  from units u
 where lower(btrim(r.unit)) = lower(btrim(u.name))
   and r.unit is not null and btrim(r.unit) <> '';

create index idx_recipe_lines_unit on recipe_lines (unit_id);

comment on column recipe_lines.unit_id is 'יחידת המתכון (FK ל-units); unit הטקסטואלי נשמר לתאימות';

-- ----------------------------------------------------------------------------
-- 5. inventory_unit_conversions.from_unit_id — FK ליחידת המקור בהמרה
-- ----------------------------------------------------------------------------
-- מיגרציה 35 יצרה את from_unit כטקסט. כאן מוסיפים FK ומאכלסים ממנו.
-- אילוץ הייחודיות (item, from_unit) מוחלף באילוץ על (item, from_unit_id).
alter table inventory_unit_conversions
  add column from_unit_id uuid references units(id);

update inventory_unit_conversions c
   set from_unit_id = u.id
  from units u
 where lower(btrim(c.from_unit)) = lower(btrim(u.name))
   and c.from_unit is not null and btrim(c.from_unit) <> '';

-- מחליפים את אילוץ הייחודיות מ-(item,from_unit טקסט) ל-(item,from_unit_id).
alter table inventory_unit_conversions
  drop constraint if exists uq_conversion_item_unit;
create unique index uq_conversion_item_unit_id
  on inventory_unit_conversions (inventory_item_id, from_unit_id);

create index idx_unit_conversions_from_unit on inventory_unit_conversions (from_unit_id);

comment on column inventory_unit_conversions.from_unit_id is
  'יחידת המקור בהמרה (FK ל-units); from_unit הטקסטואלי נשמר לתאימות';

-- ----------------------------------------------------------------------------
-- 6. סנכרון unit הטקסטואלי מ-unit_id (תאימות-לאחור עד סיום המעבר)
-- ----------------------------------------------------------------------------
-- קוד ישן שעדיין קורא/כותב את עמודת הטקסט ימשיך לעבוד: כשמעדכנים unit_id,
-- הטריגר ממלא את unit משם היחידה. כך אין צורך לשלוח את שניהם מהיישום.
create or replace function sync_unit_text_from_id()
returns trigger
language plpgsql
as $$
begin
  if new.unit_id is not null then
    select name into new.unit from units where id = new.unit_id;
  end if;
  return new;
end;
$$;

create trigger trg_inventory_items_sync_unit
  before insert or update of unit_id on inventory_items
  for each row execute function sync_unit_text_from_id();

create trigger trg_recipe_lines_sync_unit
  before insert or update of unit_id on recipe_lines
  for each row execute function sync_unit_text_from_id();

comment on function sync_unit_text_from_id() is
  'ממלא את עמודת unit הטקסטואלית משם ה-unit_id (תאימות-לאחור בתקופת המעבר)';
