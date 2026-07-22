// ניהול מתנדבים ומשימות קבועות (סעיף 24). CRUD גלובלי, מאחורי אימות מנהל.
// השיבוץ לשבת ספציפית נעשה בנתיבי תיק שבת (routes/shabbatFile.js).
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail, splitFullName } from '../lib/helpers.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

const VOLUNTEER_SELECT = '*, meals:linked_meal_id (id, name), customers:customer_id (id, first_name, last_name, full_name, phone, email), area:area_id (id, name, is_cooking), volunteer_meal_links (meal_id, meals:meal_id (id, name)), volunteer_area_links (area_id)';
const DAYS = ['general', 'tuesday', 'wednesday', 'thursday', 'friday', 'shabbat', 'motzei_shabbat'];
const SHIFTS = [null, 'morning', 'noon', 'evening', 'night'];

function normalizedAreaIds(areaIds, fallbackAreaId) {
  const requested = Array.isArray(areaIds) ? areaIds : [fallbackAreaId];
  return [...new Set(requested.filter(Boolean))];
}

// אימות שכל מזהי התחומים קיימים. מחזיר null אם תקין, אחרת הודעת שגיאה.
async function validateAreaIds(areaIds) {
  if (!areaIds.length) return 'יש לבחור לפחות תחום התנדבות אחד.';
  const { data, error } = await supabase.from('volunteer_areas').select('id').in('id', areaIds);
  if (error) throw error;
  if ((data || []).length !== areaIds.length) return 'אחד התחומים שנבחרו אינו קיים.';
  return null;
}

async function syncVolunteerAreas(volunteerId, areaIds) {
  if (!Array.isArray(areaIds)) return;
  const unique = [...new Set(areaIds.filter(Boolean))];
  const { error: delErr } = await supabase
    .from('volunteer_area_links').delete().eq('volunteer_id', volunteerId);
  if (delErr) throw delErr;
  if (!unique.length) return;
  const { error: insErr } = await supabase
    .from('volunteer_area_links')
    .insert(unique.map((area_id) => ({ volunteer_id: volunteerId, area_id })));
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

// שיטוח קישורי המאכלים והתחומים למערכי מזהים + שמות מאכלים על אובייקט המתנדב.
// המשימות אינן מנוהלות ממסך המתנדב אלא ממסך המשימה (primary/backup).
function withLinks(volunteer) {
  if (!volunteer) return volunteer;
  const { volunteer_meal_links, volunteer_area_links, ...rest } = volunteer;
  const linkedAreaIds = (volunteer_area_links || []).map((l) => l.area_id);
  return {
    ...rest,
    // area_ids: התחום הראשי (area_id) קודם, ואז שאר התחומים המקושרים
    area_ids: [rest.area_id, ...linkedAreaIds.filter((id) => id !== rest.area_id)].filter(Boolean),
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

// צוות המשימה: מתנדב קבוע (primary) + מחליפים מסודרים (backup).
function staffingPayload(body = {}) {
  const primary = body.primary_volunteer_id || null;
  const backups = [...new Set((body.backup_volunteer_ids || []).filter(Boolean))];
  const all = [primary, ...backups].filter(Boolean);
  if (new Set(all).size !== all.length) return { error: 'אותו מתנדב לא יכול להופיע ביותר מתפקיד אחד במשימה.' };
  return { primary, backups };
}

async function syncTaskStaffing(taskId, body) {
  const staffing = staffingPayload(body);
  if (staffing.error) throw Object.assign(new Error(staffing.error), { statusCode: 400 });
  const { error } = await supabase.rpc('replace_volunteer_task_staffing', {
    p_task_id: taskId,
    p_primary_id: staffing.primary,
    p_backup_ids: staffing.backups,
  });
  if (error) throw error;
}

function withStaffing(task) {
  const links = task?.volunteer_task_links || [];
  const primary = links.find((link) => link.role === 'primary');
  const backups = links.filter((link) => link.role === 'backup').sort((a, b) => a.priority - b.priority);
  return {
    ...task,
    volunteer_task_links: undefined,
    primary_volunteer_id: primary?.volunteer_id || null,
    primary_volunteer: primary?.volunteers || null,
    backup_volunteer_ids: backups.map((link) => link.volunteer_id),
    backup_volunteers: backups.map((link) => ({ ...link.volunteers, priority: link.priority })),
  };
}

// ===========================================================================
// מתנדבים (סעיף 24.1)
// ===========================================================================

// GET /api/admin/volunteers?area=&active= - רשימת מתנדבים
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
    ? volunteers.filter((volunteer) => volunteer.area_ids.includes(req.query.area))
    : volunteers);
}));

