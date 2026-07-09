-- =============================================================================
-- מטבח החסד — מיגרציה 07: מתנדבים, משימות ושיבוצים
-- =============================================================================

-- ----------------------------------------------------------------------------
-- volunteers — טבלת מתנדבים (סעיף 24.1)
-- ----------------------------------------------------------------------------
create table volunteers (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,                    -- שם מלא
  phone             text,                             -- טלפון
  email             text,                             -- מייל (אופציונלי)
  area              volunteer_area not null,          -- תחום התנדבות
  linked_meal_id    uuid references meals(id),        -- קישור למאכל להתנדבות (בישול)
  has_vehicle       boolean not null default false,   -- האם יש רכב לשינוע
  is_regular        boolean not null default false,   -- מתנדב קבוע
  is_active         boolean not null default true,    -- פעיל / לא פעיל
  notes             text,                             -- הערות פנימיות
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_volunteers_area on volunteers (area);
create index idx_volunteers_linked_meal on volunteers (linked_meal_id);

create trigger trg_volunteers_updated_at
  before update on volunteers for each row execute function set_updated_at();

comment on table volunteers is 'מתנדבים לפי תחום התנדבות (סעיף 24.1)';
comment on column volunteers.linked_meal_id is 'קישור למאכל לצורך שיבוץ בישול אוטומטי (סעיף 24.2)';

-- השלמת FK מהזמנות: מתנדב שינוע (הושאר פתוח במיגרציה 04)
alter table orders
  add constraint fk_orders_transport_volunteer
  foreign key (transport_volunteer_id) references volunteers(id);

-- ----------------------------------------------------------------------------
-- volunteer_tasks — משימות קבועות (סעיף 24.3)
-- ----------------------------------------------------------------------------
-- המשימות קבועות ואינן נוצרות מחדש בכל שבת. בכל שבת משבצים אליהן מתנדבים.
create table volunteer_tasks (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                        -- שם משימה (הכנת סלטים...)
  area          volunteer_area not null,              -- תחום המשימה
  linked_meal_id uuid references meals(id),           -- מאכל קשור (לשיבוץ בישול)
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_volunteer_tasks_updated_at
  before update on volunteer_tasks for each row execute function set_updated_at();

comment on table volunteer_tasks is 'משימות קבועות — לא נוצרות מחדש בכל שבת (סעיף 24.3)';

-- ----------------------------------------------------------------------------
-- volunteer_assignments — שיבוצי מתנדבים למשימות בשבת מסוימת (סעיף 24.2)
-- ----------------------------------------------------------------------------
-- שיבוץ בישול = אוטומטי לפי קישור למאכל. שיבוץ שינוע = ידני.
-- שיבוץ שינוע ספציפי להזמנה נשמר גם ב-orders.transport_volunteer_id.
create table volunteer_assignments (
  id            uuid primary key default gen_random_uuid(),
  shabbat_id    uuid not null references shabbatot(id) on delete cascade,
  task_id       uuid references volunteer_tasks(id),  -- המשימה (אם רלוונטי)
  volunteer_id  uuid references volunteers(id),       -- המתנדב המשובץ (null = ללא שיבוץ)
  is_auto       boolean not null default false,       -- שובץ אוטומטית (בישול)
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_volunteer_assignments_shabbat on volunteer_assignments (shabbat_id);
create index idx_volunteer_assignments_volunteer on volunteer_assignments (volunteer_id);
create index idx_volunteer_assignments_task on volunteer_assignments (task_id);

create trigger trg_volunteer_assignments_updated_at
  before update on volunteer_assignments for each row execute function set_updated_at();

comment on table volunteer_assignments is 'שיבוצי מתנדבים למשימות בשבת מסוימת (סעיף 24.2)';
