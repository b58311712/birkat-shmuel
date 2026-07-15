// שירות תיק שבת — איחוד ההזמנות של שבת וחישובי כמויות/מטבח/אריזה (סעיף 9, 21)
//
// עיקרון מרכזי (סעיף 8.7): רק הזמנות שנכנסות ל"הכנות" משתתפות בחישובים
// תפעוליים (כמויות, מטבח, מלאי, אריזה, שינוע):
//   order_status = 'approved'
//   וגם payment_status ∈ { paid, partially_paid, payment_override }
// הזמנה שבוטלה או שלא שולמה (ואין חריגה) — לא נכנסת לחישוב.
import { supabase } from '../lib/supabase.js';
import { roundUp } from '../lib/helpers.js';
import { reconcileShabbatVolunteerTasks } from './volunteerScheduling.js';

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
// סעודות/הזמנות — נסכם את כולן (סעיף 21.2, בלי הפרדה). משמש מטבח + מלאי.
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
//   - סך מנות לכל מאכל (איחוד כל הסעודות, בלי הפרדה — סעיף 21.2)
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
  // unlinked: שורות מתכון בלי קישור למלאי — אי אפשר לחשב חוסר, מציגים בנפרד
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

    // אריזות מכללי אריזה (סעיף 22.4) — כל אריזה שמקושרת לפריט מלאי
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
    // מומלץ לקנייה (סעיף 26): לכסות את החוסר, ואם מוגדר מלאי מינימום — לקנות
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

