// ניהול נוסחי מייל + יומן שליחה (סעיף 18, 3 — דינמיות)
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { isDryRun } from '../services/email.js';

const router = Router();

// GET /api/admin/email/templates — כל נוסחי המייל
router.get('/templates', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('email_templates').select('*').order('code');
  if (error) throw error;
  res.json({ templates: data || [], dry_run: isDryRun() });
}));

// PUT /api/admin/email/templates/:code — עדכון נוסח (נושא/גוף/פעיל)
router.put('/templates/:code', asyncHandler(async (req, res) => {
  const { subject, body, is_active } = req.body;
  if (subject != null && !String(subject).trim()) return fail(res, 400, 'נושא המייל אינו יכול להיות ריק.');
  if (body != null && !String(body).trim()) return fail(res, 400, 'גוף המייל אינו יכול להיות ריק.');

  const patch = { updated_by: req.appUser?.sub || null };
  if (subject != null) patch.subject = subject;
  if (body != null) patch.body = body;
  if (is_active != null) patch.is_active = !!is_active;

  const { data, error } = await supabase
    .from('email_templates').update(patch)
    .eq('code', req.params.code).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'הנוסח לא נמצא.');
  res.json({ ok: true, template: data });
}));

// GET /api/admin/email/log — יומן שליחה אחרון (סעיף 18)
router.get('/log', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { data, error } = await supabase
    .from('email_log').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  res.json({ log: data || [], dry_run: isDryRun() });
}));

export default router;
