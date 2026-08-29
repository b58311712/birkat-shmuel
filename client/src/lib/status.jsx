// תרגום סטטוסים לעברית + צבעי תג
export const ORDER_STATUS = {
  pending_approval: { label: 'ממתין לאישור', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'מאושר', cls: 'bg-green-100 text-green-800' },
  needs_correction: { label: 'דורש תיקון', cls: 'bg-orange-100 text-orange-800' },
  cancelled: { label: 'בוטל', cls: 'bg-gray-200 text-gray-600' },
  delivered: { label: 'סופק', cls: 'bg-blue-100 text-blue-800' },
};

export const PAYMENT_STATUS = {
  unpaid: { label: 'לא שולם', cls: 'bg-red-100 text-red-700' },
  partially_paid: { label: 'שולם חלקית', cls: 'bg-amber-100 text-amber-800' },
  paid: { label: 'שולם', cls: 'bg-green-100 text-green-800' },
};

// סטטוס החזר כספי (סעיף 19.4)
export const REFUND_STATUS = {
  not_required: { label: 'לא נדרש החזר', cls: 'bg-gray-100 text-gray-600' },
  pending: { label: 'ממתין להחזר', cls: 'bg-amber-100 text-amber-800' },
  partial: { label: 'הוחזר חלקית', cls: 'bg-blue-100 text-blue-800' },
  full: { label: 'הוחזר במלואו', cls: 'bg-green-100 text-green-800' },
  cancelled: { label: 'החזר בוטל', cls: 'bg-gray-200 text-gray-500' },
};

export const CUSTOMER_STATUS = {
  active: { label: 'פעיל', cls: 'bg-green-100 text-green-800' },
  pending_approval: { label: 'ממתין לאישור', cls: 'bg-amber-100 text-amber-800' },
  inactive: { label: 'לא פעיל', cls: 'bg-gray-200 text-gray-600' },
  blocked: { label: 'חסום', cls: 'bg-red-100 text-red-700' },
};

export const ACTIVE_STATUS = {
  active: { label: 'פעיל', cls: 'bg-green-100 text-green-800' },
  active_female: { label: 'פעילה', cls: 'bg-green-100 text-green-800' },
  inactive: { label: 'לא פעיל', cls: 'bg-gray-200 text-gray-600' },
  inactive_female: { label: 'לא פעילה', cls: 'bg-gray-200 text-gray-600' },
};

// תיאורים בעברית לשדות שהתקבלו מהטופס (ללא צבע - טקסט בלבד)
export const DELIVERY_METHOD = {
  volunteer_transport: 'שינוע ע"י מתנדבים',
  self_pickup: 'איסוף עצמי מהמטבח',
};

export const PAYMENT_METHOD = {
  bank_transfer: 'העברה בנקאית',
  cash: 'מזומן',
  check: 'צ׳ק',
};

// אמצעי תשלום עבור מסכי הוצאות (הוצאות חופשיות/קבועות, תשלום לספק) - רשימה
// סגורה, שדה חובה. סדר התצוגה כפי שנקבע: מזומן, צ'ק, אשראי, העברה בנקאית, אחר.
export const EXPENSE_PAYMENT_METHOD = {
  cash: 'מזומן',
  check: 'צ׳ק',
  credit: 'אשראי',
  bank_transfer: 'העברה בנקאית',
  other: 'אחר',
};

// אמצעי תשלום הניתנים לבחירה בטופס הזמנה (יצירה/עריכה - הלקוח והמנהל).
// 'check' הוסר כאפשרות לבחירה; ה-map המלא PAYMENT_METHOD נשאר לתצוגת הזמנות ישנות.
export const ORDER_PAYMENT_METHOD = Object.fromEntries(
  Object.entries(PAYMENT_METHOD).filter(([key]) => key !== 'check')
);

// תווית מועד: שבת מזוהה בפרשה, אירוע מזוהה בשם (מיגרציה 52).
// מקור אמת אחד לכל המסכים שמציגים "לאיזה מועד ההזמנה שייכת", כדי שאירוע לא
// יופיע כמקף רק בגלל ש-parasha ריק אצלו.
export function occasionLabel(occasion) {
  if (!occasion) return '-';
  return (occasion.kind === 'event' ? occasion.title : occasion.parasha) || '-';
}

// סוג הזמנה (מיגרציה 55)
export const ORDER_KIND = {
  occasion: { label: 'הזמנת מועד', cls: 'bg-brand-cream text-brand-burgundy' },
  product_sale: { label: 'מכירת מוצרים', cls: 'bg-emerald-100 text-emerald-800' },
};

