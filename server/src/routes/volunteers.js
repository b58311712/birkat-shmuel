// ניהול מתנדבים ומשימות קבועות (סעיף 24). CRUD גלובלי, מאחורי אימות מנהל.
// השיבוץ לשבת ספציפית נעשה בנתיבי תיק שבת (routes/shabbatFile.js).
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

const AREAS = ['cooking', 'packing', 'transport', 'cleaning', 'general'];
const VOLUNTEER_SELECT = '*, meals:linked_meal_id (id, name), customers:customer_id (id, full_name, phone, email), volunteer_task_links (task_id, role, priority), volunteer_meal_links (meal_id, meals:meal_id (id, name)), volunteer_area_links (area)';
const DAYS = ['general', 'tuesday', 'wednesday', 'thursday', 'friday', 'shabbat', 'motzei_shabbat'];
const SHIFTS = [null, 'morning', 'noon', 'evening', 'night'];

function normalizedAreas(areas, fallbackArea) {
  const requested = Array.isArray(areas) ? areas : [fallbackArea];
  return [...new Set(requested.filter(Boolean))];
}

async function syncVolunteerAreas(volunteerId, areas) {
  if (!Array.isArray(areas)) return;
  const unique = [...new Set(areas.filter(Boolean))];
  const { error: delErr } = await supabase
    .from('volunteer_area_links').delete().eq('volunteer_id', volunteerId);
  if (delErr) throw delErr;
  const { error: insErr } = await supabase
    .from('volunteer_area_links')
    .insert(unique.map((area) => ({ volunteer_id: volunteerId, area })));
  if (insErr) throw insErr;
}

// שיוך מחדש של המשימות הקבועות למתנדב (סעיף 24): מוחקים הכל ומכניסים את הבחירה.
// task_ids = מערך מזהי משימות (או undefined כדי לא לגעת בשיוך הקיים).
async function syncVolunteerTasks(volunteerId, taskIds) {
  if (!Array.isArray(taskIds)) return;
  const unique = [...new Set(taskIds.filter(Boolean))];
  const { error: delErr } = await supabase
    .from('volunteer_task_links').delete().eq('volunteer_id', volunteerId).eq('role', 'candidate');
  if (delErr) throw delErr;
  if (!unique.length) return;
  const { error: insErr } = await supabase
    .from('volunteer_task_links')
    .insert(unique.map((task_id) => ({ volunteer_id: volunteerId, task_id, role: 'candidate' })));
  if (insErr) throw insErr;
}

// שיוך מחדש של המאכלים הקבועים לבישול למתנדב (סעיף 24.2): מוחקים הכל ומכניסים
// את הבחירה. meal_ids = מערך מזהי מאכלים (או undefined כדי לא לגעת בשיוך הקיים).
async function syncVolunteerMeals(volunteerId, mealIds) {
  if (!Array.isArray(mealIds)) return;
  const unique = [...new Set(mealIds.filter(Boolean))];
  const { error: delErr } = await supabase
    .from('volunteer_meal_links').delete().eq('volunteer_id', volunteerId);
  if (delErr) throw delErr;
  if (!unique.length) return;
  const { error: insErr } = await supabase
    .from('volunteer_meal_links')
    .insert(unique.map((meal_id) => ({ volunteer_id: volunteerId, meal_id })));
  if (insErr) throw insErr;
}

// שיטוח קישורי המשימות והמאכלים למערכי מזהים + שמות מאכלים על אובייקט המתנדב.
function withLinks(volunteer) {
  if (!volunteer) return volunteer;
  const { volunteer_task_links, volunteer_meal_links, volunteer_area_links, ...rest } = volunteer;
  const linkedAreas = (volunteer_area_links || []).map((l) => l.area);
  return {
    ...rest,
    areas: [rest.area, ...linkedAreas.filter((area) => area !== rest.area)],
    task_ids: (volunteer_task_links || []).filter((l) => l.role === 'candidate').map((l) => l.task_id),
    task_roles: (volunteer_task_links || []).map((l) => ({ task_id: l.task_id, role: l.role, priority: l.priority })),
    meal_ids: (volunteer_meal_links || []).map((l) => l.meal_id),
    linked_meals: (volunteer_meal_links || []).map((l) => l.meals).filter(Boolean),
  };
}

async function auditDelete(req, entityType, entityId) {
  const { error } = await supabase.from('audit_log').insert({
    entity_type: entityType,
    entity_id: entityId,
    action: 'delete',
    actor_id: req.appUser?.sub || null,
  });
  if (error) throw error;
}

