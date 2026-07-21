-- =============================================================================
-- מטבח החסד — מיגרציה 39: אחוזי חלוקה אוטומטית (additive) פר-סעודה
-- =============================================================================
-- עד כה האחוזים במצב additive היו גלובליים לקטגוריה:
--   categories.primary_percent (80) / categories.secondary_percent (50),
-- כלומר אותה חלוקה בדיוק בליל שבת ובשבת בבוקר.
--
-- הדרישה: לקבוע חלוקה שונה לכל סעודה. למשל בקטגוריית דגים —
--   ליל שבת:    עיקרי 80% + משני 50%
--   שבת בבוקר:  עיקרי 50% + משני 50%
--
-- מודל: טבלת דריסות פר (קטגוריה × סעודה). שורה קיימת = דריסה לסעודה זו;
-- אין שורה (או ערך NULL בעמודה) = נופלים חזרה לאחוז ברמת הקטגוריה.
-- הטבלה נפרדת מ-category_meal_slots (שמשמעותה "לאילו סעודות הקטגוריה רלוונטית")
-- כדי לא לערבב שתי משמעויות באותה שורה.
-- =============================================================================

create table if not exists category_slot_splits (
  category_id       uuid not null references categories(id) on delete cascade,
  meal_slot_id      uuid not null references meal_slots(id) on delete cascade,
  primary_percent   smallint check (primary_percent between 1 and 100),
  secondary_percent smallint check (secondary_percent between 1 and 100),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (category_id, meal_slot_id)
);

drop trigger if exists trg_category_slot_splits_updated_at on category_slot_splits;
create trigger trg_category_slot_splits_updated_at
  before update on category_slot_splits for each row execute function set_updated_at();

comment on table category_slot_splits is
  'דריסת אחוזי החלוקה האוטומטית (split_mode=additive) לסעודה מסוימת. NULL = לפי ברירת המחדל של הקטגוריה (סעיף 13).';
comment on column category_slot_splits.primary_percent is
  'אחוז המנות למאכל העיקרי בסעודה זו. NULL = categories.primary_percent.';
comment on column category_slot_splits.secondary_percent is
  'אחוז המנות (תוספת) למאכל המשני בסעודה זו. NULL = categories.secondary_percent.';

create index if not exists idx_category_slot_splits_category on category_slot_splits(category_id);
