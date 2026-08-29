import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLineQuantity,
  formatPurchaseOrderLinesText,
  purchaseOrderVars,
} from '../src/lib/purchaseOrderText.js';

const PO = {
  po_number: 20260012,
  created_at: '2026-08-30T09:00:00Z',
  expected_delivery_date: '2026-09-03',
  notes: 'לפרוק בכניסה האחורית',
};

const SUPPLIER = { name: 'ירקות השדה בע״מ', contact_name: 'משה', order_notes: 'להתקשר לפני' };

// פריט ללא מארז מוצג ביחידת המידה שלו.
test('a loose line is written in its own unit', () => {
  assert.equal(
    formatLineQuantity({ quantity: 5, item: { unit: 'ק״ג' } }),
    '5 ק״ג',
  );
});

// פריט עם מארז מוצג במארזים שלמים, כדי שהספק יידע כמה ארגזים להוריד.
test('a packaged line is written in whole packages', () => {
  assert.equal(
    formatLineQuantity({
      quantity: 30,
      package_label: 'ארגז',
      package_label_snapshot: 'ארגז',
      package_size_snapshot: 10,
      item: { unit: 'ק״ג' },
    }),
    '3 ארגז',
  );
});

// שארית שאינה מארז שלם מתווספת ביחידות - ולא מעוגלת בשקט.
test('a partial package keeps its remainder in units', () => {
  assert.equal(
    formatLineQuantity({
      quantity: 32.5,
      package_label_snapshot: 'ארגז',
      package_size_snapshot: 10,
      item: { unit: 'ק״ג' },
    }),
    '3 ארגז + 2.5 ק״ג',
  );
});

// ה-snapshot של השורה קובע, גם אם כרטיס המוצר השתנה מאז יצירת ההזמנה.
test('lines are listed one per row with a bullet', () => {
  const text = formatPurchaseOrderLinesText([
    { quantity: 4, item: { name: 'עגבניות', unit: 'ק״ג' } },
    { quantity: 20, package_label_snapshot: 'שק', package_size_snapshot: 10, item: { name: 'תפוחי אדמה', unit: 'ק״ג' } },
  ]);
  assert.equal(text, '• עגבניות - 4 ק״ג\n• תפוחי אדמה - 2 שק');
});

// הערות ההזמנה נושאות את הקידומת בתוך הערך, כדי שנוסח בלי הערות לא ישאיר
// שורה ריקה מיותמת בגוף המייל.
test('order notes carry their own prefix and are empty when absent', () => {
  assert.equal(purchaseOrderVars({ po: PO, supplier: SUPPLIER, lines: [] }).po_notes, 'הערות: לפרוק בכניסה האחורית');
  assert.equal(purchaseOrderVars({ po: { ...PO, notes: null }, supplier: SUPPLIER, lines: [] }).po_notes, '');
});

// הזמנה בלי תאריך אספקה לא משאירה שדה ריק במייל לספק.
test('a missing delivery date falls back to an explicit wording', () => {
  const vars = purchaseOrderVars({ po: { ...PO, expected_delivery_date: null }, supplier: SUPPLIER, lines: [] });
  assert.equal(vars.expected_delivery_date, 'בהקדם האפשרי');
});

// מספר ההזמנה מועבר כמחרוזת - fillTemplate מחליף רק ערכים שאינם null.
test('the po number reaches the template as a filled value', () => {
  const vars = purchaseOrderVars({ po: PO, supplier: SUPPLIER, lines: [] });
  assert.equal(vars.po_number, '20260012');
  assert.equal(vars.supplier_name, 'ירקות השדה בע״מ');
  assert.equal(vars.contact_name, 'משה');
});
