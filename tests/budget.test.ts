import test from 'node:test';
import assert from 'node:assert/strict';
import { Budget } from '../src/budget.js';

test('budget: allows spend under all limits', () => {
  const b = new Budget({ maxPerRequest: 1.00, hourly: 5.00, daily: 50.00, session: 100.00 });
  const decision = b.check(0.50);
  assert.equal(decision.allowed, true);
});

test('budget: denies spend over per-request limit', () => {
  const b = new Budget({ maxPerRequest: 1.00 });
  const decision = b.check(1.50);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'exceeds_per_request_limit');
});

test('budget: denies spend over session limit', () => {
  const b = new Budget({ session: 2.00 });
  b.record(1.50);
  const decision = b.check(0.75);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'exceeds_session_limit');
});

test('budget: denies spend over hourly limit', () => {
  const b = new Budget({ hourly: 1.00 });
  b.record(0.80);
  const decision = b.check(0.30);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'exceeds_hourly_limit');
});

test('budget: hourly window allows old spend to expire', () => {
  const b = new Budget({ hourly: 1.00 });
  // Record spend from 2 hours ago
  b.record(0.90, Date.now() - 7_200_000);
  // Should be allowed now because it's outside the 1h window
  const decision = b.check(0.50);
  assert.equal(decision.allowed, true);
});

test('budget: status shows correct remaining', () => {
  const b = new Budget({ session: 10.00, hourly: 5.00 });
  b.record(2.50);
  const s = b.status();
  assert.equal(s.sessionSpent, '2.50');
  assert.equal(s.sessionRemaining, '7.50');
  assert.equal(s.hourlySpent, '2.50');
  assert.equal(s.hourlyRemaining, '2.50');
});

test('budget: no limits means everything is allowed', () => {
  const b = new Budget({});
  b.record(1000);
  const decision = b.check(5000);
  assert.equal(decision.allowed, true);
});
