// נתוני דמו לפיתוח: מחירים, מאכלים לדוגמה, תוספות, שבתות, לקוח ומנהל.
// הרצה: npm run seed:demo
import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

async function main() {
  console.log('🌱 מזין נתוני דמו...\n');

  // --- מחירים למסלולים (סעיף 15) ---
  await supabase.from('price_tracks').update({ price_per_portion: 45 }).eq('meals_count', 1);
  await supabase.from('price_tracks').update({ price_per_portion: 80 }).eq('meals_count', 2);
  console.log('✓ מחירים: סעודה אחת 45₪, שתי סעודות 80₪');

  // --- סעודות + קטגוריות קיימות מה-seed ---
  const { data: slots } = await supabase.from('meal_slots').select('*');
  const { data: cats } = await supabase.from('categories').select('*');
  const slotByName = Object.fromEntries(slots.map((s) => [s.name, s.id]));
  const catByName = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  // --- מאכלים לדוגמה ---
  const demoMeals = [
    { name: 'מרק עוף', cat: 'מרק', slots: ['ליל שבת'] },
    { name: 'סלט חצילים', cat: 'סלטים', slots: ['ליל שבת', 'שבת בבוקר'] },
    { name: 'סלט טורקי', cat: 'סלטים', slots: ['ליל שבת', 'שבת בבוקר'] },
    { name: 'חומוס', cat: 'סלטים', slots: ['ליל שבת', 'שבת בבוקר'] },
    { name: 'דג סלמון', cat: 'דגים', slots: ['ליל שבת'] },
    { name: 'גפילטע פיש', cat: 'דגים', slots: ['ליל שבת', 'שבת בבוקר'] },
    { name: 'עוף בגריל', cat: 'מנה עיקרית', slots: ['ליל שבת', 'שבת בבוקר'] },
    { name: 'צלי בקר', cat: 'מנה עיקרית', slots: ['ליל שבת'] },
    { name: 'קוגל תפוחי אדמה', cat: 'תוספות', slots: ['ליל שבת', 'שבת בבוקר'] },
    { name: 'אורז', cat: 'תוספות', slots: ['ליל שבת', 'שבת בבוקר'] },
    { name: 'צ׳ולנט', cat: 'מנה עיקרית', slots: ['שבת בבוקר'] },
    { name: 'עוגת שוקולד', cat: 'מנה אחרונה', slots: ['ליל שבת', 'שבת בבוקר'] },
  ];

  // ניקוי מאכלי דמו קודמים (לפי שם) כדי לא לשכפל בהרצה חוזרת
  const names = demoMeals.map((m) => m.name);
  const { data: existingMeals } = await supabase.from('meals').select('id, name').in('name', names);
  if (existingMeals?.length) {
    const ids = existingMeals.map((m) => m.id);
    await supabase.from('meal_available_slots').delete().in('meal_id', ids);
    await supabase.from('meals').delete().in('id', ids);
  }

  const mealIdByName = {}; // שם מאכל -> id (לשימוש במתכונים וכללי אריזה בהמשך)
  let order = 1;
  for (const m of demoMeals) {
    const { data: meal, error } = await supabase.from('meals').insert({
      name: m.name,
      category_id: catByName[m.cat],
      included_in_base: true,
      requires_extra_charge: false,
      display_order: order++,
      is_active: true,
    }).select('id').single();
    if (error) { console.error('שגיאת מאכל', m.name, error.message); continue; }
    mealIdByName[m.name] = meal.id;

    const rows = m.slots.map((sn) => ({ meal_id: meal.id, meal_slot_id: slotByName[sn] }));
    await supabase.from('meal_available_slots').insert(rows);
  }
  console.log(`✓ ${demoMeals.length} מאכלים לדוגמה`);

  // --- תוספות בתשלום (סעיף 14) ---
  const demoExtras = [
    { name: 'יין / מיץ ענבים', unit_price: 25, billing_unit: 'בקבוק', suggestion_ratio: 0.05, suggestion_basis: 'per_portion', customer_note: 'בקבוק לכל 20 מנות' },
    { name: 'חלות', unit_price: 8, billing_unit: 'יחידה', suggestion_ratio: 0.5, suggestion_basis: 'per_portion', customer_note: 'חלה לכל 2 מנות' },
    { name: 'שתייה קלה', unit_price: 10, billing_unit: 'בקבוק', suggestion_ratio: 0.1, suggestion_basis: 'per_portion', customer_note: '' },
  ];
  const { data: exExtras } = await supabase.from('extras').select('id, name').in('name', demoExtras.map((e) => e.name));
  if (exExtras?.length) await supabase.from('extras').delete().in('id', exExtras.map((e) => e.id));
  let eo = 1;
  for (const e of demoExtras) {
    await supabase.from('extras').insert({ ...e, display_order: eo++, is_active: true });
  }
  console.log(`✓ ${demoExtras.length} תוספות בתשלום`);

  // --- שבתות דמו (4 שבתות עתידיות) ---
  const parashot = ['ואתחנן', 'עקב', 'ראה', 'שופטים'];
  const existing = await supabase.from('shabbatot').select('id, parasha').in('parasha', parashot);
  if (existing.data?.length) await supabase.from('shabbatot').delete().in('id', existing.data.map((s) => s.id));

  let d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); // שבת הקרובה
  for (const p of parashot) {
    const dateStr = d.toISOString().slice(0, 10);
    await supabase.from('shabbatot').insert({
      parasha: p,
      hebrew_date: `שבת פרשת ${p}`,
      gregorian_date: dateStr,
      status: 'open',
    });
    d.setDate(d.getDate() + 7);
  }
  console.log(`✓ ${parashot.length} שבתות פתוחות`);

  // --- משתמש מנהל דמו (עם סיסמה לכניסת ניהול) ---
  const { hashPassword } = await import('../lib/auth.js');
  const demoMgrPassword = 'Demo1234!';
  const password_hash = await hashPassword(demoMgrPassword);
  const { data: mgr } = await supabase.from('app_users').select('id').eq('email', 'manager@demo.local').maybeSingle();
  if (mgr) {
    await supabase.from('app_users').update({ password_hash, is_active: true }).eq('id', mgr.id);
  } else {
    await supabase.from('app_users').insert({
      full_name: 'מנהל דמו', email: 'manager@demo.local', role: 'manager', is_active: true, password_hash,
    });
  }
  console.log(`✓ משתמש מנהל דמו — כניסה: manager@demo.local / ${demoMgrPassword}`);

  // --- לקוח דמו פעיל (לכניסה בטלפון) ---
  const demoPhone = '0501234567';
  const { data: cust } = await supabase.from('customers').select('id').eq('phone_normalized', demoPhone).maybeSingle();
  if (!cust) {
    await supabase.from('customers').insert({
      full_name: 'ישראל ישראלי', phone: '050-123-4567', phone_normalized: demoPhone,
      address: 'רחוב הדוגמה 1, ביתר עילית', status: 'active',
    });
  }
  console.log(`✓ לקוח דמו פעיל — טלפון לכניסה: ${demoPhone}`);

  // --- מלאי, ספקים, מתכונים וכללי אריזה (סעיפים 25-27) ---
  await seedInventory(mealIdByName);

  // --- מתנדבים ומשימות קבועות (סעיף 24) ---
  await seedVolunteers(mealIdByName);

  console.log('\n✅ נתוני הדמו הוזנו בהצלחה!');
  console.log('   כניסת לקוח לדמו: 050-123-4567');
  process.exit(0);
}

