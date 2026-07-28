-- =============================================================================
-- מטבח החסד - מיגרציה 53: שורות מלאי חופשיות בהזמנה
-- =============================================================================
-- עד כה צריכת מלאי נגזרה תמיד ממאכל (דרך recipe_lines) או מתוספת בתשלום
-- (מיגרציה 51). באירוע יש פריטים שנצרכים ישירות ואין להם מאכל: כלים חד-פעמיים,
-- שתייה, מפות, פחמים. הטבלה הזו מאפשרת להוסיף אותם כשורה בהזמנה.
--
-- השורה משרתת שני צרכים בבת אחת:
--   1. צריכת מלאי - נכנסת לניכוי (inventoryDeduction) ולדוח החוסרים (shabbatFile),
--      בדיוק כמו מרכיב של מאכל, אלא שהכמות מוחלטת ולא כפולה במספר המנות.
--   2. תמחור - העלות שלה נכנסת לסכום ההזמנה (orders.inventory_lines_amount).
--
-- הטבלה תלויה בהזמנה ולא באירוע, ולכן היא זמינה גם להזמנת שבת רגילה.
-- =============================================================================

create table order_inventory_lines (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id) on delete cascade,
  inventory_item_id  uuid not null references inventory_items(id),
  item_name_snapshot text not null,                  -- שם הפריט בזמן ההזנה
  quantity           numeric(14,4) not null,         -- כמות ביחידת ההזנה
  unit_id            uuid references units(id),      -- יחידת ההזנה (טבלת units, מיגרציה 36)
  unit_cost          numeric(10,2) not null default 0, -- עלות ליחידת ההזנה, קפואה
  line_total         numeric(10,2) not null default 0, -- quantity * unit_cost
  note               text,
  created_at         timestamptz not null default now(),
  constraint chk_order_inventory_lines_qty check (quantity > 0)
);

create index idx_order_inventory_lines_order on order_inventory_lines (order_id);
create index idx_order_inventory_lines_item  on order_inventory_lines (inventory_item_id);

comment on table order_inventory_lines is
  'פריטי מלאי הנצרכים ישירות בהזמנה, בלי מאכל מתווך (כלים חד-פעמיים, שתייה). '
  'מזינים גם את ניכוי המלאי וגם את תמחור ההזמנה';
comment on column order_inventory_lines.quantity is
  'כמות מוחלטת ליחידת ההזנה - אינה מוכפלת במספר המנות, בשונה מ-recipe_lines';
comment on column order_inventory_lines.unit_id is
  'יחידת ההזנה. ההמרה ליחידת הבסיס של הפריט עוברת ב-inventory_unit_conversions, '
  'אותו מסלול של מרכיבי המתכון, כדי שהעלות והניכוי לא יסטו זה מזה';
comment on column order_inventory_lines.unit_cost is
  'עלות ליחידת ההזנה בזמן ההזנה - קפואה, כמו כל מחיר בהזמנה (סעיף 15.3)';
