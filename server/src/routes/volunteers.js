// ניהול מתנדבים ומשימות קבועות (סעיף 24). CRUD גלובלי, מאחורי אימות מנהל.
// השיבוץ לשבת ספציפית נעשה בנתיבי תיק שבת (routes/shabbatFile.js).
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

const AREAS = ['cooking', 'packing', 'transport', 'cleaning', 'general'];
const VOLUNTEER_SELECT = '*, meals:linked_meal_id (id, name), customers:customer_id (id, full_name, phone, email), volunteer_task_links (task_id)';

// שיוך מחדש של המשימות הקבועות למתנדב (סעיף 24): מוחקים הכל ומכניסים את הבחירה.
// task_ids = מערך מזהי משימות (או undefined כדי לא לגעת בשיוך הקיים).
async function syncVolunteerTasks(volunteerId, taskIds) {
  if (!Array.isArray(taskIds)) return;
  const unique = [...new Set(taskIds.filter(Boolean))];
  const { error: delErr } = await supabase
    .from('volunteer_task_links').delete().eq('volunteer_id', volunteerId);
  if (delErr) throw delErr;
  if (!unique.length) return;
  const { error: insErr } = await supabase
    .from('volunteer_task_links')
    .insert(unique.map((task_id) => ({ volunteer_id: volunteerId, task_id })));
  if (insErr) throw insErr;
}

// שיטוח volunteer_task_links למערך task_ids פשוט על אובייקט המתנדב.
function withTaskIds(volunteer) {
  if (!volunteer) return volunteer;
  const { volunteer_task_links, ...rest } = volunteer;
  return { ...rest, task_ids: (volunteer_task_links || []).map((l) => l.task_id) };
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

// ===========================================================================
// מתנדבים (סעיף 24.1)
// ===========================================================================

// GET /api/admin/volunteers?area=&active= — רשימת מתנדבים
router.get('/', asyncHandler(async (req, res) => {
  let q = supabase
    .from('volunteers')
    .select(VOLUNTEER_SELECT)
    .order('full_name');
  if (req.query.area) q = q.eq('area', req.query.area);
  if (req.query.active === 'true') q = q.eq('is_active', true);
  if (req.query.active === 'false') q = q.eq('is_active', false);

  const { data, error } = await q;
  if (error) throw error;
  res.json((data || []).map(withTaskIds));
}));

// POST /api/admin/volunteers — יצירת מתנדב
router.post('/', asyncHandler(async (req, res) => {
  const { full_name, phone, email, customer_id, area, linked_meal_id, has_vehicle, is_regular, notes, task_ids } = req.body || {};
  const linkedCustomerId = customer_id || null;
  if (!linkedCustomerId && !full_name?.trim()) return fail(res, 400, 'חובה להזין שם מלא.');
  if (!AREAS.includes(area)) return fail(res, 400, 'תחום התנדבות לא תקין.');

  const { data, error } = await supabase.from('volunteers').insert({
    customer_id: linkedCustomerId,
    full_name: full_name?.trim() || 'linked customer',
    phone: phone?.trim() || null,
    email: email?.trim() || null,
    area,
    linked_meal_id: linked_meal_id || null,
    has_vehicle: !!has_vehicle,
    is_regular: !!is_regular,
    notes: notes?.trim() || null,
  }).select(VOLUNTEER_SELECT).single();
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'לקוח זה כבר מקושר למתנדב.');
    throw error;
  }
  await syncVolunteerTasks(data.id, task_ids);
  res.json({ ok: true, volunteer: withTaskIds({ ...data, volunteer_task_links: (task_ids || []).map((task_id) => ({ task_id })) }) });
}));