// מזין ספקים, פריטי מלאי, מתכונים (מקושרים למלאי) וכללי אריזה, לצורך הדגמת
// לשונית מלאי וחוסרים בתיק שבת (סעיפים 25-27). אידמפוטנטי: מנקה לפי שם קודם.
async function seedInventory(mealIdByName) {
  // --- ספקים ---
  const demoSuppliers = [
    { name: 'ספק חומרי גלם — כהן', contact_name: 'משה כהן', phone: '02-500-1111' },
    { name: 'ירקות השדה', contact_name: 'דוד לוי', phone: '02-500-2222' },
    { name: 'אריזות פלוס', contact_name: 'שרה מזרחי', phone: '02-500-3333' },
  ];
  const supNames = demoSuppliers.map((s) => s.name);
  const { data: exSup } = await supabase.from('suppliers').select('id').in('name', supNames);
  if (exSup?.length) await supabase.from('suppliers').delete().in('id', exSup.map((s) => s.id));
  const { data: suppliers } = await supabase.from('suppliers').insert(demoSuppliers).select('id, name');
  const supByName = Object.fromEntries((suppliers || []).map((s) => [s.name, s.id]));

  // --- פריטי מלאי (חלקם עם מלאי קיים חלקי כדי להדגים חוסר) ---
  const { data: invCats } = await supabase.from('inventory_categories').select('id, name');
  const invCatByName = Object.fromEntries((invCats || []).map((c) => [c.name, c.id]));

  const demoItems = [
    { name: 'חזה עוף', cat: 'חומרי גלם', unit: 'ק"ג', on_hand: 8, min: 5, supplier: 'ספק חומרי גלם — כהן', price: 32 },
    { name: 'בצל', cat: 'ירקות', unit: 'ק"ג', on_hand: 3, min: 2, supplier: 'ירקות השדה', price: 4 },
    { name: 'גזר', cat: 'ירקות', unit: 'ק"ג', on_hand: 10, min: 3, supplier: 'ירקות השדה', price: 5 },
    { name: 'חצילים', cat: 'ירקות', unit: 'ק"ג', on_hand: 1, min: 4, supplier: 'ירקות השדה', price: 7 },
    { name: 'שמן', cat: 'חומרי גלם', unit: 'ליטר', on_hand: 20, min: 5, supplier: 'ספק חומרי גלם — כהן', price: 12 },
    { name: 'קופסת מרק 4 ליטר', cat: 'אריזות', unit: 'יחידה', on_hand: 15, min: 20, supplier: 'אריזות פלוס', price: 3, packaging: true },
  ];
  const itemNames = demoItems.map((i) => i.name);
  // מוחקים תלויות קודם (מתכונים/כללים שמצביעים על פריטים ישנים ייווצרו מחדש בהמשך)
  const { data: exItems } = await supabase.from('inventory_items').select('id').in('name', itemNames);
  if (exItems?.length) {
    const ids = exItems.map((i) => i.id);
    await supabase.from('recipe_lines').delete().in('inventory_item_id', ids);
    await supabase.from('packing_rules').delete().in('packaging_item_id', ids);
    await supabase.from('item_suppliers').delete().in('inventory_item_id', ids);
    await supabase.from('inventory_items').delete().in('id', ids);
  }
  const itemRows = demoItems.map((i) => ({
    name: i.name,
    category_id: invCatByName[i.cat],
    unit: i.unit,
    quantity_on_hand: i.on_hand,
    min_alert_quantity: i.min,
    default_supplier_id: supByName[i.supplier],
    last_purchase_price: i.price,
    is_packaging: !!i.packaging,
    is_active: true,
  }));
  const { data: items } = await supabase.from('inventory_items').insert(itemRows).select('id, name');
  const itemByName = Object.fromEntries((items || []).map((i) => [i.name, i.id]));
  console.log(`✓ ${demoSuppliers.length} ספקים + ${demoItems.length} פריטי מלאי`);

  // --- מתכונים (recipe_lines) — כמות למנה אחת, מקושרים למלאי ---
  // מרק עוף: חזה עוף, בצל, גזר (מקושרים) + "פטרוזיליה" ללא קישור (להדגמת שורה לא-מקושרת)
  // סלט חצילים: חצילים, שמן (מקושרים)
  const recipes = [
    { meal: 'מרק עוף', item: 'חזה עוף', qty: 0.15, unit: 'ק"ג' },
    { meal: 'מרק עוף', item: 'בצל', qty: 0.05, unit: 'ק"ג' },
    { meal: 'מרק עוף', item: 'גזר', qty: 0.08, unit: 'ק"ג' },
    { meal: 'מרק עוף', item: null, name: 'פטרוזיליה', qty: 0.01, unit: 'צרור' },
    { meal: 'סלט חצילים', item: 'חצילים', qty: 0.2, unit: 'ק"ג' },
    { meal: 'סלט חצילים', item: 'שמן', qty: 0.03, unit: 'ליטר' },
  ];
  // ניקוי מתכונים קודמים למאכלים אלה
  const recipeMealIds = [...new Set(recipes.map((r) => mealIdByName[r.meal]).filter(Boolean))];
  if (recipeMealIds.length) await supabase.from('recipe_lines').delete().in('meal_id', recipeMealIds);
  const recipeRows = recipes
    .filter((r) => mealIdByName[r.meal])
    .map((r) => ({
      meal_id: mealIdByName[r.meal],
      inventory_item_id: r.item ? itemByName[r.item] : null,
      ingredient_name: r.item || r.name,
      quantity_per_portion: r.qty,
      unit: r.unit,
    }));
  await supabase.from('recipe_lines').insert(recipeRows);

  // --- כלל אריזה למרק עוף: מנה אחת = ... 4 ליטר לכל 8 מנות, מקושר לפריט אריזה ---
  if (mealIdByName['מרק עוף']) {
    await supabase.from('packing_rules').delete().eq('meal_id', mealIdByName['מרק עוף']);
    await supabase.from('packing_rules').insert({
      meal_id: mealIdByName['מרק עוף'],
      packaging_item_id: itemByName['קופסת מרק 4 ליטר'],
      packaging_label: 'קופסת מרק 4 ליטר',
      portions_per_package: 8,
    });
  }
  console.log(`✓ מתכונים (${recipeRows.length} שורות) + כלל אריזה למרק עוף`);
}

