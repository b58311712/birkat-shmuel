// תיק שבת — מסך העבודה המרכזי לניהול (סעיף 9). מאחורי אימות מנהל.
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
  autoAssignCooking,
} from '../services/shabbatFile.js';

const router = Router();

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

// GET /api/admin/shabbat-files — רשימת שבתות עם ספירת הזמנות (לבחירת תיק)
router.get('/', asyncHandler(async (req, res) => {
  const { data: shabbatot, error } = await supabase
    .from('shabbatot')
    .select('id, parasha, hebrew_date, gregorian_date, status, payment_deadline')
    .order('gregorian_date', { ascending: false });
  if (error) throw error;

  // ספירת הזמנות פעילות לכל שבת (לא מבוטלות) — לתצוגה ברשימה
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

// GET /api/admin/shabbat-files/:id/summary — לשונית סיכום שבת (סעיף 9.2)
router.get('/:id/summary', asyncHandler(async (req, res) => {
  const data = await buildSummary(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/kitchen — לשונית כמויות ומטבח (סעיף 9.4, 21)
router.get('/:id/kitchen', asyncHandler(async (req, res) => {
  const data = await buildKitchenReport(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/packing — לשונית אריזה (סעיף 9.6)
router.get('/:id/packing', asyncHandler(async (req, res) => {
  const data = await buildPackingReport(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/inventory — לשונית מלאי וחוסרים (סעיף 9.5, 26)
router.get('/:id/inventory', asyncHandler(async (req, res) => {
  const data = await buildInventoryReport(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/transport — לשונית שינוע (סעיף 9.7)
router.get('/:id/transport', asyncHandler(async (req, res) => {
  const data = await buildTransportReport(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/volunteers — לשונית מתנדבים (סעיף 9.8, 24)
router.get('/:id/volunteers', asyncHandler(async (req, res) => {
  const data = await buildVolunteerReport(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// GET /api/admin/shabbat-files/:id/workfile — תיק עבודה מרוכז להדפסה (סעיף 9.9, 33)
router.get('/:id/workfile', asyncHandler(async (req, res) => {
  const data = await buildWorkFile(req.params.id);
  if (!data) return fail(res, 404, 'שבת לא נמצאה.');
  res.json(data);
}));

// POST /api/admin/shabbat-files/:id/volunteers/auto-assign — שיבוץ בישול אוטומטי (סעיף 24.2)
router.post('/:id/volunteers/auto-assign', asyncHandler(async (req, res) => {
  const result = await autoAssignCooking(req.params.id);
  res.json(result);
}));

// POST /api/admin/shabbat-files/:id/volunteers/assign — שיבוץ ידני של מתנדב למשימה
router.post('/:id/volunteers/assign', asyncHandler(async (req, res) => {
  const { task_id, volunteer_id, notes } = req.body || {};
  if (!volunteer_id) return fail(res, 400, 'חובה לבחור מתנדב.');

  // מניעת כפילות: אותו מתנדב לאותה משימה באותה שבת
  if (task_id) {
    const { data: dup } = await supabase
      .from('volunteer_assignments')
      .select('id')
      .eq('shabbat_id', req.params.id)
      .eq('task_id', task_id)
      .eq('volunteer_id', volunteer_id)
      .maybeSingle();
    if (dup) return fail(res, 409, 'המתנדב כבר משובץ למשימה זו.');
  }

  const { data, error } = await supabase
    .from('volunteer_assignments')
    .insert({
      shabbat_id: req.params.id,
      task_id: task_id || null,
      volunteer_id,
      is_auto: false,
      notes: notes || null,
    })
    .select('id')
    .single();
  if (error) throw error;
  res.json({ ok: true, assignment_id: data.id });
}));

// DELETE /api/admin/shabbat-files/:id/volunteers/assign/:assignmentId — ביטול שיבוץ
router.delete('/:id/volunteers/assign/:assignmentId', asyncHandler(async (req, res) => {
  const { error } = await supabase
    .from('volunteer_assignments')
    .delete()
    .eq('id', req.params.assignmentId)
    .eq('shabbat_id', req.params.id); // אבטחה: השיבוץ שייך לשבת הזו
  if (error) throw error;
  res.json({ ok: true });
}));

// PATCH /api/admin/shabbat-files/:id/notes — עדכון הערות תיק שבת
router.patch('/:id/notes', asyncHandler(async (req, res) => {
  const { notes } = req.body;
  const { error } = await supabase
    .from('shabbatot').update({ notes: notes ?? null }).eq('id', req.params.id);
  if (error) throw error;
  res.json({ ok: true });
}));

export default router;
