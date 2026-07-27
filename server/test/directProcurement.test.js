import test from 'node:test';
import assert from 'node:assert/strict';
import {
  directProcurementMetrics,
  purchaseReceiptAffectsStock,
} from '../src/services/directProcurement.js';

test('direct procurement ignores stock and orders the full event requirement', () => {
  assert.deepEqual(directProcurementMetrics({ required: 20 }), {
    required: 20,
    ordered: 0,
    received: 0,
    remaining_to_order: 20,
    over_ordered: 0,
    procurement_status: 'needs_order',
  });
});

test('remaining direct procurement is rounded to a full package', () => {
  const result = directProcurementMetrics({
    required: 12,
    ordered: 10,
    received: 4,
    packageSize: 10,
  });
  assert.equal(result.remaining_to_order, 10);
  assert.equal(result.procurement_status, 'needs_order');
});

test('over-ordering is exposed without a negative remaining quantity', () => {
  const result = directProcurementMetrics({ required: 8, ordered: 20, received: 0 });
  assert.equal(result.remaining_to_order, 0);
  assert.equal(result.over_ordered, 12);
  assert.equal(result.procurement_status, 'over_ordered');
});

test('receiving direct-event goods does not affect stock, while stock goods do', () => {
  assert.equal(purchaseReceiptAffectsStock('direct_event'), false);
  assert.equal(purchaseReceiptAffectsStock('stock'), true);
});
