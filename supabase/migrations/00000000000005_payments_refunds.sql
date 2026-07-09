-- =============================================================================
-- מטבח החסד — מיגרציה 05: גבייה מלקוחות והחזרים
-- =============================================================================

-- ----------------------------------------------------------------------------
-- customer_payments — תיעוד תשלומי לקוחות (סעיף 17.2)
-- ----------------------------------------------------------------------------
-- הלקוח אינו מעדכן תשלום בעצמו; מנהל/רכז מתעדים ידנית (סעיף 17.1).
-- כל תשלום הוא רשומה נפרדת — מאפשר תשלום חלקי / מספר תשלומים להזמנה.
create table customer_payments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id),
  amount         numeric(10,2) not null,             -- סכום ששולם
  payment_method payment_method not null,            -- אמצעי תשלום
  paid_at        date not null,                      -- תאריך תשלום
  internal_note  text,                               -- הערה פנימית
  recorded_by    uuid references app_users(id),      -- מי עדכן
  created_at     timestamptz not null default now(),
  constraint chk_customer_payments_amount check (amount > 0)
);

create index idx_customer_payments_order on customer_payments (order_id);

comment on table customer_payments is 'תיעוד תשלומי לקוחות — נרשמים ידנית ע"י מנהל/רכז (סעיף 17.2)';

-- ----------------------------------------------------------------------------
-- order_refunds — החזרים כספיים ללקוח (סעיף 19)
-- ----------------------------------------------------------------------------
-- החזר אפשרי גם ללא ביטול (הפחתת מנות, הסרת תוספת, טעות גבייה — סעיף 19.1).
-- ניהול פנימי בלבד — לא מוצג ללקוח (סעיף 19.3).
create table order_refunds (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references orders(id),
  status                refund_status not null default 'pending',
  reason                text,                          -- סיבת החזר
  amount_paid           numeric(10,2),                 -- סכום ששולם
  final_amount_after_change numeric(10,2),             -- סכום סופי לאחר שינוי
  amount_to_refund      numeric(10,2),                 -- סכום להחזר
  amount_refunded       numeric(10,2),                 -- סכום שהוחזר בפועל
  refund_method         payment_method,                -- אמצעי החזר
  refunded_at           date,                          -- תאריך החזר
  approved_by           uuid references app_users(id), -- מי אישר
  executed_by           uuid references app_users(id), -- מי ביצע
  internal_note         text,                          -- הערה פנימית
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_order_refunds_order on order_refunds (order_id);
create index idx_order_refunds_status on order_refunds (status);

create trigger trg_order_refunds_updated_at
  before update on order_refunds for each row execute function set_updated_at();

comment on table order_refunds is 'החזרים כספיים ללקוח — ניהול פנימי בלבד (סעיף 19)';
