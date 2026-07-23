// שירות תיק שבת - איחוד ההזמנות של שבת וחישובי כמויות/מטבח/אריזה (סעיף 9, 21)
//
// עיקרון מרכזי (סעיף 8.7): רק הזמנות שנכנסות ל"הכנות" משתתפות בחישובים
// תפעוליים (כמויות, מטבח, מלאי, אריזה, שינוע):
//   order_status = 'approved'
//   וגם payment_status ∈ { paid, partially_paid, payment_override }
// הזמנה שבוטלה או שלא שולמה (ואין חריגה) - לא נכנסת לחישוב.
import { supabase } from '../lib/supabase.js';
import { roundUp } from '../lib/helpers.js';
import { orderedMealIds } from './volunteerScheduling.js';

// סטטוסי תשלום שמזכים הזמנה להיכנס לחישובים (סעיף 8.7)
const OPERATIONAL_PAYMENT_STATUSES = ['paid', 'partially_paid', 'payment_override'];

// בודק אם הזמנה בודדת נכנסת לחישובי הכנה (סעיף 8.7)
export function isOperational(order) {
  return (
    order.order_status === 'approved' &&
    OPERATIONAL_PAYMENT_STATUSES.includes(order.payment_status)
  );
}

// שולף שבת + כל ההזמנות שלה, כולל סעודות/מנות/מאכלים. משמש את כל הלשוניות.
// מחזיר { shabbat, orders } כאשר orders כולל ראש + פירוט מקונן.
async function loadShabbatOrders(shabbatId) {
  const { data: shabbat, error: sErr } = await supabase
    .from('shabbatot').select('*').eq('id', shabbatId).maybeSingle();
  if (sErr) throw sErr;
  if (!shabbat) return { shabbat: null, orders: [] };

  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select(`
      id, order_number, order_status, payment_status, delivery_method,
      contact_name, contact_phone, venue_name, venue_address, transport_notes,
      final_amount, base_amount,
      customers ( full_name, phone ),
      order_meal_slots ( meal_slot_id, portions ),
      order_meals ( meal_slot_id, meal_id, meal_name_snapshot, portions )
    `)
    .eq('shabbat_id', shabbatId)
    .order('order_number');
  if (oErr) throw oErr;

  return { shabbat, orders: orders || [] };
}

// לשונית סיכום שבת (סעיף 9.2): מונים לפי סטטוס, סך מנות, סך הזמנות.
export async function buildSummary(shabbatId) {
  const { shabbat, orders } = await loadShabbatOrders(shabbatId);
  if (!shabbat) return null;

  const byOrderStatus = {};
  const byPaymentStatus = {};
  let totalPortions = 0;
  let operationalPortions = 0;
  let operationalOrders = 0;

  for (const o of orders) {
    byOrderStatus[o.order_status] = (byOrderStatus[o.order_status] || 0) + 1;
    byPaymentStatus[o.payment_status] = (byPaymentStatus[o.payment_status] || 0) + 1;

    const portions = (o.order_meal_slots || []).reduce((s, ms) => s + Number(ms.portions || 0), 0);
    // סך המנות הכללי לא כולל מבוטלות
    if (o.order_status !== 'cancelled') totalPortions += portions;
    if (isOperational(o)) {
      operationalPortions += portions;
      operationalOrders += 1;
    }
  }

  return {
    shabbat: {
      id: shabbat.id,
      parasha: shabbat.parasha,
      hebrew_date: shabbat.hebrew_date,
      gregorian_date: shabbat.gregorian_date,
      status: shabbat.status,
      payment_deadline: shabbat.payment_deadline,
      notes: shabbat.notes,
    },
    total_orders: orders.filter((o) => o.order_status !== 'cancelled').length,
    total_portions: totalPortions,
    operational_orders: operationalOrders,   // הזמנות שנכנסות להכנות
    operational_portions: operationalPortions,
    by_order_status: byOrderStatus,
    by_payment_status: byPaymentStatus,
  };
}

