import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { createAdminNotification } from '../services/adminNotifications.js';
import { hashFeedbackToken } from '../services/feedback.js';

const router = Router();
const RATINGS = ['overall_rating', 'food_rating', 'quantity_rating', 'delivery_rating'];

async function loadByToken(token) {
  if (!token || String(token).length < 32) return null;
  const { data, error } = await supabase
    .from('order_feedback')
    .select('id, order_id, status, token_expires_at, overall_rating, food_rating, quantity_rating, delivery_rating, comment, completed_at, orders(order_number, customers(full_name), shabbatot(parasha, hebrew_date, gregorian_date))')
    .eq('token_hash', hashFeedbackToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!data || !['sent', 'completed'].includes(data.status)) return null;
  if (!data.token_expires_at || new Date(data.token_expires_at).getTime() <= Date.now()) return null;
  return data;
}

function publicPayload(row) {
  return {
    order_number: row.orders?.order_number,
    customer_name: row.orders?.customers?.full_name || '',
    shabbat: row.orders?.shabbatot || null,
    response: row.completed_at ? {
      overall_rating: row.overall_rating,
      food_rating: row.food_rating,
      quantity_rating: row.quantity_rating,
      delivery_rating: row.delivery_rating,
      comment: row.comment || '',
      completed_at: row.completed_at,
    } : null,
    expires_at: row.token_expires_at,
  };
}

router.get('/:token', asyncHandler(async (req, res) => {
  const feedback = await loadByToken(req.params.token);
  if (!feedback) return fail(res, 404, 'הקישור אינו תקף או שפג תוקפו.');
  res.json(publicPayload(feedback));
}));

router.put('/:token', asyncHandler(async (req, res) => {
  const feedback = await loadByToken(req.params.token);
  if (!feedback) return fail(res, 404, 'הקישור אינו תקף או שפג תוקפו.');

  const update = {};
  for (const field of RATINGS) {
    const value = Number(req.body?.[field]);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      return fail(res, 400, 'יש לתת ציון בין 1 ל־5 בכל הסעיפים.');
    }
    update[field] = value;
  }
  const comment = String(req.body?.comment || '').trim();
  if (comment.length > 3000) return fail(res, 400, 'ההערה ארוכה מדי.');

  let isFirstSubmission = false;
  let completedAt = feedback.completed_at;
  let data;
  if (!feedback.completed_at) {
    completedAt = new Date().toISOString();
    const first = await supabase
      .from('order_feedback')
      .update({ ...update, comment: comment || null, status: 'completed', completed_at: completedAt })
      .eq('id', feedback.id)
      .is('completed_at', null)
      .select('id')
      .maybeSingle();
    if (first.error) throw first.error;
    data = first.data;
    isFirstSubmission = Boolean(data);
  }

  if (!isFirstSubmission) {
    const saved = await supabase
      .from('order_feedback')
      .update({ ...update, comment: comment || null, status: 'completed' })
      .eq('id', feedback.id)
      .select('id, completed_at')
      .single();
    if (saved.error) throw saved.error;
    data = saved.data;
    completedAt = saved.data.completed_at;
  }

  if (isFirstSubmission) {
    const low = update.overall_rating <= 2;
    await createAdminNotification({
      notification_type: low ? 'low_feedback' : 'new_feedback',
      entity_table: 'order_feedback',
      entity_id: data.id,
      title: low ? 'משוב נמוך דורש טיפול' : 'התקבל משוב חדש',
      body: `הזמנה ${feedback.orders?.order_number} · ציון כללי ${update.overall_rating}/5`,
      link_path: `/admin/orders/${feedback.order_id}`,
    });
  }

  res.json({ ok: true, completed_at: completedAt });
}));

export default router;
