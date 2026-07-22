// ניהול מלאי CRUD (סעיף 25). מאחורי אימות מנהל.
//   - כרטיס מוצר: יצירה, עריכה, השבתה (מחיקה רכה - סעיף 32)
//   - קטגוריות מלאי דינמיות (סעיף 25.1)
//   - ספקים לצורך בחירת ספק ברירת מחדל (סעיף 25.3; ניהול ספקים מלא - סעיף 27)
//   - שינוי ידני בכמות עם תיעוד תנועה (סעיף 25.5)
//   - הפחתה בפועל מהמלאי לאחר ההכנות, לפי צורך השבת (סעיף 25.4)
//   - תנועות מלאי לצפייה (היסטוריית שינויים)
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { buildInventoryReport } from '../services/shabbatFile.js';
import { deductInventoryForShabbat } from '../services/inventoryDeduction.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

const CHANNELS = ['phone', 'email', 'whatsapp', 'other'];
// סוגי שינוי ידני מותרים (סעיף 25.5). 'correction' = תיקון ספירה/מלאי כללי.
const MANUAL_REASONS = ['waste', 'spoiled', 'count_error', 'unusual_use', 'return', 'correction'];

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

// המרה בטוחה למספר; מחזיר null אם לא מספר תקין
function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// פותר unit_id: מעדיף id מפורש; אחרת פותר משם-יחידה (טקסט) - מוצא קיים
// (case-insensitive) או יוצר יחידה חדשה. תאימות-לאחור לקוד ששולח unit טקסט.
// מחזיר unit_id או null אם לא סופקה יחידה כלל.
async function resolveUnitId(unitId, unitText) {
  if (unitId) return unitId;
  const name = String(unitText || '').trim();
  if (!name) return null;
  const { data: existing } = await supabase
    .from('units').select('id').ilike('name', name).maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await supabase
    .from('units').insert({ name, kind: 'other' }).select('id').single();
  if (error) throw error;
  return created.id;
}

async function deleteInventoryItem(itemId) {
  const cleanup = await Promise.all([
    supabase.from('recipe_lines').delete().eq('inventory_item_id', itemId),
    supabase.from('packing_rules').delete().eq('packaging_item_id', itemId),
    supabase.from('inventory_movements').delete().eq('inventory_item_id', itemId),
    supabase.from('purchase_order_lines').delete().eq('inventory_item_id', itemId),
  ]);
  const cleanupErr = cleanup.find((r) => r.error)?.error;
  if (cleanupErr) throw cleanupErr;
  return supabase.from('inventory_items').delete().eq('id', itemId).select('id').maybeSingle();
}

async function deletePurchaseOrder(poId) {
  const cleanup = await Promise.all([
    supabase.from('inventory_movements').delete().eq('purchase_order_id', poId),
    supabase.from('supplier_payments').delete().eq('purchase_order_id', poId),
    supabase.from('general_expenses').update({ purchase_order_id: null }).eq('purchase_order_id', poId),
  ]);
  const cleanupErr = cleanup.find((r) => r.error)?.error;
  if (cleanupErr) throw cleanupErr;
  return supabase.from('purchase_orders').delete().eq('id', poId).select('id').maybeSingle();
}

async function deleteSupplier(supplierId) {
  const { data: orders, error: ordersErr } = await supabase
    .from('purchase_orders')
    .select('id')
    .eq('supplier_id', supplierId);
  if (ordersErr) throw ordersErr;

  for (const order of orders || []) {
    const del = await deletePurchaseOrder(order.id);
    if (del.error) throw del.error;
  }

  const cleanup = await Promise.all([
    supabase.from('inventory_items').update({ default_supplier_id: null }).eq('default_supplier_id', supplierId),
    supabase.from('supplier_payments').delete().eq('supplier_id', supplierId),
    supabase.from('general_expenses').delete().eq('supplier_id', supplierId),
  ]);
  const cleanupErr = cleanup.find((r) => r.error)?.error;
  if (cleanupErr) throw cleanupErr;
  return {
    ...(await supabase.from('suppliers').delete().eq('id', supplierId).select('id').maybeSingle()),
    deletedOrders: (orders || []).length,
  };
}

