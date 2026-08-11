// שליחת המיילים הקשורים להזמנה (יצירה + עדכון) - ברקע, אחרי שהתשובה כבר נשלחה
// לקורא (כמו כל שליחת מייל במערכת - sendTemplateEmail בולע כשלים ולא זורק).
import { supabase } from '../lib/supabase.js';
import { sendTemplateEmail, orderVars, officeEmail } from './email.js';
import { loadOrderItems } from './orderItems.js';
import { formatOrderDetailsText } from './orderDetailsText.js';
import { editCutoffDate } from './orderEdit.js';

async function loadCustomer(customerId) {
  const { data } = await supabase
    .from('customers').select('full_name, email').eq('id', customerId).maybeSingle();
  return data;
}

async function loadShabbat(shabbatId) {
  if (!shabbatId) return null;
  const { data } = await supabase
    .from('shabbatot').select('kind, title, parasha, gregorian_date, payment_deadline')
    .eq('id', shabbatId).maybeSingle();
  return data;
}

async function buildDetailsVars(order) {
  const items = await loadOrderItems(order.id);
  return { order_details: formatOrderDetailsText({ order, ...items }) };
}

// מיילי יצירת הזמנה (סעיף 18.1-18.2): סיכום מלא ללקוח + קוד עריכה (אם הופק) +
// התראה למשרד. editCode הוא הקוד הגלוי (לפני גיבוב) - קיים ברשות הקורא לרגע קצר
// בלבד, מסביב ליצירת ההזמנה, ולא נשמר בשום מקום מלבד ה-hash שלו.
export async function sendOrderCreatedEmails({ order, shabbat, customerId, editCode }) {
  const [customer, detailsVars] = await Promise.all([loadCustomer(customerId), buildDetailsVars(order)]);
  const vars = { ...orderVars({ order, customer, shabbat }), ...detailsVars };

  await sendTemplateEmail({ code: 'order_summary', to: customer?.email, vars, orderId: order.id });

  if (editCode) {
    const deadline = editCutoffDate(shabbat?.gregorian_date);
    await sendTemplateEmail({
      code: 'order_edit_code',
      to: customer?.email,
      vars: { ...vars, edit_code: editCode, edit_deadline: deadline ? deadline.toLocaleDateString('he-IL') : '' },
      orderId: order.id,
    });
  }

  // נשלחת *רק* לתיבת המשרד, לא לכל המשתמשים בהרשאת מנהל.
  await sendTemplateEmail({ code: 'new_order_manager_alert', to: officeEmail(), vars, orderId: order.id });
}

// מייל עדכון הזמנה - נשלח בכל עריכה (ע"י מנהל או ע"י הלקוח עצמו) עם הפירוט המלא
// אחרי העדכון, כדי שהלקוח תמיד יידע בדיוק מה סוכם.
export async function sendOrderUpdatedEmail({ order, shabbat, customerId }) {
  const [customer, resolvedShabbat, detailsVars] = await Promise.all([
    loadCustomer(customerId),
    shabbat ? Promise.resolve(shabbat) : loadShabbat(order.shabbat_id),
    buildDetailsVars(order),
  ]);
  const vars = { ...orderVars({ order, customer, shabbat: resolvedShabbat }), ...detailsVars };

  await sendTemplateEmail({ code: 'order_updated', to: customer?.email, vars, orderId: order.id });
}
