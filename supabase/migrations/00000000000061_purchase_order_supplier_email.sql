-- =============================================================================
-- מטבח החסד - מיגרציה 61: שליחת הזמנת רכש לספק במייל (סעיף 27.2-27.3)
-- =============================================================================
-- עד כה "נשלחה לספק" היה סימון ידני בלבד: המנהלת שינתה סטטוס, והמייל/הטלפון
-- לספק נעשו מחוץ למערכת ולא הותירו שום עקבות. כאן נוסף תהליך שליחה אמיתי:
--   - נוסח purchase_order_supplier ב-email_templates הקיים (נערך ב-/admin/email
--     כמו כל נוסח אחר), עם placeholder {po_lines} לפירוט הפריטים.
--   - email_log.purchase_order_id - יומן השליחה מקשר גם להזמנת רכש, לא רק
--     להזמנת לקוח, וכך נשמרת היסטוריית שליחות מלאה לכל הזמנה (מי, מתי, לאיזו
--     כתובת, הצליח/נכשל) ואפשר לשלוח שוב.
--   - שדות סיכום על purchase_orders - המצב האחרון, לתצוגה מהירה ברשימה ובכרטיס
--     בלי שאילתת יומן לכל שורה.
-- שליחה ידנית (טלפון/וואטסאפ) נשמרת: סטטוס 'sent' עדיין ניתן לקביעה ישירה,
-- ואז שדות המייל נשארים ריקים.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- סיכום שליחת המייל האחרונה על הזמנת הרכש
-- ----------------------------------------------------------------------------
alter table purchase_orders
  add column email_sent_at    timestamptz,
  add column email_sent_to    text,
  add column email_status     text check (email_status in ('sent', 'dry_run', 'failed')),
  add column email_send_count integer not null default 0;

comment on column purchase_orders.email_sent_at is
  'מועד ניסיון השליחה האחרון של ההזמנה לספק במייל. NULL = לא נשלח מייל '
  '(ייתכן שההזמנה נמסרה בטלפון/וואטסאפ וסומנה ידנית כנשלחה).';
comment on column purchase_orders.email_sent_to is
  'כתובת הנמען בניסיון השליחה האחרון (כולל עותק, מופרד בפסיק).';
comment on column purchase_orders.email_status is
  'תוצאת ניסיון השליחה האחרון: sent / dry_run (אין SMTP מוגדר) / failed.';
comment on column purchase_orders.email_send_count is
  'מספר ניסיונות השליחה שבוצעו (כולל שליחות חוזרות).';

create index idx_purchase_orders_email_status on purchase_orders (email_status)
  where email_status is not null;

-- ----------------------------------------------------------------------------
-- קישור יומן המיילים להזמנת רכש
-- ----------------------------------------------------------------------------
alter table email_log
  add column purchase_order_id uuid references purchase_orders(id) on delete set null,
  add column cc_email text;

create index email_log_purchase_order_idx on email_log(purchase_order_id);

comment on column email_log.purchase_order_id is
  'הזמנת הרכש שאליה שייך המייל (שליחת הזמנה לספק). NULL בכל שאר סוגי המיילים.';
comment on column email_log.cc_email is
  'נמעני עותק (CC), מופרדים בפסיק. NULL כשלא נשלח עותק.';

-- ----------------------------------------------------------------------------
-- נוסח המייל לספק
-- ----------------------------------------------------------------------------
-- {po_lines} מוחלף בפירוט הפריטים (שם, כמות, מארזים) שנבנה בשרת;
-- {po_notes} כבר כולל את הקידומת "הערות:" או ריק - כדי שלא תישאר שורה מיותמת.
-- התוכן כאן הוא ברירת מחדל בלבד, מיועד לעריכה ע"י המנהלת ב-/admin/email.
insert into email_templates (code, subject, body, is_active)
values (
  'purchase_order_supplier',
  'הזמנת רכש {po_number} - מטבח החסד',
  $body$לכבוד {supplier_name},

להלן הזמנת רכש מספר {po_number} ממטבח החסד - ברכת שמואל.

הפריטים המבוקשים:
{po_lines}

תאריך אספקה מבוקש: {expected_delivery_date}
{po_notes}
נודה לאישור קבלת ההזמנה, ולעדכון מראש על כל פריט שאינו זמין.

בברכה,
מטבח החסד - ברכת שמואל$body$,
  true
)
on conflict (code) do nothing;