// ===========================================================================
// קטגוריות מלאי (סעיף 25.1)
// ===========================================================================

// GET /api/admin/inventory/categories - רשימת קטגוריות
router.get('/categories', asyncHandler(async (req, res) => {
  let q = supabase.from('inventory_categories').select('*').order('display_order').order('name');
  if (req.query.active === 'true') q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  res.json(data);
}));

// POST /api/admin/inventory/categories - יצירת קטגוריה
router.post('/categories', asyncHandler(async (req, res) => {
  const { name, display_order } = req.body || {};
  if (!name?.trim()) return fail(res, 400, 'חובה להזין שם קטגוריה.');
  const { data, error } = await supabase.from('inventory_categories').insert({
    name: name.trim(),
    display_order: num(display_order) ?? 0,
  }).select('*').single();
  if (error) throw error;
  res.json({ ok: true, category: data });
}));

// PATCH /api/admin/inventory/categories/:id - עדכון/השבתת קטגוריה
router.patch('/categories/:id', asyncHandler(async (req, res) => {
  const allowed = ['name', 'display_order', 'is_active'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  if ('name' in patch && !patch.name?.trim()) return fail(res, 400, 'שם קטגוריה לא יכול להיות ריק.');
  if (Object.keys(patch).length === 0) return fail(res, 400, 'אין שדות לעדכון.');
  const { data, error } = await supabase.from('inventory_categories')
    .update(patch).eq('id', req.params.id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'קטגוריה לא נמצאה.');
  res.json({ ok: true, category: data });
}));

router.delete('/categories/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const cleanup = await supabase
    .from('inventory_items')
    .update({ category_id: null })
    .eq('category_id', req.params.id);
  if (cleanup.error) throw cleanup.error;

  const { data, error } = await supabase
    .from('inventory_categories')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'קטגוריה לא נמצאה.');
  await auditDelete(req, 'inventory_category', req.params.id);
  res.json({ ok: true });
}));

// ===========================================================================
// יחידות מידה גלובליות (סעיף 25) - ערכים מנוהלים במקום טקסט חופשי
// ===========================================================================
const UNIT_KINDS = ['weight', 'volume', 'count', 'length', 'other'];

// GET /api/admin/inventory/units - רשימת יחידות
// ?with_usage=true מוסיף usage_count לכל יחידה (פריטי מלאי + מתכונים + המרות),
// לזיהוי יחידות שאפשר למחוק/למזג. חישוב בזיכרון (טבלאות קטנות).
router.get('/units', asyncHandler(async (req, res) => {
  let q = supabase.from('units').select('*').order('display_order').order('name');
  if (req.query.active === 'true') q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;

  if (req.query.with_usage === 'true') {
    const [items, recipes, convs] = await Promise.all([
      supabase.from('inventory_items').select('unit_id'),
      supabase.from('recipe_lines').select('unit_id'),
      supabase.from('inventory_unit_conversions').select('from_unit_id'),
    ]);
    const count = {};
    for (const r of items.data || []) if (r.unit_id) count[r.unit_id] = (count[r.unit_id] || 0) + 1;
    for (const r of recipes.data || []) if (r.unit_id) count[r.unit_id] = (count[r.unit_id] || 0) + 1;
    for (const r of convs.data || []) if (r.from_unit_id) count[r.from_unit_id] = (count[r.from_unit_id] || 0) + 1;
    return res.json((data || []).map((u) => ({ ...u, usage_count: count[u.id] || 0 })));
  }
  res.json(data);
}));

