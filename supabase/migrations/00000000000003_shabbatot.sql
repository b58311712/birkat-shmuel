-- =============================================================================
-- מטבח החסד - מיגרציה 03: שבתות ותיקי שבת
-- =============================================================================

-- ----------------------------------------------------------------------------
-- shabbatot - שבתות (סעיף 8)
-- ----------------------------------------------------------------------------
-- רשימת השבתות נוצרת אוטומטית לפי לוח שנה עברי (סעיף 8.2).
-- לכל שבת: פרשה, תאריך עברי, תאריך לועזי (לנוחות), וסטטוס (סעיף 8.4).
create table shabbatot (
  id                 uuid primary key default gen_random_uuid(),
  parasha            text not null,                   -- פרשת השבוע
  hebrew_date        text not null,                   -- תאריך עברי (טקסט)
  gregorian_date     date not null,                   -- תאריך לועזי (יום שבת)
  status             shabbat_status not null default 'open', -- סטטוס שבת
  payment_deadline   date,                            -- מועד אחרון לתשלום (סעיף 17.3)
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- שבת ייחודית לפי תאריך לועזי (מונע כפילויות בלוח)
create unique index uq_shabbatot_gregorian_date on shabbatot (gregorian_date);
create index idx_shabbatot_status on shabbatot (status);
create index idx_shabbatot_date on shabbatot (gregorian_date);

create trigger trg_shabbatot_updated_at
  before update on shabbatot for each row execute function set_updated_at();

comment on table shabbatot is 'שבתות לפי לוח עברי - פרשה, תאריך עברי/לועזי, סטטוס';
comment on column shabbatot.payment_deadline is 'מועד אחרון לתשלום - כברירת מחדל שבוע לפני, ניתן לשינוי (סעיף 17.3)';

-- ----------------------------------------------------------------------------
-- shabbat_files - תיקי שבת (סעיף 8.5, 8.6, 9)
-- ----------------------------------------------------------------------------
-- תיק שבת נפתח אוטומטית עם ההזמנה הראשונה לאותה שבת (סעיף 8.5).
-- יחס 1:1 לשבת. מרכז את כל פעילות העבודה: הזמנות, כמויות, מלאי, אריזה, שינוע.
create table shabbat_files (
  id            uuid primary key default gen_random_uuid(),
  shabbat_id    uuid not null unique references shabbatot(id), -- 1:1 עם שבת
  -- שדות סיכום מחושבים (יכולים להישמר לקאש, או להיגזר בזמן אמת):
  is_inventory_deducted boolean not null default false, -- האם המלאי כבר הופחת (סעיף 25.4)
  inventory_deducted_by uuid references app_users(id),
  inventory_deducted_at timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_shabbat_files_updated_at
  before update on shabbat_files for each row execute function set_updated_at();

comment on table shabbat_files is 'תיק שבת - מרכז העבודה לשבת, נפתח עם ההזמנה הראשונה (סעיף 8.5)';
comment on column shabbat_files.is_inventory_deducted is 'המלאי אינו מופחת אוטומטית - רק לאחר אישור ידני (סעיף 25.4)';