// מזין מתנדבים ומשימות קבועות (סעיף 24). אידמפוטנטי: מנקה לפי שם/שדות קודם.
// חלק ממתנדבי הבישול מקושרים למאכל כדי להדגים שיבוץ אוטומטי (סעיף 24.2).
async function seedVolunteers(mealIdByName) {
  // --- מתנדבים ---
  const demoVolunteers = [
    { name: 'אברהם כהן', phone: '050-111-1111', area: 'cooking', meal: 'מרק עוף', regular: true },
    { name: 'יצחק לוי', phone: '050-222-2222', area: 'cooking', meal: 'סלט חצילים', regular: true },
    { name: 'יעקב מזרחי', phone: '050-333-3333', area: 'cooking', meal: 'עוף בגריל', regular: true },
    { name: 'שרה פרידמן', phone: '050-444-4444', area: 'packing', regular: true },
    { name: 'רבקה גולן', phone: '050-555-5555', area: 'packing', regular: false },
    { name: 'משה דיין', phone: '050-666-6666', area: 'transport', vehicle: true, regular: true },
    { name: 'דוד אשל', phone: '050-777-7777', area: 'transport', vehicle: true, regular: false },
    { name: 'לאה ברק', phone: '050-888-8888', area: 'cleaning', regular: true },
    { name: 'רחל שגב', phone: '050-999-9999', area: 'general', regular: false },
  ];
  const volNames = demoVolunteers.map((v) => v.name);
  const { data: exVols } = await supabase.from('volunteers').select('id').in('full_name', volNames);
  if (exVols?.length) {
    const ids = exVols.map((v) => v.id);
    await supabase.from('volunteer_assignments').delete().in('volunteer_id', ids);
    await supabase.from('volunteers').delete().in('id', ids);
  }
  const volRows = demoVolunteers.map((v) => ({
    full_name: v.name,
    phone: v.phone,
    area: v.area,
    linked_meal_id: v.meal ? mealIdByName[v.meal] || null : null,
    has_vehicle: !!v.vehicle,
    is_regular: !!v.regular,
    is_active: true,
  }));
  await supabase.from('volunteers').insert(volRows);

  // --- משימות קבועות (סעיף 24.3) — לא נוצרות מחדש בכל שבת ---
  const demoTasks = [
    { name: 'הכנת מרק', area: 'cooking', meal: 'מרק עוף', order: 1 },
    { name: 'הכנת סלטים', area: 'cooking', meal: 'סלט חצילים', order: 2 },
    { name: 'הכנת מנה עיקרית', area: 'cooking', meal: 'עוף בגריל', order: 3 },
    { name: 'אריזה', area: 'packing', order: 4 },
    { name: 'סידור לפי הזמנות', area: 'packing', order: 5 },
    { name: 'שינוע', area: 'transport', order: 6 },
    { name: 'ניקיון וסגירת מטבח', area: 'cleaning', order: 7 },
  ];
  const taskNames = demoTasks.map((t) => t.name);
  const { data: exTasks } = await supabase.from('volunteer_tasks').select('id').in('name', taskNames);
  if (exTasks?.length) {
    const ids = exTasks.map((t) => t.id);
    await supabase.from('volunteer_assignments').delete().in('task_id', ids);
    await supabase.from('volunteer_tasks').delete().in('id', ids);
  }
  const taskRows = demoTasks.map((t) => ({
    name: t.name,
    area: t.area,
    linked_meal_id: t.meal ? mealIdByName[t.meal] || null : null,
    display_order: t.order,
    is_active: true,
  }));
  await supabase.from('volunteer_tasks').insert(taskRows);
  console.log(`✓ ${demoVolunteers.length} מתנדבים + ${demoTasks.length} משימות קבועות`);
}

main().catch((e) => { console.error('❌ שגיאה:', e.message); process.exit(1); });
