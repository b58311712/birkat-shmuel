// עוזר צד-לקוח לחישוב חלון עריכת הזמנה - לצורך UX בלבד (הצגת/הסתרת כפתור "ערוך
// הזמנה"). מקור האמת האמיתי הוא תמיד השרת (server/src/services/orderEdit.js),
// שמאמת מחדש את חתך הזמן בכל בקשת אימות/עריכה בלי קשר למה שמוצג כאן.
export const EDIT_CUTOFF_DAYS = 14;

// תאריך החתך: שבועיים לפני מועד השבת/האירוע. null אם אין תאריך מועד.
export function editDeadline(order) {
  const date = order?.shabbatot?.gregorian_date;
  if (!date) return null;
  const d = new Date(date);
  d.setDate(d.getDate() - EDIT_CUTOFF_DAYS);
  return d;
}

// true אם ניתן להציע ללקוח לערוך את ההזמנה הזו כרגע.
export function canEditOrder(order) {
  if (!order) return false;
  if (order.order_kind === 'product_sale') return false;
  if (order.order_status === 'cancelled') return false;
  const deadline = editDeadline(order);
  return Boolean(deadline) && new Date() < deadline;
}
