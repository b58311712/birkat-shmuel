import { supabase } from '../lib/supabase.js';

const TASK_SELECT = 'id, name, area, category_id, linked_meal_id, execution_day, shift, timing_note, display_order, is_active';

async function orderedMealIds(shabbatId) {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_meals(meal_id)')
    .eq('shabbat_id', shabbatId)
    .neq('order_status', 'cancelled');
  if (error) throw error;
  return new Set((orders || []).flatMap((order) => order.order_meals || []).map((row) => row.meal_id));
}

export async function reconcileShabbatVolunteerTasks(shabbatId) {
  const [tasksResult, categoriesResult, primaryResult, snapshotsResult, fileResult, mealIds] = await Promise.all([
    supabase.from('volunteer_tasks').select(TASK_SELECT).eq('is_active', true).order('display_order').order('name'),
    supabase.from('volunteer_task_categories').select('id, name, parent_id, display_order'),
    supabase.from('volunteer_task_links').select('task_id, volunteer_id, volunteers!inner(is_active)')
      .eq('role', 'primary').eq('volunteers.is_active', true),
    supabase.from('shabbat_volunteer_tasks').select('id, template_task_id, linked_meal_id, is_relevant').eq('shabbat_id', shabbatId),
    supabase.from('shabbat_files').select('id, volunteer_snapshot_created_at').eq('shabbat_id', shabbatId).maybeSingle(),
    orderedMealIds(shabbatId),
  ]);
  for (const result of [tasksResult, categoriesResult, primaryResult, snapshotsResult, fileResult]) {
    if (result.error) throw result.error;
  }

  const tasks = tasksResult.data || [];
  const categories = categoriesResult.data || [];
  const categoryById = Object.fromEntries(categories.map((category) => [category.id, category]));
  const primaryByTask = Object.fromEntries((primaryResult.data || []).map((link) => [link.task_id, link.volunteer_id]));
  let snapshots = snapshotsResult.data || [];

  // A Shabbat is a snapshot: the full active template is copied once. Later template
  // edits do not add, remove or rename tasks in an already opened Shabbat.
  if (!fileResult.data?.volunteer_snapshot_created_at) {
    const rows = tasks.map((task) => {
      const category = categoryById[task.category_id];
      const parent = category?.parent_id ? categoryById[category.parent_id] : null;
      return {
        shabbat_id: shabbatId,
        template_task_id: task.id,
        name: task.name,
        area: task.area,
        category_id: category?.id || null,
        category_name: category?.name || 'לא מסווג',
        category_display_order: category?.display_order || 0,
        parent_category_id: parent?.id || null,
        parent_category_name: parent?.name || null,
        parent_category_display_order: parent?.display_order ?? null,
        linked_meal_id: task.linked_meal_id || null,
        execution_day: task.execution_day || 'general',
        shift: task.shift || null,
        timing_note: task.timing_note || null,
        display_order: task.display_order || 0,
        default_volunteer_id: primaryByTask[task.id] || null,
        is_relevant: task.linked_meal_id ? mealIds.has(task.linked_meal_id) : true,
      };
    });
    let inserted = [];
    if (rows.length) {
      let insertResult = await supabase
        .from('shabbat_volunteer_tasks').insert(rows).select('id, template_task_id, default_volunteer_id');
      if (insertResult.error?.code === 'PGRST204'
        && /category_display_order|parent_category_display_order/.test(insertResult.error.message || '')) {
        const compatibleRows = rows.map(({ category_display_order, parent_category_display_order, ...row }) => row);
        insertResult = await supabase.from('shabbat_volunteer_tasks')
          .insert(compatibleRows).select('id, template_task_id, default_volunteer_id');
      }
      if (insertResult.error) throw insertResult.error;
      inserted = insertResult.data || [];
    }
    const { data: legacyAssignments, error: legacyError } = await supabase.from('volunteer_assignments')
      .select('id, task_id, is_auto, created_at').eq('shabbat_id', shabbatId)
      .is('shabbat_task_id', null).not('task_id', 'is', null)
      .order('created_at');
    if (legacyError) throw legacyError;
    const snapshotByTemplate = Object.fromEntries(inserted.map((snapshot) => [snapshot.template_task_id, snapshot]));
    const legacyByTask = {};
    for (const assignment of legacyAssignments || []) (legacyByTask[assignment.task_id] ||= []).push(assignment);
    for (const [taskId, rows] of Object.entries(legacyByTask)) {
      const snapshot = snapshotByTemplate[taskId];
      if (!snapshot) continue;
      const { error: snapshotUpdateError } = await supabase.from('shabbat_volunteer_tasks')
        .update({ has_manual_override: true }).eq('id', snapshot.id);
      if (snapshotUpdateError) throw snapshotUpdateError;
      rows.sort((a, b) => Number(a.is_auto) - Number(b.is_auto) || String(a.created_at).localeCompare(String(b.created_at)));
      for (let index = 0; index < rows.length; index += 1) {
        const { error: legacyUpdateError } = await supabase.from('volunteer_assignments').update({
          shabbat_task_id: snapshot.id,
          assignment_kind: index === 0 ? 'lead' : 'support',
          source: 'legacy',
        }).eq('id', rows[index].id);
        if (legacyUpdateError) throw legacyUpdateError;
      }
    }
    const assignments = inserted
      .filter((snapshot) => snapshot.default_volunteer_id && !(legacyByTask[snapshot.template_task_id]?.length))
      .map((snapshot) => ({
        shabbat_id: shabbatId,
        shabbat_task_id: snapshot.id,
        task_id: snapshot.template_task_id,
        volunteer_id: snapshot.default_volunteer_id,
        assignment_kind: 'lead',
        source: 'template',
        is_auto: true,
      }));
    if (assignments.length) {
      const { error: assignmentError } = await supabase.from('volunteer_assignments').insert(assignments);
      if (assignmentError) throw assignmentError;
    }
    snapshots = inserted;
    if (fileResult.data?.id) {
      const { error: fileError } = await supabase.from('shabbat_files')
        .update({ volunteer_snapshot_created_at: new Date().toISOString() }).eq('id', fileResult.data.id);
      if (fileError) throw fileError;
    }
  } else if (snapshots.length > 0) {
    // Menu reconciliation only toggles relevance; assignments and manual overrides survive.
    const changes = snapshots
      .map((snapshot) => ({
        ...snapshot,
        nextRelevant: snapshot.linked_meal_id ? mealIds.has(snapshot.linked_meal_id) : true,
      }))
      .filter((snapshot) => snapshot.is_relevant !== snapshot.nextRelevant);
    for (const snapshot of changes) {
      const { error } = await supabase.from('shabbat_volunteer_tasks')
        .update({ is_relevant: snapshot.nextRelevant }).eq('id', snapshot.id);
      if (error) throw error;
    }
  }

  return { ok: true, task_count: snapshots.length };
}

