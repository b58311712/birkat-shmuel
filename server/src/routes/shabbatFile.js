// תיק שבת - מסך העבודה המרכזי לניהול (סעיף 9). מאחורי אימות מנהל.
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { requireRole } from '../lib/auth.js';
import {
  buildSummary,
  buildKitchenReport,
  buildPackingReport,
  buildTransportReport,
  buildInventoryReport,
  buildVolunteerReport,
  buildWorkFile,
} from '../services/shabbatFile.js';
import {
  overrideTaskLead,
  clearOverride,
  overrideMealCook,
  clearMealOverride,
} from '../services/volunteerScheduling.js';
import { HDate } from '@hebcal/core';
import { parashaForDate } from '../lib/parasha.js';

const router = Router();
const SHABBAT_STATUSES = ['open', 'closed', 'completed', 'cancelled'];

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBefore(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function auditDelete(req, entityType, entityId, details = null) {
  const { error } = await supabase.from('audit_log').insert({
    entity_type: entityType,
    entity_id: entityId,
    action: 'delete',
    actor_id: req.appUser?.sub || null,
    details,
  });
  if (error) throw error;
}

async function deleteOrder(orderId) {
  await Promise.all([
    supabase.from('customer_payments').delete().eq('order_id', orderId),
    supabase.from('order_refunds').delete().eq('order_id', orderId),
  ]);
  return supabase.from('orders').delete().eq('id', orderId).select('id').maybeSingle();
}

// GET /api/admin/shabbat-files - רשימת שבתות עם ספירת הזמנות (לבחירת תיק)
router.get('/', asyncHandler(async (req, res) => {
  const { data: shabbatot, error } = await supabase
    .from('shabbatot')
    .select('id, parasha, hebrew_date, gregorian_date, status, payment_deadline')
    .order('gregorian_date', { ascending: false });
  if (error) throw error;

  // ספירת הזמנות פעילות לכל שבת (לא מבוטלות) - לתצוגה ברשימה
  const { data: counts, error: cErr } = await supabase
    .from('orders')
    .select('shabbat_id, order_status');
  if (cErr) throw cErr;

  const countByShabbat = {};
  for (const o of counts || []) {
    if (o.order_status === 'cancelled') continue;
    countByShabbat[o.shabbat_id] = (countByShabbat[o.shabbat_id] || 0) + 1;
  }

  res.json((shabbatot || []).map((s) => ({ ...s, order_count: countByShabbat[s.id] || 0 })));
}));

// POST /api/admin/shabbat-files - הוספה ידנית של שבת לרשימה.
// הפרשה והתאריך העברי מחושבים מהלוח כאשר המנהל לא הזין שם ידני.
router.post('/', asyncHandler(async (req, res) => {
  const gregorianDate = String(req.body?.gregorian_date || '').trim();
  const requestedParasha = String(req.body?.parasha || '').trim();
  const status = String(req.body?.status || 'open').trim();
  const requestedDeadline = String(req.body?.payment_deadline || '').trim();

  if (!isIsoDate(gregorianDate)) return fail(res, 400, 'נא לבחור תאריך תקין.');
  const selectedDate = new Date(`${gregorianDate}T12:00:00Z`);
  if (selectedDate.getUTCDay() !== 6) return fail(res, 400, 'תאריך השבת חייב לחול ביום שבת.');
  if (!SHABBAT_STATUSES.includes(status)) return fail(res, 400, 'סטטוס שבת לא תקין.');
  if (requestedDeadline && !isIsoDate(requestedDeadline)) return fail(res, 400, 'מועד התשלום אינו תאריך תקין.');
  if (requestedDeadline && requestedDeadline > gregorianDate) {
    return fail(res, 400, 'מועד התשלום חייב להיות לפני תאריך השבת או באותו יום.');
  }

  const parasha = requestedParasha || parashaForDate(gregorianDate);
  if (!parasha) {
    return fail(res, 400, 'לא נמצאה פרשת שבוע לתאריך זה. בחג או במועד יש להזין שם שבת ידני.');
  }

  const hebrewDate = new HDate(selectedDate).renderGematriya();
  const paymentDeadline = requestedDeadline || daysBefore(gregorianDate, 7);
  const { data, error } = await supabase
    .from('shabbatot')
    .insert({
      gregorian_date: gregorianDate,
      parasha,
      hebrew_date: hebrewDate,
      status,
      payment_deadline: paymentDeadline,
    })
    .select('id, parasha, hebrew_date, gregorian_date, status, payment_deadline')
    .single();

  if (error?.code === '23505') return fail(res, 409, 'כבר קיימת שבת בתאריך הזה.');
  if (error) throw error;

  await supabase.from('audit_log').insert({
    entity_type: 'shabbat',
    entity_id: data.id,
    action: 'create',
    actor_id: req.appUser?.sub || null,
    details: { gregorian_date: gregorianDate, parasha, status },
  });

  res.status(201).json({ ...data, order_count: 0 });
}));

// PATCH /api/admin/shabbat-files/:id/status -- שינוי סטטוס שבת על ידי מנהל/רכז (סעיף 8.4)
router.patch('/:id/status', asyncHandler(async (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (!SHABBAT_STATUSES.includes(status)) return fail(res, 400, 'סטטוס שבת לא תקין.');

  const { data, error } = await supabase
    .from('shabbatot')
    .update({ status })
    .eq('id', req.params.id)
    .select('id, parasha, hebrew_date, gregorian_date, status, payment_deadline, notes')
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');

  await supabase.from('audit_log').insert({
    entity_type: 'shabbat',
    entity_id: req.params.id,
    action: 'update',
    actor_id: req.appUser?.sub || null,
    details: { status },
  });

  res.json({ ok: true, shabbat: data });
}));

// DELETE /api/admin/shabbat-files/:id -- developer hard delete of a shabbat and its work file.
router.delete('/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const shabbatId = req.params.id;
  const { data: shabbat, error: getErr } = await supabase
    .from('shabbatot')
    .select('id')
    .eq('id', shabbatId)
    .maybeSingle();
  if (getErr) throw getErr;
  if (!shabbat) return fail(res, 404, 'שבת לא נמצאה.');

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id')
    .eq('shabbat_id', shabbatId);
  if (ordersErr) throw ordersErr;

  for (const order of orders || []) {
    const del = await deleteOrder(order.id);
    if (del.error) throw del.error;
  }

  const cleanup = await Promise.all([
    supabase.from('inventory_movements').delete().eq('shabbat_id', shabbatId),
    supabase.from('shabbat_files').delete().eq('shabbat_id', shabbatId),
  ]);
  const cleanupErr = cleanup.find((r) => r.error)?.error;
  if (cleanupErr) throw cleanupErr;

  const { error } = await supabase.from('shabbatot').delete().eq('id', shabbatId);
  if (error) throw error;
  await auditDelete(req, 'shabbat', shabbatId, { deleted_orders: (orders || []).length });
  res.json({ ok: true });
}));