// לשונית מתנדבים (סעיף 9.8, 24):
//   - משימות קבועות פעילות (סעיף 24.3) + מי משובץ אליהן בשבת זו
//   - משימות ללא שיבוץ (מודגשות לטיפול)
//   - טלפונים והערות של המשובצים
// שיבוץ בישול נעשה אוטומטית לפי קישור למאכל (סעיף 24.2) דרך autoAssignCooking.
export async function buildVolunteerReport(shabbatId) {
  const { shabbat, orders } = await loadShabbatOrders(shabbatId);
  if (!shabbat) return null;

  {
  await reconcileShabbatVolunteerTasks(shabbatId);
  const { nameByMeal } = computePortionsByMeal(orders);
  const [{ data: weeklyTasks, error: taskError }, { data: assignments, error: assignmentError }] = await Promise.all([
    supabase.from('shabbat_volunteer_tasks').select(`
      *, meals:linked_meal_id (id, name),
      template_task:template_task_id (
        volunteer_task_links (
          volunteer_id, role, priority,
          volunteers:volunteer_id (id, full_name, phone, area, has_vehicle, is_active)
        )
      )
    `).eq('shabbat_id', shabbatId).eq('is_relevant', true).order('display_order').order('name'),
    supabase.from('volunteer_assignments').select(`
      id, shabbat_task_id, volunteer_id, is_auto, notes, assignment_kind, source,
      volunteers (id, full_name, phone, area, has_vehicle)
    `).eq('shabbat_id', shabbatId).not('shabbat_task_id', 'is', null),
  ]);
  if (taskError) throw taskError;
  if (assignmentError) throw assignmentError;

  const assignmentsByTask = {};
  for (const assignment of assignments || []) {
    (assignmentsByTask[assignment.shabbat_task_id] ||= []).push(assignment);
  }
  const areaLabels = {
    cooking: 'בישול', packing: 'אריזה', transport: 'שינוע', cleaning: 'ניקיון', general: 'כללי',
  };
  const dayOrder = ['general', 'tuesday', 'wednesday', 'thursday', 'friday', 'shabbat', 'motzei_shabbat'];
  const shiftOrder = [null, 'morning', 'noon', 'evening', 'night'];
  const sortedWeeklyTasks = [...(weeklyTasks || [])].sort((a, b) =>
    (a.parent_category_display_order ?? a.category_display_order) - (b.parent_category_display_order ?? b.category_display_order)
    || a.category_display_order - b.category_display_order
    || dayOrder.indexOf(a.execution_day) - dayOrder.indexOf(b.execution_day)
    || shiftOrder.indexOf(a.shift) - shiftOrder.indexOf(b.shift)
    || a.display_order - b.display_order
    || a.name.localeCompare(b.name, 'he'));
  const tasksOut = sortedWeeklyTasks.map((task) => {
    const staffing = task.template_task?.volunteer_task_links || [];
    const preferredCandidates = ['backup', 'candidate'].flatMap((role) => staffing
      .filter((link) => link.role === role && link.volunteers?.is_active)
      .sort((a, b) => (a.priority || 0) - (b.priority || 0))
      .map((link) => ({ ...link.volunteers, role, priority: link.priority })));
    const assigned = (assignmentsByTask[task.id] || []).filter((row) => row.volunteer_id).map((row) => ({
      assignment_id: row.id,
      volunteer_id: row.volunteer_id,
      volunteer_name: row.volunteers?.full_name,
      phone: row.volunteers?.phone || null,
      has_vehicle: row.volunteers?.has_vehicle || false,
      is_auto: row.is_auto,
      source: row.source,
      assignment_kind: row.assignment_kind,
      notes: row.notes || null,
    }));
    return {
      shabbat_task_id: task.id,
      task_id: task.template_task_id,
      name: task.name,
      area: task.area,
      area_label: areaLabels[task.area] || task.area,
      category_id: task.category_id,
      category_name: task.category_name,
      parent_category_id: task.parent_category_id,
      parent_category_name: task.parent_category_name,
      execution_day: task.execution_day,
      shift: task.shift,
      timing_note: task.timing_note,
      display_order: task.display_order,
      linked_meal_id: task.linked_meal_id,
      linked_meal_name: task.meals?.name || nameByMeal[task.linked_meal_id] || null,
      default_volunteer_id: task.default_volunteer_id,
      has_manual_override: task.has_manual_override,
      preferred_candidates: preferredCandidates,
      assigned,
      is_unassigned: !assigned.some((row) => row.assignment_kind === 'lead'),
    };
  });
  return {
    shabbat_id: shabbatId,
    tasks: tasksOut,
    unassigned_count: tasksOut.filter((task) => task.is_unassigned).length,
    free_assignments: [],
  };
  }

  // מאכלים תפעוליים בשבת — כדי לסמן אילו משימות בישול רלוונטיות בפועל
  const { portionsByMeal, nameByMeal } = computePortionsByMeal(orders);
  const operationalMealIds = new Set(Object.keys(portionsByMeal));

  const [{ data: tasks, error: tErr }, { data: assignments, error: aErr }] = await Promise.all([
    supabase.from('volunteer_tasks')
      .select('id, name, area, linked_meal_id, display_order')
      .eq('is_active', true)
      .order('display_order').order('name'),
    supabase.from('volunteer_assignments')
      .select(`
        id, task_id, volunteer_id, is_auto, notes,
        volunteers ( id, full_name, phone, area, has_vehicle )
      `)
      .eq('shabbat_id', shabbatId),
  ]);
  if (tErr) throw tErr;
  if (aErr) throw aErr;

  // שמות מאכלים מקושרים למשימות (למקרה שהמאכל לא הוזמן ואין snapshot)
  const linkedMealIds = [...new Set((tasks || []).map((t) => t.linked_meal_id).filter(Boolean))];
  const mealNameById = { ...nameByMeal };
  const missingMealIds = linkedMealIds.filter((id) => !mealNameById[id]);
  if (missingMealIds.length) {
    const { data: meals } = await supabase.from('meals').select('id, name').in('id', missingMealIds);
    for (const m of meals || []) mealNameById[m.id] = m.name;
  }

  // מקבצים שיבוצים לפי משימה
  const assignByTask = {};
  const unassignedTaskAssignments = []; // שיבוצים ללא task_id (חופשי) — נדיר
  for (const a of assignments || []) {
    if (a.task_id) (assignByTask[a.task_id] ||= []).push(a);
    else unassignedTaskAssignments.push(a);
  }

  const AREA_LABELS = {
    cooking: 'בישול', packing: 'אריזה', transport: 'שינוע',
    cleaning: 'ניקיון', general: 'כללי',
  };

  const tasksOut = (tasks || []).map((t) => {
    const rows = (assignByTask[t.id] || [])
      .filter((a) => a.volunteer_id) // רק שיבוצים בפועל
      .map((a) => ({
        assignment_id: a.id,
        volunteer_id: a.volunteer_id,
        volunteer_name: a.volunteers?.full_name,
        phone: a.volunteers?.phone || null,
        has_vehicle: a.volunteers?.has_vehicle || false,
        is_auto: a.is_auto,
        notes: a.notes || null,
      }));
    return {
      task_id: t.id,
      name: t.name,
      area: t.area,
      area_label: AREA_LABELS[t.area] || t.area,
      linked_meal_id: t.linked_meal_id,
      linked_meal_name: t.linked_meal_id ? (mealNameById[t.linked_meal_id] || null) : null,
      // סימון: משימת בישול שהמאכל שלה מוזמן בשבת אך אין לה מתנדב
      meal_is_ordered: t.linked_meal_id ? operationalMealIds.has(t.linked_meal_id) : null,
      assigned: rows,
      is_unassigned: rows.length === 0,
    };
  });

  return {
    shabbat_id: shabbatId,
    tasks: tasksOut,
    unassigned_count: tasksOut.filter((t) => t.is_unassigned).length,
    free_assignments: unassignedTaskAssignments
      .filter((a) => a.volunteer_id)
      .map((a) => ({
        assignment_id: a.id,
        volunteer_id: a.volunteer_id,
        volunteer_name: a.volunteers?.full_name,
        phone: a.volunteers?.phone || null,
        notes: a.notes || null,
      })),
  };
}

