// ניהול הזמנות: אישור, ביטול, עדכון תשלום, דשבורד (סעיף 11, 30)
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { buildOrderItems } from '../services/orderItems.js';
import { normalizePhone, isValidPhone } from '../lib/helpers.js';
import { hashPassword, requireRole } from '../lib/auth.js';

const router = Router();

const USER_SELECT = 'id, full_name, email, phone, role, is_active, notes, last_login_at, created_at, updated_at';
const USER_ROLES = ['developer', 'manager', 'coordinator'];
const CUSTOMER_SELECT = 'id, full_name, phone, phone_normalized, email, address, status, internal_notes, created_at, updated_at';
const CUSTOMER_STATUSES = ['active', 'pending_approval', 'inactive', 'blocked'];

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicUser(user) {
  if (!user) return user;
  const { password_hash, ...safe } = user;
  return safe;
}

function cleanCustomerPayload(body, { partial = false } = {}) {
  const update = {};

  if (!partial || body.full_name !== undefined) {
    const full_name = String(body.full_name || '').trim();
    if (!full_name) return { error: 'נא להזין שם מלא.' };
    update.full_name = full_name;
  }

  if (!partial || body.phone !== undefined) {
    const phone = String(body.phone || '').trim();
    const phone_normalized = normalizePhone(phone);
    if (!isValidPhone(phone_normalized)) return { error: 'מספר טלפון לא תקין.' };
    update.phone = phone;
    update.phone_normalized = phone_normalized;
  }

  if (!partial || body.status !== undefined) {
    const status = body.status || 'active';
    if (!CUSTOMER_STATUSES.includes(status)) return { error: 'סטטוס לקוח לא תקין.' };
    update.status = status;
  }

  if (!partial || body.email !== undefined) update.email = body.email ? String(body.email).trim() : null;
  if (!partial || body.address !== undefined) update.address = body.address ? String(body.address).trim() : null;
  if (!partial || body.internal_notes !== undefined) {
    update.internal_notes = body.internal_notes ? String(body.internal_notes).trim() : null;
  }

  return { update };
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

async function markEntityNotificationsRead(entityTable, entityId) {
  const { error } = await supabase
    .from('admin_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('entity_table', entityTable)
    .eq('entity_id', entityId)
    .eq('is_read', false);
  if (error) throw error;
}

// GET /api/admin/notifications -- unread items for the admin notification bell.
router.get('/notifications', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('admin_notifications')
    .select('id, notification_type, entity_table, entity_id, title, body, link_path, created_at')
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) throw error;
  res.json({ total: data.length, items: data });
}));

// POST /api/admin/notifications/:id/read -- dismiss one notification after opening it.
router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('admin_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'ההתראה לא נמצאה.');
  res.json({ ok: true });
}));

// GET /api/admin/customers — רשימת לקוחות לניהול (סעיף 6)
router.get('/customers', asyncHandler(async (req, res) => {
  let q = supabase
    .from('customers')
    .select(CUSTOMER_SELECT)
    .order('created_at', { ascending: false });

  if (req.query.status) q = q.eq('status', req.query.status);
  if (req.query.search) {
    const s = String(req.query.search).trim();
    if (s) q = q.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,address.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  res.json(data || []);
}));

// POST /api/admin/customers — יצירת לקוח ידנית
router.post('/customers', asyncHandler(async (req, res) => {
  const cleaned = cleanCustomerPayload(req.body);
  if (cleaned.error) return fail(res, 400, cleaned.error);

  const { data, error } = await supabase
    .from('customers')
    .insert(cleaned.update)
    .select(CUSTOMER_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') return fail(res, 409, 'כבר קיים לקוח עם מספר הטלפון הזה.');
    throw error;
  }
  res.json({ ok: true, customer: data });
}));

// GET /api/admin/customers/:id — כרטיס לקוח + היסטוריית הזמנות
// POST /api/admin/customers/import -- CSV import after parsing in the browser.
router.post('/customers/import', asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return fail(res, 400, 'לא נמצאו לקוחות לייבוא.');
  if (rows.length > 1000) return fail(res, 400, 'ניתן לייבא עד 1,000 לקוחות בכל קובץ.');

  const skipped = [];
  const prepared = [];
  const seenPhones = new Set();

  rows.forEach((row, index) => {
    const cleaned = cleanCustomerPayload({
      full_name: row.full_name,
      phone: row.phone,
      email: row.email || null,
      address: row.address || null,
      status: row.status || 'active',
      internal_notes: row.internal_notes || null,
    });

    if (cleaned.error) {
      skipped.push({ row: index + 2, name: row.full_name || '', phone: row.phone || '', reason: cleaned.error });
      return;
    }

    if (seenPhones.has(cleaned.update.phone_normalized)) {
      skipped.push({ row: index + 2, name: cleaned.update.full_name, phone: cleaned.update.phone, reason: 'טלפון כפול בקובץ.' });
      return;
    }

    seenPhones.add(cleaned.update.phone_normalized);
    prepared.push({ row: index + 2, customer: cleaned.update });
  });

  if (!prepared.length) {
    return res.json({ ok: true, imported: 0, skipped: skipped.length, skipped_rows: skipped });
  }

  const phones = prepared.map((item) => item.customer.phone_normalized);
  const { data: existing, error: existingErr } = await supabase
    .from('customers')
    .select('phone_normalized')
    .in('phone_normalized', phones);
  if (existingErr) throw existingErr;

  const existingPhones = new Set((existing || []).map((customer) => customer.phone_normalized));
  const toInsert = [];
  prepared.forEach((item) => {
    if (existingPhones.has(item.customer.phone_normalized)) {
      skipped.push({ row: item.row, name: item.customer.full_name, phone: item.customer.phone, reason: 'לקוח עם הטלפון הזה כבר קיים.' });
    } else {
      toInsert.push(item.customer);
    }
  });

  let imported = 0;
  if (toInsert.length) {
    const { data, error } = await supabase
      .from('customers')
      .insert(toInsert)
      .select(CUSTOMER_SELECT);

    if (error) {
      if (error.code === '23505') return fail(res, 409, 'חלק מהלקוחות כבר קיימים. נא לרענן ולנסות שוב.');
      throw error;
    }
    imported = data?.length || 0;
  }

  res.json({ ok: true, imported, skipped: skipped.length, skipped_rows: skipped });
}));