export async function setWeeklyLead(shabbatId, shabbatTaskId, volunteerId, { reset = false } = {}) {
  const { data: task, error: taskError } = await supabase
    .from('shabbat_volunteer_tasks')
    .select('id, template_task_id, default_volunteer_id')
    .eq('id', shabbatTaskId).eq('shabbat_id', shabbatId).maybeSingle();
  if (taskError) throw taskError;
  if (!task) return null;
  const selectedVolunteerId = reset ? task.default_volunteer_id : volunteerId;

  const { error: deleteError } = await supabase.from('volunteer_assignments')
    .delete().eq('shabbat_task_id', task.id).eq('assignment_kind', 'lead');
  if (deleteError) throw deleteError;
  if (selectedVolunteerId) {
    const { error: duplicateDeleteError } = await supabase.from('volunteer_assignments')
      .delete().eq('shabbat_task_id', task.id).eq('volunteer_id', selectedVolunteerId);
    if (duplicateDeleteError) throw duplicateDeleteError;
    const { error: insertError } = await supabase.from('volunteer_assignments').insert({
      shabbat_id: shabbatId,
      shabbat_task_id: task.id,
      task_id: task.template_task_id,
      volunteer_id: selectedVolunteerId,
      assignment_kind: 'lead',
      source: reset ? 'template' : 'manual',
      is_auto: reset,
    });
    if (insertError) throw insertError;
  }
  const { error: updateError } = await supabase.from('shabbat_volunteer_tasks')
    .update({ has_manual_override: !reset }).eq('id', task.id);
  if (updateError) throw updateError;
  return { volunteer_id: selectedVolunteerId, reset };
}

export async function addWeeklySupport(shabbatId, shabbatTaskId, volunteerId, notes = null) {
  const { data: task, error } = await supabase.from('shabbat_volunteer_tasks')
    .select('id, template_task_id').eq('id', shabbatTaskId).eq('shabbat_id', shabbatId).maybeSingle();
  if (error) throw error;
  if (!task) return null;
  const { data: existing, error: existingError } = await supabase.from('volunteer_assignments')
    .select('id').eq('shabbat_task_id', task.id).eq('volunteer_id', volunteerId).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;
  const { data, error: insertError } = await supabase.from('volunteer_assignments').insert({
    shabbat_id: shabbatId,
    shabbat_task_id: task.id,
    task_id: task.template_task_id,
    volunteer_id: volunteerId,
    assignment_kind: 'support',
    source: 'manual',
    is_auto: false,
    notes: notes || null,
  }).select('id').single();
  if (insertError) throw insertError;
  return data;
}
