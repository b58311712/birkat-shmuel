import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { sendTemplateEmail } from './email.js';
import { feedbackTargetDate, isFeedbackRunDue } from './feedbackScheduling.js';

const TOKEN_DAYS = 30;

export function hashFeedbackToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function clientOrigin() {
  return String(process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
}

async function ensureFeedbackRow(orderId) {
  const { data, error } = await supabase
    .from('order_feedback')
    .upsert({ order_id: orderId }, { onConflict: 'order_id', ignoreDuplicates: true })
    .select('id, order_id, status, send_attempts')
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const existing = await supabase
    .from('order_feedback')
    .select('id, order_id, status, send_attempts')
    .eq('order_id', orderId)
    .single();
  if (existing.error) throw existing.error;
  return existing.data;
}

async function claimForSending(feedbackId, tokenHash, expiresAt) {
  const { data, error } = await supabase
    .from('order_feedback')
    .update({
      status: 'sending',
      token_hash: tokenHash,
      token_expires_at: expiresAt,
      last_send_error: null,
    })
    .eq('id', feedbackId)
    .in('status', ['pending', 'failed'])
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function sendDueFeedbackRequests({ now = new Date(), force = false } = {}) {
  if (!force && !isFeedbackRunDue(now)) {
    return { skipped: true, reason: 'not_due', target_date: feedbackTargetDate(now) };
  }

  const targetDate = feedbackTargetDate(now);
  const staleSendingBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  await supabase
    .from('order_feedback')
    .update({ status: 'failed', last_send_error: 'stale_sending_recovered' })
    .eq('status', 'sending')
    .lt('updated_at', staleSendingBefore);

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_number, order_status, customers(full_name, email), shabbatot!inner(parasha, gregorian_date)')
    .eq('order_status', 'approved')
    .eq('shabbatot.gregorian_date', targetDate);
  if (error) throw error;

  const eligible = (orders || []).filter((order) => order.shabbatot?.gregorian_date === targetDate);
  const result = {
    skipped: false,
    target_date: targetDate,
    total: eligible.length,
    sent: 0,
    dry_run: 0,
    failed: 0,
    no_email: 0,
    already_processed: 0,
  };

  for (const order of eligible) {
    if (!order.customers?.email) {
      result.no_email++;
      continue;
    }

    const feedback = await ensureFeedbackRow(order.id);
    if (!['pending', 'failed'].includes(feedback.status)) {
      result.already_processed++;
      continue;
    }

    // If delivery succeeded but the final feedback status update was interrupted,
    // trust the durable email log and do not send the same invitation twice.
    const priorDelivery = await supabase
      .from('email_log')
      .select('created_at')
      .eq('order_id', order.id)
      .eq('template_code', 'feedback_request')
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorDelivery.error) throw priorDelivery.error;
    if (priorDelivery.data) {
      const recovered = await supabase
        .from('order_feedback')
        .update({ status: 'sent', sent_at: priorDelivery.data.created_at, last_send_error: null })
        .eq('id', feedback.id)
        .in('status', ['pending', 'failed']);
      if (recovered.error) throw recovered.error;
      result.already_processed++;
      continue;
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashFeedbackToken(token);
    const expiresAt = new Date(now.getTime() + TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const claimed = await claimForSending(feedback.id, tokenHash, expiresAt);
    if (!claimed) {
      result.already_processed++;
      continue;
    }

    const feedbackUrl = `${clientOrigin()}/feedback/${encodeURIComponent(token)}`;
    const sendResult = await sendTemplateEmail({
      code: 'feedback_request',
      to: order.customers.email,
      orderId: order.id,
      vars: {
        customer_name: order.customers.full_name || '',
        order_number: order.order_number,
        parasha: order.shabbatot?.parasha || '',
        feedback_url: feedbackUrl,
      },
    });

    const sent = sendResult?.status === 'sent';
    const dryRun = sendResult?.status === 'dry_run';
    const finalUpdate = await supabase
      .from('order_feedback')
      .update({
        status: sent ? 'sent' : 'failed',
        sent_at: sent ? new Date().toISOString() : null,
        last_send_error: sent ? null : (dryRun ? 'dry_run' : 'email_send_failed'),
        send_attempts: feedback.send_attempts ? Number(feedback.send_attempts) + 1 : 1,
      })
      .eq('id', feedback.id)
      .eq('status', 'sending');
    if (finalUpdate.error) throw finalUpdate.error;

    if (sent) result.sent++;
    else if (dryRun) result.dry_run++;
    else result.failed++;
  }

  return result;
}