router.get('/customers/:id', asyncHandler(async (req, res) => {
  const { data: customer, error } = await supabase
    .from('customers')
    .select(CUSTOMER_SELECT)
    .eq('id', req.params.id)
    .single();
  if (error) throw error;

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, order_number, order_status, payment_status, final_amount, created_at, shabbatot(parasha, gregorian_date)')
    .eq('customer_id', req.params.id)
    .order('created_at', { ascending: false });
  if (ordersErr) throw ordersErr;

  res.json({ customer, orders: orders || [] });
}));

// PATCH /api/admin/customers/:id — עריכת כרטיס לקוח והשבתה דרך סטטוס
router.patch('/customers/:id', asyncHandler(async (req, res) => {
  const cleaned = cleanCustomerPayload(req.body, { partial: true });
  if (cleaned.error) return fail(res, 400, cleaned.error);
  if (Object.keys(cleaned.update).length === 0) return fail(res, 400, 'אין שדות לעדכון.');

  const { data, error } = await supabase
    .from('customers')
    .update(cleaned.update)
    .eq('id', req.params.id)
    .select(CUSTOMER_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') return fail(res, 409, 'כבר קיים לקוח עם מספר הטלפון הזה.');
    throw error;
  }
  res.json({ ok: true, customer: data });
}));

// DELETE /api/admin/customers/:id -- developer hard delete, including customer orders.
router.delete('/customers/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const { data: customer, error: getErr } = await supabase
    .from('customers')
    .select('id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (getErr) throw getErr;
  if (!customer) return fail(res, 404, 'לקוח לא נמצא.');

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id')
    .eq('customer_id', req.params.id);
  if (ordersErr) throw ordersErr;

  for (const order of orders || []) {
    const del = await deleteOrder(order.id);
    if (del.error) throw del.error;
  }

  await supabase.from('customer_registration_requests')
    .delete()
    .eq('resulting_customer_id', req.params.id);

  const { error } = await supabase.from('customers').delete().eq('id', req.params.id);
  if (error) throw error;
  await auditDelete(req, 'customer', req.params.id, { deleted_orders: (orders || []).length });
  res.json({ ok: true });
}));