// POST /api/admin/inventory/units/:id/merge - [כלי מיזוג זמני]
// ממזג את היחידה (:id = מקור) לתוך יחידת יעד: ממפה מחדש כל הרשומות ומוחק את
// המקור, אטומית ב-RPC merge_units. body: { target_id }
router.post('/units/:id/merge', asyncHandler(async (req, res) => {
  const targetId = req.body?.target_id;
  if (!targetId) return fail(res, 400, 'יש לבחור יחידת יעד למיזוג.');
  if (targetId === req.params.id) return fail(res, 400, 'לא ניתן למזג יחידה לעצמה.');
  const { data, error } = await supabase.rpc('merge_units', {
    p_source_id: req.params.id,
    p_target_id: targetId,
  });
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('target-not-found')) return fail(res, 404, 'יחידת היעד לא נמצאה.');
    if (msg.includes('same-unit')) return fail(res, 400, 'לא ניתן למזג יחידה לעצמה.');
    throw error;
  }
  res.json({ ok: true, ...data });
}));

// POST /api/admin/inventory/units - יצירת יחידה
router.post('/units', asyncHandler(async (req, res) => {
  const { name, kind, display_order } = req.body || {};
  if (!name?.trim()) return fail(res, 400, 'חובה להזין שם יחידה.');
  if (kind && !UNIT_KINDS.includes(kind)) return fail(res, 400, 'מימד יחידה לא תקין.');
  const { data, error } = await supabase.from('units').insert({
    name: name.trim(),
    kind: kind || 'other',
    display_order: num(display_order) ?? 0,
  }).select('*').single();
  // 23505 = הפרת ייחודיות (שם יחידה כפול, case-insensitive)
  if (error?.code === '23505') return fail(res, 409, 'יחידה בשם זה כבר קיימת.');
  if (error) throw error;
  res.json({ ok: true, unit: data });
}));

// PATCH /api/admin/inventory/units/:id - עדכון/השבתת יחידה
router.patch('/units/:id', asyncHandler(async (req, res) => {
  const allowed = ['name', 'kind', 'display_order', 'is_active'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  if ('name' in patch && !patch.name?.trim()) return fail(res, 400, 'שם יחידה לא יכול להיות ריק.');
  if ('kind' in patch && patch.kind && !UNIT_KINDS.includes(patch.kind)) return fail(res, 400, 'מימד יחידה לא תקין.');
  if (Object.keys(patch).length === 0) return fail(res, 400, 'אין שדות לעדכון.');
  const { data, error } = await supabase.from('units')
    .update(patch).eq('id', req.params.id).select('*').maybeSingle();
  if (error?.code === '23505') return fail(res, 409, 'יחידה בשם זה כבר קיימת.');
  if (error) throw error;
  if (!data) return fail(res, 404, 'יחידה לא נמצאה.');
  res.json({ ok: true, unit: data });
}));

router.delete('/units/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  // יחידה בשימוש (פריט/מתכון/המרה) לא נמחקת - מונע יתמות FK. עדיף השבתה.
  const [items, recipes, convs] = await Promise.all([
    supabase.from('inventory_items').select('id', { count: 'exact', head: true }).eq('unit_id', req.params.id),
    supabase.from('recipe_lines').select('id', { count: 'exact', head: true }).eq('unit_id', req.params.id),
    supabase.from('inventory_unit_conversions').select('id', { count: 'exact', head: true }).eq('from_unit_id', req.params.id),
  ]);
  const inUse = (items.count || 0) + (recipes.count || 0) + (convs.count || 0);
  if (inUse > 0) return fail(res, 409, `לא ניתן למחוק - היחידה בשימוש ב-${inUse} רשומות. ניתן להשבית אותה.`);

  const { data, error } = await supabase.from('units').delete().eq('id', req.params.id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'יחידה לא נמצאה.');
  await auditDelete(req, 'unit', req.params.id);
  res.json({ ok: true });
}));

// ===========================================================================
// המרות יחידה פר-פריט (סעיף 25.4) - יחידת-מתכון → פקטור ליחידת הבסיס
// ===========================================================================

// GET /api/admin/inventory/items/:id/conversions - המרות של פריט + שם היחידה
router.get('/items/:id/conversions', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('inventory_unit_conversions')
    .select('*, from_unit_ref:from_unit_id (id, name)')
    .eq('inventory_item_id', req.params.id)
    .order('created_at');
  if (error) throw error;
  res.json(data);
}));

