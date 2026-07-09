-- =============================================================================
-- מטבח החסד — מיגרציה 08: הוצאות כלליות, הגדרות מערכת ולוג ביקורת
-- =============================================================================

-- ----------------------------------------------------------------------------
-- general_expenses — הוצאות כלליות (סעיף 28.2)
-- ----------------------------------------------------------------------------
-- הוצאות לפי ספק ותאריך, לא בהכרח משויכות לשבת מסוימת.
create table general_expenses (
  id                uuid primary key default gen_random_uuid(),
  supplier_id       uuid references suppliers(id),     -- ספק (אופציונלי)
  expense_date      date not null,                     -- תאריך
  amount            numeric(12,2) not null,            -- סכום
  payment_method    text,                              -- אמצעי תשלום
  payment_status    supplier_payment_status not null default 'unpaid',
  invoice_number    text,                              -- מספר חשבונית או קבלה
  purchase_order_id uuid references purchase_orders(id), -- קישור להזמנת רכש (אם קיים)
  note              text,
  created_by        uuid references app_users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_general_expenses_supplier on general_expenses (supplier_id);
create index idx_general_expenses_date on general_expenses (expense_date);

create trigger trg_general_expenses_updated_at
  before update on general_expenses for each row execute function set_updated_at();

comment on table general_expenses is 'הוצאות כלליות לפי ספק ותאריך (סעיף 28.2)';

-- ----------------------------------------------------------------------------
-- system_settings — הגדרות מערכת דינמיות (סעיף 3, 17.3)
-- ----------------------------------------------------------------------------
-- מפתח-ערך גמיש להגדרות שהמנהל מנהל בעצמו:
--   מועד אחרון לתשלום (ימים לפני), טווח שבתות ללקוח, נוסחי מיילים ועוד.
create table system_settings (
  key          text primary key,                       -- מזהה ההגדרה
  value        jsonb not null,                          -- הערך (גמיש)
  description  text,                                    -- תיאור בעברית להצגה במסך הגדרות
  updated_by   uuid references app_users(id),
  updated_at   timestamptz not null default now()
);

create trigger trg_system_settings_updated_at
  before update on system_settings for each row execute function set_updated_at();

comment on table system_settings is 'הגדרות מערכת דינמיות במבנה מפתח-ערך (סעיף 3)';

-- ----------------------------------------------------------------------------
-- email_templates — נוסחי מיילים דינמיים (סעיף 3, 18)
-- ----------------------------------------------------------------------------
-- נוסחי מייל שהמנהל יכול לערוך. body תומך בתבנית עם placeholders.
create table email_templates (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,                   -- מזהה לוגי (order_summary, order_approved...)
  subject      text not null,                          -- נושא המייל
  body         text not null,                          -- גוף המייל (תבנית)
  is_active    boolean not null default true,
  updated_by   uuid references app_users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_email_templates_updated_at
  before update on email_templates for each row execute function set_updated_at();

comment on table email_templates is 'נוסחי מיילים דינמיים לעריכה ע"י המנהל (סעיף 18)';

-- ----------------------------------------------------------------------------
-- audit_log — לוג ביקורת כללי (רוחבי)
-- ----------------------------------------------------------------------------
-- תיעוד רוחבי של פעולות רגישות במערכת (מעבר להיסטוריית ההזמנה הספציפית).
create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,                          -- סוג הישות (order, customer, inventory_item...)
  entity_id    uuid,                                   -- מזהה הרשומה
  action       text not null,                          -- create / update / delete / status_change...
  actor_id     uuid references app_users(id),          -- מי ביצע
  details      jsonb,                                  -- פירוט
  created_at   timestamptz not null default now()
);

create index idx_audit_log_entity on audit_log (entity_type, entity_id);
create index idx_audit_log_actor on audit_log (actor_id);
create index idx_audit_log_created on audit_log (created_at);

comment on table audit_log is 'לוג ביקורת רוחבי לפעולות רגישות במערכת';
