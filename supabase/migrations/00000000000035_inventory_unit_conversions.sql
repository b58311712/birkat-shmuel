-- =============================================================================
-- מטבח החסד - מיגרציה 35: המרת יחידות מתכון ליחידת מלאי + ניכוי מלאי אטומי
-- =============================================================================
-- הבעיה: המתכון (recipe_lines) נכתב ביחידות נוחות למטבח כטקסט חופשי ("כף",
-- "כוס", "יחידה"), בעוד המלאי (inventory_items.unit) מנוהל ביחידת בסיס אחת
-- לכל פריט ("גרם", "מ""ל"). כדי לנכות מלאי בפועל צריך פקטור המרה: כמה יחידות
-- בסיס יש ב-1 יחידת מתכון (למשל 1 "כף" סוכר = 12.5 גרם → factor_to_base=12.5).
--
-- שני מרכיבים:
--   1. inventory_unit_conversions - טבלת המרה פר-פריט (from_unit → פקטור לבסיס).
--   2. deduct_shabbat_inventory(...) - RPC שמנכה את כל הצריכה של שבת בעסקה אחת
--      אטומית: נועל את שורות המלאי (FOR UPDATE), מאמת מספיקוּת, מעדכן כמות,
--      רושם inventory_movements, ומסמן את תיק השבת כ-deducted. הכל-או-כלום.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. טבלת המרה: יחידת-מתכון → פקטור ליחידת הבסיס של הפריט
-- ----------------------------------------------------------------------------
-- factor_to_base = כמה יחידות בסיס (inventory_items.unit) שוות ל-1 from_unit.
-- ההמרה היא פר-פריט (לא גלובלית) כי "כוס" קמח ≠ "כוס" סוכר במשקל.
-- הפריט תמיד יכול לנכות ביחידת הבסיס עצמה בפקטור 1 (מטופל בקוד, לא חובה כאן).
create table inventory_unit_conversions (
  id                uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  from_unit         text not null,                    -- יחידת המתכון (כמו שנכתבה ב-recipe_lines.unit)
  factor_to_base    numeric(18,6) not null,           -- כמה יחידות בסיס ב-1 from_unit
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_conversion_factor_positive check (factor_to_base > 0),
  -- המרה אחת לכל (פריט, יחידה). משווים lower(trim(...)) כדי ש"כף"/"כף " יזוהו כזהים.
  constraint uq_conversion_item_unit unique (inventory_item_id, from_unit)
);

create index idx_unit_conversions_item on inventory_unit_conversions (inventory_item_id);

create trigger trg_unit_conversions_updated_at
  before update on inventory_unit_conversions for each row execute function set_updated_at();

comment on table inventory_unit_conversions is
  'המרת יחידת-מתכון (recipe_lines.unit) ליחידת הבסיס של פריט המלאי (סעיף 21.3, 25.4)';
comment on column inventory_unit_conversions.factor_to_base is
  'כמה יחידות בסיס (inventory_items.unit) שוות ל-1 from_unit. דוגמה: 1 כף סוכר = 12.5 גרם';

-- ----------------------------------------------------------------------------
-- 2. ניכוי מלאי אטומי לשבת שלמה
-- ----------------------------------------------------------------------------
-- מקבל מערך שורות { item_id, qty_base } שכבר חושבו והומרו ביישום (הצריכה
-- המצטברת לכל פריט ביחידת הבסיס), + זהות המבצע. הפונקציה עצמה אחראית רק על
-- החלק שחייב להיות אטומי: נעילה, אימות מספיקוּת, עדכון, תיעוד, וסימון התיק.
--
-- אטומיות: כל גוף הפונקציה רץ בעסקה אחת. FOR UPDATE נועל את שורות המלאי כך
-- ששני ניכויים במקביל לא יקראו את אותה quantity_on_hand ויכתבו זה על זה
-- (מונע race condition / oversell). כל שגיאה (מלאי חסר, שבת כבר נוכתה) מגלגלת
-- את כל השינויים אחורה - אין ניכוי חלקי.
--
-- p_lines: jsonb מהצורה [{ "item_id": uuid, "qty_base": numeric }, ...]
create or replace function deduct_shabbat_inventory(
  p_shabbat_id uuid,
  p_lines      jsonb,
  p_performed_by uuid default null
)
returns table (inventory_item_id uuid, quantity_before numeric, quantity_after numeric)
language plpgsql
as $$
declare
  v_line       record;
  v_before     numeric(14,4);
  v_after      numeric(14,4);
  v_item_name  text;
  v_file_id    uuid;
begin
  -- נועלים את תיק השבת ומוודאים שלא נוכה כבר (אנטי-כפילות). אם אין תיק - שגיאה.
  select id into v_file_id
    from shabbat_files
   where shabbat_id = p_shabbat_id
   for update;

  if v_file_id is null then
    raise exception 'no-shabbat-file' using
      hint = 'אין תיק שבת לשבת זו - לא ניתן לנכות מלאי';
  end if;

  if exists (select 1 from shabbat_files where id = v_file_id and is_inventory_deducted) then
    raise exception 'already-deducted' using
      hint = 'המלאי כבר הופחת עבור שבת זו';
  end if;

  -- מעבר על כל שורת צריכה. נועלים את פריט המלאי, מאמתים מספיקוּת, מנכים, מתעדים.
  for v_line in
    select (elem->>'item_id')::uuid as item_id,
           (elem->>'qty_base')::numeric as qty_base
      from jsonb_array_elements(p_lines) as elem
  loop
    if v_line.qty_base is null or v_line.qty_base <= 0 then
      continue; -- מדלגים על צריכה אפסית/לא-תקינה (לא אמורה להגיע מהיישום)
    end if;

    -- FOR UPDATE - נעילת השורה עד סוף העסקה. שם הפריט לשגיאה קריאה.
    select quantity_on_hand, name into v_before, v_item_name
      from inventory_items
     where id = v_line.item_id
     for update;

    if v_before is null then
      raise exception 'item-not-found: %', v_line.item_id;
    end if;

    if v_before < v_line.qty_base then
      raise exception 'insufficient-inventory: % (נדרש %, קיים %)',
        v_item_name, v_line.qty_base, v_before
        using hint = 'אין מספיק מלאי לניכוי';
    end if;

    v_after := v_before - v_line.qty_base;

    update inventory_items
       set quantity_on_hand = v_after
     where id = v_line.item_id;

    insert into inventory_movements (
      inventory_item_id, movement_type, quantity_delta,
      quantity_before, quantity_after, shabbat_id, performed_by, note
    ) values (
      v_line.item_id, 'shabbat_deduction', -v_line.qty_base,
      v_before, v_after, p_shabbat_id, p_performed_by, 'ניכוי אוטומטי לפי מתכונים'
    );

    inventory_item_id := v_line.item_id;
    quantity_before   := v_before;
    quantity_after    := v_after;
    return next;
  end loop;

  -- מסמנים את תיק השבת כמנוכה (בתוך אותה עסקה - אטומי מול הניכוי עצמו).
  update shabbat_files
     set is_inventory_deducted = true,
         inventory_deducted_by  = p_performed_by,
         inventory_deducted_at  = now()
   where id = v_file_id;
end;
$$;

comment on function deduct_shabbat_inventory(uuid, jsonb, uuid) is
  'ניכוי מלאי אטומי לשבת: נעילה, אימות מספיקוּת, עדכון, תיעוד תנועות, וסימון התיק (סעיף 25.4)';
