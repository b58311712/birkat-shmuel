// בניית פירוט הזמנה מלא כטקסט פשוט (multi-line) לשילוב במיילים דרך placeholder
// {order_details}. משמש גם ביצירת הזמנה וגם בעדכון (orderNotifications.js) - אותו
// פורמט בשני המקרים. renderBrandedEmail (emailTemplate.js) הופך שורה בודדת ל-<br>
// ושורה ריקה לפסקה חדשה, כך שטקסט פשוט עם \n מספיק - אין צורך ב-HTML כאן.
import { PAYMENT_METHOD_HE } from './email.js';

// input: { order, slots, meals, extras } - אותה צורה שמחזיר loadOrderItems (orderItems.js).
export function formatOrderDetailsText({ order, slots = [], meals = [], extras = [] }) {
  const mealsBySlot = {};
  for (const m of meals) (mealsBySlot[m.meal_slot_id] ||= []).push(m);

  const lines = [];

  for (const s of slots) {
    const slotName = s.meal_slots?.name || 'סעודה';
    lines.push(`${slotName} - ${Number(s.portions)} מנות`);
    const slotMeals = mealsBySlot[s.meal_slot_id] || [];
    if (slotMeals.length) {
      for (const m of slotMeals) {
        const qty = m.portions != null ? ` × ${Number(m.portions)}` : '';
        const charge = Number(m.extra_charge_amount) > 0
          ? ` (תוספת תשלום: ${Number(m.extra_charge_amount).toFixed(2)} ש"ח למנה)`
          : '';
        lines.push(`  • ${m.meal_name_snapshot}${qty}${charge}`);
      }
    } else {
      lines.push('  לא נבחרו מאכלים');
    }
  }

  if (extras.length) {
    lines.push('');
    lines.push('תוספות בתשלום:');
    for (const e of extras) {
      lines.push(`  • ${e.extra_name_snapshot} × ${Number(e.actual_quantity)} - ${Number(e.line_total).toFixed(2)} ש"ח`);
    }
  }

  lines.push('');
  lines.push('פרטי משלוח:');
  lines.push(`שם האולם: ${order.venue_name || '-'}`);
  lines.push(`כתובת: ${order.venue_address || '-'}`);
  if (order.contact_name || order.contact_phone) {
    const phone = order.contact_phone ? ` (${order.contact_phone})` : '';
    lines.push(`איש קשר: ${order.contact_name || '-'}${phone}`);
  }
  lines.push(`אמצעי תשלום: ${PAYMENT_METHOD_HE[order.preferred_payment_method] || '-'}`);
  if (order.notes) lines.push(`הערות: ${order.notes}`);

  lines.push('');
  lines.push('סיכום מחיר:');
  lines.push(`מחיר בסיס: ${Number(order.base_amount).toFixed(2)} ש"ח`);
  lines.push(`תוספות: ${Number(order.extras_amount).toFixed(2)} ש"ח`);
  if (Number(order.manual_charges_amount) > 0) lines.push(`חיובים נוספים: ${Number(order.manual_charges_amount).toFixed(2)} ש"ח`);
  if (Number(order.discount_amount) > 0) lines.push(`הנחה: -${Number(order.discount_amount).toFixed(2)} ש"ח`);
  lines.push(`סה"כ לתשלום: ${Number(order.final_amount).toFixed(2)} ש"ח`);

  return lines.join('\n');
}
