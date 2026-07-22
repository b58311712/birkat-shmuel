-- =============================================================================
-- מטבח החסד - מיגרציה 04: הזמנות ופריטי הזמנה
-- =============================================================================
-- הזמנה היא לב המערכת (סעיף 10). כוללת:
--   - שדות ראש הזמנה + סכומים
--   - סעודות שנבחרו (עם מספר מנות לכל סעודה - שונה לכל סעודה, סעיף 12.2)
--   - מאכלים שנבחרו (לכל סעודה בנפרד, סעיף 13.3)
--   - תוספות בתשלום (כמות בפועל * מחיר יחידה, סעיף 14.4)
--   - הנחות וחיובים ידניים (סעיף 16)
--   - הערות פנימיות לפי סוג (סעיף 20.2)
--   - איש קשר לקבלה / שינוע (סעיף 23.2)
-- =============================================================================

-- ----------------------------------------------------------------------------
-- מספור הזמנות שנתי רץ (סעיף 10.3): 20260001, 20260002 ...
-- טבלת מונים לפי שנה, עם פונקציה אטומית להקצאת המספר הבא.
-- ----------------------------------------------------------------------------
create table order_number_counters (
  year        integer primary key,   -- שנה לועזית (2026)
  last_number integer not null default 0
);

-- מקצה את מספר ההזמנה הבא לשנה נתונה, בצורה בטוחה מפני מרוצי-תנאי (row lock).
-- מחזיר מספר בפורמט YYYYNNNN כ-bigint (למשל 20260001).
create or replace function allocate_order_number(p_year integer)
returns bigint
language plpgsql
as $$
declare
  v_next integer;
begin
  insert into order_number_counters (year, last_number)
    values (p_year, 1)
  on conflict (year) do update
    set last_number = order_number_counters.last_number + 1
  returning last_number into v_next;

  -- YYYY (4 ספרות) + NNNN (4 ספרות, מרופד באפסים)
  return (p_year::bigint * 10000) + v_next;
end;
$$;

comment on function allocate_order_number is 'מקצה מספר הזמנה שנתי רץ בפורמט YYYYNNNN (סעיף 10.3)';

-- ----------------------------------------------------------------------------
-- orders - ראש הזמנה (סעיף 10.2)
-- ----------------------------------------------------------------------------
create table orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      bigint not null unique,           -- מספר הזמנה YYYYNNNN
  customer_id       uuid not null references customers(id),
  shabbat_id        uuid not null references shabbatot(id),

  -- סטטוסים (סעיף 11)
  order_status      order_status   not null default 'pending_approval',
  payment_status    payment_status not null default 'unpaid',
  refund_status     refund_status  not null default 'not_required',

  -- אספקה ואיש קשר לקבלה (סעיף 23.2)
  delivery_method   delivery_method not null default 'volunteer_transport',
  contact_name      text,                             -- שם איש קשר לקבלה (אופציונלי)
  contact_phone     text,
  venue_address     text,                             -- כתובת האולם
  transport_notes   text,                             -- הערות שינוע
  transport_volunteer_id uuid,                        -- FK יתווסף במיגרציה 07 (מתנדב שינוע)

  -- אמצעי תשלום מועדף שנבחר (סעיף 17.1)
  preferred_payment_method payment_method,

  -- סכומים - נשמרים "קפואים" בזמן יצירה/אישור (סעיף 15.3)
  base_amount       numeric(10,2) not null default 0, -- מחיר בסיס (מנות * מסלול)
  extras_amount     numeric(10,2) not null default 0, -- סך תוספות
  manual_charges_amount numeric(10,2) not null default 0, -- סך חיובים ידניים
  discount_amount   numeric(10,2) not null default 0, -- סך הנחות
  final_amount      numeric(10,2) not null default 0, -- סכום סופי לתשלום

  approved_by       uuid references app_users(id),    -- מי אישר
  approved_at       timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_orders_customer on orders (customer_id);
create index idx_orders_shabbat on orders (shabbat_id);
create index idx_orders_order_status on orders (order_status);
create index idx_orders_payment_status on orders (payment_status);

create trigger trg_orders_updated_at
  before update on orders for each row execute function set_updated_at();

comment on table orders is 'ראש הזמנה - לב המערכת (סעיף 10)';
comment on column orders.base_amount is 'מחירים נשמרים קפואים בהזמנה; שינוי מחירון עתידי לא משפיע (סעיף 15.3)';

-- ----------------------------------------------------------------------------
-- order_meal_slots - סעודות שנבחרו בהזמנה + מספר מנות לכל סעודה (סעיף 12.2)
-- ----------------------------------------------------------------------------
-- מספר המנות שונה לכל סעודה. price_track_id + price_per_portion קפואים.
create table order_meal_slots (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  meal_slot_id      uuid not null references meal_slots(id),
  portions          integer not null,                 -- מספר מנות לסעודה זו
  price_track_id    uuid references price_tracks(id),  -- מסלול מחיר שחל (קפוא)
  price_per_portion numeric(10,2) not null default 0, -- מחיר למנה בזמן ההזמנה (קפוא)
  created_at        timestamptz not null default now(),
  constraint chk_order_meal_slots_portions check (portions > 0),
  unique (order_id, meal_slot_id)                       -- סעודה פעם אחת בהזמנה
);

create index idx_order_meal_slots_order on order_meal_slots (order_id);

comment on table order_meal_slots is 'סעודות שנבחרו והמנות לכל סעודה (מספר מנות שונה לכל סעודה)';

