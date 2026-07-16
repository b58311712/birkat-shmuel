-- =============================================================================
-- מטבח החסד — מיגרציה 31: פישוט מודול המתנדבים והמשימות
-- =============================================================================
-- מבטלים את מנגנון ה-snapshot הכבד (shabbat_volunteer_tasks) ואת תפקיד ה-candidate.
-- המבנה החדש: תבנית גלובלית אחת. משימה = מתנדב קבוע (primary) + מחליפים (backup).
-- שיבוץ בישול מחושב חי לפי המאכל שהוזמן. volunteer_assignments משמשת רק לדריסות
-- פר-שבת (is_override) — החלפת המתנדב הקבוע בשבת ספציפית.
-- הנתונים כרגע דמו ולכן אין הגירת נתונים.

-- ----------------------------------------------------------------------------
-- 1. מחיקת טבלת ה-snapshot והדגל שלה
-- ----------------------------------------------------------------------------
drop table if exists shabbat_volunteer_tasks cascade;
alter table shabbat_files drop column if exists volunteer_snapshot_created_at;

-- ----------------------------------------------------------------------------
-- 2. פישוט volunteer_assignments — רק דריסות פר-שבת
-- ----------------------------------------------------------------------------
-- מנקים שיבוצים ישנים שנוצרו במנגנון ה-snapshot (דמו).
truncate table volunteer_assignments;

-- מסירים את אינדקסים הייחודיים של ה-snapshot לפני מחיקת העמודות.
drop index if exists uq_volunteer_assignments_weekly_lead;
drop index if exists uq_volunteer_assignments_weekly_volunteer;

alter table volunteer_assignments
  drop column if exists shabbat_task_id,
  drop column if exists assignment_kind,
  drop column if exists source;

-- is_override = דריסה ידנית של המתנדב הקבוע למשימה בשבת זו.
alter table volunteer_assignments
  add column is_override boolean not null default false;

-- דריסה אחת לכל (שבת, משימה) — שורה ייחודית לכל משימה בשבת נתונה. השירות
-- overrideTaskLead עושה delete-then-insert (לא ON CONFLICT), אז אינדקס חלקי מספיק.
create unique index uq_volunteer_assignments_override
  on volunteer_assignments(shabbat_id, task_id)
  where task_id is not null;

-- ----------------------------------------------------------------------------
-- 3. ביטול תפקיד candidate ב-volunteer_task_links
-- ----------------------------------------------------------------------------
delete from volunteer_task_links where role = 'candidate';

alter table volunteer_task_links
  drop constraint if exists volunteer_task_links_role_check;
alter table volunteer_task_links
  add constraint volunteer_task_links_role_check check (role in ('primary', 'backup'));

-- ----------------------------------------------------------------------------
-- 4. עדכון ה-RPC — רק primary + backups (ללא candidates)
-- ----------------------------------------------------------------------------
drop function if exists replace_volunteer_task_staffing(uuid, uuid, uuid[], uuid[]);

create or replace function replace_volunteer_task_staffing(
  p_task_id uuid,
  p_primary_id uuid,
  p_backup_ids uuid[]
) returns void language plpgsql as $$
declare all_ids uuid[];
begin
  all_ids := array_remove(array[p_primary_id] || coalesce(p_backup_ids, '{}'::uuid[]), null);
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
end;
$$;

comment on column volunteer_assignments.is_override is 'דריסה ידנית של המתנדב הקבוע למשימה בשבת זו';