// GET /api/admin/users — ניהול משתמשי מערכת (סעיף 5, 34.27)
router.get('/users', requireRole('developer', 'manager'), asyncHandler(async (req, res) => {
  let q = supabase
    .from('app_users')
    .select(USER_SELECT)
    .order('created_at', { ascending: false });

  if (req.query.role) q = q.eq('role', req.query.role);
  if (req.query.active === 'true') q = q.eq('is_active', true);
  if (req.query.active === 'false') q = q.eq('is_active', false);
  if (req.query.search) {
    const s = String(req.query.search).trim();
    if (s) q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  res.json(data || []);
}));

// POST /api/admin/users — יצירת משתמש מערכת חדש
router.post('/users', requireRole('developer', 'manager'), asyncHandler(async (req, res) => {
  const full_name = String(req.body.full_name || '').trim();
  const email = cleanEmail(req.body.email);
  const phone = req.body.phone ? String(req.body.phone).trim() : null;
  const role = req.body.role || 'coordinator';
  const password = String(req.body.password || '');

  if (!full_name) return fail(res, 400, 'נא להזין שם מלא.');
  if (!email) return fail(res, 400, 'נא להזין אימייל.');
  if (!USER_ROLES.includes(role)) return fail(res, 400, 'תפקיד לא תקין.');
  if (password.length < 6) return fail(res, 400, 'סיסמה חייבת להכיל לפחות 6 תווים.');

  const password_hash = await hashPassword(password);
  const { data, error } = await supabase
    .from('app_users')
    .insert({
      full_name,
      email,
      phone,
      role,
      password_hash,
      is_active: req.body.is_active !== false,
      notes: req.body.notes || null,
    })
    .select(USER_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') return fail(res, 409, 'כבר קיים משתמש עם האימייל הזה.');
    throw error;
  }
  res.json({ ok: true, user: data });
}));

// PATCH /api/admin/users/:id — עדכון פרטי משתמש והשבתה במקום מחיקה
router.patch('/users/:id', requireRole('developer', 'manager'), asyncHandler(async (req, res) => {
  const update = {};

  if (req.body.full_name !== undefined) {
    const full_name = String(req.body.full_name || '').trim();
    if (!full_name) return fail(res, 400, 'שם מלא לא יכול להיות ריק.');
    update.full_name = full_name;
  }
  if (req.body.email !== undefined) {
    const email = cleanEmail(req.body.email);
    if (!email) return fail(res, 400, 'אימייל לא יכול להיות ריק.');
    update.email = email;
  }
  if (req.body.phone !== undefined) update.phone = req.body.phone ? String(req.body.phone).trim() : null;
  if (req.body.role !== undefined) {
    if (!USER_ROLES.includes(req.body.role)) return fail(res, 400, 'תפקיד לא תקין.');
    update.role = req.body.role;
  }
  if (req.body.notes !== undefined) update.notes = req.body.notes || null;
  if (req.body.is_active !== undefined) {
    if (req.params.id === req.appUser?.sub && req.body.is_active === false) {
      return fail(res, 409, 'לא ניתן להשבית את המשתמש המחובר.');
    }
    update.is_active = Boolean(req.body.is_active);
  }

  if (Object.keys(update).length === 0) return fail(res, 400, 'אין שדות לעדכון.');

  const { data, error } = await supabase
    .from('app_users')
    .update(update)
    .eq('id', req.params.id)
    .select(USER_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') return fail(res, 409, 'כבר קיים משתמש עם האימייל הזה.');
    throw error;
  }
  res.json({ ok: true, user: data });
}));

// POST /api/admin/users/:id/password — איפוס סיסמה פנימי
router.post('/users/:id/password', requireRole('developer', 'manager'), asyncHandler(async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 6) return fail(res, 400, 'סיסמה חייבת להכיל לפחות 6 תווים.');

  const password_hash = await hashPassword(password);
  const { data, error } = await supabase
    .from('app_users')
    .update({ password_hash })
    .eq('id', req.params.id)
    .select(USER_SELECT)
    .single();
  if (error) throw error;

  res.json({ ok: true, user: publicUser(data) });
}));

// DELETE /api/admin/users/:id -- developer hard delete.
router.delete('/users/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  if (req.params.id === req.appUser?.sub) {
    return fail(res, 409, 'לא ניתן למחוק את המשתמש המחובר.');
  }

  const { data: user, error: getErr } = await supabase
    .from('app_users')
    .select('id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (getErr) throw getErr;
  if (!user) return fail(res, 404, 'משתמש לא נמצא.');

  const userId = req.params.id;
  const nullRefs = [
    supabase.from('customer_registration_requests').update({ handled_by: null }).eq('handled_by', userId),
    supabase.from('orders').update({ approved_by: null }).eq('approved_by', userId),
    supabase.from('order_discounts').update({ created_by: null }).eq('created_by', userId),
    supabase.from('order_manual_charges').update({ created_by: null }).eq('created_by', userId),
    supabase.from('order_internal_notes').update({ created_by: null }).eq('created_by', userId),
    supabase.from('order_history').update({ changed_by: null }).eq('changed_by', userId),
    supabase.from('customer_payments').update({ recorded_by: null }).eq('recorded_by', userId),
    supabase.from('order_refunds').update({ approved_by: null }).eq('approved_by', userId),
    supabase.from('order_refunds').update({ executed_by: null }).eq('executed_by', userId),
    supabase.from('shabbat_files').update({ inventory_deducted_by: null }).eq('inventory_deducted_by', userId),
    supabase.from('purchase_orders').update({ created_by: null }).eq('created_by', userId),
    supabase.from('inventory_movements').update({ performed_by: null }).eq('performed_by', userId),
    supabase.from('general_expenses').update({ created_by: null }).eq('created_by', userId),
    supabase.from('system_settings').update({ updated_by: null }).eq('updated_by', userId),
    supabase.from('email_templates').update({ updated_by: null }).eq('updated_by', userId),
    supabase.from('audit_log').update({ actor_id: null }).eq('actor_id', userId),
  ];
  const results = await Promise.all(nullRefs);
  const refErr = results.find((r) => r.error)?.error;
  if (refErr) throw refErr;

  const { error } = await supabase.from('app_users').delete().eq('id', userId);
  if (error) throw error;
  await auditDelete(req, 'app_user', userId);
  res.json({ ok: true });
}));

// GET /api/admin/orders?status=&shabbat_id= — רשימת הזמנות לניהול (סעיף 9.3)
router.get('/orders', asyncHandler(async (req, res) => {
  let q = supabase
    .from('orders')
    .select('*, customers(full_name, phone), shabbatot(parasha, gregorian_date)')
    .order('created_at', { ascending: false });

  if (req.query.status) q = q.eq('order_status', req.query.status);
  if (req.query.shabbat_id) q = q.eq('shabbat_id', req.query.shabbat_id);

  const { data, error } = await q;
  if (error) throw error;
  res.json(data);
}));

