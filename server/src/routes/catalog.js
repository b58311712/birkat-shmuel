// קטלוג: סעודות, קטגוריות, מאכלים, תוספות, מסלולי מחיר (סעיף 12-15)
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/helpers.js';
import { fetchSlotSplitsByCategory } from '../services/categorySplits.js';

const router = Router();

// GET /api/catalog - כל הקטלוג הפעיל להצגה בממשק הזמנה, בקריאה אחת.
router.get('/', asyncHandler(async (req, res) => {
  const [slots, categories, meals, mealSlots, extras, extraMeals, priceTracks, trackSlots, slotSplits] = await Promise.all([
    supabase.from('meal_slots').select('*').eq('is_active', true).order('display_order'),
    supabase.from('categories').select('*').eq('is_active', true).order('display_order'),
    supabase.from('meals').select('*').eq('is_active', true).order('display_order'),
    supabase.from('meal_available_slots').select('*'),
    supabase.from('extras').select('*').eq('is_active', true).order('display_order'),
    supabase.from('extra_meal_requirements').select('extra_id, meal_id'),
    supabase.from('price_tracks').select('*').eq('is_active', true).order('meals_count'),
    supabase.from('price_track_meal_slots').select('*'),
    fetchSlotSplitsByCategory(),
  ]);

  for (const r of [slots, categories, meals, mealSlots, extras, extraMeals, priceTracks, trackSlots]) {
    if (r.error) throw r.error;
  }

  // מצרפים לכל מאכל את רשימת הסעודות שבהן הוא זמין
  const slotsByMeal = {};
  for (const row of mealSlots.data) {
    (slotsByMeal[row.meal_id] ||= []).push(row.meal_slot_id);
  }
  const mealsWithSlots = meals.data.map((m) => ({
    ...m,
    available_slot_ids: slotsByMeal[m.id] || [],
  }));

  // מצרפים לכל תוספת את המאכלים שהיא מותנית בהם (רשימה ריקה = ללא התניה)
  const mealsByExtra = {};
  for (const row of extraMeals.data) {
    (mealsByExtra[row.extra_id] ||= []).push(row.meal_id);
  }
  const extrasWithMeals = extras.data.map((e) => ({
    ...e,
    required_meal_ids: mealsByExtra[e.id] || [],
  }));

  // מצרפים לכל מסלול מחיר את צירוף הסעודות שהוא חל עליו (סעיף 15)
  const slotsByTrack = {};
  for (const row of trackSlots.data) {
    (slotsByTrack[row.price_track_id] ||= []).push(row.meal_slot_id);
  }
  const priceTracksWithSlots = priceTracks.data.map((t) => ({
    ...t,
    meal_slot_ids: slotsByTrack[t.id] || [],
  }));

  // דריסות אחוזי החלוקה האוטומטית פר-סעודה: category.slot_splits[slotId] = {…}
  const categoriesWithSplits = categories.data.map((c) => ({
    ...c,
    slot_splits: slotSplits[c.id] || {},
  }));

  res.json({
    meal_slots: slots.data,
    categories: categoriesWithSplits,
    meals: mealsWithSlots,
    extras: extrasWithMeals,
    price_tracks: priceTracksWithSlots,
  });
}));

export default router;
