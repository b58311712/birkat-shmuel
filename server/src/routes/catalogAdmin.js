// Admin catalog management: food categories and meals.
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler, fail } from '../lib/helpers.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

const CATEGORY_SELECT = 'id, name, internal_description, display_order, recommended_min, max_allowed, is_active, created_at, updated_at';
const MEAL_SELECT = 'id, name, category_id, included_in_base, requires_extra_charge, extra_charge_amount, kitchen_prep_notes, kitchen_report_notes, preparation_instructions, display_order, is_active, created_at, updated_at, category:category_id (id, name)';

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

function num(v, fallback = null) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function intOrNull(v) {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

function normalizeCategory(body, { partial = false } = {}) {
  const patch = {};

  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'נא להזין שם קטגוריה.' };
    patch.name = name;
  }
  if (!partial || body.internal_description !== undefined) {
    patch.internal_description = body.internal_description ? String(body.internal_description).trim() : null;
  }
  if (!partial || body.display_order !== undefined) patch.display_order = intOrNull(body.display_order) ?? 0;
  if (!partial || body.recommended_min !== undefined) patch.recommended_min = intOrNull(body.recommended_min);
  if (!partial || body.max_allowed !== undefined) patch.max_allowed = intOrNull(body.max_allowed);
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  if (patch.recommended_min != null && patch.recommended_min < 0) return { error: 'מינימום מומלץ לא יכול להיות שלילי.' };
  if (patch.max_allowed != null && patch.max_allowed < 0) return { error: 'מקסימום מותר לא יכול להיות שלילי.' };
  if (patch.recommended_min != null && patch.max_allowed != null && patch.recommended_min > patch.max_allowed) {
    return { error: 'המינימום המומלץ לא יכול להיות גדול מהמקסימום המותר.' };
  }

  return { patch };
}

function normalizeMeal(body, { partial = false } = {}) {
  const patch = {};

  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'נא להזין שם מאכל.' };
    patch.name = name;
  }
  if (!partial || body.category_id !== undefined) {
    if (!body.category_id) return { error: 'נא לבחור קטגוריה למאכל.' };
    patch.category_id = body.category_id;
  }
  if (!partial || body.included_in_base !== undefined) patch.included_in_base = body.included_in_base !== false;
  if (!partial || body.requires_extra_charge !== undefined) patch.requires_extra_charge = Boolean(body.requires_extra_charge);
  if (!partial || body.extra_charge_amount !== undefined) patch.extra_charge_amount = num(body.extra_charge_amount);
  if (!partial || body.kitchen_prep_notes !== undefined) {
    patch.kitchen_prep_notes = body.kitchen_prep_notes ? String(body.kitchen_prep_notes).trim() : null;
  }
  if (!partial || body.kitchen_report_notes !== undefined) {
    patch.kitchen_report_notes = body.kitchen_report_notes ? String(body.kitchen_report_notes).trim() : null;
  }
  if (!partial || body.preparation_instructions !== undefined) {
    patch.preparation_instructions = body.preparation_instructions ? String(body.preparation_instructions).trim() : null;
  }
  if (!partial || body.display_order !== undefined) patch.display_order = intOrNull(body.display_order) ?? 0;
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  const extraRequired = patch.requires_extra_charge ?? Boolean(body.requires_extra_charge);
  if (extraRequired && patch.extra_charge_amount == null) return { error: 'מאכל עם תוספת מחיר חייב לכלול סכום.' };
  if (patch.extra_charge_amount != null && patch.extra_charge_amount < 0) return { error: 'מחיר תוספת לא יכול להיות שלילי.' };
  if (patch.requires_extra_charge === false) patch.extra_charge_amount = null;

  return { patch };
}