-- ----------------------------------------------------------------------------
-- order_meals - מאכלים שנבחרו, לכל סעודה בנפרד (סעיף 13.3, 22.2)
-- ----------------------------------------------------------------------------
-- אותו מאכל יכול להיבחר בכמה סעודות. לא מאחדים אריזה בין סעודות (סעיף 22.2).
-- שם המאכל וקטגוריה נשמרים snapshot כדי שהזמנות עבר לא ישתנו אם המאכל שונה.
create table order_meals (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id) on delete cascade,
  meal_slot_id       uuid not null references meal_slots(id),
  meal_id            uuid not null references meals(id),
  meal_name_snapshot text not null,                   -- שם מאכל בזמן ההזמנה
  extra_charge_amount numeric(10,2) not null default 0, -- תוספת מחיר אם המאכל דורש (קפוא)
  created_at         timestamptz not null default now(),
  unique (order_id, meal_slot_id, meal_id)             -- מאכל פעם אחת בכל סעודה
);

create index idx_order_meals_order on order_meals (order_id);
create index idx_order_meals_meal on order_meals (meal_id);

comment on table order_meals is 'מאכלים שנבחרו לכל סעודה בנפרד (סעיף 13.3)';

-- ----------------------------------------------------------------------------
-- order_extras - תוספות בתשלום שנבחרו בהזמנה (סעיף 14.4)
-- ----------------------------------------------------------------------------
-- המחיר לפי הכמות בפועל שהוזנה: quantity * unit_price (קפוא).
create table order_extras (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  extra_id            uuid not null references extras(id),
  extra_name_snapshot text not null,                  -- שם תוספת בזמן ההזמנה
  suggested_quantity  numeric(12,4),                  -- כמות מוצעת שחושבה
  actual_quantity     numeric(12,4) not null,         -- כמות בפועל (לאחר עיגול/עריכה)
  unit_price          numeric(10,2) not null,         -- מחיר יחידה קפוא
  line_total          numeric(10,2) not null,         -- actual_quantity * unit_price
  created_at          timestamptz not null default now(),
  constraint chk_order_extras_qty check (actual_quantity > 0)
);

create index idx_order_extras_order on order_extras (order_id);

comment on table order_extras is 'תוספות בתשלום בהזמנה - מחיר לפי כמות בפועל (סעיף 14.4)';
comment on column order_extras.actual_quantity is 'כמות בפועל לאחר עיגול כלפי מעלה ועריכת הלקוח (סעיף 14.5)';

-- ----------------------------------------------------------------------------
-- order_discounts - הנחות ידניות (סעיף 16.1)
-- ----------------------------------------------------------------------------
create table order_discounts (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  discount_type     discount_type not null,           -- סכום קבוע / אחוזים
  value             numeric(10,2) not null,           -- הערך שהוזן (סכום או אחוז)
  amount_before     numeric(10,2) not null,           -- סכום לפני הנחה
  discount_amount   numeric(10,2) not null,           -- סכום ההנחה בפועל
  amount_after      numeric(10,2) not null,           -- סכום לאחר הנחה
  internal_reason   text,                             -- סיבה פנימית
  created_by        uuid references app_users(id),    -- מי נתן את ההנחה
  created_at        timestamptz not null default now()
);

create index idx_order_discounts_order on order_discounts (order_id);

comment on table order_discounts is 'הנחות ידניות עם תיעוד מלא של מי/מתי/סכומים (סעיף 16.1)';

-- ----------------------------------------------------------------------------
-- order_manual_charges - חיובים ידניים נוספים (סעיף 16.2)
-- ----------------------------------------------------------------------------
create table order_manual_charges (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  name         text not null,                          -- שם החיוב
  amount       numeric(10,2) not null,                 -- סכום
  reason       text,                                   -- סיבה / הערה
  created_by   uuid references app_users(id),          -- מי הוסיף
  created_at   timestamptz not null default now()
);

create index idx_order_manual_charges_order on order_manual_charges (order_id);

comment on table order_manual_charges is 'חיובים ידניים נוספים המוצגים ללקוח (סעיף 16.2)';

-- ----------------------------------------------------------------------------
-- order_internal_notes - הערות פנימיות לפי סוג (סעיף 20.2, 20.3)
-- ----------------------------------------------------------------------------
-- ההערה מופיעה בתיק השבת לפי סוגה (מטבח/אריזה/שינוע/כספית/כללית).
create table order_internal_notes (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  note_type    internal_note_type not null,            -- סוג ההערה
  content      text not null,
  created_by   uuid references app_users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_order_internal_notes_order on order_internal_notes (order_id);
create index idx_order_internal_notes_type on order_internal_notes (note_type);

create trigger trg_order_internal_notes_updated_at
  before update on order_internal_notes for each row execute function set_updated_at();

comment on table order_internal_notes is 'הערות פנימיות לפי הקשר (מטבח/אריזה/שינוע/כספי/כללי) (סעיף 20.2)';

-- ----------------------------------------------------------------------------
-- order_history - היסטוריית שינויים בהזמנה (סעיף 10.2, 10.4)
-- ----------------------------------------------------------------------------
-- מתעד כל שינוי מהותי: מי, מתי, מה השתנה. פורמט גמיש ב-jsonb.
create table order_history (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  action       text not null,                          -- תיאור הפעולה (נוצר/אושר/עודכן...)
  changed_by   uuid references app_users(id),          -- מי ביצע (null = הלקוח)
  changes      jsonb,                                  -- פירוט השינויים
  created_at   timestamptz not null default now()
);

create index idx_order_history_order on order_history (order_id);

comment on table order_history is 'היסטוריית שינויים בהזמנה עם תיעוד מי/מתי/מה (סעיף 10.4)';
