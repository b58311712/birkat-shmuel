import test from 'node:test';
import assert from 'node:assert/strict';
import { calcMealSurcharges } from './pricing.js';

const catalogMeals = [
  { id: 'regular', category_id: 'regular-category', requires_extra_charge: true, extra_charge_amount: 3 },
  { id: 'with-quantity', category_id: 'split-category', requires_extra_charge: true, extra_charge_amount: 5 },
  { id: 'split-peer', category_id: 'split-category', requires_extra_charge: false, extra_charge_amount: 0 },
  { id: 'included', category_id: 'regular-category', requires_extra_charge: false, extra_charge_amount: 99 },
];

const selectedSlots = [
  { meal_slot_id: 'night', portions: 100 },
  { meal_slot_id: 'day', portions: 60 },
];

test('meal surcharge uses the total portions of its meal slot when no quantity is selected', () => {
  assert.equal(
    calcMealSurcharges({ 'night:regular': true }, catalogMeals, selectedSlots),
    300
  );
});

test('meal surcharge uses the portion count selected for that meal', () => {
  assert.equal(
    calcMealSurcharges({
      'night:with-quantity': 35,
      'night:split-peer': 65,
    }, catalogMeals, selectedSlots),
    175
  );
});

test('a lone meal in a quantity-split category is billed for the whole meal slot', () => {
  assert.equal(
    calcMealSurcharges({ 'night:with-quantity': 100 }, catalogMeals, selectedSlots),
    500
  );
});

test('meal surcharges are summed using each meal quantity rule and slot', () => {
  assert.equal(
    calcMealSurcharges({
      'night:regular': true,
      'day:with-quantity': 20,
      'day:split-peer': 40,
      'day:included': true,
    }, catalogMeals, selectedSlots),
    400
  );
});
