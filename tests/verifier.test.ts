import test from 'node:test';
import assert from 'node:assert/strict';
import { ChallengeStore } from '../src/challenge.js';
import { verifyPayment } from '../src/verifier.js';

const mockConfig = {
  price: '0.25',
  currency: 'USDC',
  network: 'base',
  recipient: '0x123',
  mode: 'mock' as const,
};

test('mock: valid proof succeeds', async () => {
  const store = new ChallengeStore();
  const ch = store.create('0.25', 'USDC', '0x123', '/api');

  const result = await verifyPayment(
    { scheme: 'mock', networkId: 'base', payload: `${ch.id}:paid` },
    store,
    mockConfig,
  );

  assert.equal(result.valid, true);
  assert.equal(result.challengeId, ch.id);
  store.destroy();
});

test('mock: wrong scheme fails', async () => {
  const store = new ChallengeStore();

  const result = await verifyPayment(
    { scheme: 'exact', networkId: 'base', payload: 'id:paid' },
    store,
    mockConfig,
  );

  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('scheme'));
  store.destroy();
});

test('mock: unknown challenge fails', async () => {
  const store = new ChallengeStore();

  const result = await verifyPayment(
    { scheme: 'mock', networkId: 'base', payload: 'nonexistent:paid' },
    store,
    mockConfig,
  );

  assert.equal(result.valid, false);
  store.destroy();
});

test('mock: challenge consumed only once', async () => {
  const store = new ChallengeStore();
  const ch = store.create('0.25', 'USDC', '0x123', '/api');
  const proof = { scheme: 'mock', networkId: 'base', payload: `${ch.id}:paid` };

  const first = await verifyPayment(proof, store, mockConfig);
  assert.equal(first.valid, true);

  const second = await verifyPayment(proof, store, mockConfig);
  assert.equal(second.valid, false);
  store.destroy();
});

test('verify mode: calls custom verifyPayment', async () => {
  const store = new ChallengeStore();
  const config = {
    ...mockConfig,
    mode: 'verify' as const,
    verifyPayment: async () => true,
  };

  const result = await verifyPayment(
    { scheme: 'exact', networkId: 'base', payload: 'tx-hash-123' },
    store,
    config,
  );

  assert.equal(result.valid, true);
  store.destroy();
});

test('verify mode: fails without verifyPayment function', async () => {
  const store = new ChallengeStore();
  const config = { ...mockConfig, mode: 'verify' as const };

  const result = await verifyPayment(
    { scheme: 'exact', networkId: 'base', payload: 'tx' },
    store,
    config,
  );

  assert.equal(result.valid, false);
  store.destroy();
});
