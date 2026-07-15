-- Follow-up for environments where migration 29 was applied before the
-- staffing RPC and snapshot ordering columns were added to its source file.

alter table shabbat_volunteer_tasks
  add column if not exists category_display_order integer not null default 0,
  add column if not exists parent_category_display_order integer;

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
    insert into volunteer_task_links(task_id, volunteer_id, role)
    values (p_task_id, p_primary_id, 'primary');
  end if;
  insert into volunteer_task_links(task_id, volunteer_id, role, priority)
  select p_task_id, p_backup_ids[position], 'backup', position
  from generate_subscripts(coalesce(p_backup_ids, '{}'::uuid[]), 1) as positions(position);
  insert into volunteer_task_links(task_id, volunteer_id, role)
  select p_task_id, volunteer_id, 'candidate'
  from unnest(coalesce(p_candidate_ids, '{}'::uuid[])) as candidates(volunteer_id);
end;
$$;

notify pgrst, 'reload schema';
