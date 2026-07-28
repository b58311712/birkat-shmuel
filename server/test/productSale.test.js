import test from 'node:test';
import assert from 'node:assert/strict';
import { priceSaleLine } from '../src/lib/saleLine.js';

const ITEM = {
  id: 'i1',
  name: 'צלחות חד-פעמיות',
  unit: 'יחידה',
  unit_id: 'u-unit',
  last_purchase_price: 5,
  vat_exempt: false,
  is_active: true,
  procurement_type: 'stock',
};

// המחיר ללקוח הוא מחיר העלות כולל מע"מ, בלי רווח.
test('a sale line is priced at cost including VAT', () => {
  const { row, qtyBase } = priceSaleLine(ITEM, { quantity: 3 }, 18, {});
  assert.equal(row.unit_cost, 5.9);
  assert.equal(row.line_total, 17.7);
  assert.equal(row.quantity, 3);
  assert.equal(qtyBase, 3);
});

// פריט פטור ממע"מ (פירות/ירקות) נמכר במחיר הבסיס עצמו.
test('a VAT exempt item is sold at its base price', () => {
  const { row } = priceSaleLine({ ...ITEM, vat_exempt: true }, { quantity: 2 }, 18, {});
  assert.equal(row.unit_cost, 5);
  assert.equal(row.line_total, 10);
});

// מכירה ביחידת אריזה: המחיר מוכפל בפקטור ההמרה, והכמות שיורדת מהמלאי היא
// ביחידת הבסיס. שני החישובים חייבים לנבוע מאותו פקטור.
test('selling by a package unit scales both the price and the deducted quantity', () => {
  const { row, qtyBase } = priceSaleLine(
    ITEM, { quantity: 2, unit_id: 'u-box' }, 18, { 'u-box': 50 },
  );
  assert.equal(row.unit_cost, 295);   // 5.90 ליחידה * 50 יחידות בחבילה
  assert.equal(row.line_total, 590);
  assert.equal(qtyBase, 100);         // 2 חבילות * 50 יחידות
});

// מחיר עלות חסר חוסם. זו חריגה מכוונת מ-costing.js, שם מחיר חסר רק מדווח
// כאזהרה: שם זו הערכה פנימית, כאן זה כסף שנגבה מלקוח, ו-0 היה מוסר בחינם.
test('a missing purchase price blocks the sale instead of charging zero', () => {
  const { error, row } = priceSaleLine({ ...ITEM, last_purchase_price: null }, { quantity: 1 }, 18, {});
  assert.equal(row, undefined);
  assert.match(error, /מחיר עלות אחרון/);
});

// המרת יחידות חסרה חוסמת: בלעדיה לא ניתן לדעת כמה יורד מהמלאי.
test('a missing unit conversion blocks the sale', () => {
  const { error } = priceSaleLine(ITEM, { quantity: 1, unit_id: 'u-crate' }, 18, { 'u-box': 50 });
  assert.match(error, /המרת יחידות/);
});

test('an inactive item cannot be sold', () => {
  const { error } = priceSaleLine({ ...ITEM, is_active: false }, { quantity: 1 }, 18, {});
  assert.match(error, /אינו פעיל/);
});

// רכש ישיר לאירוע אינו מנוהל ככמות במלאי (מיגרציה 50 אוכפת עליו מלאי אפס),
// ולכן מכירתו הייתה מפחיתה כמות שאיש אינו מתחזק.
test('a direct-event item is not sellable from stock', () => {
  const { error } = priceSaleLine({ ...ITEM, procurement_type: 'direct_event' }, { quantity: 1 }, 18, {});
  assert.match(error, /רכש ישיר/);
});

test('a non positive quantity is rejected', () => {
  assert.match(priceSaleLine(ITEM, { quantity: 0 }, 18, {}).error, /כמות לא תקינה/);
  assert.match(priceSaleLine(ITEM, { quantity: -1 }, 18, {}).error, /כמות לא תקינה/);
});
