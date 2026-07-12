-- =============================================================================
-- מטבח החסד — מיגרציה 15: שיוך מסלול מחיר לצירוף סעודות מדויק (סעיף 15)
-- =============================================================================
-- שינוי מדיניות: מחיר הבסיס נקבע לפי *הצירוף המדויק* של הסעודות שנבחרו,
-- ולא לפי מספרן. למשל: ליל שבת בלבד → מסלול א', שבת בבוקר בלבד → מסלול ב',
-- ליל שבת + שבת בבוקר → מסלול ג'. הזמנה שצירוף הסעודות שלה אינו זהה בדיוק
-- לאף מסלול פעיל — נחסמת (אין מחיר מוגדר).
--
-- meals_count נעשה מיותר; משאירים אותו בטבלה לתאימות-לאחור אך הבחירה
-- מתבצעת מעתה לפי טבלת הקישור בלבד.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- price_track_meal_slots — אילו סעודות מרכיבות כל מסלול (יחס רבים-לרבים)
-- ----------------------------------------------------------------------------
-- צירוף הסעודות של המסלול = קבוצת ה-meal_slot_id המקושרים אליו כאן.
create table price_track_meal_slots (
  price_track_id uuid not null references price_tracks(id) on delete cascade,
  meal_slot_id   uuid not null references meal_slots(id) on delete cascade,
  primary key (price_track_id, meal_slot_id)
);

create index idx_price_track_meal_slots_slot
  on price_track_meal_slots (meal_slot_id);

comment on table price_track_meal_slots is
  'צירוף הסעודות שכל מסלול מחיר חל עליו — הבחירה לפי צירוף מדויק ולא לפי מספר (סעיף 15)';

-- ----------------------------------------------------------------------------
-- קישור המסלולים הקיימים לסעודות לפי שמות ברירת המחדל (המשכיות מה-seed)
-- ----------------------------------------------------------------------------
-- "סעודה אחת" ← ליל שבת בלבד. "שתי סעודות" ← ליל שבת + שבת בבוקר.
-- אם המסלולים/הסעודות שונו בסביבה זו, ה-insert פשוט לא ימצא התאמה ולא יזיק.
insert into price_track_meal_slots (price_track_id, meal_slot_id)
select pt.id, ms.id
from price_tracks pt
join meal_slots ms on ms.name = 'ליל שבת'
where pt.name = 'סעודה אחת'
on conflict do nothing;

insert into price_track_meal_slots (price_track_id, meal_slot_id)
select pt.id, ms.id
from price_tracks pt
join meal_slots ms on ms.name in ('ליל שבת', 'שבת בבוקר')
where pt.name = 'שתי סעודות'
on conflict do nothing;

comment on column price_tracks.meals_count is
  'לא בשימוש לבחירת מסלול — נשמר לתאימות בלבד. הבחירה לפי price_track_meal_slots (מיגרציה 15)';