// PATCH /api/admin/volunteers/:id — עדכון מתנדב (כולל השבתה — מחיקה רכה)
router.patch('/:id', asyncHandler(async (req, res) => {
  const allowed = ['customer_id', 'full_name', 'phone', 'email', 'area', 'linked_meal_id', 'has_vehicle', 'is_regular', 'is_active', 'notes'];
  const patch = {};
  for (const k of allowed) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }
  if ('customer_id' in patch) patch.customer_id = patch.customer_id || null;
  if ('area' in patch && !AREAS.includes(patch.area)) return fail(res, 400, 'תחום התנדבות לא תקין.');
  if ('full_name' in patch && !patch.customer_id && !patch.full_name?.trim()) return fail(res, 400, 'שם מלא לא יכול להיות ריק.');
  if ('full_name' in patch && patch.full_name) patch.full_name = patch.full_name.trim();
  if ('phone' in patch) patch.phone = patch.phone ? String(patch.phone).trim() : null;
  if ('email' in patch) patch.email = patch.email ? String(patch.email).trim() : null;
  if ('notes' in patch) patch.notes = patch.notes ? String(patch.notes).trim() : null;
  const syncTasks = Array.isArray(req.body?.task_ids);
  if (Object.keys(patch).length === 0 && !syncTasks) return fail(res, 400, 'אין שדות לעדכון.');

  // אם אין שדות עמודה לעדכן אבל כן צריך לסנכרן משימות — שולפים את המתנדב בלבד.
  const query = Object.keys(patch).length
    ? supabase.from('volunteers').update(patch).eq('id', req.params.id).select(VOLUNTEER_SELECT).maybeSingle()
    : supabase.from('volunteers').select(VOLUNTEER_SELECT).eq('id', req.params.id).maybeSingle();
  const { data, error } = await query;
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'לקוח זה כבר מקושר למתנדב.');
    throw error;
  }
  if (!data) return fail(res, 404, 'מתנדב לא נמצא.');
  if (syncTasks) await syncVolunteerTasks(data.id, req.body.task_ids);
  const links = syncTasks ? req.body.task_ids.map((task_id) => ({ task_id })) : data.volunteer_task_links;
  res.json({ ok: true, volunteer: withTaskIds({ ...data, volunteer_task_links: links }) });
}));

router.delete('/:id', requireRole('developer'), asyncHandler(async (req, res) => {
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
    .select('*, meals:linked_meal_id (id, name)')
    .order('display_order').order('name');
  if (req.query.active === 'true') q = q.eq('is_active', true);

  const { data, error } = await q;
  if (error) throw error;
  res.json(data);
}));

// POST /api/admin/volunteers/tasks — יצירת משימה קבועה
router.post('/tasks', asyncHandler(async (req, res) => {
  const { name, area, linked_meal_id, display_order } = req.body || {};
  if (!name?.trim()) return fail(res, 400, 'חובה להזין שם משימה.');
  if (!AREAS.includes(area)) return fail(res, 400, 'תחום משימה לא תקין.');

  const { data, error } = await supabase.from('volunteer_tasks').insert({
    name: name.trim(),
    area,
    linked_meal_id: linked_meal_id || null,
    display_order: Number.isFinite(Number(display_order)) ? Number(display_order) : 0,
  }).select('*').single();
  if (error) throw error;
  res.json({ ok: true, task: data });
}));

// PATCH /api/admin/volunteers/tasks/:id — עדכון משימה קבועה
router.patch('/tasks/:id', asyncHandler(async (req, res) => {
  const allowed = ['name', 'area', 'linked_meal_id', 'display_order', 'is_active'];
  const patch = {};
  for (const k of allowed) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }
  if ('area' in patch && !AREAS.includes(patch.area)) return fail(res, 400, 'תחום משימה לא תקין.');
  if ('name' in patch && !patch.name?.trim()) return fail(res, 400, 'שם משימה לא יכול להיות ריק.');
  if (Object.keys(patch).length === 0) return fail(res, 400, 'אין שדות לעדכון.');

  const { data, error } = await supabase.from('volunteer_tasks')
    .update(patch).eq('id', req.params.id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'משימה לא נמצאה.');
  res.json({ ok: true, task: data });
}));

router.delete('/tasks/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const cleanup = await supabase.from('volunteer_assignments').delete().eq('task_id', req.params.id);
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
