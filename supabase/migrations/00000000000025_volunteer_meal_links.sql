-- =============================================================================
-- מטבח החסד — מיגרציה 25: שיוך מספר מאכלים קבועים למתנדב אחד (סעיף 24.2)
-- =============================================================================
-- קישור many-to-many בין מתנדבים למאכלים שהם רגילים לבשל. מחליף את השדה הבודד
-- volunteers.linked_meal_id (שנשמר לתאימות לאחור). השיבוץ האוטומטי לבישול בשבת
-- מסוימת (autoAssignCooking) משתמש בקישורים אלה כדי לשבץ מתנדב לכל משימת בישול
-- שהמאכל שלה מקושר אליו.

create table volunteer_meal_links (
  id            uuid primary key default gen_random_uuid(),
  volunteer_id  uuid not null references volunteers(id) on delete cascade,
  meal_id       uuid not null references meals(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (volunteer_id, meal_id)
);

create index idx_volunteer_meal_links_volunteer on volunteer_meal_links (volunteer_id);
create index idx_volunteer_meal_links_meal on volunteer_meal_links (meal_id);

comment on table volunteer_meal_links is
  'שיוך קבוע (גלובלי) בין מתנדב למאכלים שהוא רגיל לבשל (סעיף 24.2)';

-- העברת השיוך הבודד הקיים אל טבלת הקישור החדשה (backfill).
insert into volunteer_meal_links (volunteer_id, meal_id)
select id, linked_meal_id
from volunteers
where linked_meal_id is not null
on conflict (volunteer_id, meal_id) do nothing;