// GET /api/admin/shabbat-files/:id/summary - לשונית סיכום שבת (סעיף 9.2)
router.get('/:id/summary', asyncHandler(async (req, res) => {
  const data = await buildSummary(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/kitchen - לשונית כמויות ומטבח (סעיף 9.4, 21)
router.get('/:id/kitchen', asyncHandler(async (req, res) => {
  const data = await buildKitchenReport(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/packing - לשונית אריזה (סעיף 9.6)
router.get('/:id/packing', asyncHandler(async (req, res) => {
  const data = await buildPackingReport(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/inventory - לשונית מלאי וחוסרים (סעיף 9.5, 26)
router.get('/:id/inventory', asyncHandler(async (req, res) => {
  const data = await buildInventoryReport(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/transport - לשונית שינוע (סעיף 9.7)
router.get('/:id/transport', asyncHandler(async (req, res) => {
  const data = await buildTransportReport(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/volunteers - לשונית מתנדבים (סעיף 9.8, 24)
router.get('/:id/volunteers', asyncHandler(async (req, res) => {
  const data = await buildVolunteerReport(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/workfile - תיק עבודה מרוכז להדפסה (סעיף 9.9, 33)
router.get('/:id/workfile', asyncHandler(async (req, res) => {
  const data = await buildWorkFile(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// POST /api/admin/shabbat-files/:id/volunteers/auto-assign - רענון הדוח (חישוב חי)
// אין יותר snapshot: השיבוץ מחושב בכל טעינה, אז זה פשוט מחזיר את הדוח המעודכן.
router.post('/:id/volunteers/auto-assign', asyncHandler(async (req, res) => {
  const data = await buildVolunteerReport(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json({ ok: true, refreshed: data.tasks.length });
}));

// POST /api/admin/shabbat-files/:id/volunteers/assign - דריסת המתנדב הקבוע למשימה
// בשבת זו (למשל אם הקבוע חולה). volunteer_id ריק = הסרת דריסה (חזרה לקבוע).
router.post('/:id/volunteers/assign', asyncHandler(async (req, res) => {
  const { task_id, volunteer_id } = req.body || {};
  if (!task_id) return fail(res, 400, 'חובה לבחור משימה.');
  if (!volunteer_id) {
    await clearOverride(req.params.id, task_id);
    return res.json({ ok: true });
  }
  const result = await overrideTaskLead(req.params.id, task_id, volunteer_id);
  res.json({ ok: true, assignment_id: result?.id || null });
}));

// POST /api/admin/shabbat-files/:id/volunteers/tasks/:taskId/reset - הסרת דריסה
// המשימה חוזרת למתנדב הקבוע מהתבנית.
router.post('/:id/volunteers/tasks/:taskId/reset', asyncHandler(async (req, res) => {
  await clearOverride(req.params.id, req.params.taskId);
  res.json({ ok: true });
}));

// POST /api/admin/shabbat-files/:id/volunteers/meals/:mealId/assign - שיבוץ מבשל
// מחליף למאכל בשבת זו (מתוך רשימת המתנדבים הכללית). volunteer_id ריק = הסרת המחליף.
router.post('/:id/volunteers/meals/:mealId/assign', asyncHandler(async (req, res) => {
  const { volunteer_id } = req.body || {};
  if (!volunteer_id) {
    await clearMealOverride(req.params.id, req.params.mealId);
    return res.json({ ok: true });
  }
  const result = await overrideMealCook(req.params.id, req.params.mealId, volunteer_id);
  res.json({ ok: true, assignment_id: result?.id || null });
}));

// POST /api/admin/shabbat-files/:id/volunteers/meals/:mealId/reset - הסרת דריסת מבשל
// המאכל חוזר למבשלים הקבועים.
router.post('/:id/volunteers/meals/:mealId/reset', asyncHandler(async (req, res) => {
  await clearMealOverride(req.params.id, req.params.mealId);
  res.json({ ok: true });
}));

// PATCH /api/admin/shabbat-files/:id/notes - עדכון הערות תיק שבת
router.patch('/:id/notes', asyncHandler(async (req, res) => {
  const { notes } = req.body;
  const { error } = await supabase
    .from('shabbatot').update({ notes: notes ?? null }).eq('id', req.params.id);
  if (error) throw error;
  res.json({ ok: true });
}));

export default router;
