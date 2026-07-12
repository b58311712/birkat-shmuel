// עזרי תמחור בצד הלקוח (תצוגה בלבד — השרת סמכותי על המחיר).

// מפתח נורמלי (ממוין, ייחודי) לצירוף מזהי-סעודות — לבחירת מסלול מחיר לפי
// צירוף מדויק (סעיף 15). חייב להיות זהה ל-slotKey שבשרת (server/src/services/pricing.js).
export function slotComboKey(ids) {
  return [...new Set((ids || []).filter(Boolean).map(String))].sort().join('|');
}
