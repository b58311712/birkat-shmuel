-- =============================================================================
-- מטבח החסד - מיגרציה 23: שיוך מספר משימות קבועות למתנדב אחד (סעיף 24)
-- =============================================================================
-- קישור many-to-many בין מתנדבים למשימות קבועות. השיוך גלובלי (ברירת מחדל),
-- ואינו תלוי בשבת מסוימת. השיבוץ בפועל לשבת מסוימת נשאר ב-volunteer_assignments.

create table volunteer_task_links (
  id            uuid primary key default gen_random_uuid(),
  volunteer_id  uuid not null references volunteers(id) on delete cascade,
  task_id       uuid not null references volunteer_tasks(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (volunteer_id, task_id)
);

create index idx_volunteer_task_links_volunteer on volunteer_task_links (volunteer_id);
create index idx_volunteer_task_links_task on volunteer_task_links (task_id);

comment on table volunteer_task_links is
  'שיוך קבוע (גלובלי) בין מתנדב למשימות קבועות שהוא רגיל לבצע (סעיף 24)';
