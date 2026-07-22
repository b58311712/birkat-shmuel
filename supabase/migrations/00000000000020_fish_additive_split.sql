-- =============================================================================
-- מטבח החסד - מיגרציה 20: חלוקת מנות אוטומטית בקטגוריית דגים (יקר 80% + זול תוספת 50%)
-- =============================================================================
-- עד כה קטגוריות "דגים" ו"מנה עיקרית" עבדו במצב חלוקה *ידני* (requires_portion_split):
-- הלקוח מזין כמות לכל מאכל, וסך הכמויות חייב להשתוות למנות הסעודה (100 = 60+40).
--
-- בקטגוריית דגים רוצים התנהגות *אוטומטית* שונה (סעיף 13):
--   - דג מרכזי אחד (יקר) - חובה, ולא ניתן לבחור שני דגים יקרים.
--   - אפשר להוסיף דג משני זול יותר (is_secondary).
--   - כשנבחרו שניהם: היקר מקבל primary_percent (80%) מהמנות, הזול מקבל תוספת של
--     secondary_percent (50%). דוגמה: 100 מנות → 80 + 50 = 130 מנות מיוצרות (עודף מכוון).
--   - דג יחיד (יקר או זול) מקבל 100% מהמנות (כל מנות הסעודה).
--   - העיגול כלפי מעלה, והתוספת כלולה במחיר (המחיר לפי מנות הסעודה, לא לפי הדגים).
--
-- מודל: מרחיבים את categories.requires_portion_split (בוליאני) למצב חלוקה טקסטואלי:
--   split_mode: 'none'     - אין חלוקה (מאכל שנבחר = כל מנות הסעודה, התנהגות רגילה)
--               'equal'    - חלוקה ידנית, סכום הכמויות = מנות הסעודה (המצב הקודם)
--               'additive' - חלוקה אוטומטית לפי אחוזים (יקר + תוספת זול)
-- העמודה הישנה requires_portion_split נשמרת לתאימות-לאחור אך הקוד עובר ל-split_mode.
-- =============================================================================

-- --- מצב חלוקה ואחוזים ברמת הקטגוריה ---
alter table categories
  add column if not exists split_mode text not null default 'none'
    check (split_mode in ('none', 'equal', 'additive'));

alter table categories
  add column if not exists primary_percent smallint not null default 80
    check (primary_percent between 1 and 100);

alter table categories
  add column if not exists secondary_percent smallint not null default 50
    check (secondary_percent between 1 and 100);

comment on column categories.split_mode is
  'מצב חלוקת מנות: none=אין / equal=ידני סכום=מנות / additive=אוטומטי לפי אחוזים (סעיף 13).';
comment on column categories.primary_percent is
  'אחוז המנות לדג המרכזי (היקר) במצב additive. ברירת מחדל 80.';
comment on column categories.secondary_percent is
  'אחוז המנות (תוספת) לדג המשני (הזול) במצב additive. ברירת מחדל 50.';

-- --- דגל דג משני/זול ברמת המאכל ---
alter table meals
  add column if not exists is_secondary boolean not null default false;

comment on column meals.is_secondary is
  'true = מאכל משני/זול בקטגוריה במצב additive (מקבל את אחוז התוספת). דג לא-מסומן = מרכזי/יקר.';

-- --- מיגרציית נתונים קיימים ---
-- כל הקטגוריות שהיו בחלוקה ידנית עוברות ל-equal (שומר את ההתנהגות הקיימת),
-- ואז דגים בלבד עוברות ל-additive (מנה עיקרית נשארת equal).
update categories
set split_mode = 'equal'
where requires_portion_split = true and split_mode = 'none';

update categories
set split_mode = 'additive'
where name = 'דגים';
