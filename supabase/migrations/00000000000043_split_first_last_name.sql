-- =============================================================================
-- מטבח החסד - מיגרציה 43: הפרדת שם מלא לשם פרטי ושם משפחה
-- =============================================================================
-- לקוחות, מתנדבים ובקשות רישום מקבלים first_name + last_name נפרדים.
-- העמודה full_name הופכת לעמודה מחושבת (GENERATED) שהיא צירוף השם הפרטי והמשפחה,
-- כך שכל קוד שקורא full_name ממשיך לעבוד, אך הכתיבה נעשית לשם הפרטי/משפחה בלבד.
--
-- first_name חובה (not null). last_name אופציונלי (שמות בעלי מילה אחת נשמרים כפרטי בלבד).
-- הנתונים הקיימים מפוצלים לפי הרווח הראשון: המילה הראשונה = שם פרטי, השאר = שם משפחה.
--
-- הערה: מיגרציה 12 יצרה טריגרים שמסנכרנים full_name בין לקוח מקושר למתנדב. כאן הם
-- נכתבים מחדש לסנכרון first_name/last_name (אי אפשר לכתוב לעמודה מחושבת).

-- ----------------------------------------------------------------------------
-- ביטוי העזר לחישוב full_name: אם אין שם משפחה - רק השם הפרטי; אחרת צירוף עם רווח.
-- (חייב להיות ביטוי immutable המפנה רק לעמודות באותה טבלה)
-- ----------------------------------------------------------------------------

-- ============================ customers ====================================
alter table customers add column first_name text;
alter table customers add column last_name  text;

update customers set
  first_name = split_part(btrim(full_name), ' ', 1),
  last_name  = nullif(btrim(substr(btrim(full_name), length(split_part(btrim(full_name), ' ', 1)) + 1)), '');

alter table customers alter column first_name set not null;

-- ==================== customer_registration_requests =======================
alter table customer_registration_requests add column first_name text;
alter table customer_registration_requests add column last_name  text;

update customer_registration_requests set
  first_name = split_part(btrim(full_name), ' ', 1),
  last_name  = nullif(btrim(substr(btrim(full_name), length(split_part(btrim(full_name), ' ', 1)) + 1)), '');

alter table customer_registration_requests alter column first_name set not null;

-- ============================ volunteers ===================================
alter table volunteers add column first_name text;
alter table volunteers add column last_name  text;

update volunteers set
  first_name = split_part(btrim(full_name), ' ', 1),
  last_name  = nullif(btrim(substr(btrim(full_name), length(split_part(btrim(full_name), ' ', 1)) + 1)), '');

alter table volunteers alter column first_name set not null;

-- ----------------------------------------------------------------------------
-- הסרת הטריגרים של מיגרציה 12 (מפנים ל-full_name) לפני המרת העמודה למחושבת
-- ----------------------------------------------------------------------------
drop trigger if exists trg_volunteers_sync_customer_contact on volunteers;
drop trigger if exists trg_customers_sync_linked_volunteers on customers;

-- ----------------------------------------------------------------------------
-- המרת full_name לעמודה מחושבת בשלוש הטבלאות
-- ----------------------------------------------------------------------------
alter table customers drop column full_name;
alter table customers add column full_name text
  generated always as (
    case when coalesce(last_name, '') = '' then first_name
         else first_name || ' ' || last_name end
  ) stored;

alter table customer_registration_requests drop column full_name;
alter table customer_registration_requests add column full_name text
  generated always as (
    case when coalesce(last_name, '') = '' then first_name
         else first_name || ' ' || last_name end
  ) stored;

alter table volunteers drop column full_name;
alter table volunteers add column full_name text
  generated always as (
    case when coalesce(last_name, '') = '' then first_name
         else first_name || ' ' || last_name end
  ) stored;

-- ----------------------------------------------------------------------------
-- שכתוב טריגרים מסנכרנים (מיגרציה 12) לעבוד על first_name/last_name
-- ----------------------------------------------------------------------------
-- מתנדב מקושר ללקוח: מושכים את פרטי הקשר מהלקוח לתוך שורת המתנדב.
create or replace function sync_volunteer_customer_contact()
returns trigger as $$
begin
  if new.customer_id is not null then
    select c.first_name, c.last_name, c.phone, c.email
      into new.first_name, new.last_name, new.phone, new.email
    from customers c
    where c.id = new.customer_id;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_volunteers_sync_customer_contact
  before insert or update of customer_id, first_name, last_name, phone, email on volunteers
  for each row execute function sync_volunteer_customer_contact();

-- עדכון לקוח: מפיצים את פרטי הקשר המעודכנים לכל המתנדבים המקושרים.
create or replace function propagate_customer_contact_to_volunteers()
returns trigger as $$
begin
  update volunteers
  set first_name = new.first_name,
      last_name  = new.last_name,
      phone      = new.phone,
      email      = new.email
  where customer_id = new.id;

  return new;
end;
$$ language plpgsql;

create trigger trg_customers_sync_linked_volunteers
  after update of first_name, last_name, phone, email on customers
  for each row execute function propagate_customer_contact_to_volunteers();

comment on column customers.first_name is 'שם פרטי';
comment on column customers.last_name is 'שם משפחה (אופציונלי)';
comment on column customers.full_name is 'שם מלא מחושב - צירוף שם פרטי ושם משפחה';
comment on column volunteers.first_name is 'שם פרטי';
comment on column volunteers.last_name is 'שם משפחה (אופציונלי)';
comment on column volunteers.full_name is 'שם מלא מחושב - צירוף שם פרטי ושם משפחה';
