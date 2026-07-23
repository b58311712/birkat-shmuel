-- =============================================================================
-- מטבח החסד - מיגרציה 44: קישור כמה מאכלים למשימת בישול אחת (סעיף 24.3)
-- =============================================================================
-- עד כה למשימה קבועה היה מאכל בודד (volunteer_tasks.linked_meal_id), והמשימה
-- הופיעה בתיק השבת רק אם אותו מאכל הוזמן. משימת בישול אחת משרתת לא פעם כמה
-- מאכלים (למשל "בישול דגים" לכל סוגי הדגים), ולכן נדרש קישור רב-רב.
--
-- מודל זהה ל-volunteer_meal_links (מתנדב x מאכל) ול-extra_meal_requirements,
-- עם סמנטיקת "או":
--   אין שורות למשימה  = משימה ללא התניית מאכל, מוצגת תמיד.
--   יש שורה אחת ויותר = המשימה מוצגת בשבת רק אם הוזמן לפחות אחד מהמאכלים.
--
-- volunteer_tasks.linked_meal_id נשמר לתאימות לאחור ומסונכרן עם המאכל הראשון
-- שנבחר (בדיוק כמו אצל המתנדבים).
-- =============================================================================

create table if not exists volunteer_task_meal_links (
  task_id    uuid not null references volunteer_tasks(id) on delete cascade,
  meal_id    uuid not null references meals(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, meal_id)
);

create index if not exists idx_volunteer_task_meal_links_meal on volunteer_task_meal_links(meal_id);

comment on table volunteer_task_meal_links is
  'מאכלים המקושרים למשימת בישול (סמנטיקת "או"): המשימה רלוונטית בשבת אם הוזמן לפחות אחד מהם. אין שורות = ללא התניה (סעיף 24.3)';

-- העברת הקישור הבודד הקיים אל טבלת הקישור החדשה (backfill).
insert into volunteer_task_meal_links (task_id, meal_id)
select id, linked_meal_id
from volunteer_tasks
where linked_meal_id is not null
on conflict (task_id, meal_id) do nothing;