// POST /api/admin/inventory/items/:id/conversions - הוספת המרה
// body: { from_unit_id, factor_to_base, note }
router.post('/items/:id/conversions', asyncHandler(async (req, res) => {
  const { from_unit_id, factor_to_base, note } = req.body || {};
  if (!from_unit_id) return fail(res, 400, 'יש לבחור יחידת מקור.');
  const factor = num(factor_to_base);
  if (factor === null || factor <= 0) return fail(res, 400, 'פקטור ההמרה חייב להיות מספר חיובי.');

  // ממלאים גם את from_unit הטקסטואלי משם היחידה. העמודה היא NOT NULL עד
  // מיגרציה 38, אז זה מונע כשל INSERT גם לפני שהמיגרציה רצה (הגנה כפולה).
  const { data: unit, error: uErr } = await supabase
    .from('units').select('name').eq('id', from_unit_id).maybeSingle();
  if (uErr) throw uErr;
  if (!unit) return fail(res, 400, 'יחידת המקור לא נמצאה.');

  const { data, error } = await supabase.from('inventory_unit_conversions').insert({
    inventory_item_id: req.params.id,
    from_unit_id,
    from_unit: unit.name,
    factor_to_base: factor,
    note: note?.trim() || null,
  }).select('*, from_unit_ref:from_unit_id (id, name)').single();
  if (error?.code === '23505') return fail(res, 409, 'כבר קיימת המרה מיחידה זו לפריט זה.');
  if (error) throw error;
  res.json({ ok: true, conversion: data });
}));

// PATCH /api/admin/inventory/conversions/:id - עדכון פקטור/הערה
router.patch('/conversions/:id', asyncHandler(async (req, res) => {
  const patch = {};
  if ('factor_to_base' in (req.body || {})) {
    const factor = num(req.body.factor_to_base);
    if (factor === null || factor <= 0) return fail(res, 400, 'פקטור ההמרה חייב להיות מספר חיובי.');
    patch.factor_to_base = factor;
  }
  if ('note' in (req.body || {})) patch.note = req.body.note?.trim() || null;
  if (Object.keys(patch).length === 0) return fail(res, 400, 'אין שדות לעדכון.');
  const { data, error } = await supabase.from('inventory_unit_conversions')
    .update(patch).eq('id', req.params.id).select('*, from_unit_ref:from_unit_id (id, name)').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'המרה לא נמצאה.');
  res.json({ ok: true, conversion: data });
}));

// DELETE /api/admin/inventory/conversions/:id - מחיקת המרה
router.delete('/conversions/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('inventory_unit_conversions')
    .delete().eq('id', req.params.id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'המרה לא נמצאה.');
  res.json({ ok: true });
}));

// ===========================================================================
// ספקים - לבחירת ספק ברירת מחדל בכרטיס המוצר (סעיף 25.3)
// ניהול ספקים מלא (הזמנות רכש וכו') הוא סעיף 27 - כאן רק מינימום למלאי.
// ===========================================================================

// GET /api/admin/inventory/suppliers - רשימת ספקים
router.get('/suppliers', asyncHandler(async (req, res) => {
  let q = supabase.from('suppliers').select('*').order('name');
  if (req.query.active === 'true') q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  res.json(data);
}));

// POST /api/admin/inventory/suppliers - יצירת ספק
router.post('/suppliers', asyncHandler(async (req, res) => {
  const { name, contact_name, phone, email, preferred_channel, order_notes } = req.body || {};
  if (!name?.trim()) return fail(res, 400, 'חובה להזין שם ספק.');
  if (preferred_channel && !CHANNELS.includes(preferred_channel))
    return fail(res, 400, 'אמצעי הזמנה לא תקין.');
  const { data, error } = await supabase.from('suppliers').insert({
    name: name.trim(),
    contact_name: contact_name?.trim() || null,
    phone: phone?.trim() || null,
    email: email?.trim() || null,
    preferred_channel: preferred_channel || null,
    order_notes: order_notes?.trim() || null,
  }).select('*').single();
  if (error) throw error;
  res.json({ ok: true, supplier: data });
}));

