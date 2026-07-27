// עזרי תמחור בצד הלקוח (תצוגה בלבד - השרת סמכותי על המחיר).

// מפתח נורמלי (ממוין, ייחודי) לצירוף מזהי-סעודות - לבחירת מסלול מחיר לפי
// צירוף מדויק (סעיף 15). חייב להיות זהה ל-slotKey שבשרת (server/src/services/pricing.js).
export function slotComboKey(ids) {
  return [...new Set((ids || []).filter(Boolean).map(String))].sort().join('|');
}

// Sum per-portion surcharges for selected meals.
// A dish with an explicitly selected portion count is billed by that count;
// otherwise it is billed by the total portions of its meal slot.
export function calcMealSurcharges(selectedMeals, catalogMeals, selectedSlots) {
  const portionsBySlot = new Map(
    (selectedSlots || []).map((slot) => [String(slot.meal_slot_id), Number(slot.portions) || 0])
  );
  const mealsById = new Map((catalogMeals || []).map((meal) => [String(meal.id), meal]));
  const selectedCountByGroup = new Map();

  for (const key of Object.keys(selectedMeals || {})) {
    const separator = key.indexOf(':');
    if (separator < 0) continue;
    const slotId = key.slice(0, separator);
    const mealId = key.slice(separator + 1);
    const categoryId = mealsById.get(mealId)?.category_id;
    if (!categoryId) continue;
    const groupKey = `${slotId}:${categoryId}`;
    selectedCountByGroup.set(groupKey, (selectedCountByGroup.get(groupKey) || 0) + 1);
  }

  return Object.entries(selectedMeals || {}).reduce((total, [key, selectedPortions]) => {
    const separator = key.indexOf(':');
    if (separator < 0) return total;
    const slotId = key.slice(0, separator);
    const mealId = key.slice(separator + 1);
    const meal = mealsById.get(mealId);
    if (!meal?.requires_extra_charge) return total;
    const explicitPortions = Number(selectedPortions);
    const groupKey = `${slotId}:${meal.category_id}`;
    // In the order form, numeric values represent a manual split. A lone dish in
    // such a category still receives (and is billed for) the full meal-slot count.
    const usesExplicitPortions =
      typeof selectedPortions === 'number'
      && Number.isFinite(explicitPortions)
      && (selectedCountByGroup.get(groupKey) || 0) > 1;
    const billedPortions =
      usesExplicitPortions
        ? explicitPortions
        : (portionsBySlot.get(slotId) || 0);
    return total + Number(meal.extra_charge_amount || 0) * billedPortions;
  }, 0);
}
