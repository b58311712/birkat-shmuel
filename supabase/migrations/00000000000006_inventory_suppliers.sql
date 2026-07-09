-- =============================================================================
-- מטבח החסד — מיגרציה 06: מלאי, ספקים, הזמנות רכש ותנועות מלאי
-- =============================================================================

-- ----------------------------------------------------------------------------
-- suppliers — ספקים / כרטיס ספק (סעיף 27.1)
-- ----------------------------------------------------------------------------
create table suppliers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,                    -- שם ספק
  contact_name      text,                             -- איש קשר
  phone             text,
  email             text,
  preferred_channel supplier_order_channel,           -- אמצעי הזמנה מועדף
  order_notes       text,                             -- הערות הזמנה
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_suppliers_updated_at
  before update on suppliers for each row execute function set_updated_at();

comment on table suppliers is 'ספקים — כרטיס ספק (סעיף 27.1)';

-- ----------------------------------------------------------------------------
-- inventory_categories — קטגוריות מלאי (סעיף 25.1)
-- ----------------------------------------------------------------------------
-- חומרי גלם, קפואים, ירקות, אריזות, כלים חד-פעמיים, ניקיון, ציוד... דינמי.
create table inventory_categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_inventory_categories_updated_at
  before update on inventory_categories for each row execute function set_updated_at();

comment on table inventory_categories is 'קטגוריות מלאי דינמיות (חומרי גלם, אריזות, ניקיון...) (סעיף 25.1)';

