import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackTargetDate, isFeedbackRunDue } from '../src/services/feedbackScheduling.js';

test('Sunday before 10:00 Israel time is not due', () => {
  const now = new Date('2026-07-26T06:59:00.000Z'); // 09:59 IDT
  assert.equal(isFeedbackRunDue(now), false);
  assert.equal(feedbackTargetDate(now), '2026-07-25');
});

test('Sunday at 10:00 Israel time targets the preceding Saturday', () => {
  const now = new Date('2026-07-26T07:00:00.000Z'); // 10:00 IDT
  assert.equal(isFeedbackRunDue(now), true);
  assert.equal(feedbackTargetDate(now), '2026-07-25');
});

test('weekday startup catches up for the most recent Saturday', () => {
  const now = new Date('2026-07-29T12:00:00.000Z'); // Wednesday
  assert.equal(isFeedbackRunDue(now), true);
  assert.equal(feedbackTargetDate(now), '2026-07-25');
});

test('Saturday never targets the current Shabbat', () => {
  const now = new Date('2026-08-01T18:00:00.000Z');
  assert.equal(isFeedbackRunDue(now), false);
  assert.equal(feedbackTargetDate(now), '2026-07-25');
});

test('winter timezone calculation observes Israel standard time', () => {
  const before = new Date('2026-12-06T07:59:00.000Z'); // 09:59 IST
  const due = new Date('2026-12-06T08:00:00.000Z'); // 10:00 IST
  assert.equal(isFeedbackRunDue(before), false);
  assert.equal(isFeedbackRunDue(due), true);
  assert.equal(feedbackTargetDate(due), '2026-12-05');
});