function staffingPayload(body = {}) {
  const primary = body.primary_volunteer_id || null;
  const backups = [...new Set((body.backup_volunteer_ids || []).filter(Boolean))];
  const candidates = [...new Set((body.candidate_volunteer_ids || []).filter(Boolean))];
  const all = [primary, ...backups, ...candidates].filter(Boolean);
  if (new Set(all).size !== all.length) return { error: 'אותו מתנדב לא יכול להופיע ביותר מתפקיד אחד במשימה.' };
  return { primary, backups, candidates };
}

async function syncTaskStaffing(taskId, body) {
  const staffing = staffingPayload(body);
  if (staffing.error) throw Object.assign(new Error(staffing.error), { statusCode: 400 });
  const { error } = await supabase.rpc('replace_volunteer_task_staffing', {
    p_task_id: taskId,
    p_primary_id: staffing.primary,
    p_backup_ids: staffing.backups,
    p_candidate_ids: staffing.candidates,
  });
  if (error) throw error;
}

function withStaffing(task) {
  const links = task?.volunteer_task_links || [];
  const primary = links.find((link) => link.role === 'primary');
  return {
    ...task,
    volunteer_task_links: undefined,
    primary_volunteer_id: primary?.volunteer_id || null,
    primary_volunteer: primary?.volunteers || null,
    backup_volunteer_ids: links.filter((link) => link.role === 'backup').sort((a, b) => a.priority - b.priority).map((link) => link.volunteer_id),
    backup_volunteers: links.filter((link) => link.role === 'backup').sort((a, b) => a.priority - b.priority).map((link) => ({ ...link.volunteers, priority: link.priority })),
    candidate_volunteer_ids: links.filter((link) => link.role === 'candidate').map((link) => link.volunteer_id),
    candidate_volunteers: links.filter((link) => link.role === 'candidate').map((link) => link.volunteers).filter(Boolean),
  };
}

// ===========================================================================
// מתנדבים (סעיף 24.1)
// ===========================================================================

// GET /api/admin/volunteers?area=&active= — רשימת מתנדבים
router.get('/', asyncHandler(async (req, res) => {
  let q = supabase
    .from('volunteers')
    .select(VOLUNTEER_SELECT)
    .order('full_name');
  if (req.query.active === 'true') q = q.eq('is_active', true);
  if (req.query.active === 'false') q = q.eq('is_active', false);

  const { data, error } = await q;
  if (error) throw error;
  const volunteers = (data || []).map(withLinks);
  res.json(req.query.area
    ? volunteers.filter((volunteer) => volunteer.areas.includes(req.query.area))
    : volunteers);
}));

// POST /api/admin/volunteers — יצירת מתנדב
router.post('/', asyncHandler(async (req, res) => {
  const { full_name, phone, email, customer_id, area, areas, linked_meal_id, has_vehicle, is_regular, notes, task_ids, meal_ids } = req.body || {};
  const linkedCustomerId = customer_id || null;
  if (!linkedCustomerId && !full_name?.trim()) return fail(res, 400, 'חובה להזין שם מלא.');
  const volunteerAreas = normalizedAreas(areas, area);
  if (!volunteerAreas.length || !volunteerAreas.every((value) => AREAS.includes(value))) {
    return fail(res, 400, 'יש לבחור לפחות תחום התנדבות תקין אחד.');
  }

  // שדה linked_meal_id הבודד נשמר לתאימות לאחור: אם נשלח מערך meal_ids נגזור ממנו
  // את המאכל הראשי, אחרת נשתמש בערך הבודד שנשלח.
  const primaryMealId = Array.isArray(meal_ids)
    ? (meal_ids.filter(Boolean)[0] || null)
    : (linked_meal_id || null);

  const { data, error } = await supabase.from('volunteers').insert({
    customer_id: linkedCustomerId,
    full_name: full_name?.trim() || 'linked customer',
    phone: phone?.trim() || null,
    email: email?.trim() || null,
    area: volunteerAreas[0],
    linked_meal_id: primaryMealId,
    has_vehicle: !!has_vehicle,
    is_regular: !!is_regular,
    notes: notes?.trim() || null,
  }).select(VOLUNTEER_SELECT).single();
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'לקוח זה כבר מקושר למתנדב.');
    throw error;
  }
  await syncVolunteerAreas(data.id, volunteerAreas);
  await syncVolunteerTasks(data.id, task_ids);
  await syncVolunteerMeals(data.id, meal_ids);
  const mealLinks = Array.isArray(meal_ids)
    ? meal_ids.map((meal_id) => ({ meal_id }))
    : data.volunteer_meal_links;
  res.json({ ok: true, volunteer: withLinks({
    ...data,
    volunteer_area_links: volunteerAreas.map((value) => ({ area: value })),
    volunteer_task_links: (task_ids || []).map((task_id) => ({ task_id, role: 'candidate', priority: null })),
    volunteer_meal_links: mealLinks,
  }) });
}));