// PATCH /api/admin/inventory/suppliers/:id - עדכון/השבתת ספק
router.patch('/suppliers/:id', asyncHandler(async (req, res) => {
  const allowed = ['name', 'contact_name', 'phone', 'email', 'preferred_channel', 'order_notes', 'is_active'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  if ('name' in patch && !patch.name?.trim()) return fail(res, 400, 'שם ספק לא יכול להיות ריק.');
  if ('preferred_channel' in patch && patch.preferred_channel && !CHANNELS.includes(patch.preferred_channel))
    return fail(res, 400, 'אמצעי הזמנה לא תקין.');
  if (Object.keys(patch).length === 0) return fail(res, 400, 'אין שדות לעדכון.');
  const { data, error } = await supabase.from('suppliers')
    .update(patch).eq('id', req.params.id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'ספק לא נמצא.');
  res.json({ ok: true, supplier: data });
}));

router.delete('/suppliers/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const result = await deleteSupplier(req.params.id);
  if (result.error) throw result.error;
  if (!result.data) return fail(res, 404, 'ספק לא נמצא.');
  await auditDelete(req, 'supplier', req.params.id, { deleted_purchase_orders: result.deletedOrders });
  res.json({ ok: true });
}));

// ===========================================================================
// פריטי מלאי - כרטיס מוצר (סעיף 25.2)
// ===========================================================================

// GET /api/admin/inventory/items?category_id=&active=&packaging=&low_stock= - רשימת פריטים
router.get('/items', asyncHandler(async (req, res) => {
  let q = supabase
    .from('inventory_items')
    .select('*, category:category_id (id, name), default_supplier:default_supplier_id (id, name), unit_ref:unit_id (id, name)')
    .order('name');
  if (req.query.category_id) q = q.eq('category_id', req.query.category_id);
  if (req.query.active === 'true') q = q.eq('is_active', true);
  if (req.query.active === 'false') q = q.eq('is_active', false);
  if (req.query.packaging === 'true') q = q.eq('is_packaging', true);

  const { data, error } = await q;
  if (error) throw error;

  // סינון "מתחת למינימום" (סעיף 30.3) - לוגיקה בצד השרת, כי היא השוואה בין עמודות
  let items = data;
  if (req.query.low_stock === 'true') {
    items = (data || []).filter((i) =>
      i.min_alert_quantity != null && Number(i.quantity_on_hand) < Number(i.min_alert_quantity));
  }
  res.json(items);
}));

// GET /api/admin/inventory/items/:id - כרטיס מוצר בודד + תנועות אחרונות
router.get('/items/:id', asyncHandler(async (req, res) => {
  const { data: item, error } = await supabase
    .from('inventory_items')
    .select('*, category:category_id (id, name), default_supplier:default_supplier_id (id, name), unit_ref:unit_id (id, name)')
    .eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!item) return fail(res, 404, 'פריט מלאי לא נמצא.');

  const { data: movements, error: mErr } = await supabase
    .from('inventory_movements')
    .select('*, shabbatot:shabbat_id (parasha)')
    .eq('inventory_item_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (mErr) throw mErr;

  res.json({ item, movements });
}));

