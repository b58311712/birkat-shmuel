import test from 'node:test';
import assert from 'node:assert/strict';
import { costPerBaseUnit, toBaseQuantity } from '../src/lib/costMath.js';

// עלות פריט = מחיר בסיס + מע"מ, אלא אם הפריט פטור (פירות/ירקות טריים).
test('item cost adds VAT unless the item is exempt', () => {
  assert.equal(costPerBaseUnit({ last_purchase_price: 100, vat_exempt: false }, 18), 118);
  assert.equal(costPerBaseUnit({ last_purchase_price: 100, vat_exempt: true }, 18), 100);
});

// מחיר חסר מחזיר null ולא 0. אפס היה נראה כמו מוצר חינמי ומשקר בתמחור,
// ואילו null מאפשר לדווח "חסר מחיר" ולהציג עלות חלקית.
test('missing purchase price yields null rather than a free item', () => {
  assert.equal(costPerBaseUnit({ last_purchase_price: null, vat_exempt: false }, 18), null);
  assert.equal(costPerBaseUnit({ last_purchase_price: 0, vat_exempt: false }, 18), null);
  assert.equal(costPerBaseUnit({}, 18), null);
});

// יחידת ההזנה זהה ליחידת הבסיס - פקטור 1 בלי שנדרשת רשומת המרה.
test('the base unit needs no conversion record', () => {
  const item = { unit_id: 'kg' };
  assert.equal(toBaseQuantity(3, 'kg', item, {}), 3);
});

test('a configured conversion factor is applied', () => {
  const item = { unit_id: 'kg' };
  assert.equal(toBaseQuantity(2, 'box', item, { box: 12 }), 24);
});

// אין פקטור - מחזירים null ולא ממציאים 1. אותו כלל של ניכוי המלאי: המצאת
// פקטור הייתה מנכה כמות שגויה מהמלאי ומתמחרת לפיה.
test('an unknown unit is reported instead of assuming a factor of one', () => {
  const item = { unit_id: 'kg' };
  assert.equal(toBaseQuantity(2, 'crate', item, { box: 12 }), null);
  assert.equal(toBaseQuantity(2, null, item, { box: 12 }), null);
});