// POST /api/admin/volunteers - יצירת מתנדב
router.post('/', asyncHandler(async (req, res) => {
  const { first_name, last_name, full_name, phone, email, customer_id, area_id, area_ids, linked_meal_id, has_vehicle, is_regular, notes, meal_ids } = req.body || {};
  const linkedCustomerId = customer_id || null;
  // שם פרטי/משפחה מפוצלים, עם נפילה מ-full_name. כשמקושר ללקוח - טריגר ב-DB דורס מהלקוח.
  let firstName = String(first_name ?? '').trim();
  let lastName = last_name !== undefined ? (String(last_name || '').trim() || null) : null;
  if (!firstName && full_name) { const s = splitFullName(full_name); firstName = s.first_name; lastName = s.last_name; }
  if (!linkedCustomerId && !firstName) return fail(res, 400, 'חובה להזין שם פרטי.');
  const volunteerAreaIds = normalizedAreaIds(area_ids, area_id);
  const areaError = await validateAreaIds(volunteerAreaIds);
  if (areaError) return fail(res, 400, areaError);

  // שדה linked_meal_id הבודד נשמר לתאימות לאחור: אם נשלח מערך meal_ids נגזור ממנו
  // את המאכל הראשי, אחרת נשתמש בערך הבודד שנשלח.
  const primaryMealId = Array.isArray(meal_ids)
    ? (meal_ids.filter(Boolean)[0] || null)
    : (linked_meal_id || null);

  const { data, error } = await supabase.from('volunteers').insert({
    customer_id: linkedCustomerId,
    first_name: firstName || null,
    last_name: lastName,
    phone: phone?.trim() || null,
    email: email?.trim() || null,
    area_id: volunteerAreaIds[0],
    linked_meal_id: primaryMealId,
    has_vehicle: !!has_vehicle,
    is_regular: !!is_regular,
    notes: notes?.trim() || null,
  }).select(VOLUNTEER_SELECT).single();
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'לקוח זה כבר מקושר למתנדב.');
    throw error;
  }
  await syncVolunteerAreas(data.id, volunteerAreaIds);
  await syncVolunteerMeals(data.id, meal_ids);
  const mealLinks = Array.isArray(meal_ids)
    ? meal_ids.map((meal_id) => ({ meal_id }))
    : data.volunteer_meal_links;
  res.json({ ok: true, volunteer: withLinks({
    ...data,
    volunteer_area_links: volunteerAreaIds.map((value) => ({ area_id: value })),
    volunteer_meal_links: mealLinks,
  }) });
}));

// ===========================================================================
// תחומי התנדבות - טבלה ניתנת-לניהול (מחליפה את הקטגוריות והתחומים הקבועים)
// ===========================================================================
router.get('/areas', asyncHandler(async (_req, res) => {
  const { data, error } = await supabase.from('volunteer_areas')
    .select('*').order('display_order').order('name');
  if (error) throw error;
  res.json(data || []);
}));

router.post('/areas', asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return fail(res, 400, 'חובה להזין שם תחום.');
  const { data, error } = await supabase.from('volunteer_areas').insert({
    name,
    is_cooking: !!req.body?.is_cooking,
    display_order: Number(req.body?.display_order) || 0,
  }).select('*').single();
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'תחום בשם זה כבר קיים.');
    throw error;
  }
  res.json({ ok: true, area: data });
}));