// GET /api/admin/orders/:id — הזמנה מלאה לניהול, כולל כל שדות הטופס וההיסטוריה
router.get('/orders/:id', asyncHandler(async (req, res) => {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, customers(full_name, phone, email, address), shabbatot(parasha, hebrew_date, gregorian_date)')
    .eq('id', req.params.id).single();
  if (error) throw error;

  const [slots, meals, extras, discounts, manualCharges, history] = await Promise.all([
    supabase.from('order_meal_slots').select('*, meal_slots(name)').eq('order_id', order.id),
    supabase.from('order_meals').select('*').eq('order_id', order.id),
    supabase.from('order_extras').select('*').eq('order_id', order.id),
    supabase.from('order_discounts').select('*').eq('order_id', order.id).order('created_at', { ascending: true }),
    supabase.from('order_manual_charges').select('*').eq('order_id', order.id).order('created_at', { ascending: true }),
    supabase.from('order_history').select('*').eq('order_id', order.id).order('created_at', { ascending: false }),
  ]);

  res.json({
    ...order,
    slots: slots.data || [],
    meals: meals.data || [],
    extras: extras.data || [],
    discounts: discounts.data || [],
    manual_charges: manualCharges.data || [],
    history: history.data || [],
  });
}));

// DELETE /api/admin/orders/:id -- developer hard delete.
router.delete('/orders/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const { data, error } = await deleteOrder(req.params.id);
  if (error) throw error;
  if (!data) return fail(res, 404, 'הזמנה לא נמצאה.');
  await auditDelete(req, 'order', req.params.id);
  res.json({ ok: true });
}));

// PUT /api/admin/orders/:id — עריכה מלאה של הזמנה ע"י מנהל (שבת, אספקה, סעודות, מאכלים, תוספות)
// המחירים מחושבים מחדש בשרת מהמחירון הפעיל (כמו ביצירה). לא ניתן לערוך הזמנה מבוטלת.
router.put('/orders/:id', asyncHandler(async (req, res) => {
  const b = req.body;

  // --- טוענים את ההזמנה הקיימת ---
  const { data: order, error: getErr } = await supabase
    .from('orders').select('id, order_status, shabbat_id').eq('id', req.params.id).single();
  if (getErr) throw getErr;
  if (order.order_status === 'cancelled')
    return fail(res, 409, 'לא ניתן לערוך הזמנה מבוטלת.');

  // --- ולידציה בסיסית ---
  if (!Array.isArray(b.slots) || b.slots.length === 0)
    return fail(res, 400, 'יש לבחור לפחות סעודה אחת.');
  const shabbatId = b.shabbat_id || order.shabbat_id;

  // --- חישוב-מחדש של פריטי המשנה + סכומים (משותף עם יצירה) ---
  let built;
  try {
    built = await buildOrderItems({
      slots: b.slots,
      meals: b.meals,
      extras: b.extras,
      orderId: order.id,
      enforcePortionRange: true,
    });
  } catch (e) {
    if (e.userMessage) return fail(res, 400, e.userMessage);
    throw e;
  }
  const { slotRows, mealRows, extraRows, amounts } = built;

  // --- מוודאים שתיק שבת קיים אם השבת שונתה ---
  if (shabbatId !== order.shabbat_id) {
    const { data: existing } = await supabase
      .from('shabbat_files').select('id').eq('shabbat_id', shabbatId).maybeSingle();
    if (!existing) await supabase.from('shabbat_files').insert({ shabbat_id: shabbatId });
  }

  // --- עדכון שדות ראש ההזמנה + סכומים מחושבים ---
  const update = {
    shabbat_id: shabbatId,
    delivery_method: b.delivery_method || 'volunteer_transport',
    contact_name: b.contact_name ?? null,
    contact_phone: b.contact_phone ?? null,
    venue_address: b.venue_address ?? null,
    transport_notes: b.transport_notes ?? null,
    preferred_payment_method: b.preferred_payment_method || null,
    base_amount: amounts.base_amount,
    extras_amount: amounts.extras_amount,
    manual_charges_amount: amounts.manual_charges_amount,
    discount_amount: amounts.discount_amount,
    final_amount: amounts.final_amount,
  };
  const { error: updErr } = await supabase.from('orders').update(update).eq('id', order.id);
  if (updErr) throw updErr;

  // --- מחיקה ובנייה מחדש של פריטי המשנה ---
  await Promise.all([
    supabase.from('order_meal_slots').delete().eq('order_id', order.id),
    supabase.from('order_meals').delete().eq('order_id', order.id),
    supabase.from('order_extras').delete().eq('order_id', order.id),
  ]);
  await supabase.from('order_meal_slots').insert(slotRows.map((s) => ({ ...s, order_id: order.id })));
  if (mealRows.length)
    await supabase.from('order_meals').insert(mealRows.map((m) => ({ ...m, order_id: order.id })));
  if (extraRows.length)
    await supabase.from('order_extras').insert(extraRows.map((e) => ({ ...e, order_id: order.id })));

  await supabase.from('order_history').insert({
    order_id: order.id, changed_by: req.appUser?.sub || null,
    action: 'ההזמנה נערכה ע"י מנהל',
  });

  const { data: updated } = await supabase.from('orders').select('*').eq('id', order.id).single();
  res.json({ ok: true, order: updated });
}));

