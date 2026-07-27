import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveMinimum,
  packageConfig,
  quantityFromPackageInput,
} from '../src/lib/inventoryPackages.js';
import {
  convertRequirementsToBase,
  indexConversions,
} from '../src/services/inventoryUnitConversion.js';

test('package input is normalized into the base quantity', () => {
  assert.equal(quantityFromPackageInput({
    package_quantity: 2,
    loose_quantity: 7,
  }, 5), 17);
});

test('package count must be a non-negative integer', () => {
  assert.equal(quantityFromPackageInput({
    package_quantity: 1.5,
    loose_quantity: 0,
  }, 5), null);
  assert.equal(quantityFromPackageInput({
    package_quantity: -1,
    loose_quantity: 0,
  }, 5), null);
});

test('package name and size must be configured together', () => {
  assert.ok(packageConfig({ package_label: 'שק', package_size: null }).error);
  assert.ok(packageConfig({ package_label: '', package_size: 5 }).error);
  assert.deepEqual(packageConfig({ package_label: ' שק ', package_size: 5 }), {
    package_label: 'שק',
    package_size: 5,
  });
});

test('minimum package threshold is converted to base units', () => {
  assert.equal(effectiveMinimum({
    package_size: 5,
    min_alert_packages: 3,
    min_alert_quantity: 2,
  }), 15);
});

test('recipe requirements use the same per-item conversion table', () => {
  const conversions = indexConversions([
    { inventory_item_id: 'rice', from_unit_id: 'cup', factor_to_base: 0.2 },
  ]);
  const result = convertRequirementsToBase({
    rice: {
      cup: { unit_id: 'cup', unit_name: 'כוס', qty: 10 },
      kg: { unit_id: 'kg', unit_name: 'ק״ג', qty: 1 },
    },
  }, {
    rice: { id: 'rice', name: 'אורז', unit_id: 'kg', unit: 'ק״ג' },
  }, conversions);

  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.lines, [{ item_id: 'rice', qty_base: 3 }]);
});

test('missing recipe conversion is reported without inventing a factor', () => {
  const result = convertRequirementsToBase({
    rice: { cup: { unit_id: 'cup', unit_name: 'כוס', qty: 1 } },
  }, {
    rice: { id: 'rice', name: 'אורז', unit_id: 'kg', unit: 'ק״ג' },
  }, {});
  assert.equal(result.lines.length, 0);
  assert.equal(result.missing[0].item_name, 'אורז');
});