// POST /api/admin/inventory/items - יצירת פריט מלאי (סעיף 25.2)
// יחידת המידה מגיעה כ-unit_id (FK ל-units). לתאימות-לאחור מקבלים גם unit טקסט:
// אם הגיע רק טקסט, פותרים/יוצרים ממנו יחידה. עמודת unit הטקסטואלית ממולאת
// אוטומטית בטריגר מ-unit_id, אז אין צורך לשלוח אותה כשיש unit_id.
router.post('/items', asyncHandler(async (req, res) => {
  const {
    name, category_id, unit, quantity_on_hand, min_alert_quantity,
    default_supplier_id, last_purchase_price, is_packaging, vat_exempt, notes,
  } = req.body || {};
  if (!name?.trim()) return fail(res, 400, 'חובה להזין שם מוצר.');

  const unitId = await resolveUnitId(req.body?.unit_id, unit);
  if (!unitId) return fail(res, 400, 'חובה לבחור יחידת מידה.');

  const { data, error } = await supabase.from('inventory_items').insert({
    name: name.trim(),
    category_id: category_id || null,
    unit_id: unitId, // הטריגר ימלא את unit הטקסטואלי משם היחידה
    quantity_on_hand: num(quantity_on_hand) ?? 0,
    min_alert_quantity: num(min_alert_quantity),
    default_supplier_id: default_supplier_id || null,
    last_purchase_price: num(last_purchase_price), // נשמר כמחיר בסיס (לפני מע"מ)
    is_packaging: !!is_packaging,
    vat_exempt: !!vat_exempt, // פטור ממע"מ (פירות/ירקות)
    notes: notes?.trim() || null,
  }).select('*, unit_ref:unit_id (id, name)').single();
  if (error) throw error;
  res.json({ ok: true, item: data });
}));

// PATCH /api/admin/inventory/items/:id - עדכון כרטיס מוצר (כולל השבתה - סעיף 32)
// שים לב: עדכון ישיר של quantity_on_hand כאן מיועד לתיקון פרטי כרטיס בלבד.
// שינוי כמות מתועד (בלאי/ספירה) נעשה דרך POST /items/:id/adjust (סעיף 25.5).
router.patch('/items/:id', asyncHandler(async (req, res) => {
  const allowed = [
    'name', 'category_id', 'min_alert_quantity', 'default_supplier_id',
    'last_purchase_price', 'is_packaging', 'vat_exempt', 'is_active', 'notes',
  ];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  if ('name' in patch && !patch.name?.trim()) return fail(res, 400, 'שם מוצר לא יכול להיות ריק.');
  // יחידה: unit_id מפורש או unit טקסט (תאימות). הטריגר מסנכרן את עמודת הטקסט.
  if ('unit_id' in (req.body || {}) || 'unit' in (req.body || {})) {
    const unitId = await resolveUnitId(req.body.unit_id, req.body.unit);
    if (!unitId) return fail(res, 400, 'יחידת מידה לא יכולה להיות ריקה.');
    patch.unit_id = unitId;
  }
  // נרמול שדות ריקים -> null / מספר
  if ('min_alert_quantity' in patch) patch.min_alert_quantity = num(patch.min_alert_quantity);
  if ('last_purchase_price' in patch) patch.last_purchase_price = num(patch.last_purchase_price);
  if ('vat_exempt' in patch) patch.vat_exempt = !!patch.vat_exempt;
  if ('category_id' in patch) patch.category_id = patch.category_id || null;
  if ('default_supplier_id' in patch) patch.default_supplier_id = patch.default_supplier_id || null;
  if (Object.keys(patch).length === 0) return fail(res, 400, 'אין שדות לעדכון.');

  const { data, error } = await supabase.from('inventory_items')
    .update(patch).eq('id', req.params.id).select('*, unit_ref:unit_id (id, name)').maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'פריט מלאי לא נמצא.');
  res.json({ ok: true, item: data });
}));

router.delete('/items/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const { data, error } = await deleteInventoryItem(req.params.id);
  if (error) throw error;
  if (!data) return fail(res, 404, 'פריט מלאי לא נמצא.');
  await auditDelete(req, 'inventory_item', req.params.id);
  res.json({ ok: true });
}));

// ===========================================================================
// שינוי ידני בכמות עם תיעוד תנועה (סעיף 25.5)
// ===========================================================================