// שיבוץ אוטומטי של מתנדבי בישול (סעיף 24.2): לכל משימת בישול עם קישור למאכל,
// אם המאכל מוזמן בשבת (תפעולי) — משבצים אוטומטית מתנדבים פעילים המקושרים
// לאותו מאכל, אם עדיין לא משובצים. מחזיר { created } — כמה שיבוצים נוצרו.
export async function autoAssignCooking(shabbatId) {
  const result = await reconcileShabbatVolunteerTasks(shabbatId);
  return { created: 0, refreshed: result.task_count };

  const { shabbat, orders } = await loadShabbatOrders(shabbatId);
  if (!shabbat) return { created: 0 };

  const { portionsByMeal } = computePortionsByMeal(orders);
  const orderedMealIds = new Set(Object.keys(portionsByMeal));

  // משימות בישול עם מאכל מקושר שמוזמן בפועל
  const { data: tasks, error: tErr } = await supabase.from('volunteer_tasks')
    .select('id, linked_meal_id')
    .eq('is_active', true).eq('area', 'cooking').not('linked_meal_id', 'is', null);
  if (tErr) throw tErr;
  const relevantTasks = (tasks || []).filter((t) => orderedMealIds.has(t.linked_meal_id));
  if (!relevantTasks.length) return { created: 0 };

  const mealIds = [...new Set(relevantTasks.map((t) => t.linked_meal_id))];

  // מתנדבי בישול פעילים המקושרים למאכלים אלה. מתנדב יכול להיות מקושר למספר
  // מאכלים (volunteer_meal_links, סעיף 24.2) ולכן משבצים אותו לכל משימת בישול
  // שהמאכל שלה מקושר אליו.
  const { data: cookingAreaLinks, error: areaErr } = await supabase.from('volunteer_area_links')
    .select('volunteer_id')
    .eq('area', 'cooking');
  if (areaErr) throw areaErr;
  const cookingVolunteerIds = [...new Set((cookingAreaLinks || []).map((link) => link.volunteer_id))];
  if (!cookingVolunteerIds.length) return { created: 0 };

  const { data: links, error: vErr } = await supabase.from('volunteer_meal_links')
    .select('meal_id, volunteer_id, volunteers!inner (id, is_active)')
    .in('meal_id', mealIds)
    .in('volunteer_id', cookingVolunteerIds)
    .eq('volunteers.is_active', true);
  if (vErr) throw vErr;
  const volsByMeal = {};
  for (const l of links || []) {
    if (!l.volunteers) continue;
    (volsByMeal[l.meal_id] ||= []).push({ id: l.volunteers.id });
  }

  // שיבוצים קיימים בשבת זו — לא ליצור כפילויות (task+volunteer)
  const { data: existing, error: eErr } = await supabase.from('volunteer_assignments')
    .select('task_id, volunteer_id').eq('shabbat_id', shabbatId);
  if (eErr) throw eErr;
  const existingKeys = new Set((existing || []).map((a) => `${a.task_id}::${a.volunteer_id}`));

  const toInsert = [];
  for (const task of relevantTasks) {
    for (const vol of volsByMeal[task.linked_meal_id] || []) {
      const key = `${task.id}::${vol.id}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      toInsert.push({
        shabbat_id: shabbatId, task_id: task.id, volunteer_id: vol.id, is_auto: true,
      });
    }
  }

  if (!toInsert.length) return { created: 0 };
  const { error: iErr } = await supabase.from('volunteer_assignments').insert(toInsert);
  if (iErr) throw iErr;
  return { created: toInsert.length };
}

// דוח פירוט ללקוח (סעיף 33.6): לכל הזמנה תפעולית — המאכלים שהזמין לפי סעודה,
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
// להדפסה — שער, סיכום, מטבח, חומרי גלם וחוסרים, אריזה, שינוע, מתנדבים, ופירוט ללקוח.
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