// תווית ההקשר של הזמנה: לאיזה מועד היא שייכת, או "מכירת מוצרים" כשאין מועד.
// מקור אמת אחד לכל המסכים המציגים רשימת הזמנות, כדי שמכירה לא תופיע כמקף רק
// בגלל ש-shabbatot ריק אצלה (מיגרציה 55).
export function orderContextLabel(order) {
  if (!order) return '-';
  if (order.order_kind === 'product_sale') return ORDER_KIND.product_sale.label;
  return occasionLabel(order.shabbatot);
}

// תאריך ההקשר של הזמנה: תאריך המועד, או תאריך המכירה כשאין מועד.
export function orderContextDate(order) {
  if (!order) return null;
  return order.shabbatot?.gregorian_date || order.sale_date || null;
}

// סוג אירוע (מיגרציה 52)
export const EVENT_TYPE = {
  community: { label: 'אירוע קהילה', cls: 'bg-indigo-100 text-indigo-800' },
  private: { label: 'אירוע פרטי', cls: 'bg-teal-100 text-teal-800' },
};

// סטטוס מועד (שבת או אירוע)
export const OCCASION_STATUS = {
  open: { label: 'פתוח', cls: 'bg-green-100 text-green-800' },
  closed: { label: 'סגור', cls: 'bg-amber-100 text-amber-800' },
  completed: { label: 'הושלם', cls: 'bg-blue-100 text-blue-800' },
  cancelled: { label: 'בוטל', cls: 'bg-gray-200 text-gray-600' },
};

// סטטוס הזמנת רכש (סעיף 27.3)
export const PO_STATUS = {
  draft: { label: 'טיוטה', cls: 'bg-gray-200 text-gray-700' },
  sent: { label: 'נשלחה לספק', cls: 'bg-blue-100 text-blue-800' },
  partially_received: { label: 'התקבלה חלקית', cls: 'bg-amber-100 text-amber-800' },
  received: { label: 'התקבלה במלואה', cls: 'bg-green-100 text-green-800' },
  cancelled: { label: 'בוטלה', cls: 'bg-gray-200 text-gray-500' },
};

// סטטוס תשלום לספק (סעיף 28.1)
export const SUPPLIER_PAYMENT_STATUS = {
  unpaid: { label: 'לא שולם', cls: 'bg-red-100 text-red-700' },
  partially_paid: { label: 'שולם חלקית', cls: 'bg-amber-100 text-amber-800' },
  paid: { label: 'שולם במלואו', cls: 'bg-green-100 text-green-800' },
  awaiting_invoice: { label: 'ממתין לחשבונית', cls: 'bg-purple-100 text-purple-800' },
  cancelled: { label: 'בוטל', cls: 'bg-gray-200 text-gray-500' },
};

// אמצעי הזמנה מספק (סעיף 27.1)
export const SUPPLIER_CHANNEL = {
  phone: 'טלפון',
  email: 'מייל',
  whatsapp: 'וואטסאפ',
  other: 'אחר',
};

// יעד האספקה של הספק (מיגרציה 63): המטבח, או ישירות לאולם של הזמנת הלקוח
// המקושרת להזמנת הרכש. הכתובת עצמה יושבת ב-system_settings.kitchen_address.
export const SUPPLIER_DELIVERY_DESTINATION = {
  kitchen: 'מטבח החסד',
  event_venue: 'מקום האירוע',
};

// תוצאת שליחת מייל (יומן המיילים ושליחת הזמנת רכש לספק - מיגרציה 61).
// dry_run = אין מסלול שליחה מוגדר בסביבה, המייל נשמר ביומן ולא יצא בפועל.
export const EMAIL_SEND_STATUS = {
  sent: { label: 'נשלח', cls: 'bg-green-100 text-green-800' },
  dry_run: { label: 'מצב יבש', cls: 'bg-amber-100 text-amber-800' },
  failed: { label: 'נכשל', cls: 'bg-red-100 text-red-700' },
};

export function Badge({ map, value }) {
  const s = map[value] || { label: value, cls: 'bg-gray-100 text-gray-600' };
  const isPayment = map === PAYMENT_STATUS || map === SUPPLIER_PAYMENT_STATUS;

  return (
    <span className={`badge ${isPayment ? 'badge-payment' : ''} ${s.cls}`}>
      {isPayment
        ? <span className="badge-payment-mark" aria-hidden="true">₪</span>
        : <span className="badge-dot" aria-hidden="true" />}
      {s.label}
    </span>
  );
}