function normalizeRecipeLines(body) {
  const portions = num(body.recipe_portions, 1);
  if (portions === null || portions <= 0) return { error: 'מספר המנות במתכון חייב להיות גדול מאפס.' };

  if (!Array.isArray(body.lines)) return { error: 'יש לשלוח רשימת רכיבי מתכון.' };

  const rows = [];
  for (const raw of body.lines) {
    const ingredientName = String(raw.ingredient_name || '').trim();
    const unit = String(raw.unit || '').trim();
    const quantityForRecipe = num(raw.quantity_for_recipe ?? raw.quantity);

    if (!ingredientName && raw.inventory_item_id) return { error: 'יש להזין שם רכיב לכל שורת מתכון.' };
    if (!ingredientName && quantityForRecipe == null && !unit) continue;
    if (!ingredientName) return { error: 'יש להזין שם רכיב לכל שורת מתכון.' };
    if (quantityForRecipe === null || quantityForRecipe <= 0) return { error: `הכמות עבור ${ingredientName} חייבת להיות גדולה מאפס.` };
    if (!unit) return { error: `יש להזין יחידת מידה עבור ${ingredientName}.` };

    rows.push({
      inventory_item_id: raw.inventory_item_id || null,
      ingredient_name: ingredientName,
      quantity_per_portion: Number((quantityForRecipe / portions).toFixed(4)),
      unit,
      notes: raw.notes ? String(raw.notes).trim() : null,
    });
  }

  return { portions, rows };
}

async function categoriesWithSlots(data) {
  const ids = (data || []).map((c) => c.id);
  if (ids.length === 0) return data || [];

  const { data: links, error } = await supabase
    .from('category_meal_slots')
    .select('category_id, meal_slot_id')
    .in('category_id', ids);
  if (error) throw error;

  const byCategory = {};
  for (const row of links || []) (byCategory[row.category_id] ||= []).push(row.meal_slot_id);
  return data.map((c) => ({ ...c, meal_slot_ids: byCategory[c.id] || [] }));
}

async function mealsWithSlots(data) {
  const ids = (data || []).map((m) => m.id);
  if (ids.length === 0) return data || [];

  const { data: links, error } = await supabase
    .from('meal_available_slots')
    .select('meal_id, meal_slot_id')
    .in('meal_id', ids);
  if (error) throw error;

  const byMeal = {};
  for (const row of links || []) (byMeal[row.meal_id] ||= []).push(row.meal_slot_id);
  return data.map((m) => ({ ...m, available_slot_ids: byMeal[m.id] || [] }));
}

async function replaceCategorySlots(categoryId, slotIds) {
  const del = await supabase.from('category_meal_slots').delete().eq('category_id', categoryId);
  if (del.error) throw del.error;
  const clean = [...new Set(Array.isArray(slotIds) ? slotIds.filter(Boolean) : [])];
  if (!clean.length) return;
  const { error } = await supabase
    .from('category_meal_slots')
    .insert(clean.map((meal_slot_id) => ({ category_id: categoryId, meal_slot_id })));
  if (error) throw error;
}

async function replaceMealSlots(mealId, slotIds) {
  const del = await supabase.from('meal_available_slots').delete().eq('meal_id', mealId);
  if (del.error) throw del.error;
  const clean = [...new Set(Array.isArray(slotIds) ? slotIds.filter(Boolean) : [])];
  if (!clean.length) return;
  const { error } = await supabase
    .from('meal_available_slots')
    .insert(clean.map((meal_slot_id) => ({ meal_id: mealId, meal_slot_id })));
  if (error) throw error;
}

async function deleteMeal(mealId) {
  const cleanup = await Promise.all([
    supabase.from('volunteers').update({ linked_meal_id: null }).eq('linked_meal_id', mealId),
    supabase.from('volunteer_tasks').update({ linked_meal_id: null }).eq('linked_meal_id', mealId),
    supabase.from('order_meals').delete().eq('meal_id', mealId),
  ]);
  const cleanupErr = cleanup.find((r) => r.error)?.error;
  if (cleanupErr) throw cleanupErr;
  return supabase.from('meals').delete().eq('id', mealId).select('id').maybeSingle();
}

router.get('/meal-slots', asyncHandler(async (req, res) => {
  let q = supabase.from('meal_slots').select('*').order('display_order').order('name');
  if (req.query.active === 'true') q = q.eq('is_active', true);
  if (req.query.active === 'false') q = q.eq('is_active', false);
  const { data, error } = await q;
  if (error) throw error;
  res.json(data || []);
}));

