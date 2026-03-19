import test from 'node:test';
import assert from 'node:assert/strict';
import { ChallengeStore } from '../src/challenge.js';

test('create returns a valid challenge', () => {
  const store = new ChallengeStore();
  const ch = store.create('0.25', 'USDC', '0x123', '/api/data');

  assert.ok(ch.id.length > 0);
  assert.equal(ch.price, '0.25');
  assert.equal(ch.currency, 'USDC');
  assert.equal(ch.recipient, '0x123');
  assert.ok(ch.expiresAt > Date.now());
  store.destroy();
});

test('consume returns challenge and removes it', () => {
  const store = new ChallengeStore();
  const ch = store.create('0.25', 'USDC', '0x123', '/api/data');

  const consumed = store.consume(ch.id);
  assert.ok(consumed);
  assert.equal(consumed.id, ch.id);

  const again = store.consume(ch.id);
  assert.equal(again, null);
  store.destroy();
});

test('consume returns null for unknown id', () => {
  const store = new ChallengeStore();
  assert.equal(store.consume('nonexistent'), null);
  store.destroy();
});

test('size tracks active challenges', () => {
  const store = new ChallengeStore();
  assert.equal(store.size, 0);

  store.create('1', 'USDC', '0x1', '/a');
  store.create('2', 'USDC', '0x2', '/b');
  assert.equal(store.size, 2);
  store.destroy();
});
