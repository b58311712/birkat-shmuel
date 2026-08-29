// =============================================================================
// שליחת הזמנת רכש לספק במייל (סעיף 27.2-27.3, מיגרציה 61)
// =============================================================================
// עד מיגרציה 61 "נשלחה לספק" היה סימון ידני בלבד. כאן נבנה המייל בפועל:
//   - הנוסח נשמר ב-email_templates תחת purchase_order_supplier ונערך ע"י
//     המנהלת ב-/admin/email (דינמיות, סעיף 3).
//   - {po_lines} מוחלף בפירוט הפריטים; שאר ה-placeholders נקראים כשמות שדות
//     ההזמנה, כדי שהנוסח יהיה קריא למנהלת.
//   - buildPurchaseOrderEmail מחזיר את הנוסח *לאחר* מילוי ה-placeholders, כדי
//     שהמנהלת תראה תצוגה מקדימה ותוכל לערוך לפני השליחה. הראוט שולח את מה
//     שחזר ממנה כמות שהוא ולא ממלא שוב (ראו sendCustomEmail ב-email.js).
// בניית הטקסט עצמה יושבת ב-lib/purchaseOrderText.js (טהורה, ניתנת לבדיקה).
// =============================================================================
import { supabase } from '../lib/supabase.js';
import { loadTemplate, fillTemplate } from './email.js';
import { purchaseOrderVars, resolveDeliveryDestination } from '../lib/purchaseOrderText.js';

export const PURCHASE_ORDER_TEMPLATE_CODE = 'purchase_order_supplier';

// כתובת המטבח יושבת ב-system_settings כדי שניתן יהיה לשנותה בלי דיפלוי
// (מיגרציה 63). הנפילה כאן היא רשת ביטחון בלבד, למקרה שההגדרה נמחקה.
const DEFAULT_KITCHEN_ADDRESS = 'רח׳ החוזה מלובלין 1, ביתר עילית';

async function kitchenAddress() {
  const { data, error } = await supabase
    .from('system_settings').select('value').eq('key', 'kitchen_address').maybeSingle();
  if (error) throw error;
  // value הוא jsonb; מחרוזת מגיעה כמחרוזת JS, וכל ערך אחר לא רלוונטי כאן.
  const value = typeof data?.value === 'string' ? data.value.trim() : '';
  return value || DEFAULT_KITCHEN_ADDRESS;
}

// =============================================================================
// buildPurchaseOrderEmail - טוען הזמנה+ספק+שורות, ומחזיר את המייל המוצע.
// מחזיר { purchase_order, supplier, lines, to, subject, body, template_active }.
// זורק שגיאה עם דגל notFound כשההזמנה לא קיימת (הראוט מתרגם ל-404).
// =============================================================================
export async function buildPurchaseOrderEmail(poId) {
  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select(`*,
      supplier:supplier_id (id, name, contact_name, phone, email, preferred_channel, order_notes, delivery_destination),
      order:order_id (id, order_number, venue_name, venue_address, contact_name, contact_phone)`)
    .eq('id', poId)
    .maybeSingle();
  if (error) throw error;
  if (!po) {
    const err = new Error('הזמנת רכש לא נמצאה.');
    err.notFound = true;
    throw err;
  }

  const { data: lines, error: lErr } = await supabase
    .from('purchase_order_lines')
    .select('*, item:inventory_item_id (id, name, unit)')
    .eq('purchase_order_id', poId)
    .order('created_at');
  if (lErr) throw lErr;

  const tpl = await loadTemplate(PURCHASE_ORDER_TEMPLATE_CODE);
  const delivery = resolveDeliveryDestination({
    supplier: po.supplier,
    order: po.order,
    kitchenAddress: await kitchenAddress(),
  });
  const vars = purchaseOrderVars({ po, supplier: po.supplier, lines: lines || [], delivery });

  return {
    purchase_order: po,
    supplier: po.supplier || null,
    order: po.order || null,
    lines: lines || [],
    delivery,
    to: po.supplier?.email || '',
    subject: tpl ? fillTemplate(tpl.subject, vars) : '',
    body: tpl ? fillTemplate(tpl.body, vars) : '',
    template_active: !!tpl?.is_active,
  };
}