// עוזר משותף: צובר סך המנות לכל מאכל על פני כל ההזמנות התפעוליות של השבת.
// המנות של מאכל = מנות הסעודה שאליה הוא שייך באותה הזמנה. מאכל שנבחר בכמה
// סעודות/הזמנות - נסכם את כולן (סעיף 21.2, בלי הפרדה). משמש מטבח + מלאי.
// מחזיר { portionsByMeal, nameByMeal }.
function computePortionsByMeal(orders) {
  const portionsByMeal = {}; // meal_id -> total portions
  const nameByMeal = {}; // meal_id -> שם תצוגה (snapshot אחרון)
  for (const o of orders) {
    if (!isOperational(o)) continue;
    const slotMap = {};
    for (const ms of o.order_meal_slots || []) {
      slotMap[ms.meal_slot_id] = Number(ms.portions || 0);
    }
    for (const om of o.order_meals || []) {
      // מאכל בקטגוריה שמחלקת מנות → הכמות שלו (om.portions); אחרת כל מנות הסעודה.
      const p = om.portions != null ? Number(om.portions) : (slotMap[om.meal_slot_id] || 0);
      if (!p) continue;
      portionsByMeal[om.meal_id] = (portionsByMeal[om.meal_id] || 0) + p;
      nameByMeal[om.meal_id] = om.meal_name_snapshot;
    }
  }
  return { portionsByMeal, nameByMeal };
}

// לשונית כמויות ומטבח (סעיף 9.4, 21):
//   - סך מנות לכל מאכל (איחוד כל הסעודות, בלי הפרדה - סעיף 21.2)
//   - קיבוץ לפי קטגוריה
//   - חומרי גלם לפי מתכונים * מנות, כמות מדויקת + מעוגלת (סעיף 21.3, 21.4)
export async function buildKitchenReport(shabbatId) {
  const { shabbat, orders } = await loadShabbatOrders(shabbatId);
  if (!shabbat) return null;

  const { portionsByMeal, nameByMeal } = computePortionsByMeal(orders);
  const mealIds = Object.keys(portionsByMeal);
  if (mealIds.length === 0) {
    return { shabbat_id: shabbatId, categories: [], total_portions: 0 };
  }

  // שולפים פרטי מאכל (קטגוריה, הערות מטבח) + מתכונים
  const [{ data: meals, error: mErr }, { data: recipes, error: rErr }, { data: categories, error: cErr }] =
    await Promise.all([
      supabase.from('meals')
        .select('id, name, category_id, kitchen_report_notes, kitchen_prep_notes')
        .in('id', mealIds),
      supabase.from('recipe_lines')
        .select('meal_id, ingredient_name, quantity_per_portion, unit')
        .in('meal_id', mealIds),
      supabase.from('categories').select('id, name, display_order'),
    ]);
  if (mErr) throw mErr;
  if (rErr) throw rErr;
  if (cErr) throw cErr;

  const mealById = Object.fromEntries((meals || []).map((m) => [m.id, m]));
  const catById = Object.fromEntries((categories || []).map((c) => [c.id, c]));
  const recipesByMeal = {};
  for (const rl of recipes || []) {
    (recipesByMeal[rl.meal_id] ||= []).push(rl);
  }

  // בונים שורות מאכל עם חומרי גלם
  // מקבצים לפי קטגוריה
  const catBuckets = {};   // category_id -> { category, meals: [] }
  let grandTotalPortions = 0;

  for (const mealId of mealIds) {
    const meal = mealById[mealId];
    const portions = portionsByMeal[mealId];
    grandTotalPortions += portions;

    const ingredients = (recipesByMeal[mealId] || []).map((rl) => {
      const exact = Number(rl.quantity_per_portion) * portions;
      return {
        ingredient_name: rl.ingredient_name,
        unit: rl.unit,
        quantity_per_portion: Number(rl.quantity_per_portion),
        exact_quantity: round4(exact),
        rounded_quantity: roundUp(exact),   // עיגול כללי כלפי מעלה (סעיף 21.4)
      };
    });

    const catId = meal?.category_id || '_uncat';
    const cat = catById[catId] || { id: catId, name: 'ללא קטגוריה', display_order: 999 };
    (catBuckets[catId] ||= { category: cat, meals: [] }).meals.push({
      meal_id: mealId,
      name: nameByMeal[mealId] || meal?.name || 'מאכל',
      total_portions: portions,
      kitchen_report_notes: meal?.kitchen_report_notes || null,
      kitchen_prep_notes: meal?.kitchen_prep_notes || null,
      ingredients,
    });
  }

  // ממיינים קטגוריות ומאכלים לפי display_order/שם
  const categoriesOut = Object.values(catBuckets)
    .sort((a, b) => (a.category.display_order ?? 999) - (b.category.display_order ?? 999))
    .map((bucket) => ({
      category_id: bucket.category.id,
      category_name: bucket.category.name,
      meals: bucket.meals.sort((a, b) => b.total_portions - a.total_portions),
    }));

  return {
    shabbat_id: shabbatId,
    total_portions: grandTotalPortions,
    categories: categoriesOut,
  };
}

