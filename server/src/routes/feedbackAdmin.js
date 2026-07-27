import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/helpers.js';

const router = Router();

function feedbackStatus(order) {
  const feedback = Array.isArray(order.order_feedback) ? order.order_feedback[0] : order.order_feedback;
  if (!order.customers?.email) return 'no_email';
  if (!feedback) return 'pending';
  if (feedback.status === 'completed') return 'completed';
  if (feedback.status === 'failed') return 'failed';
  if (feedback.status === 'sent') return 'sent';
  return 'pending';
}

router.get('/', asyncHandler(async (req, res) => {
  let query = supabase
    .from('orders')
    .select('id, order_number, order_status, customer_id, shabbat_id, customers(full_name, email), shabbatot!inner(parasha, hebrew_date, gregorian_date), order_feedback(id, status, send_attempts, last_send_error, sent_at, token_expires_at, overall_rating, food_rating, quantity_rating, delivery_rating, comment, completed_at, updated_at)')
    .eq('order_status', 'approved')
    .lte('shabbatot.gregorian_date', new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date()))
    .order('created_at', { ascending: false });

  if (req.query.shabbat_id) query = query.eq('shabbat_id', req.query.shabbat_id);
  const { data, error } = await query;
  if (error) throw error;

  let rows = (data || []).map((order) => ({
    ...order,
    feedback: Array.isArray(order.order_feedback) ? (order.order_feedback[0] || null) : order.order_feedback,
    feedback_status: feedbackStatus(order),
    order_feedback: undefined,
  }));
  if (req.query.status) rows = rows.filter((row) => row.feedback_status === req.query.status);
  if (req.query.rating) rows = rows.filter((row) => Number(row.feedback?.overall_rating) === Number(req.query.rating));
  if (req.query.order_id) rows = rows.filter((row) => row.id === req.query.order_id);

  res.json({ rows });
}));

export default router;