router.delete('/meal-slots/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const slotId = req.params.id;
  const cleanup = await Promise.all([
    supabase.from('order_meal_slots').delete().eq('meal_slot_id', slotId),
    supabase.from('order_meals').delete().eq('meal_slot_id', slotId),
  ]);
  const cleanupErr = cleanup.find((r) => r.error)?.error;
  if (cleanupErr) throw cleanupErr;

  const { data, error } = await supabase
    .from('meal_slots')
    .delete()
    .eq('id', slotId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'סעודה לא נמצאה.');
  await auditDelete(req, 'meal_slot', slotId);
  res.json({ ok: true });
}));

router.get('/categories', asyncHandler(async (req, res) => {
  let q = supabase.from('categories').select(CATEGORY_SELECT).order('display_order').order('name');
  if (req.query.active === 'true') q = q.eq('is_active', true);
  if (req.query.active === 'false') q = q.eq('is_active', false);
  if (req.query.search) {
    const s = String(req.query.search).trim();
    if (s) q = q.or(`name.ilike.%${s}%,internal_description.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  res.json(await categoriesWithSlots(data));
}));

router.post('/categories', asyncHandler(async (req, res) => {
  const cleaned = normalizeCategory(req.body || {});
  if (cleaned.error) return fail(res, 400, cleaned.error);

  const { data, error } = await supabase
    .from('categories')
    .insert(cleaned.patch)
    .select(CATEGORY_SELECT)
    .single();
  if (error) throw error;

  await replaceCategorySlots(data.id, req.body.meal_slot_ids);
  const [category] = await categoriesWithSlots([data]);
  res.json({ ok: true, category });
}));

router.patch('/categories/:id', asyncHandler(async (req, res) => {
  const cleaned = normalizeCategory(req.body || {}, { partial: true });
  if (cleaned.error) return fail(res, 400, cleaned.error);

  let category;
  if (Object.keys(cleaned.patch).length > 0) {
    const { data, error } = await supabase
      .from('categories')
      .update(cleaned.patch)
      .eq('id', req.params.id)
      .select(CATEGORY_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, 'קטגוריה לא נמצאה.');
    category = data;
  } else {
    const { data, error } = await supabase.from('categories').select(CATEGORY_SELECT).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, 'קטגוריה לא נמצאה.');
    category = data;
  }

  if (req.body.meal_slot_ids !== undefined) await replaceCategorySlots(req.params.id, req.body.meal_slot_ids);
  const [withSlots] = await categoriesWithSlots([category]);
  res.json({ ok: true, category: withSlots });
}));

router.delete('/categories/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const categoryId = req.params.id;
  const { data: meals, error: mealsErr } = await supabase
    .from('meals')
    .select('id')
    .eq('category_id', categoryId);
  if (mealsErr) throw mealsErr;

  for (const meal of meals || []) {
    const del = await deleteMeal(meal.id);
    if (del.error) throw del.error;
  }

  const { data, error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'קטגוריה לא נמצאה.');
  await auditDelete(req, 'category', categoryId, { deleted_meals: (meals || []).length });
  res.json({ ok: true });
}));

router.get('/meals', asyncHandler(async (req, res) => {
  let q = supabase.from('meals').select(MEAL_SELECT).order('display_order').order('name');
  if (req.query.active === 'true') q = q.eq('is_active', true);
  if (req.query.active === 'false') q = q.eq('is_active', false);
  if (req.query.category_id) q = q.eq('category_id', req.query.category_id);
  if (req.query.search) {
    const s = String(req.query.search).trim();
    if (s) q = q.or(`name.ilike.%${s}%,kitchen_prep_notes.ilike.%${s}%,kitchen_report_notes.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  res.json(await mealsWithSlots(data));
}));

router.post('/meals', asyncHandler(async (req, res) => {
  const cleaned = normalizeMeal(req.body || {});
  if (cleaned.error) return fail(res, 400, cleaned.error);

  const { data, error } = await supabase
    .from('meals')
    .insert(cleaned.patch)
    .select(MEAL_SELECT)
    .single();
  if (error) throw error;

  await replaceMealSlots(data.id, req.body.available_slot_ids);
  const [meal] = await mealsWithSlots([data]);
  res.json({ ok: true, meal });
}));

router.patch('/meals/:id', asyncHandler(async (req, res) => {
  const cleaned = normalizeMeal(req.body || {}, { partial: true });
  if (cleaned.error) return fail(res, 400, cleaned.error);

  let meal;
  if (Object.keys(cleaned.patch).length > 0) {
    const { data, error } = await supabase
      .from('meals')
      .update(cleaned.patch)
      .eq('id', req.params.id)
      .select(MEAL_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, 'מאכל לא נמצא.');
    meal = data;
  } else {
    const { data, error } = await supabase.from('meals').select(MEAL_SELECT).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, 'מאכל לא נמצא.');
    meal = data;
  }

  if (req.body.available_slot_ids !== undefined) await replaceMealSlots(req.params.id, req.body.available_slot_ids);
  const [withSlots] = await mealsWithSlots([meal]);
  res.json({ ok: true, meal: withSlots });
}));

router.delete('/meals/:id', requireRole('developer'), asyncHandler(async (req, res) => {
  const { data, error } = await deleteMeal(req.params.id);
  if (error) throw error;
  if (!data) return fail(res, 404, 'מאכל לא נמצא.');
  await auditDelete(req, 'meal', req.params.id);
  res.json({ ok: true });
}));

router.get('/meals/:id/recipe', asyncHandler(async (req, res) => {
  const { data: meal, error: mealErr } = await supabase
    .from('meals')
    .select('id, recipe_portions')
    .eq('id', req.params.id)
    .maybeSingle();
  if (mealErr) throw mealErr;
  if (!meal) return fail(res, 404, 'מאכל לא נמצא.');

  const { data, error } = await supabase
    .from('recipe_lines')
    .select('id, meal_id, inventory_item_id, ingredient_name, quantity_per_portion, unit, notes, inventory_item:inventory_item_id (id, name, unit)')
    .eq('meal_id', req.params.id)
    .order('ingredient_name');
  if (error) throw error;

  // מספר המנות שהמתכון המקורי נכתב עבורו. משחזרים את הכמות למתכון השלם
  // (quantity_per_portion × recipe_portions) כדי שהעורך יציג שוב את הכמות
  // המקורית המדויקת ולא את הכמות למנה בודדת. הכמות למנה נשמרת מעוגלת ל-4
  // ספרות, ולכן המכפלה עלולה לצאת כמעט-שלמה (למשל 9.9999 במקום 10);
  // מעגלים ל-3 ספרות משמעותיות כדי לשחזר את הערך שהוזן במקור.
  const recipePortions = meal.recipe_portions || 1;
  const lines = (data || []).map((line) => ({
    ...line,
    quantity_for_recipe: Number((Number(line.quantity_per_portion) * recipePortions).toFixed(3)),
  }));

  res.json({ recipe_portions: recipePortions, lines });
}));

router.put('/meals/:id/recipe', asyncHandler(async (req, res) => {
  const { data: meal, error: mealErr } = await supabase
    .from('meals')
    .select('id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (mealErr) throw mealErr;
  if (!meal) return fail(res, 404, 'מאכל לא נמצא.');

  const cleaned = normalizeRecipeLines(req.body || {});
  if (cleaned.error) return fail(res, 400, cleaned.error);

  // שומרים את מספר המנות המקורי על המאכל כדי שנוכל לשחזר את המתכון השלם בקריאה.
  const updMeal = await supabase
    .from('meals')
    .update({ recipe_portions: cleaned.portions })
    .eq('id', req.params.id);
  if (updMeal.error) throw updMeal.error;

  const del = await supabase.from('recipe_lines').delete().eq('meal_id', req.params.id);
  if (del.error) throw del.error;

  if (cleaned.rows.length) {
    const { error } = await supabase
      .from('recipe_lines')
      .insert(cleaned.rows.map((row) => ({ ...row, meal_id: req.params.id })));
    if (error) throw error;
  }

  res.json({ ok: true, recipe_portions: cleaned.portions, lines_count: cleaned.rows.length });
}));

export default router;
