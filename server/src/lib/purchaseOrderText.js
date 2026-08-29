// =============================================================================
// בניית הטקסט של הזמנת רכש לספק (מיגרציה 61)
// =============================================================================
// טהור - בלי גישה ל-DB, כדי שיהיה ניתן לבדיקה ישירה (ראו test/purchaseOrderText).
// השירות services/purchaseOrderEmail.js טוען את הנתונים וקורא לפונקציות כאן.
//
// כוונה: מחירים אינם נכללים בפירוט לספק. estimated_price הוא מחיר קנייה אחרון
// משוער, ושליחתו לספק עלולה להיקרא כמחיר מוסכם. המנהלת יכולה להוסיף מחיר ידנית
// בגוף המייל לפני השליחה (הנוסח ניתן לעריכה במסך השליחה).
// =============================================================================

// --- מספר קריא: 2.5 ולא 2.5000, 3 ולא 3.0000 ---
function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  return String(Number(number.toFixed(4)));
}

// --- כמות בשורת הזמנה: "3 ארגז + 2 ק״ג" כשיש מארז, אחרת "5 ק״ג" ---
// זהה בהתנהגותה ל-formatInventoryQuantity בצד הלקוח, אך על סמך ה-snapshot
// שנשמר בשורה (ולא כרטיס המוצר, שאולי השתנה מאז יצירת ההזמנה).
export function formatLineQuantity(line) {
  const quantity = Number(line?.quantity);
  const unit = line?.item?.unit || '';
  const label = line?.package_label_snapshot;
  const size = Number(line?.package_size_snapshot);
  if (!Number.isFinite(quantity)) return '';
  if (!(size > 0) || !label) return `${formatNumber(quantity)} ${unit}`.trim();

  const packages = Math.floor((quantity + 1e-9) / size);
  const looseRaw = quantity - packages * size;
  const loose = Math.abs(looseRaw) < 0.0001 ? 0 : Number(looseRaw.toFixed(4));
  const parts = [`${packages} ${label}`];
  if (loose > 0) parts.push(`${formatNumber(loose)} ${unit}`.trim());
  return parts.join(' + ');
}

// --- פירוט הפריטים כטקסט פשוט (placeholder {po_lines}) ---
// renderBrandedEmail הופך \n ל-<br>, ולכן טקסט פשוט מספיק - בלי HTML כאן.
export function formatPurchaseOrderLinesText(lines = []) {
  return lines
    .map((line) => `• ${line?.item?.name || 'פריט'} - ${formatLineQuantity(line)}`)
    .join('\n');
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('he-IL');
}

// --- ערכי ה-placeholders של נוסח הספק ---
export function purchaseOrderVars({ po, supplier, lines }) {
  return {
    supplier_name: supplier?.name || '',
    contact_name: supplier?.contact_name || '',
    po_number: po?.po_number != null ? String(po.po_number) : '',
    po_date: formatDate(po?.created_at),
    // ספק חייב לדעת מתי; בלי תאריך יעד עדיף נוסח מפורש על פני שורה ריקה.
    expected_delivery_date: po?.expected_delivery_date
      ? formatDate(po.expected_delivery_date)
      : 'בהקדם האפשרי',
    po_lines: formatPurchaseOrderLinesText(lines),
    // הקידומת נכללת בערך עצמו, כדי שנוסח בלי הערות לא ישאיר שורה מיותמת.
    po_notes: po?.notes ? `הערות: ${po.notes}` : '',
    supplier_order_notes: supplier?.order_notes || '',
  };
}
