import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentEvents } from '../src/events.js';

test('events: on() fires handler on emit', () => {
  const events = new AgentEvents();
  let received: any = null;
  events.on('payment:success', (data) => { received = data; });

  const entry = { timestamp: '2026-01-01', url: 'https://api.test.com', amount: '0.25', currency: 'USDC', network: 'base', status: 'paid' as const, reason: 'ok' };
  events.emit('payment:success', { entry });

  assert.deepEqual(received?.entry, entry);
});

test('events: on() returns unsubscribe function', () => {
  const events = new AgentEvents();
  let count = 0;
  const unsub = events.on('payment:success', () => { count++; });

  const entry = { timestamp: '2026-01-01', url: 'https://api.test.com', amount: '0.25', currency: 'USDC', network: 'base', status: 'paid' as const, reason: 'ok' };
  events.emit('payment:success', { entry });
  assert.equal(count, 1);

  unsub();
  events.emit('payment:success', { entry });
  assert.equal(count, 1); // Should not fire after unsub
});

test('events: once() fires only once', () => {
  const events = new AgentEvents();
  let count = 0;
  events.once('payment:denied', () => { count++; });

  const entry = { timestamp: '2026-01-01', url: 'https://api.test.com', amount: '0.50', currency: 'USDC', network: 'base', status: 'denied' as const, reason: 'policy' };
  events.emit('payment:denied', { entry });
  events.emit('payment:denied', { entry });
  events.emit('payment:denied', { entry });

  assert.equal(count, 1);
});

test('events: multiple handlers on same event', () => {
  const events = new AgentEvents();
  let a = 0, b = 0;
  events.on('payment:failed', () => { a++; });
  events.on('payment:failed', () => { b++; });

  const entry = { timestamp: '2026-01-01', url: 'https://api.test.com', amount: '0.25', currency: 'USDC', network: 'base', status: 'failed' as const, reason: 'wallet error' };
  events.emit('payment:failed', { entry });

  assert.equal(a, 1);
  assert.equal(b, 1);
});

test('events: clear() removes all handlers', () => {
  const events = new AgentEvents();
  let count = 0;
  events.on('payment:success', () => { count++; });
  events.on('payment:denied', () => { count++; });

  events.clear();

  const entry = { timestamp: '2026-01-01', url: 'https://api.test.com', amount: '0.25', currency: 'USDC', network: 'base', status: 'paid' as const, reason: 'ok' };
  events.emit('payment:success', { entry });
  events.emit('payment:denied', { entry: { ...entry, status: 'denied' as const } });

  assert.equal(count, 0);
});

test('events: handler errors do not crash the emitter', () => {
  const events = new AgentEvents();
  let secondCalled = false;

  events.on('payment:success', () => { throw new Error('handler crash'); });
  events.on('payment:success', () => { secondCalled = true; });

  const entry = { timestamp: '2026-01-01', url: 'https://api.test.com', amount: '0.25', currency: 'USDC', network: 'base', status: 'paid' as const, reason: 'ok' };
  // Should not throw
  events.emit('payment:success', { entry });

  assert.equal(secondCalled, true);
});
