// קטלוג: סעודות, קטגוריות, מאכלים, תוספות, מסלולי מחיר (סעיף 12-15)
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/helpers.js';

const router = Router();

// GET /api/catalog — כל הקטלוג הפעיל להצגה בממשק הזמנה, בקריאה אחת.
router.get('/', asyncHandler(async (req, res) => {
  const [slots, categories, meals, mealSlots, extras, priceTracks] = await Promise.all([
    supabase.from('meal_slots').select('*').eq('is_active', true).order('display_order'),
    supabase.from('categories').select('*').eq('is_active', true).order('display_order'),
    supabase.from('meals').select('*').eq('is_active', true).order('display_order'),
    supabase.from('meal_available_slots').select('*'),
    supabase.from('extras').select('*').eq('is_active', true).order('display_order'),
    supabase.from('price_tracks').select('*').eq('is_active', true).order('meals_count'),
  ]);

  for (const r of [slots, categories, meals, mealSlots, extras, priceTracks]) {
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

  res.json({
    meal_slots: slots.data,
    categories: categories.data,
    meals: mealsWithSlots,
    extras: extras.data,
    price_tracks: priceTracks.data,
  });
}));

export default router;
