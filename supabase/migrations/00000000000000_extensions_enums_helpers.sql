-- =============================================================================
-- מטבח החסד — מיגרציה 00: הרחבות, אנומים (רשימות ערכים קבועות) ופונקציות עזר
-- =============================================================================
-- מוסכמה: שמות טבלאות ועמודות באנגלית לצורך יציבות טכנית.
--          כל התוויות שהמשתמש רואה (עברית מלאה, RTL) הן בשכבת הממשק.
-- כל טבלה שיש בה סטטוס פעיל/לא-פעיל משתמשת ב-is_active במקום מחיקה (סעיף 32).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- הרחבות
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "unaccent";       -- חיפוש טקסט גמיש (אופציונלי)

-- ----------------------------------------------------------------------------
-- אנומים — רשימות ערכים קבועות מהאיפיון
-- (סטטוסים "בסיסיים" שהמנהל לא משנה. קטגוריות/מאכלים/מסלולים הם טבלאות דינמיות.)
-- ----------------------------------------------------------------------------

-- תפקידי משתמש פנימי (סעיף 5)
create type user_role as enum (
  'developer',   -- מפתחת
  'manager',     -- מנהל מערכת / מנהל מטבח החסד
  'coordinator'  -- רכז תפעול
);

-- סטטוס לקוח (סעיף 6)
create type customer_status as enum (
  'active',            -- פעיל
  'pending_approval',  -- ממתין לאישור רישום
  'inactive',          -- לא פעיל
  'blocked'            -- חסום
);

-- סטטוס שבת (סעיף 8.4)
create type shabbat_status as enum (
  'open',       -- פתוחה להזמנות
  'closed',     -- סגורה להזמנות
  'completed',  -- הושלמה
  'cancelled'   -- מבוטלת / המטבח לא פעיל
);

-- סטטוס הזמנה (סעיף 11.1)
create type order_status as enum (
  'pending_approval',  -- ממתין לאישור
  'approved',          -- מאושר
  'needs_correction',  -- דורש תיקון
  'cancelled',         -- בוטל
  'delivered'          -- סופק / בוצע
);

-- סטטוס תשלום להזמנה (סעיף 11.2)
create type payment_status as enum (
  'unpaid',              -- לא שולם
  'partially_paid',      -- שולם חלקית
  'paid',                -- שולם
  'payment_override'     -- אושר חריגת תשלום
);

-- סטטוס החזר (סעיף 19.4)
create type refund_status as enum (
  'not_required',    -- לא נדרש החזר
  'pending',         -- ממתין להחזר
  'partial',         -- הוחזר חלקית
  'full',            -- הוחזר במלואו
  'cancelled'        -- החזר בוטל / לא יבוצע
);

-- אמצעי תשלום מלקוח (סעיף 17.1)
create type payment_method as enum (
  'bank_transfer',  -- העברה בנקאית
  'cash',           -- מזומן
  'check'           -- צ׳ק
);

-- שיטת אספקה (סעיף 23.1)
create type delivery_method as enum (
  'volunteer_transport',  -- שינוע על ידי מתנדבים (ברירת מחדל)
  'self_pickup'           -- איסוף עצמי מהמטבח
);

-- תחום התנדבות (סעיף 24.1)
create type volunteer_area as enum (
  'cooking',   -- בישול
  'packing',   -- אריזה
  'transport', -- שינוע
  'cleaning',  -- ניקיון
  'general'    -- כללי
);

-- סטטוס הזמנת רכש (סעיף 27.3)
create type purchase_order_status as enum (
  'draft',              -- טיוטה
  'sent',               -- נשלחה לספק
  'partially_received', -- התקבלה חלקית
  'received',           -- התקבלה במלואה
  'cancelled'           -- בוטלה
);

-- סטטוס תשלום לספק (סעיף 28.1)
create type supplier_payment_status as enum (
  'unpaid',            -- לא שולם
  'partially_paid',    -- שולם חלקית
  'paid',              -- שולם במלואו
  'awaiting_invoice',  -- ממתין לחשבונית
  'cancelled'          -- בוטל
);

-- סוג הנחה (סעיף 16.1)
create type discount_type as enum (
  'fixed_amount',  -- הנחה בסכום קבוע
  'percentage'     -- הנחה באחוזים
);

-- סוג הערה פנימית (סעיף 20.2)
create type internal_note_type as enum (
  'general',    -- הערה כללית פנימית
  'kitchen',    -- הערה למטבח
  'packing',    -- הערה לאריזה
  'transport',  -- הערה לשינוע
  'financial'   -- הערה כספית
);

-- אמצעי הזמנה מספק (סעיף 27.1)
create type supplier_order_channel as enum (
  'phone',     -- טלפון
  'email',     -- מייל
  'whatsapp',  -- וואטסאפ
  'other'      -- אחר
);

-- ----------------------------------------------------------------------------
-- פונקציית עזר: עדכון אוטומטי של updated_at בכל UPDATE
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- הערה: כל טבלה מרכזית תקבל את שלוש עמודות העל:
--   id           uuid  primary key default gen_random_uuid()
--   created_at   timestamptz not null default now()
--   updated_at   timestamptz not null default now()  (מתעדכן בטריגר)
-- ----------------------------------------------------------------------------