// PATCH /api/admin/orders/:id/customer — עדכון פרטי הלקוח של ההזמנה (שם/טלפון/דוא"ל/כתובת)
router.patch('/orders/:id/customer', asyncHandler(async (req, res) => {
  const { full_name, phone, email, address } = req.body;

  const { data: order, error: getErr } = await supabase
    .from('orders').select('customer_id').eq('id', req.params.id).single();
  if (getErr) throw getErr;

  const update = {};
  if (full_name !== undefined) {
    if (!full_name || !full_name.trim()) return fail(res, 400, 'שם הלקוח לא יכול להיות ריק.');
    update.full_name = full_name.trim();
  }
  if (phone !== undefined) {
    const normalized = normalizePhone(phone);
    if (!isValidPhone(normalized)) return fail(res, 400, 'מספר טלפון לא תקין.');
    update.phone = phone;
    update.phone_normalized = normalized;
  }
  if (email !== undefined) update.email = email || null;
  if (address !== undefined) update.address = address || null;

  if (Object.keys(update).length === 0) return fail(res, 400, 'אין שדות לעדכון.');

  const { data: customer, error } = await supabase
    .from('customers').update(update).eq('id', order.customer_id).select('*').single();
  if (error) throw error;

  await supabase.from('order_history').insert({
    order_id: req.params.id, changed_by: req.appUser?.sub || null,
    action: 'פרטי הלקוח עודכנו ע"י מנהל',
  });
  res.json({ ok: true, customer });
}));

// ---------------------------------------------------------------------------
// הנחות וחיובים ידניים בהזמנה (סעיף 16)
// ---------------------------------------------------------------------------

// מחשב מחדש את סכומי ההנחות/חיובים והסכום הסופי של ההזמנה מטבלאות המשנה.
// מקור אמת יחיד — נקרא אחרי כל הוספה/מחיקה של הנחה או חיוב.
async function recomputeOrderAmounts(orderId) {
  const [{ data: order }, { data: mc }, { data: dc }] = await Promise.all([
    supabase.from('orders').select('base_amount, extras_amount').eq('id', orderId).single(),
    supabase.from('order_manual_charges').select('amount').eq('order_id', orderId),
    supabase.from('order_discounts').select('discount_amount').eq('order_id', orderId),
  ]);
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const manualCharges = round2((mc || []).reduce((s, r) => s + Number(r.amount || 0), 0));
  const discounts = round2((dc || []).reduce((s, r) => s + Number(r.discount_amount || 0), 0));
  const finalAmount = round2(Math.max(0,
    Number(order.base_amount) + Number(order.extras_amount) + manualCharges - discounts));

  await supabase.from('orders').update({
    manual_charges_amount: manualCharges,
    discount_amount: discounts,
    final_amount: finalAmount,
  }).eq('id', orderId);

  return { manual_charges_amount: manualCharges, discount_amount: discounts, final_amount: finalAmount };
}

// טוען הזמנה ומוודא שאינה מבוטלת — הנחות/חיובים אסורים על הזמנה מבוטלת.
async function loadEditableOrder(res, orderId) {
  const { data: order, error } = await supabase
    .from('orders').select('id, order_status, base_amount, extras_amount').eq('id', orderId).single();
  if (error || !order) { fail(res, 404, 'הזמנה לא נמצאה.'); return null; }
  if (order.order_status === 'cancelled') { fail(res, 409, 'לא ניתן לשנות הזמנה מבוטלת.'); return null; }
  return order;
}

// POST /api/admin/orders/:id/discounts — הוספת הנחה ידנית (סעיף 16.1)
router.post('/orders/:id/discounts', asyncHandler(async (req, res) => {
  const orderId = req.params.id;
  const { discount_type, value, internal_reason } = req.body;
  if (!['fixed_amount', 'percentage'].includes(discount_type))
    return fail(res, 400, 'סוג הנחה לא תקין.');
  const val = Number(value);
  if (!(val > 0)) return fail(res, 400, 'ערך ההנחה חייב להיות גדול מאפס.');
  if (discount_type === 'percentage' && val > 100)
    return fail(res, 400, 'אחוז ההנחה לא יכול לעלות על 100.');

  const order = await loadEditableOrder(res, orderId);
  if (!order) return;

  // סכום ההנחה מחושב מתוך בסיס+תוספות (לפני הנחות אחרות)
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const amountBefore = round2(Number(order.base_amount) + Number(order.extras_amount));
  const discountAmount = discount_type === 'percentage'
    ? round2(amountBefore * val / 100)
    : round2(Math.min(val, amountBefore));
  const amountAfter = round2(amountBefore - discountAmount);

  const { error } = await supabase.from('order_discounts').insert({
    order_id: orderId,
    discount_type,
    value: val,
    amount_before: amountBefore,
    discount_amount: discountAmount,
    amount_after: amountAfter,
    internal_reason: internal_reason || null,
    created_by: req.appUser?.sub || null,
  });
  if (error) throw error;

  const amounts = await recomputeOrderAmounts(orderId);
  await supabase.from('order_history').insert({
    order_id: orderId, changed_by: req.appUser?.sub || null,
    action: 'נוספה הנחה ידנית', changes: { discount_type, value: val, discount_amount: discountAmount },
  });
  res.json({ ok: true, amounts });
}));

