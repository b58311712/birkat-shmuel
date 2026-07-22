// אחוזי החלוקה האוטומטית (split_mode = 'additive') של קטגוריה בסעודה מסוימת.
//
// היררכיית הנפילה־לאחור זהה לזו שבשרת (server/src/services/orderItems.js):
//   1. דריסה פר-סעודה - category.slot_splits[slotId] (טבלת category_slot_splits)
//   2. ברירת המחדל של הקטגוריה - category.primary_percent / secondary_percent
//   3. ברירת המחדל של המערכת - 80% עיקרי / 50% משני
//
// כך אפשר, למשל, לקבוע בקטגוריית דגים 80%+50% בליל שבת ו-50%+50% בשבת בבוקר.

export const DEFAULT_PRIMARY_PERCENT = 80;
export const DEFAULT_SECONDARY_PERCENT = 50;

export function splitPercentsFor(category, mealSlotId) {
  const override = category?.slot_splits?.[mealSlotId] || {};
  return {
    primary: Number(
      override.primary_percent ?? category?.primary_percent ?? DEFAULT_PRIMARY_PERCENT
    ),
    secondary: Number(
      override.secondary_percent ?? category?.secondary_percent ?? DEFAULT_SECONDARY_PERCENT
    ),
  };
}

// true אם לסעודה זו הוגדרה דריסה כלשהי (לתצוגת "מותאם לסעודה" בממשקים).
export function hasSlotSplitOverride(category, mealSlotId) {
  const override = category?.slot_splits?.[mealSlotId];
  return !!override && (override.primary_percent != null || override.secondary_percent != null);
}
