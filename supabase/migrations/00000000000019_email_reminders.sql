-- =============================================================================
-- מטבח החסד - מיגרציה 19: תזכורות תשלום (סעיף 18.4)
-- =============================================================================
-- 1) מרחיב את סוגי ההתראות המותרים כדי לאפשר התראת "תזכורת תשלום" פנימית
--    (נוצרת ללקוח שאין לו מייל - סעיף 18.4).
-- 2) מוסיף נוסח מייל "תזכורת תשלום" הניתן לעריכה ע"י המנהל.
-- =============================================================================

-- --- הרחבת אילוץ notification_type ---
-- מאתרים דינמית את שם אילוץ ה-CHECK שמכסה את notification_type ומורידים אותו,
-- כדי לא להיות תלויים בשם ברירת מחדל שעלול להשתנות בין סביבות.
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'admin_notifications'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%notification_type%';

  if con_name is not null then
    execute format('alter table admin_notifications drop constraint %I', con_name);
  end if;
end $$;

alter table admin_notifications
  add constraint admin_notifications_notification_type_check
  check (notification_type in ('new_order', 'new_registration', 'payment_reminder'));

-- --- נוסח מייל תזכורת תשלום ---
-- הערה: גוף הטקסט עטוף ב-dollar-quoting ($body$...$body$) ולא במרכאות בודדות,
-- כדי שאף תו בתוך הטקסט (מרכאות, גרש, RTL) לא יוכל לשבור את המחרוזת.
insert into email_templates (code, subject, body, is_active)
values (
  'payment_reminder',
  $subj$תזכורת תשלום - מטבח החסד$subj$,
  $body$שלום {customer_name},

זוהי תזכורת לתשלום עבור הזמנתך מספר {order_number} לשבת פרשת {parasha}.
סכום לתשלום: {final_amount} ש"ח
אמצעי תשלום שנבחר: {payment_method}
מועד אחרון לתשלום: {payment_deadline}

תודה,
מטבח החסד$body$,
  true
)
on conflict (code) do nothing;
