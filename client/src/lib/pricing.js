// עזרי תמחור בצד הלקוח (תצוגה בלבד - השרת סמכותי על המחיר).

// מפתח נורמלי (ממוין, ייחודי) לצירוף מזהי-סעודות - לבחירת מסלול מחיר לפי
// צירוף מדויק (סעיף 15). חייב להיות זהה ל-slotKey שבשרת (server/src/services/pricing.js).
export function slotComboKey(ids) {
  return [...new Set((ids || []).filter(Boolean).map(String))].sort().join('|');
}

// Sum per-portion surcharges for selected meals. Each selected dish is billed
// against the number of portions in the meal slot where it was selected.
export function calcMealSurcharges(selectedMeals, catalogMeals, selectedSlots) {
  const portionsBySlot = new Map(
    (selectedSlots || []).map((slot) => [String(slot.meal_slot_id), Number(slot.portions) || 0])
  );
  const mealsById = new Map((catalogMeals || []).map((meal) => [String(meal.id), meal]));

  return Object.keys(selectedMeals || {}).reduce((total, key) => {
    const separator = key.indexOf(':');
    if (separator < 0) return total;
    const slotId = key.slice(0, separator);
    const mealId = key.slice(separator + 1);
    const meal = mealsById.get(mealId);
    if (!meal?.requires_extra_charge) return total;
    return total + Number(meal.extra_charge_amount || 0) * (portionsBySlot.get(slotId) || 0);
  }, 0);
}