// ===========================================================================
// קטגוריות משימה — שתי רמות בלבד
// ===========================================================================
router.get('/categories', asyncHandler(async (_req, res) => {
  const { data, error } = await supabase.from('volunteer_task_categories')
    .select('*').order('display_order').order('name');
  if (error) throw error;
  res.json(data || []);
}));

router.post('/categories', asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const parent_id = req.body?.parent_id || null;
  if (!name) return fail(res, 400, 'חובה להזין שם קטגוריה.');
  if (parent_id) {
    const { data: parent, error: parentError } = await supabase.from('volunteer_task_categories')
      .select('id, parent_id').eq('id', parent_id).maybeSingle();
    if (parentError) throw parentError;
    if (!parent || parent.parent_id) return fail(res, 400, 'תת־קטגוריה יכולה להשתייך לקטגוריה ראשית בלבד.');
  }
  const { data, error } = await supabase.from('volunteer_task_categories').insert({
    name, parent_id, display_order: Number(req.body?.display_order) || 0,
  }).select('*').single();
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'קטגוריה בשם זה כבר קיימת באותה רמה.');
    throw error;
  }
  res.json({ ok: true, category: data });
}));

router.patch('/categories/:id', asyncHandler(async (req, res) => {
  const patch = {};
  if ('name' in (req.body || {})) {
    patch.name = String(req.body.name || '').trim();
    if (!patch.name) return fail(res, 400, 'שם קטגוריה לא יכול להיות ריק.');
  }
  if ('display_order' in (req.body || {})) patch.display_order = Number(req.body.display_order) || 0;
  if ('is_active' in (req.body || {})) patch.is_active = !!req.body.is_active;
  if ('parent_id' in (req.body || {})) {
    patch.parent_id = req.body.parent_id || null;
    if (patch.parent_id === req.params.id) return fail(res, 400, 'קטגוריה לא יכולה להיות אב של עצמה.');
    if (patch.parent_id) {
      const { data: parent, error: parentError } = await supabase.from('volunteer_task_categories')
        .select('id, parent_id').eq('id', patch.parent_id).maybeSingle();
      if (parentError) throw parentError;
      if (!parent || parent.parent_id) return fail(res, 400, 'תת־קטגוריה יכולה להשתייך לקטגוריה ראשית בלבד.');
      const { count, error: childError } = await supabase.from('volunteer_task_categories')
        .select('id', { count: 'exact', head: true }).eq('parent_id', req.params.id);
      if (childError) throw childError;
      if (count) return fail(res, 400, 'לא ניתן להפוך קטגוריה שיש לה תתי־קטגוריות לתת־קטגוריה.');
    }
  }
  if (!Object.keys(patch).length) return fail(res, 400, 'אין שדות לעדכון.');
  const { data, error } = await supabase.from('volunteer_task_categories')
    .update(patch).eq('id', req.params.id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'קטגוריה לא נמצאה.');
  res.json({ ok: true, category: data });
}));

router.delete('/categories/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const [childrenResult, tasksResult] = await Promise.all([
    supabase.from('volunteer_task_categories').select('id', { count: 'exact', head: true }).eq('parent_id', req.params.id),
    supabase.from('volunteer_tasks').select('id', { count: 'exact', head: true }).eq('category_id', req.params.id),
  ]);
  if (childrenResult.error) throw childrenResult.error;
  if (tasksResult.error) throw tasksResult.error;
  const children = childrenResult.count;
  const tasks = tasksResult.count;
  if (children || tasks) return fail(res, 409, 'לא ניתן למחוק קטגוריה שיש בה תתי־קטגוריות או משימות. ניתן להשבית אותה.');
  const { data, error } = await supabase.from('volunteer_task_categories')
    .delete().eq('id', req.params.id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'קטגוריה לא נמצאה.');
  await auditDelete(req, 'volunteer_task_category', req.params.id);
  res.json({ ok: true });
}));

