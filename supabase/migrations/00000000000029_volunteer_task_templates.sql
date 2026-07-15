-- Volunteer task templates, staffing roles and immutable per-Shabbat snapshots.

create table volunteer_task_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references volunteer_task_categories(id) on delete restrict,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint volunteer_task_categories_name_not_blank check (btrim(name) <> ''),
  constraint volunteer_task_categories_not_self check (parent_id is null or parent_id <> id)
);

create unique index uq_volunteer_task_categories_root_name
  on volunteer_task_categories (lower(name)) where parent_id is null;
create unique index uq_volunteer_task_categories_child_name
  on volunteer_task_categories (parent_id, lower(name)) where parent_id is not null;
create index idx_volunteer_task_categories_parent on volunteer_task_categories(parent_id);

create trigger trg_volunteer_task_categories_updated_at
  before update on volunteer_task_categories for each row execute function set_updated_at();

create or replace function validate_volunteer_task_category_depth()
returns trigger language plpgsql as $$
declare parent_parent uuid;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'category cannot be its own parent'; end if;
  select parent_id into parent_parent from volunteer_task_categories where id = new.parent_id;
  if not found then raise exception 'parent category not found'; end if;
  if parent_parent is not null then raise exception 'volunteer task categories support two levels only'; end if;
  return new;
end;
$$;

create trigger trg_validate_volunteer_task_category_depth
  before insert or update of parent_id on volunteer_task_categories
  for each row execute function validate_volunteer_task_category_depth();

insert into volunteer_task_categories (name, display_order)
values ('לא מסווג', 0);

alter table volunteer_tasks
  add column category_id uuid references volunteer_task_categories(id) on delete restrict,
  add column execution_day text not null default 'general',
  add column shift text,
  add column timing_note text;

update volunteer_tasks
set category_id = (select id from volunteer_task_categories where name = 'לא מסווג' and parent_id is null limit 1)
where category_id is null;

alter table volunteer_tasks
  alter column category_id set not null,
  add constraint volunteer_tasks_execution_day_check
    check (execution_day in ('general','tuesday','wednesday','thursday','friday','shabbat','motzei_shabbat')),
  add constraint volunteer_tasks_shift_check
    check (shift is null or shift in ('morning','noon','evening','night'));

alter table volunteer_task_links
  add column role text not null default 'candidate',
  add column priority integer;

alter table volunteer_task_links
  add constraint volunteer_task_links_role_check check (role in ('primary','backup','candidate')),
  add constraint volunteer_task_links_priority_check
    check ((role = 'backup' and priority is not null and priority > 0) or (role <> 'backup' and priority is null));

create unique index uq_volunteer_task_links_primary
  on volunteer_task_links(task_id) where role = 'primary';
create unique index uq_volunteer_task_links_backup_priority
  on volunteer_task_links(task_id, priority) where role = 'backup';

create or replace function replace_volunteer_task_staffing(
  p_task_id uuid,
  p_primary_id uuid,
  p_backup_ids uuid[],
  p_candidate_ids uuid[]
) returns void language plpgsql as $$
declare all_ids uuid[];
begin
  all_ids := array_remove(array[p_primary_id] || coalesce(p_backup_ids, '{}'::uuid[]) || coalesce(p_candidate_ids, '{}'::uuid[]), null);
  if cardinality(all_ids) <> (select count(distinct value) from unnest(all_ids) as valueset(value)) then
    raise exception 'a volunteer cannot have multiple roles in one task';
  end if;

  delete from volunteer_task_links where task_id = p_task_id;
  if p_primary_id is not null then
    insert into volunteer_task_links(task_id, volunteer_id, role) values (p_task_id, p_primary_id, 'primary');
  end if;
  insert into volunteer_task_links(task_id, volunteer_id, role, priority)
  select p_task_id, p_backup_ids[position], 'backup', position
  from generate_subscripts(coalesce(p_backup_ids, '{}'::uuid[]), 1) as positions(position);
  insert into volunteer_task_links(task_id, volunteer_id, role)
  select p_task_id, volunteer_id, 'candidate'
  from unnest(coalesce(p_candidate_ids, '{}'::uuid[])) as candidates(volunteer_id);
end;
$$;

create table shabbat_volunteer_tasks (
  id uuid primary key default gen_random_uuid(),
  shabbat_id uuid not null references shabbatot(id) on delete cascade,
  template_task_id uuid references volunteer_tasks(id) on delete set null,
  name text not null,
  area volunteer_area not null,
  category_id uuid references volunteer_task_categories(id) on delete set null,
  category_name text not null,
  category_display_order integer not null default 0,
  parent_category_id uuid references volunteer_task_categories(id) on delete set null,
  parent_category_name text,
  parent_category_display_order integer,
  linked_meal_id uuid references meals(id) on delete set null,
  execution_day text not null,
  shift text,
  timing_note text,
  display_order integer not null default 0,
  default_volunteer_id uuid references volunteers(id) on delete set null,
  is_relevant boolean not null default true,
  has_manual_override boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shabbat_id, template_task_id),
  constraint shabbat_volunteer_tasks_execution_day_check
    check (execution_day in ('general','tuesday','wednesday','thursday','friday','shabbat','motzei_shabbat')),
  constraint shabbat_volunteer_tasks_shift_check
    check (shift is null or shift in ('morning','noon','evening','night'))
);

alter table shabbat_files add column volunteer_snapshot_created_at timestamptz;

create index idx_shabbat_volunteer_tasks_shabbat on shabbat_volunteer_tasks(shabbat_id, is_relevant);
create trigger trg_shabbat_volunteer_tasks_updated_at
  before update on shabbat_volunteer_tasks for each row execute function set_updated_at();

alter table volunteer_assignments
  add column shabbat_task_id uuid references shabbat_volunteer_tasks(id) on delete cascade,
  add column assignment_kind text not null default 'lead',
  add column source text not null default 'manual';

alter table volunteer_assignments
  add constraint volunteer_assignments_kind_check check (assignment_kind in ('lead','support')),
  add constraint volunteer_assignments_source_check check (source in ('template','manual','legacy'));

create unique index uq_volunteer_assignments_weekly_lead
  on volunteer_assignments(shabbat_task_id) where assignment_kind = 'lead' and shabbat_task_id is not null;
create unique index uq_volunteer_assignments_weekly_volunteer
  on volunteer_assignments(shabbat_task_id, volunteer_id) where shabbat_task_id is not null and volunteer_id is not null;

comment on table volunteer_task_categories is 'קטגוריות נפרדות למשימות מתנדבים, בשתי רמות בלבד';
comment on table shabbat_volunteer_tasks is 'צילום משימה ותבנית השיבוץ עבור שבת מסוימת';
