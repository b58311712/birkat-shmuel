-- =============================================================================
-- מטבח החסד - מיגרציה 28: שיוך מספר תחומי התנדבות למתנדב אחד
-- =============================================================================
-- volunteers.area נשמר כתחום הראשי לצורך תאימות לאחור. כל התחומים, כולל הראשי,
-- נשמרים בטבלת הקישור ומשמשים להצגה ולשיבוץ מתנדבים למשימות.

create table volunteer_area_links (
  id            uuid primary key default gen_random_uuid(),
  volunteer_id  uuid not null references volunteers(id) on delete cascade,
  area          volunteer_area not null,
  created_at    timestamptz not null default now(),
  unique (volunteer_id, area)
);

create index idx_volunteer_area_links_volunteer on volunteer_area_links (volunteer_id);
create index idx_volunteer_area_links_area on volunteer_area_links (area);

comment on table volunteer_area_links is
  'שיוך תחומי התנדבות מרובים למתנדב. volunteers.area הוא התחום הראשי לתאימות לאחור.';

-- העברת התחום היחיד של המתנדבים הקיימים לטבלת הקישור.
insert into volunteer_area_links (volunteer_id, area)
select id, area
from volunteers
on conflict (volunteer_id, area) do nothing;