// PATCH /api/admin/volunteers/:id — עדכון מתנדב (כולל השבתה — מחיקה רכה)
router.patch('/:id', asyncHandler(async (req, res) => {
  const allowed = ['customer_id', 'full_name', 'phone', 'email', 'area', 'linked_meal_id', 'has_vehicle', 'is_regular', 'is_active', 'notes'];
  const patch = {};
  for (const k of allowed) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }
  if ('customer_id' in patch) patch.customer_id = patch.customer_id || null;
  const volunteerAreas = Array.isArray(req.body?.areas)
    ? normalizedAreas(req.body.areas)
    : ('area' in patch ? normalizedAreas(null, patch.area) : null);
  if (volunteerAreas && (!volunteerAreas.length || !volunteerAreas.every((value) => AREAS.includes(value)))) {
    return fail(res, 400, 'יש לבחור לפחות תחום התנדבות תקין אחד.');
  }
  if (volunteerAreas) patch.area = volunteerAreas[0];
  if ('full_name' in patch && !patch.customer_id && !patch.full_name?.trim()) return fail(res, 400, 'שם מלא לא יכול להיות ריק.');
  if ('full_name' in patch && patch.full_name) patch.full_name = patch.full_name.trim();
  if ('phone' in patch) patch.phone = patch.phone ? String(patch.phone).trim() : null;
  if ('email' in patch) patch.email = patch.email ? String(patch.email).trim() : null;
  if ('notes' in patch) patch.notes = patch.notes ? String(patch.notes).trim() : null;
  const syncTasks = Array.isArray(req.body?.task_ids);
  const syncMeals = Array.isArray(req.body?.meal_ids);
  const syncAreas = Array.isArray(volunteerAreas);
  // כשמסנכרנים מאכלים, משאירים את linked_meal_id הבודד מסונכרן עם המאכל הראשי
  // (תאימות לאחור + התצוגה בטבלה). דריסה ידנית של linked_meal_id ב-body מכובדת.
  if (syncMeals && !('linked_meal_id' in patch)) {
    patch.linked_meal_id = req.body.meal_ids.filter(Boolean)[0] || null;
  }
  if (Object.keys(patch).length === 0 && !syncTasks && !syncMeals && !syncAreas) return fail(res, 400, 'אין שדות לעדכון.');

  // אם אין שדות עמודה לעדכן אבל כן צריך לסנכרן קישורים — שולפים את המתנדב בלבד.
  const query = Object.keys(patch).length
    ? supabase.from('volunteers').update(patch).eq('id', req.params.id).select(VOLUNTEER_SELECT).maybeSingle()
    : supabase.from('volunteers').select(VOLUNTEER_SELECT).eq('id', req.params.id).maybeSingle();
  const { data, error } = await query;
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'לקוח זה כבר מקושר למתנדב.');
    throw error;
  }
  if (!data) return fail(res, 404, 'מתנדב לא נמצא.');
  if (syncAreas) await syncVolunteerAreas(data.id, volunteerAreas);
  if (syncTasks) await syncVolunteerTasks(data.id, req.body.task_ids);
  if (syncMeals) await syncVolunteerMeals(data.id, req.body.meal_ids);
  const preservedTaskRoles = (data.volunteer_task_links || []).filter((link) => link.role !== 'candidate');
  const taskLinks = syncTasks
    ? [...preservedTaskRoles, ...req.body.task_ids.map((task_id) => ({ task_id, role: 'candidate', priority: null }))]
    : data.volunteer_task_links;
  const mealLinks = syncMeals ? req.body.meal_ids.map((meal_id) => ({ meal_id })) : data.volunteer_meal_links;
  res.json({ ok: true, volunteer: withLinks({
    ...data,
    volunteer_area_links: syncAreas
      ? volunteerAreas.map((value) => ({ area: value }))
      : data.volunteer_area_links,
    volunteer_task_links: taskLinks,
    volunteer_meal_links: mealLinks,
  }) });
}));

router.delete('/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const { count: assignmentCount, error: countError } = await supabase.from('volunteer_assignments')
    .select('id', { count: 'exact', head: true }).eq('volunteer_id', req.params.id);
  if (countError) throw countError;
  if (assignmentCount) return fail(res, 409, 'לא ניתן למחוק מתנדב עם היסטוריית שיבוצים. ניתן להשבית אותו.');
  const cleanup = await Promise.all([
    supabase.from('orders').update({ transport_volunteer_id: null }).eq('transport_volunteer_id', req.params.id),
    supabase.from('volunteer_assignments').delete().eq('volunteer_id', req.params.id),
  ]);
  const cleanupErr = cleanup.find((r) => r.error)?.error;
  if (cleanupErr) throw cleanupErr;

  const { data, error } = await supabase
    .from('volunteers')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'מתנדב לא נמצא.');
  await auditDelete(req, 'volunteer', req.params.id);
  res.json({ ok: true });
}));

// ===========================================================================
// משימות קבועות (סעיף 24.3)
// ===========================================================================

