-- =============================================================================
-- מטבח החסד - מיגרציה 22: קופה קטנה (Petty Cash)
-- =============================================================================
-- קופה קטנה גלובלית אחת: ספר תנועות (ledger) עם יתרה רצה.
--   deposit  - הפקדה / מימון הקופה (תרומה, משיכה מהחשבון, החזר).
--   expense  - הוצאה במזומן מהקופה (קניות קטנות, החזר הוצאה למתנדב וכו').
-- יתרה = Σ deposits − Σ expenses. אין ספירת מזומן/התאמה פורמלית - יתרה רצה בלבד.
-- הוצאות הקופה הקטנה נספרות בסך ההוצאות במודול הכספי (סעיף 29).
-- =============================================================================

create type petty_cash_kind as enum (
  'deposit',   -- הפקדה / מימון הקופה (מוסיף ליתרה)
  'expense'    -- הוצאה מהקופה (מוריד מהיתרה)
);

create table petty_cash_transactions (
  id            uuid primary key default gen_random_uuid(),
  kind          petty_cash_kind not null,               -- הפקדה או הוצאה
  amount        numeric(12,2) not null check (amount > 0), -- סכום חיובי תמיד; הכיוון נקבע לפי kind
  tx_date       date not null default current_date,      -- תאריך התנועה
  category      text,                                    -- קטגוריית הוצאה/הפקדה חופשית (למשל "ירקות", "תרומה")
  description   text,                                    -- תיאור חופשי
  supplier_id   uuid references suppliers(id) on delete set null, -- ספק (אופציונלי, להוצאות)
  receipt_number text,                                   -- מספר קבלה/חשבונית (אם קיים)
  created_by    uuid references app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index petty_cash_date_idx on petty_cash_transactions (tx_date desc);
create index petty_cash_kind_idx on petty_cash_transactions (kind);
create index petty_cash_supplier_idx on petty_cash_transactions (supplier_id);

create trigger trg_petty_cash_updated_at
  before update on petty_cash_transactions for each row execute function set_updated_at();

comment on table petty_cash_transactions is 'קופה קטנה גלובלית - ספר תנועות (הפקדות/הוצאות) עם יתרה רצה. הוצאות נספרות בסך ההוצאות הכספיות.';