// DELETE /api/admin/orders/:id/discounts/:discountId — הסרת הנחה
router.delete('/orders/:id/discounts/:discountId', asyncHandler(async (req, res) => {
  const orderId = req.params.id;
  const order = await loadEditableOrder(res, orderId);
  if (!order) return;

  const { data, error } = await supabase
    .from('order_discounts').delete()
    .eq('id', req.params.discountId).eq('order_id', orderId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'ההנחה לא נמצאה.');

  const amounts = await recomputeOrderAmounts(orderId);
  await supabase.from('order_history').insert({
    order_id: orderId, changed_by: req.appUser?.sub || null, action: 'הנחה ידנית הוסרה',
  });
  res.json({ ok: true, amounts });
}));

// POST /api/admin/orders/:id/manual-charges — הוספת חיוב ידני (סעיף 16.2)
router.post('/orders/:id/manual-charges', asyncHandler(async (req, res) => {
  const orderId = req.params.id;
  const { name, amount, reason } = req.body;
  if (!name || !String(name).trim()) return fail(res, 400, 'יש להזין שם לחיוב.');
  const amt = Number(amount);
  if (!(amt > 0)) return fail(res, 400, 'סכום החיוב חייב להיות גדול מאפס.');

  const order = await loadEditableOrder(res, orderId);
  if (!order) return;

  const { error } = await supabase.from('order_manual_charges').insert({
    order_id: orderId,
    name: String(name).trim(),
    amount: amt,
    reason: reason || null,
    created_by: req.appUser?.sub || null,
  });
  if (error) throw error;

  const amounts = await recomputeOrderAmounts(orderId);
  await supabase.from('order_history').insert({
    order_id: orderId, changed_by: req.appUser?.sub || null,
    action: 'נוסף חיוב ידני', changes: { name: String(name).trim(), amount: amt },
  });
  res.json({ ok: true, amounts });
}));

// DELETE /api/admin/orders/:id/manual-charges/:chargeId — הסרת חיוב ידני
router.delete('/orders/:id/manual-charges/:chargeId', asyncHandler(async (req, res) => {
  const orderId = req.params.id;
  const order = await loadEditableOrder(res, orderId);
  if (!order) return;

  const { data, error } = await supabase
    .from('order_manual_charges').delete()
    .eq('id', req.params.chargeId).eq('order_id', orderId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'החיוב לא נמצא.');

  const amounts = await recomputeOrderAmounts(orderId);
  await supabase.from('order_history').insert({
    order_id: orderId, changed_by: req.appUser?.sub || null, action: 'חיוב ידני הוסר',
  });
  res.json({ ok: true, amounts });
}));

// POST /api/admin/orders/:id/approve — אישור הזמנה (סעיף 11.1)
router.post('/orders/:id/approve', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .update({ order_status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('order_status', 'pending_approval')
    .select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 409, 'לא ניתן לאשר — ההזמנה אינה בסטטוס ממתין לאישור.');

  await supabase.from('order_history').insert({
    order_id: req.params.id, action: 'ההזמנה אושרה',
  });
  await markEntityNotificationsRead('orders', req.params.id);
  res.json({ ok: true, order: data });
}));

// POST /api/admin/orders/:id/cancel — ביטול הזמנה בכל סטטוס (סעיף 10.5)
router.post('/orders/:id/cancel', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('orders').update({ order_status: 'cancelled' })
    .eq('id', req.params.id).select('*').single();
  if (error) throw error;

  await supabase.from('order_history').insert({
    order_id: req.params.id, action: 'ההזמנה בוטלה', changes: { reason: req.body.reason || null },
  });
  res.json({ ok: true, order: data });
}));

// POST /api/admin/orders/:id/payment — עדכון סטטוס תשלום (סעיף 17.2)
router.post('/orders/:id/payment', asyncHandler(async (req, res) => {
  const { payment_status, amount, payment_method, paid_at } = req.body;
  const valid = ['unpaid', 'partially_paid', 'paid', 'payment_override'];
  if (!valid.includes(payment_status)) return fail(res, 400, 'סטטוס תשלום לא תקין.');

  const { data, error } = await supabase
    .from('orders').update({ payment_status })
    .eq('id', req.params.id).select('*').single();
  if (error) throw error;

  // אם נרשם סכום — מתעדים תשלום (סעיף 17.2)
  if (amount && Number(amount) > 0) {
    await supabase.from('customer_payments').insert({
      order_id: req.params.id,
      amount: Number(amount),
      payment_method: payment_method || 'cash',
      paid_at: paid_at || new Date().toISOString().slice(0, 10),
    });
  }
  res.json({ ok: true, order: data });
}));