// POST /api/admin/inventory/items/:id/adjust - שינוי ידני מתועד
// body: { new_quantity | delta, reason, note }
// שומר תנועה עם כמות לפני/אחרי, מי ביצע וסיבה.
router.post('/items/:id/adjust', asyncHandler(async (req, res) => {
  const { new_quantity, delta, reason, note } = req.body || {};
  if (!MANUAL_REASONS.includes(reason)) return fail(res, 400, 'סיבת שינוי לא תקינה.');

  const { data: item, error: iErr } = await supabase
    .from('inventory_items').select('id, quantity_on_hand').eq('id', req.params.id).maybeSingle();
  if (iErr) throw iErr;
  if (!item) return fail(res, 404, 'פריט מלאי לא נמצא.');

  const before = Number(item.quantity_on_hand);
  let after;
  if (new_quantity !== undefined && new_quantity !== null && new_quantity !== '') {
    after = num(new_quantity);
    if (after === null) return fail(res, 400, 'כמות חדשה לא תקינה.');
  } else {
    const d = num(delta);
    if (d === null || d === 0) return fail(res, 400, 'יש להזין כמות חדשה או שינוי (delta).');
    after = before + d;
  }
  if (after < 0) return fail(res, 400, 'כמות המלאי לא יכולה להיות שלילית.');

  const change = Number((after - before).toFixed(4));
  if (change === 0) return fail(res, 400, 'אין שינוי בכמות.');

  const { error: uErr } = await supabase.from('inventory_items')
    .update({ quantity_on_hand: after }).eq('id', item.id);
  if (uErr) throw uErr;

  const { data: movement, error: mErr } = await supabase.from('inventory_movements').insert({
    inventory_item_id: item.id,
    movement_type: 'manual_adjustment',
    quantity_delta: change,
    quantity_before: before,
    quantity_after: after,
    reason,
    note: note?.trim() || null,
    performed_by: req.appUser?.sub || null,
  }).select('*').single();
  if (mErr) throw mErr;

  res.json({ ok: true, new_quantity: after, movement });
}));

// ===========================================================================
// הפחתה בפועל לאחר ההכנות, לפי צורך השבת (סעיף 25.4)
// ===========================================================================

