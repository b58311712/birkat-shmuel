-- =============================================================================
-- מטבח החסד - מיגרציה 62: ביטול "אישור חריגת תשלום" (כלל 8.7 מעודכן)
-- =============================================================================
-- עד כה הזמנה מאושרת שלא שולמה לא נכנסה לחישובים התפעוליים (כמויות, מטבח,
-- מלאי, אריזה, שינוע), אלא אם מנהל סימן עליה ידנית "אושרה חריגת תשלום".
-- בפועל זה יצר שלב אישור כפול: המנהלת כבר אישרה את ההזמנה, ואז נדרשה לאשר
-- שוב שהיא אמנם תבוצע. מעכשיו אישור ההזמנה הוא השער היחיד לביצוע, וסטטוס
-- התשלום אינו מעכב דבר.
--
-- הגבייה לא נעלמת - היא רק מפסיקה להיות תנאי לביצוע: היתרה הפתוחה של כל
-- הזמנה מוצגת בעמודה "יתרה לתשלום" ברשימת ההזמנות (נגזרת מ-final_amount פחות
-- סך customer_payments, ולכן אין כאן שדה חדש).
--
-- הערך 'payment_override' מוסר מה-enum כדי שלא יישאר סטטוס שאי אפשר להגיע
-- אליו ואי אפשר לפרש. Postgres לא תומך ב-ALTER TYPE ... DROP VALUE, ולכן
-- הטיפוס נבנה מחדש. orders.payment_status הוא השימוש היחיד בטיפוס הזה.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. גזירה מחדש של ההזמנות שסומנו בחריגה
-- ----------------------------------------------------------------------------
-- הסטטוס נקבע מהתשלומים שתועדו בפועל, בדיוק כפי ש-recomputePaymentStatus
-- עושה בשרת: אין תשלום = unpaid, שולם הכל = paid, ביניים = partially_paid.
update orders o
set payment_status = (
  case
    when coalesce(p.paid, 0) <= 0 then 'unpaid'
    when coalesce(p.paid, 0) >= o.final_amount then 'paid'
    else 'partially_paid'
  end
)::payment_status
from (
  select o2.id,
         (select coalesce(sum(cp.amount), 0)
            from customer_payments cp
           where cp.order_id = o2.id) as paid
    from orders o2
   where o2.payment_status = 'payment_override'
) p
where o.id = p.id;

-- ----------------------------------------------------------------------------
-- 2. בניית ה-enum מחדש בלי 'payment_override'
-- ----------------------------------------------------------------------------
alter type payment_status rename to payment_status_old;

create type payment_status as enum (
  'unpaid',              -- לא שולם
  'partially_paid',      -- שולם חלקית
  'paid'                 -- שולם
);

alter table orders
  alter column payment_status drop default,
  alter column payment_status type payment_status
    using payment_status::text::payment_status,
  alter column payment_status set default 'unpaid';

drop type payment_status_old;

comment on column orders.payment_status is
  'סטטוס גבייה בלבד, נגזר אוטומטית מסך התשלומים שתועדו. אינו משפיע על כניסת '
  'ההזמנה לחישובים התפעוליים - לשם כך די באישור המנהל (כלל 8.7).';
