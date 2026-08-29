import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customerDisplayName, filterCustomers, sortCustomersByLastName,
} from './customers.js';

const levi = { id: '1', first_name: 'משה', last_name: 'לוי', full_name: 'משה לוי', phone: '0501111111' };
const cohen = { id: '2', first_name: 'אברהם', last_name: 'כהן', full_name: 'אברהם כהן', phone: '0502222222', email: 'a@example.com' };
const vaad = { id: '3', first_name: 'ועד הקהילה', last_name: null, full_name: 'ועד הקהילה', phone: '0503333333', is_organization: true };
const abramovitz = { id: '4', first_name: 'תמר', last_name: 'אברמוביץ', full_name: 'תמר אברמוביץ', phone: '0504444444' };
const all = [levi, cohen, vaad, abramovitz];

test('the picker label puts the last name first', () => {
  assert.equal(customerDisplayName(cohen), 'כהן אברהם');
});

test('a record without a last name keeps its full name', () => {
  assert.equal(customerDisplayName(vaad), 'ועד הקהילה');
});

test('customers are ordered by the Hebrew alphabet of the last name', () => {
  assert.deepEqual(
    sortCustomersByLastName(all).map(customerDisplayName),
    ['אברמוביץ תמר', 'ועד הקהילה', 'כהן אברהם', 'לוי משה'],
  );
});

test('the same last name is broken by the first name', () => {
  const rows = [
    { first_name: 'שרה', last_name: 'כהן' },
    { first_name: 'אבי', last_name: 'כהן' },
  ];
  assert.deepEqual(
    sortCustomersByLastName(rows).map(customerDisplayName),
    ['כהן אבי', 'כהן שרה'],
  );
});

test('priority groups organizations before the alphabetical list', () => {
  assert.deepEqual(
    sortCustomersByLastName(all, (c) => (c.is_organization ? 0 : 1)).map(customerDisplayName),
    ['ועד הקהילה', 'אברמוביץ תמר', 'כהן אברהם', 'לוי משה'],
  );
});

test('search finds a customer by last name alone', () => {
  assert.deepEqual(filterCustomers(all, 'כהן'), [cohen]);
});

test('search finds a customer by first name alone', () => {
  assert.deepEqual(filterCustomers(all, 'תמר'), [abramovitz]);
});

test('search matches both name orders', () => {
  assert.deepEqual(filterCustomers(all, 'אברהם כהן'), [cohen]);
  assert.deepEqual(filterCustomers(all, 'כהן אברהם'), [cohen]);
});

test('search matches a partial phone number and an email', () => {
  assert.deepEqual(filterCustomers(all, '4444'), [abramovitz]);
  assert.deepEqual(filterCustomers(all, 'a@example'), [cohen]);
});

test('an empty search returns every customer', () => {
  assert.equal(filterCustomers(all, '   ').length, all.length);
});

test('a search with no match returns nothing', () => {
  assert.deepEqual(filterCustomers(all, 'שגיא'), []);
});