// GET /api/admin/dashboard — נתוני דשבורד ניהולי (סעיף 30)
// מחזיר את "הדברים הדורשים טיפול" בחלוקה ל-5 סקציות: הזמנות, תשלומים,
// מלאי, מתנדבים, ספקים. לכל פריט מספר; הפרונט מוסיף קישור ישיר לפעולה.
router.get('/dashboard', asyncHandler(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);            // YYYY-MM-DD
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString(); // לפני 7 ימים (ISO)
  const ACTIVE = ['pending_approval', 'approved', 'needs_correction', 'delivered'];

  // השבת הקרובה = השבת הפעילה הבאה מהיום (כולל היום)
  const { data: nextShabbat } = await supabase
    .from('shabbatot')
    .select('id, parasha, hebrew_date, gregorian_date, payment_deadline')
    .gte('gregorian_date', today)
    .order('gregorian_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  const [
    pendingOrders, cancelledRecent,
    unpaidActive, partiallyPaid, overrideCount, openRefunds,
    lowStock, openPOs, supplierPayments,
    invItems, transportOrders,
  ] = await Promise.all([
    // 30.1 — הזמנות
    supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('order_status', 'pending_approval'),
    supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('order_status', 'cancelled').gte('updated_at', weekAgo),
    // 30.2 — תשלומים
    supabase.from('orders').select('id', { count: 'exact', head: true })
      .in('order_status', ACTIVE).eq('payment_status', 'unpaid'),
    supabase.from('orders').select('id', { count: 'exact', head: true })
      .in('order_status', ACTIVE).eq('payment_status', 'partially_paid'),
    supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('payment_status', 'payment_override'),
    supabase.from('order_refunds').select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    // 30.3/30.5 — מלאי + רכש
    supabase.from('inventory_items').select('id, quantity_on_hand, min_alert_quantity')
      .eq('is_active', true).not('min_alert_quantity', 'is', null),
    supabase.from('purchase_orders').select('id', { count: 'exact', head: true })
      .in('status', ['draft', 'sent', 'partially_received']),
    supabase.from('supplier_payments').select('id', { count: 'exact', head: true })
      .in('status', ['unpaid', 'partially_paid', 'awaiting_invoice']),
    // עזר: פריטי מלאי מלאים (לא בשימוש כאן ישירות — נשמר לעתיד)
    supabase.from('inventory_items').select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    // 30.4 — הזמנות פעילות שדורשות שינוע (למניית שיבוץ שינוע חסר)
    nextShabbat
      ? supabase.from('orders')
          .select('id, transport_volunteer_id')
          .eq('shabbat_id', nextShabbat.id)
          .eq('delivery_method', 'volunteer_transport')
          .in('order_status', ACTIVE)
      : Promise.resolve({ data: [] }),
  ]);

  // מוצרים מתחת למינימום — השוואה בין שתי עמודות מתבצעת ב-JS
  const belowMin = (lowStock.data || []).filter(
    (it) => Number(it.quantity_on_hand) < Number(it.min_alert_quantity),
  ).length;

  // הזמנות שלא שולמו בזמן — מאושרות/פעילות שלא שולמו והשבת שלהן עברה את מועד התשלום
  let overdueUnpaid = 0;
  let nextShabbatOrders = 0;
  let missingTransport = 0;
  let unassignedTasks = 0;

  if (nextShabbat) {
    const { count: nsOrders } = await supabase
      .from('orders').select('id', { count: 'exact', head: true })
      .eq('shabbat_id', nextShabbat.id).in('order_status', ACTIVE);
    nextShabbatOrders = nsOrders || 0;

    // שינוע חסר להזמנות שדורשות שינוע לשבת הקרובה
    missingTransport = (transportOrders.data || [])
      .filter((o) => !o.transport_volunteer_id).length;

    // משימות קבועות ללא שיבוץ מתנדב לשבת הקרובה
    const [{ data: tasks }, { data: assignments }] = await Promise.all([
      supabase.from('volunteer_tasks').select('id').eq('is_active', true),
      supabase.from('volunteer_assignments')
        .select('task_id, volunteer_id').eq('shabbat_id', nextShabbat.id),
    ]);
    const assignedTaskIds = new Set(
      (assignments || []).filter((a) => a.task_id && a.volunteer_id).map((a) => a.task_id),
    );
    unassignedTasks = (tasks || []).filter((t) => !assignedTaskIds.has(t.id)).length;
  }

  // הזמנות שלא שולמו בזמן — דורש את מועד התשלום של השבת של כל הזמנה
  const { data: unpaidRows } = await supabase
    .from('orders')
    .select('id, shabbatot(payment_deadline)')
    .in('order_status', ACTIVE)
    .in('payment_status', ['unpaid', 'partially_paid']);
  overdueUnpaid = (unpaidRows || []).filter((o) => {
    const dl = o.shabbatot?.payment_deadline;
    return dl && dl < today;
  }).length;

  const { count: pendingRegistrations } = await supabase
    .from('customer_registration_requests')
    .select('id', { count: 'exact', head: true })
    .eq('is_handled', false);

  res.json({
    next_shabbat: nextShabbat || null,
    orders: {
      pending_approval: pendingOrders.count || 0,
      next_shabbat: nextShabbatOrders,
      overdue_unpaid: overdueUnpaid,
      cancelled_recent: cancelledRecent.count || 0,
    },
    payments: {
      unpaid: unpaidActive.count || 0,
      partially_paid: partiallyPaid.count || 0,
      overrides: overrideCount.count || 0,
      open_refunds: openRefunds.count || 0,
    },
    inventory: {
      below_min: belowMin,
      open_purchase_orders: openPOs.count || 0,
    },
    volunteers: {
      unassigned_tasks: unassignedTasks,
      missing_transport: missingTransport,
    },
    suppliers: {
      open_purchase_orders: openPOs.count || 0,
      open_payments: supplierPayments.count || 0,
    },
    registrations: {
      pending: pendingRegistrations || 0,
    },
    // תאימות לאחור — שדות הדשבורד הישן
    pending_orders: pendingOrders.count || 0,
    unpaid_approved: unpaidActive.count || 0,
    pending_registrations: pendingRegistrations || 0,
  });
}));