-- ----------------------------------------------------------------------------
-- inventory_items — כרטיס מוצר מלאי (סעיף 25.2)
-- ----------------------------------------------------------------------------
-- אריזות מנוהלות כפריטי מלאי רגילים (סעיף 22.4).
-- בשלב הראשון: אין תוקף/אצווה/מיקום (סעיף 25.2).
create table inventory_items (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,                 -- שם מוצר
  category_id           uuid references inventory_categories(id), -- קטגוריה
  unit                  text not null,                 -- יחידת מידה
  quantity_on_hand      numeric(14,4) not null default 0, -- כמות קיימת
  min_alert_quantity    numeric(14,4),                 -- כמות מינימום להתראה
  default_supplier_id   uuid references suppliers(id), -- ספק ברירת מחדל
  last_purchase_price   numeric(10,2),                 -- מחיר קנייה אחרון
  is_packaging          boolean not null default false, -- האם זה פריט אריזה (סעיף 22.4)
  is_active             boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_inventory_items_category on inventory_items (category_id);
create index idx_inventory_items_default_supplier on inventory_items (default_supplier_id);
create index idx_inventory_items_packaging on inventory_items (is_packaging) where is_packaging;

create trigger trg_inventory_items_updated_at
  before update on inventory_items for each row execute function set_updated_at();

comment on table inventory_items is 'כרטיס מוצר מלאי — כולל אריזות (סעיף 25.2, 22.4)';
comment on column inventory_items.is_packaging is 'true = פריט אריזה (קופסה, תבנית, שקית) המנוהל כמלאי';

-- ----------------------------------------------------------------------------
-- item_suppliers — ספקים אפשריים למוצר (סעיף 25.3)
-- ----------------------------------------------------------------------------
-- מוצר יכול להיות משויך לכמה ספקים; אחד מהם הוא ברירת מחדל (בכרטיס המוצר).
create table item_suppliers (
  inventory_item_id   uuid not null references inventory_items(id) on delete cascade,
  supplier_id         uuid not null references suppliers(id) on delete cascade,
  last_purchase_price numeric(10,2),                   -- מחיר קנייה אחרון מספק זה
  primary key (inventory_item_id, supplier_id)
);

comment on table item_suppliers is 'ספקים אפשריים לכל מוצר מלאי (סעיף 25.3)';

-- ----------------------------------------------------------------------------
-- השלמת מפתחות זר שהושארו פתוחים במיגרציה 02
-- (recipe_lines ו-packing_rules -> inventory_items)
-- ----------------------------------------------------------------------------
alter table recipe_lines
  add constraint fk_recipe_lines_inventory_item
  foreign key (inventory_item_id) references inventory_items(id);

alter table packing_rules
  add constraint fk_packing_rules_packaging_item
  foreign key (packaging_item_id) references inventory_items(id);

-- ----------------------------------------------------------------------------
-- purchase_orders — הזמנות רכש (סעיף 27.2)
-- ----------------------------------------------------------------------------
create table purchase_orders (
  id                    uuid primary key default gen_random_uuid(),
  po_number             bigint not null unique,        -- מספר הזמנת רכש
  supplier_id           uuid not null references suppliers(id),
  status                purchase_order_status not null default 'draft',
  expected_delivery_date date,                          -- תאריך אספקה צפוי
  estimated_amount      numeric(12,2),                 -- מחיר משוער (סה"כ)
  actual_amount         numeric(12,2),                 -- מחיר בפועל (סה"כ)
  notes                 text,
  created_by            uuid references app_users(id), -- מי יצר
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_purchase_orders_supplier on purchase_orders (supplier_id);
create index idx_purchase_orders_status on purchase_orders (status);

create trigger trg_purchase_orders_updated_at
  before update on purchase_orders for each row execute function set_updated_at();

comment on table purchase_orders is 'הזמנות רכש לספקים (סעיף 27.2)';

-- מונה נפרד להזמנות רכש (בפורמט שנתי כמו הזמנות לקוח)
create table purchase_order_number_counters (
  year        integer primary key,
  last_number integer not null default 0
);

create or replace function allocate_po_number(p_year integer)
returns bigint
language plpgsql
as $$
declare
  v_next integer;
begin
  insert into purchase_order_number_counters (year, last_number)
    values (p_year, 1)
  on conflict (year) do update
    set last_number = purchase_order_number_counters.last_number + 1
  returning last_number into v_next;
  return (p_year::bigint * 10000) + v_next;
end;
$$;

-- ----------------------------------------------------------------------------
-- purchase_order_lines — פריטי הזמנת רכש (סעיף 27.2)
-- ----------------------------------------------------------------------------
create table purchase_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references purchase_orders(id) on delete cascade,
  inventory_item_id  uuid not null references inventory_items(id),
  quantity           numeric(14,4) not null,           -- כמות מוזמנת
  quantity_received  numeric(14,4) not null default 0, -- כמות שהתקבלה (התקבלה חלקית)
  estimated_price    numeric(10,2),                    -- מחיר משוער ליחידה
  actual_price       numeric(10,2),                    -- מחיר בפועל ליחידה
  created_at         timestamptz not null default now(),
  constraint chk_po_lines_qty check (quantity > 0)
);

create index idx_po_lines_po on purchase_order_lines (purchase_order_id);

comment on table purchase_order_lines is 'פריטי הזמנת רכש (סעיף 27.2)';

-- ----------------------------------------------------------------------------
-- supplier_payments — תשלומים לספק לפי הזמנת רכש (סעיף 28.1)
-- ----------------------------------------------------------------------------
create table supplier_payments (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid references purchase_orders(id), -- קישור להזמנת רכש (אופציונלי)
  supplier_id        uuid not null references suppliers(id),
  status             supplier_payment_status not null default 'unpaid',
  estimated_amount   numeric(12,2),                    -- סכום הזמנה משוער
  invoice_amount     numeric(12,2),                    -- סכום בפועל לפי חשבונית
  invoice_number     text,                             -- מספר חשבונית / קבלה
  invoice_date       date,                             -- תאריך חשבונית
  paid_at            date,                             -- תאריך תשלום
  payment_method     text,                             -- אמצעי תשלום
  amount_paid        numeric(12,2),                    -- סכום ששולם
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_supplier_payments_po on supplier_payments (purchase_order_id);
create index idx_supplier_payments_supplier on supplier_payments (supplier_id);

create trigger trg_supplier_payments_updated_at
  before update on supplier_payments for each row execute function set_updated_at();

comment on table supplier_payments is 'תשלומים לספקים לפי הזמנת רכש (סעיף 28.1)';

-- ----------------------------------------------------------------------------
-- inventory_movements — תנועות מלאי (סעיף 25.4, 25.5)
-- ----------------------------------------------------------------------------
-- כל שינוי כמות מתועד: הפחתה לאחר הכנות, קבלת סחורה, בלאי, תיקון ספירה...
-- delta חיובי = תוספת, שלילי = הפחתה. שומר כמות לפני/אחרי לביקורת.
create table inventory_movements (
  id                uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id),
  movement_type     text not null,                    -- 'shabbat_deduction'|'purchase_receipt'|'manual_adjustment'|'waste'|'return'|'correction'
  quantity_delta    numeric(14,4) not null,           -- שינוי הכמות (+/-)
  quantity_before   numeric(14,4) not null,           -- כמות לפני
  quantity_after    numeric(14,4) not null,           -- כמות אחרי
  shabbat_id        uuid references shabbatot(id),    -- שבת קשורה (אם רלוונטי)
  purchase_order_id uuid references purchase_orders(id), -- הזמנת רכש קשורה (אם רלוונטי)
  reason            text,                             -- סיבה (בלאי, טעות ספירה...)
  note              text,
  performed_by      uuid references app_users(id),    -- מי ביצע
  created_at        timestamptz not null default now()
);

create index idx_inventory_movements_item on inventory_movements (inventory_item_id);
create index idx_inventory_movements_shabbat on inventory_movements (shabbat_id);
create index idx_inventory_movements_type on inventory_movements (movement_type);

comment on table inventory_movements is 'תנועות מלאי מתועדות: הפחתות, קבלות, תיקונים (סעיף 25.4, 25.5)';
comment on column inventory_movements.movement_type is 'shabbat_deduction / purchase_receipt / manual_adjustment / waste / return / correction';
