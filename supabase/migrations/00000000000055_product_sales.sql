-- =============================================================================
-- מטבח החסד - מיגרציה 55: מכירת מוצרים מהמלאי ללקוח (סעיף 38)
-- =============================================================================
-- עד כה כל תנועת כסף מלקוח הייתה תלויה בהזמנת שבת, וכל ירידת מלאי הייתה תלויה
-- בתיק שבת. אין דרך למכור ללקוח פריטי מלאי בפני עצמם: כלים חד-פעמיים, שתייה,
-- מוצרים יבשים.
--
-- מכירת מוצרים היא **שורת orders עצמאית**, בלי מועד ובלי סעודות, שכל תוכנה הוא
-- order_inventory_lines (מיגרציה 53). המחיר הוא מחיר העלות של הפריט
-- (last_purchase_price, מחיר בסיס לפני מע"מ ליחידת בסיס, מיגרציה 33) בתוספת
-- מע"מ לפריט שאינו פטור, בלי רווח.
--
-- למה orders ולא טבלה נפרדת: כל מנגנון שהמכירה צריכה כבר מפתח על order_id -
-- הגבייה (customer_payments), ההחזרים, ההנחות, הדוחות הכספיים ורשימת ההזמנות
-- של הלקוח. routes/payments.js אינו נוגע ב-shabbat_id בשום מקום, ולכן הוא עובד
-- על מכירה בלי שורת קוד חדשה. טבלה מקבילה הייתה מחייבת שכפול של כל השרשרת.
--
-- הבדל מהותי אחד מהזמנת שבת ומאירוע: המלאי יורד **מיד ביצירה** (המוצר עובר
-- לידי הלקוח באותו רגע), ולא בניכוי ידני אחרי ההכנות. הביטול מחזיר אותו.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- סוג ההזמנה ותאריך המכירה
-- ----------------------------------------------------------------------------
-- 'occasion' ולא 'shabbat_order': מיגרציה 52 הפכה את shabbatot לטבלת מועדים,
-- ואירוע הוא מועד בדיוק כמו שבת. ההבחנה כאן היא בין הזמנה התלויה במועד לבין
-- מכירה שאינה תלויה בו.
alter table orders
  add column order_kind text not null default 'occasion',
  add column sale_date  date;

alter table orders
  add constraint chk_orders_order_kind
    check (order_kind in ('occasion', 'product_sale'));

-- מועד אינו חובה יותר: מכירת מוצרים אינה משויכת לשבת ולא לאירוע.
alter table orders alter column shabbat_id drop not null;

-- מקור-תאריך אחד ויחיד לכל הזמנה. זה מה שמאפשר ל-finance.js לקבץ הכנסות לפי
-- חודש ולפי שנה בלי לאבד מכירות. כל השורות הקיימות עוברות את האילוץ כבר עכשיו
-- (order_kind='occasion' בברירת מחדל, shabbat_id מלא, sale_date ריק), ולכן הוא
-- נוצר מאומת ולא not valid.
alter table orders
  add constraint chk_orders_kind_occasion check (
    (order_kind = 'occasion'     and shabbat_id is not null and sale_date is null)
    or
    (order_kind = 'product_sale' and shabbat_id is null     and sale_date is not null)
  );

create index idx_orders_kind on orders (order_kind);
create index idx_orders_sale_date on orders (sale_date) where order_kind = 'product_sale';

comment on column orders.order_kind is
  'occasion = הזמנה המשויכת למועד (שבת או אירוע); product_sale = מכירת מוצרי '
  'מלאי ישירה ללקוח, בלי מועד ובלי סעודות (סעיף 38)';
comment on column orders.sale_date is
  'תאריך המכירה. מחליף את תאריך המועד כמפתח הקיבוץ בדוחות הכספיים. '
  'חובה במכירת מוצרים, אסור בהזמנה המשויכת למועד';

-- ----------------------------------------------------------------------------
-- הרפיית אילוצי מיגרציה 27 למכירה
-- ----------------------------------------------------------------------------
-- שלושת האילוצים של מיגרציה 27 הם NOT VALID: אינם חלים על הזמנות היסטוריות
-- חסרות, אך כן נאכפים על כל יצירה/עדכון חדשים. למכירת מוצרים אין אולם ואין
-- כתובת אספקה, ולכן היא הייתה נחסמת. מתנים אותם בסוג ההזמנה במקום למלא ערכי
-- דמה, שהיו זולגים לדוח השינוע ולדף ההזמנה להדפסה.
--
-- קריטי: האילוצים נבנים מחדש עם NOT VALID. בנייה כאילוץ מאומת הייתה נכשלת
-- בדיוק על ההזמנות ההיסטוריות שמיגרציה 27 פטרה במכוון.
alter table orders drop constraint orders_venue_name_required;
alter table orders drop constraint orders_venue_address_required;
alter table orders drop constraint orders_payment_method_required;

alter table orders
  add constraint orders_venue_name_required check (
    order_kind <> 'occasion' or (venue_name is not null and btrim(venue_name) <> '')
  ) not valid,
  add constraint orders_venue_address_required check (
    order_kind <> 'occasion' or (venue_address is not null and btrim(venue_address) <> '')
  ) not valid,
  add constraint orders_payment_method_required check (
    order_kind <> 'occasion' or preferred_payment_method is not null
  ) not valid;

-- ----------------------------------------------------------------------------
-- עקיבות תנועת המלאי חזרה למכירה
-- ----------------------------------------------------------------------------
-- inventory_movements תמכה עד כה בשני הקשרים: מועד והזמנת רכש. תנועת מכירה
-- שייכת להזמנה, ובלי העמודה הזו לא ניתן לדעת איזו מכירה הורידה את הכמות ולא
-- ניתן להחזיר אותה בביטול.
--
-- on delete set null ולא cascade: תנועת מלאי היא רשומת ביקורת של שינוי שקרה
-- בפועל. מחיקת ההזמנה אינה מבטלת את העובדה שהכמות ירדה, ולכן התנועה נשארת
-- ומאבדת רק את ההפניה. מחיקת המכירה עצמה מחזירה את המלאי לפני כן.
alter table inventory_movements
  add column order_id uuid references orders(id) on delete set null;

create index idx_inventory_movements_order on inventory_movements (order_id);

comment on column inventory_movements.order_id is
  'ההזמנה שגרמה לתנועה. משמש מכירת מוצרים: מזהה את הניכוי לצורך החזרת המלאי '
  'בביטול, ומאפשר לכרטיס הפריט להציג את המכירה שהורידה את הכמות (סעיף 38)';

comment on column inventory_movements.movement_type is
  'shabbat_deduction / purchase_receipt / manual_adjustment / waste / return / '
  'correction / sale_deduction / sale_return';

-- ----------------------------------------------------------------------------
-- סנכרון מלאי אטומי למכירה
-- ----------------------------------------------------------------------------
-- הפונקציה מקבלת את **מצב היעד** של המכירה (שורות ביחידת בסיס) ומביאה את המלאי
-- אליו, במקום לקבל פעולה ("נכה" / "החזר"). זה מה שמאפשר לשלוש הפעולות - יצירה,
-- עריכת שורות וביטול - לרוץ באותה פונקציה: ביטול הוא פשוט יעד ריק.
--
-- שתי תכונות שנובעות מהצורה הזו:
--   אידמפוטנטיות - קריאה חוזרת עם אותו יעד מוצאת דלתא 0 ואינה עושה כלום.
--                  שמירה כפולה מהממשק אינה מנכה פעמיים.
--   נכונות בעריכה - הדלתא נגזרת ממה שירד בפועל (סכום התנועות), ולא ממה שכתוב
--                  כרגע בשורות. שורה שנערכה אחרי הניכוי לא תגרום לסטייה.
--
-- אטומיות: FOR UPDATE על ההזמנה מסדר בקשות מקבילות על אותה מכירה; FOR UPDATE על
-- כל פריט מונע מכירת יתר בין מכירות שונות; order by על מזהה הפריט קובע סדר
-- נעילה דטרמיניסטי ומונע קיפאון בין שתי מכירות הנוגעות באותם פריטים. כל שגיאה
-- מגלגלת את העסקה כולה - אין ניכוי חלקי.
--
-- p_lines: [{ "item_id": uuid, "qty_base": numeric }, ...] ביחידת הבסיס של הפריט
create or replace function sync_sale_inventory(
  p_order_id     uuid,
  p_lines        jsonb,
  p_performed_by uuid default null
)
returns table (inventory_item_id uuid, quantity_before numeric, quantity_after numeric)
language plpgsql
as $$
declare
  v_row    record;
  v_before numeric(14,4);
  v_after  numeric(14,4);
  v_name   text;
  v_kind   text;
begin
  -- נעילת המכירה עצמה. בלעדיה שתי בקשות מקבילות היו קוראות את אותו מצב תנועות
  -- ומחשבות את אותה דלתא פעמיים.
  select order_kind into v_kind
    from orders where id = p_order_id for update;

  if v_kind is null then
    raise exception 'sale-not-found' using hint = 'המכירה לא נמצאה';
  end if;
  if v_kind <> 'product_sale' then
    raise exception 'not-a-sale' using
      hint = 'סנכרון מלאי מכירה חל על מכירת מוצרים בלבד';
  end if;

  for v_row in
    with target as (
      select (elem->>'item_id')::uuid          as item_id,
             sum((elem->>'qty_base')::numeric) as qty
        from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as elem
       where (elem->>'qty_base')::numeric > 0
       group by 1
    ),
    applied as (
      -- מה שירד בפועל עד כה: ניכוי שלילי, החזרה חיובית, ולכן ההיפוך של הסכום
      -- הוא הכמות שהמכירה מחזיקה כרגע.
      select m.inventory_item_id    as item_id,
             -sum(m.quantity_delta) as qty
        from inventory_movements m
       where m.order_id = p_order_id
         and m.movement_type in ('sale_deduction', 'sale_return')
       group by 1
    )
    select coalesce(t.item_id, a.item_id)          as item_id,
           coalesce(t.qty, 0) - coalesce(a.qty, 0) as delta
      from target t
      full outer join applied a on a.item_id = t.item_id
     where coalesce(t.qty, 0) <> coalesce(a.qty, 0)
     order by 1
  loop
    select quantity_on_hand, name into v_before, v_name
      from inventory_items
     where id = v_row.item_id
     for update;

    if v_before is null then
      raise exception 'item-not-found: %', v_row.item_id;
    end if;

    -- חסימה על חוסר מלאי חלה רק על ניכוי. החזרה תמיד אפשרית.
    if v_row.delta > 0 and v_before < v_row.delta then
      raise exception 'insufficient-inventory: % (נדרש %, קיים %)',
        v_name, v_row.delta, v_before
        using hint = 'אין מספיק מלאי למכירה';
    end if;

    v_after := v_before - v_row.delta;

    update inventory_items
       set quantity_on_hand = v_after
     where id = v_row.item_id;

    insert into inventory_movements (
      inventory_item_id, movement_type, quantity_delta,
      quantity_before, quantity_after, order_id, performed_by, reason
    ) values (
      v_row.item_id,
      case when v_row.delta > 0 then 'sale_deduction' else 'sale_return' end,
      -v_row.delta, v_before, v_after, p_order_id, p_performed_by,
      case when v_row.delta > 0
           then 'מכירת מוצרים ללקוח'
           else 'החזרת מלאי מביטול או עדכון מכירה' end
    );

    inventory_item_id := v_row.item_id;
    quantity_before   := v_before;
    quantity_after    := v_after;
    return next;
  end loop;
end;
$$;

comment on function sync_sale_inventory(uuid, jsonb, uuid) is
  'סנכרון מלאי אטומי למכירת מוצרים: מביא את המלאי למצב היעד של המכירה. '
  'יעד ריק = ביטול והחזרת הכל. אידמפוטנטי (סעיף 38)';