// GET /api/admin/registrations — בקשות רישום ממתינות (סעיף 7)
router.get('/registrations', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('customer_registration_requests').select('*')
    .eq('is_handled', false).order('created_at');
  if (error) throw error;
  res.json(data);
}));

// POST /api/admin/registrations/:id/approve — אישור רישום -> יוצר לקוח פעיל
router.post('/registrations/:id/approve', asyncHandler(async (req, res) => {
  const { data: reqRow, error } = await supabase
    .from('customer_registration_requests').select('*').eq('id', req.params.id).single();
  if (error) throw error;
  if (reqRow.is_handled) return fail(res, 409, 'בקשת הרישום כבר טופלה.');

  const { data: existing, error: existingErr } = await supabase
    .from('customers')
    .select(CUSTOMER_SELECT)
    .eq('phone_normalized', reqRow.phone_normalized)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) {
    await supabase.from('customer_registration_requests')
      .update({
        is_handled: true,
        handled_by: req.appUser?.sub || null,
        handled_at: new Date().toISOString(),
        resulting_customer_id: existing.id,
      })
      .eq('id', req.params.id);
    await markEntityNotificationsRead('customer_registration_requests', req.params.id);
    return res.json({ ok: true, customer: existing });
  }

  const { data: customer, error: cErr } = await supabase.from('customers').insert({
    full_name: reqRow.full_name,
    phone: reqRow.phone,
    phone_normalized: reqRow.phone_normalized,
    email: reqRow.email,
    address: reqRow.address,
    status: 'active',
  }).select('*').single();
  if (cErr) throw cErr;

  await supabase.from('customer_registration_requests')
    .update({
      is_handled: true,
      handled_by: req.appUser?.sub || null,
      handled_at: new Date().toISOString(),
      resulting_customer_id: customer.id,
    })
    .eq('id', req.params.id);

  await markEntityNotificationsRead('customer_registration_requests', req.params.id);
  res.json({ ok: true, customer });
}));

// POST /api/admin/registrations/:id/reject — דחיית רישום -> יוצר/מעדכן לקוח חסום עם סיבה
router.post('/registrations/:id/reject', asyncHandler(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) return fail(res, 400, 'חובה להזין סיבת דחיית רישום.');

  const { data: reqRow, error } = await supabase
    .from('customer_registration_requests').select('*').eq('id', req.params.id).single();
  if (error) throw error;
  if (reqRow.is_handled) return fail(res, 409, 'בקשת הרישום כבר טופלה.');

  const note = `דחיית רישום: ${reason}`;
  const { data: existing, error: existingErr } = await supabase
    .from('customers')
    .select(CUSTOMER_SELECT)
    .eq('phone_normalized', reqRow.phone_normalized)
    .maybeSingle();
  if (existingErr) throw existingErr;

  let customer;
  if (existing) {
    const internal_notes = existing.internal_notes ? `${existing.internal_notes}\n${note}` : note;
    const { data: updated, error: updateErr } = await supabase
      .from('customers')
      .update({ status: 'blocked', internal_notes })
      .eq('id', existing.id)
      .select(CUSTOMER_SELECT)
      .single();
    if (updateErr) throw updateErr;
    customer = updated;
  } else {
    const { data: created, error: createErr } = await supabase.from('customers').insert({
      full_name: reqRow.full_name,
      phone: reqRow.phone,
      phone_normalized: reqRow.phone_normalized,
      email: reqRow.email,
      address: reqRow.address,
      status: 'blocked',
      internal_notes: note,
    }).select(CUSTOMER_SELECT).single();
    if (createErr) throw createErr;
    customer = created;
  }

  await supabase.from('customer_registration_requests')
    .update({
      is_handled: true,
      handled_by: req.appUser?.sub || null,
      handled_at: new Date().toISOString(),
      resulting_customer_id: customer.id,
    })
    .eq('id', req.params.id);

  await markEntityNotificationsRead('customer_registration_requests', req.params.id);
  res.json({ ok: true, customer });
}));

// DELETE /api/admin/registrations/:id -- developer hard delete.
router.delete('/registrations/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('customer_registration_requests')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'בקשת רישום לא נמצאה.');
  await auditDelete(req, 'customer_registration_request', req.params.id);
  res.json({ ok: true });
}));

export default router;
