-- =============================================================================
-- מטבח החסד - מיגרציה 21: הוצאות קבועות חודשיות (Recurring Expenses)
-- =============================================================================
-- תבניות של הוצאות תקורה חוזרות (שכירות, חשמל, מים, ארנונה, ביטוח, משכורות...).
-- מגדירים תבנית פעם אחת; מנגנון ההפקה יוצר רשומת general_expenses אמיתית לכל חודש.
--   • הרשומות המופקות נכנסות לסיכום הכספי (routes/finance.js) כמו כל הוצאה כללית.
--   • ההפקה idempotent - לא ניתן להפיק פעמיים לאותו חודש (unique על תבנית+חודש).
-- =============================================================================

create table recurring_expenses (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,                              -- שם ההוצאה (למשל "שכירות", "חשמל")
  amount         numeric(12,2) not null check (amount > 0),  -- סכום חודשי משוער/קבוע
  day_of_month   integer not null default 1
                   check (day_of_month between 1 and 28),    -- יום בחודש לתאריך ההוצאה (עד 28 לכל חודש)
  category       text,                                       -- קטגוריית תקורה חופשית ("שכירות", "שכר"...)
  supplier_id    uuid references suppliers(id) on delete set null, -- ספק/נותן שירות (אופציונלי)
  payment_method text,                                       -- אמצעי תשלום ברירת מחדל (הו"ק, העברה...)
  note           text,                                       -- הערה חופשית
  is_active      boolean not null default true,              -- מחיקה רכה / השהיה (לא מפיקים כשלא פעיל)
  created_by     uuid references app_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index recurring_expenses_active_idx on recurring_expenses (is_active);

create trigger trg_recurring_expenses_updated_at
  before update on recurring_expenses for each row execute function set_updated_at();

comment on table recurring_expenses is 'תבניות הוצאה קבועה חודשית - מופקות אוטומטית ל-general_expenses לכל חודש (סעיף 29).';

-- ----------------------------------------------------------------------------
-- קישור בין הרשומה המופקת לתבנית שמקורה בה - מונע הפקה כפולה לאותו חודש.
-- ----------------------------------------------------------------------------
alter table general_expenses
  add column recurring_expense_id uuid references recurring_expenses(id) on delete set null,
  add column period_month text;   -- מפתח החודש שהופק YYYY-MM (למופקות בלבד; ידניות = null)

-- אינדקס ייחודי חלקי: תבנית אחת יכולה להפיק רשומה אחת בלבד לכל חודש.
create unique index general_expenses_recurring_period_uidx
  on general_expenses (recurring_expense_id, period_month)
  where recurring_expense_id is not null;

comment on column general_expenses.recurring_expense_id is 'התבנית הקבועה שממנה הופקה הרשומה (null = הוצאה ידנית).';
comment on column general_expenses.period_month is 'חודש ההפקה YYYY-MM (למופקות מתבנית קבועה בלבד).';