router.patch('/areas/:id', asyncHandler(async (req, res) => {
  const patch = {};
  if ('name' in (req.body || {})) {
    patch.name = String(req.body.name || '').trim();
    if (!patch.name) return fail(res, 400, 'שם תחום לא יכול להיות ריק.');
  }
  if ('is_cooking' in (req.body || {})) patch.is_cooking = !!req.body.is_cooking;
  if ('display_order' in (req.body || {})) patch.display_order = Number(req.body.display_order) || 0;
  if ('is_active' in (req.body || {})) patch.is_active = !!req.body.is_active;
  if (!Object.keys(patch).length) return fail(res, 400, 'אין שדות לעדכון.');
  const { data, error } = await supabase.from('volunteer_areas')
    .update(patch).eq('id', req.params.id).select('*').maybeSingle();
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'תחום בשם זה כבר קיים.');
    throw error;
  }
  if (!data) return fail(res, 404, 'תחום לא נמצא.');
  res.json({ ok: true, area: data });
}));

router.delete('/areas/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  // לא ניתן למחוק תחום בשימוש (מתנדבים/משימות/קישורים) - ניתן להשבית.
  const [vols, tasks, links] = await Promise.all([
    supabase.from('volunteers').select('id', { count: 'exact', head: true }).eq('area_id', req.params.id),
    supabase.from('volunteer_tasks').select('id', { count: 'exact', head: true }).eq('area_id', req.params.id),
    supabase.from('volunteer_area_links').select('id', { count: 'exact', head: true }).eq('area_id', req.params.id),
  ]);
  for (const r of [vols, tasks, links]) if (r.error) throw r.error;
  if (vols.count || tasks.count || links.count) {
    return fail(res, 409, 'לא ניתן למחוק תחום שמשויכים אליו מתנדבים או משימות. ניתן להשבית אותו.');
  }
  const { data, error } = await supabase.from('volunteer_areas')
    .delete().eq('id', req.params.id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'תחום לא נמצא.');
  await auditDelete(req, 'volunteer_area', req.params.id);
  res.json({ ok: true });
}));

