// קיבוץ מאכלי סעודה לפי קטגוריה, לתצוגת פירוט הזמנה עם כותרת לכל קטגוריה
// במקום רשימה שטוחה של כל המאכלים. משותף למסך ההזמנה בניהול ולמסך של הלקוח.
//
// הקטגוריה מגיעה מהשרת כשדה מקונן על שורת order_meals:
//   m.meals = { display_order, categories: { id, name, display_order } }
// הסדר הוא סדר התצוגה של הקטלוג (display_order), ומאכל שהקטגוריה שלו לא נטענה
// נופל לקבוצה "ללא קטגוריה" בסוף.
export function groupMealsByCategory(slotMeals) {
  const groups = new Map();
  for (const m of slotMeals || []) {
    const cat = m.meals?.categories;
    const key = cat?.id || '_uncat';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: cat?.name || 'ללא קטגוריה',
        order: cat?.display_order ?? 9999,
        meals: [],
      });
    }
    groups.get(key).meals.push(m);
  }
  const byName = (a, b) => String(a).localeCompare(String(b), 'he');
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || byName(a.name, b.name))
    .map((g) => ({
      ...g,
      meals: g.meals.sort((a, b) =>
        (a.meals?.display_order ?? 9999) - (b.meals?.display_order ?? 9999) ||
        byName(a.meal_name_snapshot, b.meal_name_snapshot)),
    }));
}
