-- =============================================================================
-- מטבח החסד - מיגרציה 37: [כלי מיזוג יחידות זמני] merge_units
-- =============================================================================
-- ⚠️ כלי ניקיון חד-פעמי. ה-backfill במיגרציה 36 יצר יחידות כפולות סמנטית
-- (יח'/יחי'/יחידה, ק"ג/קילו, כוס/כוסות, קופסא/קופסה). כדי לאחד אותן צריך
-- למפות מחדש את כל הרשומות המקושרות ליחידת היעד לפני מחיקת המקור - אחרת
-- מחיקה נחסמת על ידי ה-FK. הפונקציה עושה זאת אטומית (עסקה אחת).
--
-- לאחר סיום הניקיון ניתן להסיר: DROP FUNCTION merge_units(uuid, uuid);
-- (וכן להסיר את הראוט/כפתור התואמים - כולם מסומנים "[כלי מיזוג זמני]").
-- =============================================================================

create or replace function merge_units(p_source_id uuid, p_target_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_items    integer;
  v_recipes  integer;
  v_convs    integer;
  v_dropped  integer := 0;
begin
  if p_source_id = p_target_id then
    raise exception 'same-unit' using hint = 'יחידת המקור והיעד זהות';
  end if;
  if not exists (select 1 from units where id = p_target_id) then
    raise exception 'target-not-found' using hint = 'יחידת היעד לא קיימת';
  end if;

  -- 1. פריטי מלאי: מצביעים ליעד. הטריגר sync_unit_text_from_id מעדכן גם את
  --    עמודת unit הטקסטואלית אוטומטית (update of unit_id מפעיל אותו).
  update inventory_items set unit_id = p_target_id where unit_id = p_source_id;
  get diagnostics v_items = row_count;

  -- 2. שורות מתכון: אותו דבר (הטריגר מסנכרן את הטקסט).
  update recipe_lines set unit_id = p_target_id where unit_id = p_source_id;
  get diagnostics v_recipes = row_count;

  -- 3. המרות יחידה: from_unit_id → היעד. ייחודיות (item, from_unit_id) עלולה
  --    להתנגש אם לפריט כבר קיימת המרה מהיעד - במקרה כזה מוחקים את הכפולה של המקור.
  delete from inventory_unit_conversions src
   where src.from_unit_id = p_source_id
     and exists (
       select 1 from inventory_unit_conversions tgt
        where tgt.inventory_item_id = src.inventory_item_id
          and tgt.from_unit_id = p_target_id
     );
  get diagnostics v_dropped = row_count;

  update inventory_unit_conversions set from_unit_id = p_target_id where from_unit_id = p_source_id;
  get diagnostics v_convs = row_count;

  -- 4. עכשיו המקור אינו מקושר לאף רשומה - מוחקים אותו.
  delete from units where id = p_source_id;

  return jsonb_build_object(
    'items_remapped', v_items,
    'recipes_remapped', v_recipes,
    'conversions_remapped', v_convs,
    'duplicate_conversions_dropped', v_dropped
  );
end;
$$;

comment on function merge_units(uuid, uuid) is
  '[כלי מיזוג זמני] ממפה כל הרשומות מיחידת מקור ליעד ומוחק את המקור, אטומית (מיגרציה 37)';
