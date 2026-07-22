-- =============================================================================
-- מטבח החסד - מיגרציה 01: משתמשים פנימיים ולקוחות
-- =============================================================================

-- ----------------------------------------------------------------------------
-- app_users - משתמשים פנימיים: מפתחת, מנהל, רכז תפעול (סעיף 5)
-- ----------------------------------------------------------------------------
-- הערה: כאשר יופעל Supabase Auth, id יקושר ל-auth.users.
--       בשלב זה נשמר כטבלה עצמאית עם שדה auth_uid אופציונלי לקישור עתידי.
create table app_users (
  id           uuid primary key default gen_random_uuid(),
  auth_uid     uuid unique,                    -- קישור עתידי ל-auth.users(id)
  full_name    text not null,                  -- שם מלא
  email        text unique,                    -- מייל
  phone        text,                           -- טלפון
  role         user_role not null,             -- תפקיד (מפתחת/מנהל/רכז)
  is_active    boolean not null default true,  -- פעיל / לא פעיל (סעיף 32)
  notes        text,                           -- הערות פנימיות
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_app_users_updated_at
  before update on app_users
  for each row execute function set_updated_at();

comment on table app_users is 'משתמשים פנימיים של המערכת: מפתחת, מנהל, רכז תפעול';

-- ----------------------------------------------------------------------------
-- customers - לקוחות / מזמיני אירועים (סעיף 6)
-- ----------------------------------------------------------------------------
-- זיהוי הלקוח ומניעת כפילויות לפי טלפון מנורמל (סעיף 6.1, 7).
-- phone_normalized: הטלפון לאחר ניקוי רווחים/מקפים, לצורך ייחודיות וכניסה.
create table customers (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,                            -- שם מלא
  phone             text not null,                            -- טלפון (כפי שהוזן)
  phone_normalized  text not null,                            -- טלפון מנורמל (ספרות בלבד)
  email             text,                                     -- מייל (אופציונלי)
  address           text,                                     -- כתובת
  status            customer_status not null default 'pending_approval', -- סטטוס לקוח
  internal_notes    text,                                     -- הערות פנימיות
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- מניעת כפילויות לפי טלפון מנורמל (סעיף 6.1)
create unique index uq_customers_phone_normalized on customers (phone_normalized);

-- כניסת לקוח לפי טלפון = חיפוש מהיר על phone_normalized (סעיף 7)
create index idx_customers_status on customers (status);

create trigger trg_customers_updated_at
  before update on customers
  for each row execute function set_updated_at();

comment on table customers is 'לקוחות / מזמיני אירועים - חברי קהילה';
comment on column customers.phone_normalized is 'טלפון לאחר ניקוי רווחים ומקפים - משמש לכניסה ולמניעת כפילויות';

-- ----------------------------------------------------------------------------
-- customer_registration_requests - בקשות רישום לקוח חדש (סעיף 7)
-- ----------------------------------------------------------------------------
-- כאשר טלפון לא נמצא, נשלחת בקשה לאישור מנהל/רכז לפני יצירת לקוח.
create table customer_registration_requests (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,
  phone             text not null,
  phone_normalized  text not null,
  email             text,
  address           text,
  is_handled        boolean not null default false,  -- טופל / ממתין
  handled_by        uuid references app_users(id),   -- מי טיפל
  handled_at        timestamptz,
  resulting_customer_id uuid references customers(id), -- הלקוח שנוצר, אם אושר
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_registration_requests_unhandled
  on customer_registration_requests (is_handled)
  where is_handled = false;

create trigger trg_registration_requests_updated_at
  before update on customer_registration_requests
  for each row execute function set_updated_at();

comment on table customer_registration_requests is 'בקשות רישום לקוח חדש הממתינות לאישור מנהל/רכז';
