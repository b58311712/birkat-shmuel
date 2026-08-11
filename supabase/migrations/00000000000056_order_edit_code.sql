-- =============================================================================
-- מטבח החסד - מיגרציה 56: קוד עריכת הזמנה ללקוח + פירוט הזמנה מלא במייל
-- =============================================================================
-- עד כה ללקוח לא הייתה שום דרך לערוך הזמנה קיימת - עריכה מלאה (סעודות, מאכלים,
-- תוספות, פרטי משלוח) הייתה שמורה למסך הניהול בלבד.
--
-- כל הזמנה חדשה מקבלת קוד בן 6 ספרות (נשלח במייל, נשמר כ-hash בלבד - כמו סיסמה,
-- לא כמו הטוקנים הארוכים של order_feedback). הלקוח מזין אותו במסך ההזמנה הקיימת
-- כדי לפתוח מצב עריכה. חתך הזמן (שבועיים לפני מועד השבת/האירוע) נגזר דינמית
-- מ-shabbatot.gregorian_date ולא נשמר כתאריך תפוגה קבוע, כדי שלא "יקפא" אם המועד
-- ישתנה. edit_code_attempts/edit_code_locked_until מגנים מפני ניחוש-בכוח על קוד
-- קצר יחסית (בניגוד לטוקן ארוך אקראי, שאין בו צורך בהגנת נעילה).
-- =============================================================================

alter table orders
  add column edit_code_hash text,
  add column edit_code_attempts integer not null default 0,
  add column edit_code_locked_until timestamptz;

comment on column orders.edit_code_hash is
  'גיבוב bcrypt של קוד עריכה בן 6 ספרות שנשלח ללקוח ביצירת ההזמנה. NULL = הזמנה '
  'ישנה מלפני הפיצ׳ר, ללא עריכה עצמאית זמינה.';
comment on column orders.edit_code_attempts is
  'מונה ניסיונות קוד שגויים רצופים; מתאפס באימות מוצלח.';
comment on column orders.edit_code_locked_until is
  'נעילה זמנית של אימות הקוד לאחר יותר מדי ניסיונות שגויים.';

-- ----------------------------------------------------------------------------
-- הרחבת סוגי התראות המנהל - עריכת הזמנה ע"י לקוח (בדגם מיגרציה 049)
-- ----------------------------------------------------------------------------
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
  check (notification_type in (
    'new_order', 'new_registration', 'payment_reminder', 'new_feedback',
    'low_feedback', 'order_edited'
  ));

-- ----------------------------------------------------------------------------
-- נוסחי מייל חדשים
-- ----------------------------------------------------------------------------
insert into email_templates (code, subject, body, is_active)
values (
  'order_edit_code',
  'קוד לעריכת ההזמנה שלך - מטבח החסד',
  $body$שלום {customer_name},

הזמנתך מספר {order_number} לשבת פרשת {parasha} התקבלה במערכת.

ניתן לערוך את ההזמנה (סעודות, מאכלים, תוספות ופרטי משלוח) דרך "ההזמנות שלי" באתר, עד {edit_deadline} (שבועיים לפני מועד השבת). קוד העריכה שלך:

{edit_code}

לאחר מועד זה לא ניתן יותר לערוך את ההזמנה עצמאית - יש לפנות למשרד.

תודה,
מטבח החסד$body$,
  true
)
on conflict (code) do nothing;

insert into email_templates (code, subject, body, is_active)
values (
  'order_updated',
  'ההזמנה שלך עודכנה - מטבח החסד',
  $body$שלום {customer_name},

הזמנתך מספר {order_number} לשבת פרשת {parasha} עודכנה. פירוט ההזמנה המלא לאחר העדכון:

{order_details}

תודה,
מטבח החסד$body$,
  true
)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- הרחבת נוסח "סיכום הזמנה" הקיים לפירוט מלא
-- ----------------------------------------------------------------------------
-- הנוסח הקיים (מ-seed.sql) הוא סיכום שורה-שורה בלבד (מספר הזמנה, פרשה, סטטוס,
-- סכום, אמצעי תשלום). מעדכנים אותו לכלול את {order_details} המלא - placeholder
-- חדש שהשרת ממלא עם פירוט סעודות/מאכלים/תוספות/פרטי משלוח/פירוט מחיר.
-- שים לב: זהו update, לא insert...on conflict do nothing - אם המנהל כבר התאים
-- אישית את הנוסח הזה דרך /admin/email, השינוי הידני יידרס.
update email_templates
set body = $body$שלום {customer_name},

התקבלה הזמנתך מספר {order_number} לשבת פרשת {parasha}.
סטטוס: ממתין לאישור.

{order_details}

תודה,
מטבח החסד$body$
where code = 'order_summary';