// GET /api/admin/inventory/shabbat/:shabbatId/deduction-preview - תצוגה מקדימה
// מחזיר לכל פריט: כמות נדרשת לשבת (מעוגלת), כמות במלאי, וכמות מוצעת להפחתה.
// מבוסס על אותו חישוב של לשונית מלאי בתיק שבת (סעיף 26).
router.get('/shabbat/:shabbatId/deduction-preview', asyncHandler(async (req, res) => {
  const report = await buildInventoryReport(req.params.shabbatId);
  if (!report) return fail(res, 404, 'שבת לא נמצאה.');

  // משטחים את קבוצות הספקים לרשימת פריטים אחת עם ברירת מחדל להפחתה = הנדרש
  const rows = [];
  for (const group of report.suppliers || []) {
    for (const it of group.items) {
      rows.push({
        item_id: it.item_id,
        name: it.name,
        unit: it.unit,
        is_packaging: it.is_packaging,
        required: it.required,          // כמות נדרשת מעוגלת לשבת
        on_hand: it.on_hand,            // כמות קיימת
        suggested_deduction: it.required, // ברירת מחדל - להפחית את כל הנדרש
        supplier_name: group.supplier_name,
      });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  res.json({ shabbat_id: req.params.shabbatId, items: rows });
}));

// POST /api/admin/inventory/shabbat/:shabbatId/deduct - ביצוע הפחתה בפועל
// body: { lines: [{ item_id, quantity }] } - הכמויות ניתנות לתיקון ידני לפני ההפחתה (סעיף 25.4.3)
// כל שורה מפחיתה מהמלאי ומתעדת תנועה 'shabbat_deduction' מקושרת לשבת.
router.post('/shabbat/:shabbatId/deduct', asyncHandler(async (req, res) => {
  const { lines } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0)
    return fail(res, 400, 'אין פריטים להפחתה.');

  // אימות שהשבת קיימת
  const { data: shabbat, error: sErr } = await supabase
    .from('shabbatot').select('id').eq('id', req.params.shabbatId).maybeSingle();
  if (sErr) throw sErr;
  if (!shabbat) return fail(res, 404, 'שבת לא נמצאה.');

  // מנרמלים ומסננים שורות עם כמות חיובית
  const clean = [];
  for (const l of lines) {
    const qty = num(l.quantity);
    if (!l.item_id || qty === null || qty <= 0) continue;
    clean.push({ item_id: l.item_id, quantity: qty });
  }
  if (clean.length === 0) return fail(res, 400, 'אין כמויות תקינות להפחתה.');

  // שולפים כמות נוכחית לכל הפריטים
  const itemIds = clean.map((l) => l.item_id);
  const { data: items, error: iErr } = await supabase
    .from('inventory_items').select('id, name, quantity_on_hand').in('id', itemIds);
  if (iErr) throw iErr;
  const itemById = Object.fromEntries((items || []).map((i) => [i.id, i]));

  const results = [];
  const movements = [];
  for (const l of clean) {
    const item = itemById[l.item_id];
    if (!item) continue;
    const before = Number(item.quantity_on_hand);
    const after = Number((before - l.quantity).toFixed(4)); // מותר לרדת מתחת ל-0 (חוסר בפועל)

    const { error: uErr } = await supabase.from('inventory_items')
      .update({ quantity_on_hand: after }).eq('id', item.id);
    if (uErr) throw uErr;

    movements.push({
      inventory_item_id: item.id,
      movement_type: 'shabbat_deduction',
      quantity_delta: Number((-l.quantity).toFixed(4)),
      quantity_before: before,
      quantity_after: after,
      shabbat_id: req.params.shabbatId,
      reason: 'הפחתה לאחר הכנות השבת',
      performed_by: req.appUser?.sub || null,
    });
    results.push({ item_id: item.id, name: item.name, before, after });
  }

  if (movements.length) {
    const { error: mErr } = await supabase.from('inventory_movements').insert(movements);
    if (mErr) throw mErr;
  }

  res.json({ ok: true, deducted: results.length, items: results });
}));

// POST /api/admin/inventory/shabbat/:shabbatId/deduct-auto - ניכוי אוטומטי מלא
// מנכה את כל צריכת המלאי של השבת לפי המתכונים, בעסקה אחת אטומית (סעיף 25.4):
//   - צובר צריכה מכל ההזמנות התפעוליות, ממיר יחידות מתכון ליחידת בסיס.
//   - פקטור המרה חסר / מלאי לא מספיק → 400 עם הודעה מתארת, בלי ניכוי חלקי.
//   - is_inventory_deducted מונע ניכוי כפול (נאכף אטומית ב-DB).
// בשונה מ-/deduct הידני (שמאפשר תיקון כמויות), זהו מסלול אוטומטי חד-פעמי.
router.post('/shabbat/:shabbatId/deduct-auto', asyncHandler(async (req, res) => {
  try {
    const result = await deductInventoryForShabbat(
      req.params.shabbatId,
      req.appUser?.sub || null,
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    // שגיאת דומיין (המרה חסרה / מלאי לא מספיק / כבר נוכה) → הודעה ידידותית ללקוח.
    if (err.userMessage) return fail(res, err.status || 400, err.userMessage);
    throw err; // שגיאה בלתי צפויה → error middleware הגלובלי
  }
}));

// ===========================================================================
// תנועות מלאי - צפייה כללית (סעיף 25.5, ביקורת)
// ===========================================================================

// GET /api/admin/inventory/movements?item_id=&type=&limit= - היסטוריית תנועות
router.get('/movements', asyncHandler(async (req, res) => {
  let q = supabase
    .from('inventory_movements')
    .select('*, inventory_items:inventory_item_id (name, unit), shabbatot:shabbat_id (parasha)')
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(req.query.limit) || 100, 500));
  if (req.query.item_id) q = q.eq('inventory_item_id', req.query.item_id);
  if (req.query.type) q = q.eq('movement_type', req.query.type);

  const { data, error } = await q;
  if (error) throw error;
  res.json(data);
}));

export default router;
