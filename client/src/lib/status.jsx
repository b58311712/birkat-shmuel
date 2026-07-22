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
  payment_override: { label: 'אושרה חריגה', cls: 'bg-purple-100 text-purple-800' },
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
