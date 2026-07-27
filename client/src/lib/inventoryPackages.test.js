import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatInventoryQuantity,
  packageQuantityTotal,
  splitPackageQuantity,
} from './inventoryPackages.js';

test('inventory is split into full packages and a loose remainder', () => {
  assert.deepEqual(splitPackageQuantity(10, 5), { packages: 2, loose: 0 });
  assert.deepEqual(splitPackageQuantity(12, 5), { packages: 2, loose: 2 });
  assert.deepEqual(splitPackageQuantity(2, 5), { packages: 0, loose: 2 });
});

test('package formatting includes the base-unit remainder', () => {
  assert.equal(formatInventoryQuantity(12, {
    package_label: 'שקים',
    package_size: 5,
    unit: 'ק״ג',
  }), '2 שקים + 2 ק״ג');
});

test('negative inventory is shown as a shortage in base units', () => {
  assert.equal(formatInventoryQuantity(-2, {
    package_label: 'שקים',
    package_size: 5,
    unit: 'ק״ג',
  }), 'חוסר 2 ק״ג');
});

test('package and loose inputs normalize overflow naturally', () => {
  assert.equal(packageQuantityTotal(2, 7, 5), 17);
  assert.deepEqual(splitPackageQuantity(17, 5), { packages: 3, loose: 2 });
});