// PATCH /api/admin/volunteers/:id - עדכון מתנדב (כולל השבתה - מחיקה רכה)
router.patch('/:id', asyncHandler(async (req, res) => {
  const allowed = ['customer_id', 'first_name', 'last_name', 'phone', 'email', 'area_id', 'linked_meal_id', 'has_vehicle', 'is_regular', 'is_active', 'notes'];
  const patch = {};
  for (const k of allowed) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }
  if ('customer_id' in patch) patch.customer_id = patch.customer_id || null;
  const volunteerAreaIds = Array.isArray(req.body?.area_ids)
    ? normalizedAreaIds(req.body.area_ids)
    : ('area_id' in patch ? normalizedAreaIds(null, patch.area_id) : null);
  if (volunteerAreaIds) {
    const areaError = await validateAreaIds(volunteerAreaIds);
    if (areaError) return fail(res, 400, areaError);
    patch.area_id = volunteerAreaIds[0];
  }
  if ('first_name' in patch) {
    patch.first_name = String(patch.first_name || '').trim();
    if (!patch.customer_id && !patch.first_name) return fail(res, 400, 'שם פרטי לא יכול להיות ריק.');
  }
  if ('last_name' in patch) patch.last_name = patch.last_name ? String(patch.last_name).trim() : null;
  if ('phone' in patch) patch.phone = patch.phone ? String(patch.phone).trim() : null;
  if ('email' in patch) patch.email = patch.email ? String(patch.email).trim() : null;
  if ('notes' in patch) patch.notes = patch.notes ? String(patch.notes).trim() : null;
  const syncMeals = Array.isArray(req.body?.meal_ids);
  const syncAreas = Array.isArray(volunteerAreaIds);
  // כשמסנכרנים מאכלים, משאירים את linked_meal_id הבודד מסונכרן עם המאכל הראשי
  // (תאימות לאחור + התצוגה בטבלה). דריסה ידנית של linked_meal_id ב-body מכובדת.
  if (syncMeals && !('linked_meal_id' in patch)) {
    patch.linked_meal_id = req.body.meal_ids.filter(Boolean)[0] || null;
  }
  if (Object.keys(patch).length === 0 && !syncMeals && !syncAreas) return fail(res, 400, 'אין שדות לעדכון.');

  // אם אין שדות עמודה לעדכן אבל כן צריך לסנכרן קישורים - שולפים את המתנדב בלבד.
  const query = Object.keys(patch).length
    ? supabase.from('volunteers').update(patch).eq('id', req.params.id).select(VOLUNTEER_SELECT).maybeSingle()
    : supabase.from('volunteers').select(VOLUNTEER_SELECT).eq('id', req.params.id).maybeSingle();
  const { data, error } = await query;
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'לקוח זה כבר מקושר למתנדב.');
    throw error;
  }
  if (!data) return fail(res, 404, 'מתנדב לא נמצא.');
  if (syncAreas) await syncVolunteerAreas(data.id, volunteerAreaIds);
  if (syncMeals) await syncVolunteerMeals(data.id, req.body.meal_ids);
  const mealLinks = syncMeals ? req.body.meal_ids.map((meal_id) => ({ meal_id })) : data.volunteer_meal_links;
  res.json({ ok: true, volunteer: withLinks({
    ...data,
    volunteer_area_links: syncAreas
      ? volunteerAreaIds.map((value) => ({ area_id: value }))
      : data.volunteer_area_links,
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

// GET /api/admin/volunteers/tasks - רשימת משימות קבועות
router.get('/tasks', asyncHandler(async (req, res) => {
  let q = supabase
    .from('volunteer_tasks')
    .select('*, meals:linked_meal_id (id, name), area:area_id (id, name, is_cooking, display_order), volunteer_task_links (volunteer_id, role, priority, volunteers:volunteer_id (id, full_name, phone, area_id, is_active))')
    .order('display_order').order('name');
  if (req.query.active === 'true') q = q.eq('is_active', true);

  const { data, error } = await q;
  if (error) throw error;
  res.json((data || []).map(withStaffing));
}));

// POST /api/admin/volunteers/tasks - יצירת משימה קבועה
router.post('/tasks', asyncHandler(async (req, res) => {
  const { name, area_id, linked_meal_id, execution_day = 'general', shift = null, timing_note, display_order } = req.body || {};
  if (!name?.trim()) return fail(res, 400, 'חובה להזין שם משימה.');
  if (!area_id) return fail(res, 400, 'חובה לבחור תחום.');
  const areaError = await validateAreaIds([area_id]);
  if (areaError) return fail(res, 400, 'תחום משימה לא תקין.');
  if (!DAYS.includes(execution_day)) return fail(res, 400, 'יום ביצוע לא תקין.');
  if (!SHIFTS.includes(shift || null)) return fail(res, 400, 'משמרת לא תקינה.');
  const staffing = staffingPayload(req.body);
  if (staffing.error) return fail(res, 400, staffing.error);

  const { data, error } = await supabase.from('volunteer_tasks').insert({
    name: name.trim(),
    area_id,
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

// PATCH /api/admin/volunteers/tasks/:id - עדכון משימה קבועה
router.patch('/tasks/:id', asyncHandler(async (req, res) => {
  const allowed = ['name', 'area_id', 'linked_meal_id', 'execution_day', 'shift', 'timing_note', 'display_order', 'is_active'];
  const patch = {};
  for (const k of allowed) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }
  if ('area_id' in patch) {
    if (!patch.area_id) return fail(res, 400, 'חובה לבחור תחום.');
    const areaError = await validateAreaIds([patch.area_id]);
    if (areaError) return fail(res, 400, 'תחום משימה לא תקין.');
  }
  if ('execution_day' in patch && !DAYS.includes(patch.execution_day)) return fail(res, 400, 'יום ביצוע לא תקין.');
  if ('shift' in patch) patch.shift = patch.shift || null;
  if ('shift' in patch && !SHIFTS.includes(patch.shift)) return fail(res, 400, 'משמרת לא תקינה.');
  if ('name' in patch && !patch.name?.trim()) return fail(res, 400, 'שם משימה לא יכול להיות ריק.');
  if ('timing_note' in patch) patch.timing_note = String(patch.timing_note || '').trim() || null;
  const hasStaffing = ['primary_volunteer_id', 'backup_volunteer_ids'].some((key) => key in (req.body || {}));
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
