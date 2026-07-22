-- =============================================================================
-- מטבח החסד - מיגרציה 18: יומן מיילים (סעיף 18)
-- =============================================================================
-- מתעד כל מייל שהמערכת ניסתה לשלוח: נמען, נוסח (code), נושא, גוף, וסטטוס.
-- במצב "יבש" (אין SMTP מוגדר) נשמר עם status='dry_run' במקום להישלח - כך אפשר
-- לבדוק את כל הזרימה בלי חשבון מייל אמיתי. כשמוגדר SMTP, status='sent'/'failed'.
-- =============================================================================

create table email_log (
  id            uuid primary key default gen_random_uuid(),
  template_code text,                                   -- מזהה הנוסח (order_summary, order_approved...)
  to_email      text not null,                          -- נמען
  subject       text not null,                          -- נושא (לאחר מילוי placeholders)
  body          text not null,                          -- גוף (לאחר מילוי placeholders)
  status        text not null default 'dry_run'
                  check (status in ('sent', 'dry_run', 'failed')),
  error         text,                                   -- הודעת שגיאה אם status='failed'
  order_id      uuid references orders(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index email_log_order_idx on email_log(order_id);
create index email_log_created_idx on email_log(created_at desc);

comment on table email_log is 'יומן שליחת מיילים - כולל מצב יבש (dry_run) לבדיקה ללא SMTP (סעיף 18).';