// GET /api/admin/volunteers/tasks — רשימת משימות קבועות
router.get('/tasks', asyncHandler(async (req, res) => {
  let q = supabase
    .from('volunteer_tasks')
    .select('*, meals:linked_meal_id (id, name), category:category_id (id, name, parent_id, display_order), volunteer_task_links (volunteer_id, role, priority, volunteers:volunteer_id (id, full_name, phone, area, is_active))')
    .order('display_order').order('name');
  if (req.query.active === 'true') q = q.eq('is_active', true);

  const { data, error } = await q;
  if (error) throw error;
  res.json((data || []).map(withStaffing));
}));

// POST /api/admin/volunteers/tasks — יצירת משימה קבועה
router.post('/tasks', asyncHandler(async (req, res) => {
  const { name, area, category_id, linked_meal_id, execution_day = 'general', shift = null, timing_note, display_order } = req.body || {};
  if (!name?.trim()) return fail(res, 400, 'חובה להזין שם משימה.');
  if (!AREAS.includes(area)) return fail(res, 400, 'תחום משימה לא תקין.');
  if (!category_id) return fail(res, 400, 'חובה לבחור קטגוריה.');
  if (!DAYS.includes(execution_day)) return fail(res, 400, 'יום ביצוע לא תקין.');
  if (!SHIFTS.includes(shift || null)) return fail(res, 400, 'משמרת לא תקינה.');
  const staffing = staffingPayload(req.body);
  if (staffing.error) return fail(res, 400, staffing.error);

  const { data, error } = await supabase.from('volunteer_tasks').insert({
    name: name.trim(),
    area,
    category_id,
    linked_meal_id: linked_meal_id || null,
    execution_day,
    shift: shift || null,
    timing_note: String(timing_note || '').trim() || null,
    display_order: Number.isFinite(Number(display_order)) ? Number(display_order) : 0,
  }).select('*').single();
  if (error) throw error;
  await syncTaskStaffing(data.id, req.body);
  res.json({ ok: true, task: withStaffing({ ...data, volunteer_task_links: [] }) });
}));

// PATCH /api/admin/volunteers/tasks/:id — עדכון משימה קבועה
router.patch('/tasks/:id', asyncHandler(async (req, res) => {
  const allowed = ['name', 'area', 'category_id', 'linked_meal_id', 'execution_day', 'shift', 'timing_note', 'display_order', 'is_active'];
  const patch = {};
  for (const k of allowed) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }
  if ('area' in patch && !AREAS.includes(patch.area)) return fail(res, 400, 'תחום משימה לא תקין.');
  if ('category_id' in patch && !patch.category_id) return fail(res, 400, 'חובה לבחור קטגוריה.');
  if ('execution_day' in patch && !DAYS.includes(patch.execution_day)) return fail(res, 400, 'יום ביצוע לא תקין.');
  if ('shift' in patch) patch.shift = patch.shift || null;
  if ('shift' in patch && !SHIFTS.includes(patch.shift)) return fail(res, 400, 'משמרת לא תקינה.');
  if ('name' in patch && !patch.name?.trim()) return fail(res, 400, 'שם משימה לא יכול להיות ריק.');
  if ('timing_note' in patch) patch.timing_note = String(patch.timing_note || '').trim() || null;
  const hasStaffing = ['primary_volunteer_id', 'backup_volunteer_ids', 'candidate_volunteer_ids'].some((key) => key in (req.body || {}));
  if (hasStaffing) {
    const staffing = staffingPayload(req.body);
    if (staffing.error) return fail(res, 400, staffing.error);
  }
  if (Object.keys(patch).length === 0 && !hasStaffing) return fail(res, 400, 'אין שדות לעדכון.');

  const query = Object.keys(patch).length
    ? supabase.from('volunteer_tasks').update(patch).eq('id', req.params.id).select('*').maybeSingle()
    : supabase.from('volunteer_tasks').select('*').eq('id', req.params.id).maybeSingle();
  const { data, error } = await query;
  if (error) throw error;
  if (!data) return fail(res, 404, 'משימה לא נמצאה.');
  if (hasStaffing) await syncTaskStaffing(data.id, req.body);
  res.json({ ok: true, task: data });
}));

router.delete('/tasks/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const cleanup = await supabase.from('volunteer_assignments').update({ task_id: null }).eq('task_id', req.params.id);
  if (cleanup.error) throw cleanup.error;

  const { data, error } = await supabase
    .from('volunteer_tasks')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'משימה לא נמצאה.');
  await auditDelete(req, 'volunteer_task', req.params.id);
  res.json({ ok: true });
}));

export default router;
