-- סדר הקטגוריות והמאכלים בממשק הניהול ובממשק ההזמנות.
-- קטגוריות שאינן ברשימה נשארות לאחר הקטגוריות המוגדרות.

insert into categories (name, display_order, is_active)
select wanted.name, wanted.display_order, true
from (values
  ('סלטים', 1),
  ('דגים', 2),
  ('מרק', 3),
  ('מנה עיקרית', 4),
  ('תוספות', 5),
  ('ביצים וכבד', 6),
  ('טשולנט', 7),
  ('מנה אחרונה', 8)
) as wanted(name, display_order)
where not exists (
  select 1 from categories existing where existing.name = wanted.name
);

update categories
set display_order = wanted.display_order
from (values
  ('סלטים', 1),
  ('דגים', 2),
  ('מרק', 3),
  ('מנה עיקרית', 4),
  ('תוספות', 5),
  ('ביצים וכבד', 6),
  ('טשולנט', 7),
  ('מנה אחרונה', 8)
) as wanted(name, display_order)
where categories.name = wanted.name;

-- ממקמים קטגוריות נוספות אחרי שמונה הקטגוריות המבוקשות.
with remaining as (
  select id, row_number() over (order by display_order, name, id) as position
  from categories
  where name not in (
    'סלטים', 'דגים', 'מרק', 'מנה עיקרית', 'תוספות', 'מנה אחרונה', 'ביצים וכבד', 'טשולנט'
  )
)
update categories
set display_order = 8 + remaining.position
from remaining
where categories.id = remaining.id;

-- שומרים את הסדר הקיים בתוך כל קטגוריה, אך מקבצים את כל המאכלים לפי סדר הקטגוריות.
with ranked_meals as (
  select
    meals.id,
    row_number() over (
      order by categories.display_order, meals.display_order, meals.name, meals.id
    ) as position
  from meals
  left join categories on categories.id = meals.category_id
)
update meals
set display_order = ranked_meals.position
from ranked_meals
where meals.id = ranked_meals.id;