// לשונית אריזה (סעיף 9.6, 22): פירוט אריזה לפי הזמנה.
// לכל הזמנה תפעולית: מספר, מזמין, מנות, סעודות, מאכלים, וכמה אריזות מכל סוג.
export async function buildPackingReport(shabbatId) {
  const { shabbat, orders } = await loadShabbatOrders(shabbatId);
  if (!shabbat) return null;

  const opOrders = orders.filter(isOperational);
  const mealIds = [...new Set(opOrders.flatMap((o) => (o.order_meals || []).map((m) => m.meal_id)))];

  // שמות סעודות + כללי אריזה
  const [{ data: slots, error: slErr }, { data: rules, error: rErr }] = await Promise.all([
    supabase.from('meal_slots').select('id, name, display_order'),
    mealIds.length
      ? supabase.from('packing_rules')
          .select('meal_id, packaging_label, portions_per_package')
          .in('meal_id', mealIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (slErr) throw slErr;
  if (rErr) throw rErr;

  const slotName = Object.fromEntries((slots || []).map((s) => [s.id, s.name]));
  const rulesByMeal = {};
  for (const r of rules || []) (rulesByMeal[r.meal_id] ||= []).push(r);

  const ordersOut = opOrders.map((o) => {
    const portionsBySlot = Object.fromEntries(
      (o.order_meal_slots || []).map((ms) => [ms.meal_slot_id, Number(ms.portions || 0)]),
    );
    const totalPortions = Object.values(portionsBySlot).reduce((a, b) => a + b, 0);
    const slotsUsed = (o.order_meal_slots || []).map((ms) => slotName[ms.meal_slot_id] || 'סעודה');

    // אריזות: לכל מאכל בהזמנה, לפי מנות הסעודה שלו וכללי האריזה
    const packages = [];
    for (const om of o.order_meals || []) {
      // כמות המאכל: הכמות שלו אם הקטגוריה מחלקת מנות, אחרת כל מנות הסעודה.
      const p = om.portions != null ? Number(om.portions) : (portionsBySlot[om.meal_slot_id] || 0);
      const mealRules = rulesByMeal[om.meal_id] || [];
      const packLines = mealRules.map((r) => ({
        packaging_label: r.packaging_label,
        count: p > 0 ? roundUp(p / Number(r.portions_per_package)) : 0,
      }));
      packages.push({
        meal_name: om.meal_name_snapshot,
        slot_name: slotName[om.meal_slot_id] || 'סעודה',
        portions: p,
        packages: packLines,
      });
    }

    return {
      order_id: o.id,
      order_number: o.order_number,
      customer_name: o.customers?.full_name,
      total_portions: totalPortions,
      slots: [...new Set(slotsUsed)],
      items: packages,
    };
  });

  return { shabbat_id: shabbatId, orders: ordersOut };
}

// לשונית שינוע (סעיף 9.7): הזמנות שדורשות אספקה, כתובות, אנשי קשר.
export async function buildTransportReport(shabbatId) {
  const { shabbat, orders } = await loadShabbatOrders(shabbatId);
  if (!shabbat) return null;

  const opOrders = orders.filter(isOperational);
  // רק הזמנות עם שינוע (לא איסוף עצמי)
  const transport = opOrders
    .filter((o) => o.delivery_method !== 'self_pickup')
    .map((o) => ({
      order_id: o.id,
      order_number: o.order_number,
      customer_name: o.customers?.full_name,
      contact_name: o.contact_name || o.customers?.full_name,
      contact_phone: o.contact_phone || o.customers?.phone,
      venue_name: o.venue_name,
      venue_address: o.venue_address,
      transport_notes: o.transport_notes,
      total_portions: (o.order_meal_slots || []).reduce((s, ms) => s + Number(ms.portions || 0), 0),
    }));

  return { shabbat_id: shabbatId, orders: transport };
}

// לשונית מלאי וחוסרים (סעיף 9.5, 26):
//   - כמות נדרשת לשבת לכל פריט מלאי (חומרי גלם ממתכונים + אריזות מכללי אריזה)
//   - כמות קיימת (quantity_on_hand), חסרה, ומומלצת לקנייה
//   - חלוקה לפי ספק ברירת מחדל של כל פריט (סעיף 26); פריט בלי ספק → קבוצה נפרדת
// הצורך מחושב רק מהזמנות תפעוליות (סעיף 8.7). כמות נדרשת מעוגלת כלפי מעלה (סעיף 21.4).
export async function buildInventoryReport(shabbatId) {
  const { shabbat, orders } = await loadShabbatOrders(shabbatId);
  if (!shabbat) return null;

  const { portionsByMeal } = computePortionsByMeal(orders);
  const mealIds = Object.keys(portionsByMeal);

  // requiredByItem: inventory_item_id -> כמות מדויקת נדרשת (מצטבר)
  // unlinked: שורות מתכון בלי קישור למלאי - אי אפשר לחשב חוסר, מציגים בנפרד
  const requiredByItem = {};
  const unlinkedByName = {}; // "שם::יחידה" -> { name, unit, quantity }

  if (mealIds.length > 0) {
    const [{ data: recipes, error: rErr }, { data: rules, error: pErr }] = await Promise.all([
      supabase.from('recipe_lines')
        .select('meal_id, inventory_item_id, ingredient_name, quantity_per_portion, unit')
        .in('meal_id', mealIds),
      supabase.from('packing_rules')
        .select('meal_id, packaging_item_id, packaging_label, portions_per_package')
        .in('meal_id', mealIds),
    ]);
    if (rErr) throw rErr;
    if (pErr) throw pErr;

    // חומרי גלם ממתכונים
    for (const rl of recipes || []) {
      const portions = portionsByMeal[rl.meal_id] || 0;
      if (!portions) continue;
      const need = Number(rl.quantity_per_portion) * portions;
      if (rl.inventory_item_id) {
        requiredByItem[rl.inventory_item_id] = (requiredByItem[rl.inventory_item_id] || 0) + need;
      } else {
        const key = `${rl.ingredient_name}::${rl.unit || ''}`;
        const e = (unlinkedByName[key] ||= { name: rl.ingredient_name, unit: rl.unit, quantity: 0 });
        e.quantity += need;
      }
    }

    // אריזות מכללי אריזה (סעיף 22.4) - כל אריזה שמקושרת לפריט מלאי
    for (const r of rules || []) {
      if (!r.packaging_item_id) continue;
      const portions = portionsByMeal[r.meal_id] || 0;
      if (!portions) continue;
      const need = roundUp(portions / Number(r.portions_per_package)); // אריזות שלמות
      requiredByItem[r.packaging_item_id] = (requiredByItem[r.packaging_item_id] || 0) + need;
    }
  }

  const itemIds = Object.keys(requiredByItem);
  if (itemIds.length === 0) {
    return {
      shabbat_id: shabbatId,
      suppliers: [],
      unlinked: Object.values(unlinkedByName).map((u) => ({ ...u, quantity: round4(u.quantity) })),
      has_requirements: Object.keys(unlinkedByName).length > 0,
    };
  }

  // שולפים את פריטי המלאי הנדרשים + הספקים שלהם
  const { data: items, error: iErr } = await supabase
    .from('inventory_items')
    .select('id, name, unit, quantity_on_hand, min_alert_quantity, last_purchase_price, default_supplier_id, is_packaging')
    .in('id', itemIds);
  if (iErr) throw iErr;

  const supplierIds = [...new Set((items || []).map((i) => i.default_supplier_id).filter(Boolean))];
  const { data: suppliers, error: sErr } = supplierIds.length
    ? await supabase.from('suppliers').select('id, name, phone, contact_name').in('id', supplierIds)
    : { data: [], error: null };
  if (sErr) throw sErr;
  const supplierById = Object.fromEntries((suppliers || []).map((s) => [s.id, s]));

  // בונים שורת פריט: נדרש (מעוגל), קיים, חסר, מומלץ לקנייה
  const NO_SUPPLIER = '_none';
  const buckets = {}; // supplier_key -> { supplier, items: [] }

  for (const item of items || []) {
    const exactRequired = requiredByItem[item.id] || 0;
    const required = roundUp(exactRequired); // כמות נדרשת מעוגלת (סעיף 21.4)
    const onHand = Number(item.quantity_on_hand || 0);
    const missing = Math.max(0, required - onHand); // כמה חסר לכיסוי צורך השבת
    // מומלץ לקנייה (סעיף 26): לכסות את החוסר, ואם מוגדר מלאי מינימום - לקנות
    // מספיק כדי שלאחר השבת המלאי לא ירד מתחת למינימום ההתראה.
    const minAlert = item.min_alert_quantity != null ? Number(item.min_alert_quantity) : 0;
    const suggested = Math.max(missing, required + minAlert - onHand, 0);

    const supKey = item.default_supplier_id || NO_SUPPLIER;
    const bucket = (buckets[supKey] ||= {
      supplier: supplierById[item.default_supplier_id] || null,
      items: [],
    });
    bucket.items.push({
      item_id: item.id,
      name: item.name,
      unit: item.unit,
      is_packaging: item.is_packaging,
      required,
      exact_required: round4(exactRequired),
      on_hand: onHand,
      missing: round4(missing),
      suggested_purchase: round4(suggested),
      last_purchase_price: item.last_purchase_price != null ? Number(item.last_purchase_price) : null,
    });
  }

  // ממיינים: קבוצות ספק לפי שם (ללא-ספק אחרון), פריטים לפי חוסר יורד ואז שם
  const supplierGroups = Object.entries(buckets)
    .map(([key, b]) => ({
      supplier_id: key === NO_SUPPLIER ? null : key,
      supplier_name: b.supplier?.name || null,
      supplier_phone: b.supplier?.phone || null,
      items: b.items.sort((a, c) => c.missing - a.missing || a.name.localeCompare(c.name, 'he')),
      total_missing_items: b.items.filter((it) => it.missing > 0).length,
    }))
    .sort((a, b) => {
      if (!a.supplier_id) return 1; // ללא-ספק תמיד אחרון
      if (!b.supplier_id) return -1;
      return (a.supplier_name || '').localeCompare(b.supplier_name || '', 'he');
    });

  return {
    shabbat_id: shabbatId,
    suppliers: supplierGroups,
    unlinked: Object.values(unlinkedByName).map((u) => ({ ...u, quantity: round4(u.quantity) })),
    has_requirements: true,
  };
}

// לשונית מתנדבים (סעיף 9.8, 24) - מבנה מפושט, חישוב חי בלי snapshot:
//   - משימות קבועות פעילות (volunteer_tasks) + מי משובץ אליהן בשבת זו
//   - המשובץ = דריסה ידנית (is_override) אם קיימת, אחרת המתנדב הקבוע (primary),
//     ולמשימת בישול - נפילה למבשל הקבוע של המאכל (volunteer_meal_links, role=primary)
//   - משימת בישול שהמאכל שלה לא הוזמן בשבת - לא רלוונטית ומוסתרת
//   - מחליפים (backup) מוצגים כרשימת גיבוי לבחירה
export async function buildVolunteerReport(shabbatId) {
  const { shabbat, orders } = await loadShabbatOrders(shabbatId);
  if (!shabbat) return null;

  const { portionsByMeal, nameByMeal } = computePortionsByMeal(orders);
  const orderedMeals = await orderedMealIds(shabbatId);

  const [
    { data: tasks, error: taskError },
    { data: areas, error: areaError },
    { data: staffingLinks, error: staffingError },
    { data: overrides, error: overrideError },
    { data: mealLinks, error: mealLinkError },
  ] = await Promise.all([
    supabase.from('volunteer_tasks')
      .select('id, name, area_id, linked_meal_id, execution_day, shift, timing_note, display_order, meals:linked_meal_id (id, name), volunteer_task_meal_links (meal_id, meals:meal_id (id, name))')
      .eq('is_active', true).order('display_order').order('name'),
    supabase.from('volunteer_areas').select('id, name, is_cooking, display_order'),
    supabase.from('volunteer_task_links')
      .select('task_id, role, priority, volunteers:volunteer_id (id, full_name, phone, area_id, has_vehicle, is_active)'),
    supabase.from('volunteer_assignments')
      .select('id, task_id, meal_id, volunteer_id, notes, volunteers:volunteer_id (id, full_name, phone, area_id, has_vehicle)')
      .eq('shabbat_id', shabbatId).eq('is_override', true),
    supabase.from('volunteer_meal_links')
      .select('meal_id, role, volunteers:volunteer_id (id, full_name, phone, area_id, has_vehicle, is_active)'),
  ]);
  for (const result of [taskError, areaError, staffingError, overrideError, mealLinkError]) {
    if (result) throw result;
  }

  const areaById = Object.fromEntries((areas || []).map((a) => [a.id, a]));
  // קישורי צוות (primary/backup) מקובצים לפי משימה
  const staffingByTask = {};
  for (const link of staffingLinks || []) (staffingByTask[link.task_id] ||= []).push(link);
  // דריסות ידניות בשבת זו: לפי משימה (task_id) או דריסת מבשל לפי מאכל (meal_id).
  const overrideByTask = {};
  const overrideByMeal = {};
  for (const o of overrides || []) {
    if (o.task_id) overrideByTask[o.task_id] = o;
    else if (o.meal_id) overrideByMeal[o.meal_id] = o;
  }
  // מתנדבי בישול פעילים לפי מאכל, מופרדים לפי תפקיד (סעיף 24.2):
  //   primary = מבשל קבוע, הוא המשובץ בפועל (וגם הנפילה לאחראי משימת בישול).
  //   backup  = מחליף קבוע, הצעה מהירה בלבד - אינו משובץ אוטומטית.
  const mealVolunteersByMeal = {};
  const mealBackupsByMeal = {};
  for (const link of mealLinks || []) {
    if (!link.volunteers?.is_active) continue;
    const bucket = link.role === 'backup' ? mealBackupsByMeal : mealVolunteersByMeal;
    (bucket[link.meal_id] ||= []).push(link.volunteers);
  }

  const dayOrder = ['general', 'tuesday', 'wednesday', 'thursday', 'friday', 'shabbat', 'motzei_shabbat'];
  const shiftOrder = [null, 'morning', 'noon', 'evening', 'night'];

  // המאכלים המקושרים למשימה (סמנטיקת "או"): המשימה רלוונטית בשבת אם הוזמן לפחות
  // אחד מהם. אין קישורים כלל = משימה ללא התניית מאכל, תמיד רלוונטית.
  // נפילה ל-linked_meal_id הבודד למשימות ישנות שטרם קיבלו שורות קישור.
  const taskMeals = (task) => {
    const links = task.volunteer_task_meal_links || [];
    if (links.length) {
      return links.map((link) => ({ id: link.meal_id, name: link.meals?.name || nameByMeal[link.meal_id] || null }));
    }
    if (!task.linked_meal_id) return [];
    return [{ id: task.linked_meal_id, name: task.meals?.name || nameByMeal[task.linked_meal_id] || null }];
  };

  const relevantTasks = (tasks || [])
    .map((task) => ({ task, linkedMeals: taskMeals(task) }))
    .filter(({ linkedMeals }) => !linkedMeals.length || linkedMeals.some((meal) => orderedMeals.has(meal.id)));

  const enriched = relevantTasks.map(({ task, linkedMeals }) => {
    const area = areaById[task.area_id];
    // המאכלים שבגללם המשימה רלוונטית - הם שמוצגים לצד שם המשימה
    const orderedLinked = linkedMeals.filter((meal) => orderedMeals.has(meal.id));
    const shownMeals = orderedLinked.length ? orderedLinked : linkedMeals;
    const links = staffingByTask[task.id] || [];
    const primaryLink = links.find((l) => l.role === 'primary' && l.volunteers?.is_active);
    const backups = links
      .filter((l) => l.role === 'backup' && l.volunteers?.is_active)
      .sort((a, b) => (a.priority || 0) - (b.priority || 0))
      .map((l) => ({ ...l.volunteers, priority: l.priority }));

    const override = overrideByTask[task.id];
    // המתנדב האחראי בפועל: דריסה > קבוע > (תחום בישול) מתנדב מקושר למאכל
    let lead = null;
    let source = null;
    if (override?.volunteers) {
      lead = override.volunteers;
      source = 'override';
    } else if (primaryLink?.volunteers) {
      lead = primaryLink.volunteers;
      source = 'primary';
    } else if (area?.is_cooking && shownMeals.length) {
      // המאכל הראשון (מבין המוזמנים) שיש לו מבשל קבוע קובע את האחראי
      for (const meal of shownMeals) {
        lead = (mealVolunteersByMeal[meal.id] || [])[0] || null;
        if (lead) { source = 'meal'; break; }
      }
    }

    return {
      task_id: task.id,
      name: task.name,
      area_id: task.area_id,
      area_name: area?.name || '-',
      area_is_cooking: !!area?.is_cooking,
      area_display_order: area?.display_order ?? 0,
      execution_day: task.execution_day,
      shift: task.shift,
      timing_note: task.timing_note,
      display_order: task.display_order,
      linked_meal_id: linkedMeals[0]?.id || null,
      linked_meal_ids: linkedMeals.map((meal) => meal.id),
      linked_meal_name: shownMeals.map((meal) => meal.name).filter(Boolean).join(', ') || null,
      meal_is_ordered: linkedMeals.length ? orderedLinked.length > 0 : null,
      // המתנדב האחראי בשבת זו (חי)
      lead: lead ? {
        volunteer_id: lead.id,
        volunteer_name: lead.full_name,
        phone: lead.phone || null,
        has_vehicle: lead.has_vehicle || false,
        source, // override | primary | meal
        override_assignment_id: override?.id || null,
      } : null,
      is_override: !!override,
      // מחליפים (גיבוי) לבחירה
      backups: backups.map((b) => ({
        volunteer_id: b.id,
        volunteer_name: b.full_name,
        phone: b.phone || null,
        has_vehicle: b.has_vehicle || false,
        priority: b.priority,
      })),
      is_unassigned: !lead,
    };
  });

  const tasksOut = enriched.sort((a, b) =>
    a.area_display_order - b.area_display_order
    || a.area_name.localeCompare(b.area_name, 'he')
    || dayOrder.indexOf(a.execution_day) - dayOrder.indexOf(b.execution_day)
    || shiftOrder.indexOf(a.shift) - shiftOrder.indexOf(b.shift)
    || a.display_order - b.display_order
    || a.name.localeCompare(b.name, 'he'));

  // פירוט בישול פר-מאכל: כל מאכל שהוזמן בפועל בשבת (תפעולי) + כל המתנדבים
  // המשובצים לבשל אותו (volunteer_meal_links). מאכל בלי מבשל מסומן כפער.
  // נגזר ישירות מההזמנות ולא מהמשימות - כך שום מאכל שהוזמן לא נופל בין הכיסאות.
  // דריסת מבשל פר-שבת (overrideByMeal): מחליפה את המבשלים הקבועים לשבת זו בלבד.
  // מחליפים קבועים (backup_cooks) אינם משובצים - הם הצעה מהירה לדריסה ושורת גיבוי.
  const cookRow = (v) => ({
    volunteer_id: v.id,
    volunteer_name: v.full_name,
    phone: v.phone || null,
    has_vehicle: v.has_vehicle || false,
  });
  const cookingMeals = Object.keys(portionsByMeal)
    .map((mealId) => {
      const permanentCooks = (mealVolunteersByMeal[mealId] || []).map(cookRow);
      const backupCooks = (mealBackupsByMeal[mealId] || []).map(cookRow);
      const override = overrideByMeal[mealId];
      const overrideCook = override?.volunteers ? cookRow(override.volunteers) : null;
      // כשיש מחליף לשבת זו - הוא המבשל בפועל במקום הקבועים.
      const cooks = overrideCook ? [overrideCook] : permanentCooks;
      return {
        meal_id: mealId,
        meal_name: nameByMeal[mealId] || 'מאכל',
        portions: portionsByMeal[mealId],
        cooks,
        permanent_cooks: permanentCooks,
        backup_cooks: backupCooks,
        override_cook: overrideCook,
        is_override: !!overrideCook,
        is_unassigned: cooks.length === 0,
      };
    })
    .sort((a, b) => b.portions - a.portions || a.meal_name.localeCompare(b.meal_name, 'he'));

  return {
    shabbat_id: shabbatId,
    tasks: tasksOut,
    unassigned_count: tasksOut.filter((task) => task.is_unassigned).length,
    cooking_meals: cookingMeals,
    cooking_unassigned_count: cookingMeals.filter((meal) => meal.is_unassigned).length,
  };
}

// דוח פירוט ללקוח (סעיף 33.6): לכל הזמנה תפעולית - המאכלים שהזמין לפי סעודה,
// ללא מחיר וללא מצב תשלום. דף זה נשאר אצל הלקוח עם האוכל.
export async function buildCustomerSlips(shabbatId) {
  const { shabbat, orders } = await loadShabbatOrders(shabbatId);
  if (!shabbat) return null;

  const opOrders = orders.filter(isOperational);
  const { data: slots, error: slErr } = await supabase
    .from('meal_slots').select('id, name, display_order').order('display_order');
  if (slErr) throw slErr;
  const slotName = Object.fromEntries((slots || []).map((s) => [s.id, s.name]));
  const slotOrder = Object.fromEntries((slots || []).map((s) => [s.id, s.display_order ?? 999]));

  const ordersOut = opOrders.map((o) => {
    const portionsBySlot = Object.fromEntries(
      (o.order_meal_slots || []).map((ms) => [ms.meal_slot_id, Number(ms.portions || 0)]),
    );
    // מקבצים מאכלים לפי סעודה
    const bySlot = {};
    for (const om of o.order_meals || []) {
      const sid = om.meal_slot_id;
      // בקטגוריה שמחלקת מנות מציגים גם את הכמות לצד שם המאכל (למשל "סלמון × 30").
      const label = om.portions != null
        ? `${om.meal_name_snapshot} × ${Number(om.portions)}`
        : om.meal_name_snapshot;
      (bySlot[sid] ||= { slot_id: sid, slot_name: slotName[sid] || 'סעודה', portions: portionsBySlot[sid] || 0, meals: [] })
        .meals.push(label);
    }
    const slotsOut = Object.values(bySlot)
      .sort((a, b) => (slotOrder[a.slot_id] ?? 999) - (slotOrder[b.slot_id] ?? 999));
    return {
      order_id: o.id,
      order_number: o.order_number,
      customer_name: o.customers?.full_name,
      contact_name: o.contact_name || o.customers?.full_name,
      contact_phone: o.contact_phone || o.customers?.phone,
      delivery_method: o.delivery_method,
      venue_name: o.venue_name,
      venue_address: o.venue_address,
      total_portions: Object.values(portionsBySlot).reduce((a, b) => a + b, 0),
      slots: slotsOut,
    };
  });

  return { shabbat_id: shabbatId, orders: ordersOut };
}

// לשונית הדפסות / תיק עבודה (סעיף 9.9, 33): מרכז את כל הדוחות לתיק עבודה אחד
// להדפסה - שער, סיכום, מטבח, חומרי גלם וחוסרים, אריזה, שינוע, מתנדבים, ופירוט ללקוח.
// מאחד את בוני הדוחות הקיימים בקריאה אחת כדי שהפרונט יפיק מסמך מרוכז אחד.
export async function buildWorkFile(shabbatId) {
  const { shabbat } = await loadShabbatOrders(shabbatId);
  if (!shabbat) return null;

  const [summary, kitchen, inventory, packing, transport, volunteers, customerSlips] =
    await Promise.all([
      buildSummary(shabbatId),
      buildKitchenReport(shabbatId),
      buildInventoryReport(shabbatId),
      buildPackingReport(shabbatId),
      buildTransportReport(shabbatId),
      buildVolunteerReport(shabbatId),
      buildCustomerSlips(shabbatId),
    ]);

  return {
    shabbat: summary?.shabbat || null,
    generated_at: new Date().toISOString(),
    summary,
    kitchen,
    inventory,
    packing,
    transport,
    volunteers,
    customer_slips: customerSlips,
  };
}

function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}
