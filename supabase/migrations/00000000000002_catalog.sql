-- =============================================================================
-- מטבח החסד - מיגרציה 02: קטלוג דינמי
-- סעודות, קטגוריות, מאכלים, תוספות, מסלולי מחיר, מתכונים, כללי אריזה
-- =============================================================================
-- עיקרון הדינמיות (סעיף 3): המנהל מנהל את כל אלה בעצמו, בלי קיבוע בקוד.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- meals_slots - סעודות (סעיף 12)
-- ----------------------------------------------------------------------------
-- ברירת מחדל: ליל שבת, שבת בבוקר, סעודה שלישית. דינמי לניהול עתידי.
-- requires_companion = true עבור "סעודה שלישית" שלא ניתן לבחור לבד (סעיף 12.2).
create table meal_slots (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,                   -- שם הסעודה (ליל שבת...)
  display_order      integer not null default 0,      -- סדר תצוגה
  requires_companion boolean not null default false,  -- לא ניתן לבחור לבד (סעודה שלישית)
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_meal_slots_updated_at
  before update on meal_slots for each row execute function set_updated_at();

comment on table meal_slots is 'סעודות: ליל שבת, שבת בבוקר, סעודה שלישית - דינמי';
comment on column meal_slots.requires_companion is 'true = לא ניתן לבחור לבד (סעודה שלישית דורשת עוד סעודה)';

-- ----------------------------------------------------------------------------
-- categories - קטגוריות מאכלים (סעיף 13.2, 13.3)
-- ----------------------------------------------------------------------------
create table categories (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,                    -- שם קטגוריה
  internal_description text,                           -- תיאור פנימי
  display_order     integer not null default 0,       -- סדר תצוגה
  recommended_min   integer,                          -- מינימום מומלץ (לא חוסם)
  max_allowed       integer,                          -- מקסימום מותר (חוסם)
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_categories_updated_at
  before update on categories for each row execute function set_updated_at();

comment on column categories.recommended_min is 'מינימום מומלץ - אינו חוסם, מציג הודעה בלבד (סעיף 13.4)';
comment on column categories.max_allowed is 'מקסימום מותר - כלל מחייב, המערכת חוסמת מעבר אליו (סעיף 13.4)';

-- קטגוריה רלוונטית לאילו סעודות (סעיף 13.3) - יחס רבים-לרבים
create table category_meal_slots (
  category_id  uuid not null references categories(id) on delete cascade,
  meal_slot_id uuid not null references meal_slots(id) on delete cascade,
  primary key (category_id, meal_slot_id)
);

comment on table category_meal_slots is 'אילו סעודות רלוונטיות לכל קטגוריה';

-- ----------------------------------------------------------------------------
-- meals - מאכלים / כרטיס מאכל (סעיף 13.5)
-- ----------------------------------------------------------------------------
-- כל מאכל שייך לקטגוריה אחת בלבד, אך זמין בכמה סעודות (סעיף 13.5).
create table meals (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,                    -- שם מאכל
  category_id           uuid not null references categories(id), -- קטגוריה אחת
  included_in_base      boolean not null default true,    -- כלול במחיר הבסיס
  requires_extra_charge boolean not null default false,   -- דורש תוספת מחיר
  extra_charge_amount   numeric(10,2),                    -- מחיר תוספת, אם יש
  kitchen_prep_notes    text,                             -- הערות הכנה פנימיות
  kitchen_report_notes  text,                             -- הערות לדוח מטבח
  display_order         integer not null default 0,       -- סדר תצוגה
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- אם דורש תוספת מחיר, חייב סכום
  constraint chk_meals_extra_charge
    check (not requires_extra_charge or extra_charge_amount is not null)
);

create index idx_meals_category on meals (category_id);
create index idx_meals_active on meals (is_active);

create trigger trg_meals_updated_at
  before update on meals for each row execute function set_updated_at();

comment on table meals is 'כרטיס מאכל - שייך לקטגוריה אחת, זמין בכמה סעודות';

-- מאכל זמין באילו סעודות (סעיף 13.5) - יחס רבים-לרבים
create table meal_available_slots (
  meal_id      uuid not null references meals(id) on delete cascade,
  meal_slot_id uuid not null references meal_slots(id) on delete cascade,
  primary key (meal_id, meal_slot_id)
);

comment on table meal_available_slots is 'אילו סעודות זמין בהן כל מאכל';

-- ----------------------------------------------------------------------------
-- recipes - מתכונים לפי מנה אחת (סעיף 21.3)
-- ----------------------------------------------------------------------------
-- כל מאכל -> רשימת שורות מתכון (חומר גלם + כמות למנה אחת).
-- inventory_item_id יקושר לטבלת המלאי במיגרציה 06 (הוספת FK בהמשך).
create table recipe_lines (
  id                uuid primary key default gen_random_uuid(),
  meal_id           uuid not null references meals(id) on delete cascade,
  inventory_item_id uuid,                           -- FK יתווסף במיגרציה 06
  ingredient_name   text not null,                  -- שם חומר גלם (גיבוי/תצוגה)
  quantity_per_portion numeric(12,4) not null,      -- כמות למנה אחת
  unit              text not null,                  -- יחידת מידה
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_recipe_lines_meal on recipe_lines (meal_id);

create trigger trg_recipe_lines_updated_at
  before update on recipe_lines for each row execute function set_updated_at();

comment on table recipe_lines is 'שורות מתכון: חומר גלם וכמות למנה אחת (סעיף 21.3)';

-- ----------------------------------------------------------------------------
-- packing_rules - כללי אריזה למאכל (סעיף 22)
-- ----------------------------------------------------------------------------
-- packaging_item_id יקושר לטבלת המלאי (אריזות כמלאי, סעיף 22.4) במיגרציה 06.
create table packing_rules (
  id                 uuid primary key default gen_random_uuid(),
  meal_id            uuid not null references meals(id) on delete cascade,
  packaging_item_id  uuid,                          -- FK יתווסף במיגרציה 06 (סוג אריזה)
  packaging_label    text not null,                 -- תיאור אריזה (קופסה 4 ליטר)
  portions_per_package numeric(12,4) not null,      -- כמה מנות באריזה אחת
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_packing_rules_meal on packing_rules (meal_id);

create trigger trg_packing_rules_updated_at
  before update on packing_rules for each row execute function set_updated_at();

comment on table packing_rules is 'כללי אריזה: כמה מנות נכנסות לאריזה מסוג מסוים (סעיף 22)';

-- ----------------------------------------------------------------------------
-- extras - תוספות בתשלום / כרטיס תוספת (סעיף 14)
-- ----------------------------------------------------------------------------
-- נוסחת כמות מוצעת נשמרת כפרמטרים (סעיף 14.4):
--   suggestion_ratio  - יחס (למשל 1 ל-20 מנות => 0.05 ליחידת מנה)
--   suggestion_basis  - הבסיס לחישוב: לכל מנה / לכל מנה לכל סעודה / קבוע להזמנה
create table extras (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,                  -- שם תוספת
  unit_price         numeric(10,2) not null,         -- מחיר ליחידה
  billing_unit       text not null,                  -- יחידת חיוב (בקבוק, יחידה...)
  suggestion_ratio   numeric(12,4),                  -- יחס לנוסחת כמות מוצעת
  suggestion_basis   text,                           -- 'per_portion' | 'per_portion_per_slot' | 'fixed_per_order'
  customer_note      text,                           -- הערה להצגה ללקוח
  display_order      integer not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_extras_updated_at
  before update on extras for each row execute function set_updated_at();

comment on table extras is 'תוספות בתשלום: שתייה, חלות, מיץ ענבים וכו׳ (סעיף 14)';
comment on column extras.suggestion_basis is 'בסיס נוסחת כמות מוצעת: per_portion / per_portion_per_slot / fixed_per_order';

-- ----------------------------------------------------------------------------
-- price_tracks - מסלולי מחיר דינמיים (סעיף 15)
-- ----------------------------------------------------------------------------
-- מחיר למנה לפי מספר סעודות: סעודה אחת, שתי סעודות, ובעתיד שלוש (סעיף 15.4).
create table price_tracks (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,                     -- שם מסלול
  condition_note text,                              -- תנאי מסלול (טקסט תיאורי)
  meals_count    integer,                           -- מספר סעודות שהמסלול חל עליו
  price_per_portion numeric(10,2) not null,         -- מחיר למנה
  effective_from date,                              -- תאריך תחולה
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_price_tracks_updated_at
  before update on price_tracks for each row execute function set_updated_at();

comment on table price_tracks is 'מסלולי מחיר דינמיים לפי מספר סעודות (סעיף 15.2)';

-- ----------------------------------------------------------------------------
-- portion_limits - מגבלת מנות דינמית לפי סעודה (סעיף 35)
-- ----------------------------------------------------------------------------
-- מינימום/מקסימום מנות לסעודה, עם אפשרות חריגה באישור מנהל.
create table portion_limits (
  id            uuid primary key default gen_random_uuid(),
  meal_slot_id  uuid not null references meal_slots(id) on delete cascade,
  min_portions  integer,                            -- מינימום מנות
  max_portions  integer,                            -- מקסימום מנות
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index uq_portion_limits_slot on portion_limits (meal_slot_id) where is_active;

create trigger trg_portion_limits_updated_at
  before update on portion_limits for each row execute function set_updated_at();

comment on table portion_limits is 'מגבלת מנות מינ/מקס לסעודה, חריגה באישור מנהל (סעיף 35)';
