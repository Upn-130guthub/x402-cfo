import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { tollbooth, tollboothStats } from '../src/index.js';

// --- MetricsCollector unit tests via the middleware ---

test('tollboothStats returns correct initial stats', async () => {
  const gate = tollbooth({
    price: '0.25',
    currency: 'USDC',
    network: 'base',
    recipient: '0x123',
  });

  const app = express();
  app.get('/stats', tollboothStats(gate));

  const { body } = await req(app, '/stats');

  assert.equal(body.totalChallenges, 0);
  assert.equal(body.totalPayments, 0);
  assert.equal(body.totalFailures, 0);
  assert.equal(body.revenue, '0.00');
  assert.ok(body.startedAt);
  assert.ok(body.uptime);
});

test('metrics increment on challenge + payment cycle', async () => {
  const gate = tollbooth({
    price: '0.50',
    currency: 'USDC',
    network: 'base',
    recipient: '0x123',
  });

  const app = express();
  app.use('/api', gate);
  app.get('/api/data', (_req, res) => res.json({ ok: true }));
  app.get('/stats', tollboothStats(gate));

  // Trigger a challenge
  const r1 = await req(app, '/api/data');
  assert.equal(r1.status, 402);

  // Check stats: 1 challenge, 0 payments
  const s1 = await req(app, '/stats');
  assert.equal(s1.body.totalChallenges, 1);
  assert.equal(s1.body.totalPayments, 0);

  // Pay
  const challengeId = r1.body.challengeId;
  const r2 = await req(app, '/api/data', { 'X-PAYMENT': `mock base ${challengeId}:paid` });
  assert.equal(r2.status, 200);

  // Check stats: 1 challenge, 1 payment, revenue $0.50
  const s2 = await req(app, '/stats');
  assert.equal(s2.body.totalChallenges, 1);
  assert.equal(s2.body.totalPayments, 1);
  assert.equal(s2.body.revenue, '0.50');
});

test('metrics increment on payment failure', async () => {
  const gate = tollbooth({
    price: '0.25',
    currency: 'USDC',
    network: 'base',
    recipient: '0x123',
  });

  const app = express();
  app.use('/api', gate);
  app.get('/api/data', (_req, res) => res.json({ ok: true }));
  app.get('/stats', tollboothStats(gate));

  // Send a bad payment
  const r1 = await req(app, '/api/data', { 'X-PAYMENT': 'mock base fake-id:paid' });
  assert.equal(r1.status, 402);

  const s1 = await req(app, '/stats');
  assert.equal(s1.body.totalFailures, 1);
  assert.equal(s1.body.totalPayments, 0);
});

test('lifecycle hooks fire correctly', async () => {
  const events: string[] = [];

  const gate = tollbooth({
    price: '0.25',
    currency: 'USDC',
    network: 'base',
    recipient: '0x123',
    onChallenge: () => events.push('challenge'),
    onPaymentVerified: () => events.push('paid'),
    onPaymentFailed: () => events.push('failed'),
  });

  const app = express();
  app.use('/api', gate);
  app.get('/api/data', (_req, res) => res.json({ ok: true }));

  // Trigger challenge
  const r1 = await req(app, '/api/data');
  assert.equal(r1.status, 402);
  assert.deepEqual(events, ['challenge']);

  // Trigger failure
  await req(app, '/api/data', { 'X-PAYMENT': 'mock base bad:paid' });
  assert.deepEqual(events, ['challenge', 'failed']);

  // Trigger success: need a new challenge first
  const r3 = await req(app, '/api/data');
  const cid = r3.body.challengeId;
  await req(app, '/api/data', { 'X-PAYMENT': `mock base ${cid}:paid` });
  assert.deepEqual(events, ['challenge', 'failed', 'challenge', 'paid']);
});

test('revenue accumulates correctly across multiple payments', async () => {
  const gate = tollbooth({
    price: '0.33',
    currency: 'USDC',
    network: 'base',
    recipient: '0x123',
  });

  const app = express();
  app.use('/api', gate);
  app.get('/api/data', (_req, res) => res.json({ ok: true }));
  app.get('/stats', tollboothStats(gate));

  // 3 payment cycles
  for (let i = 0; i < 3; i++) {
    const ch = await req(app, '/api/data');
    await req(app, '/api/data', { 'X-PAYMENT': `mock base ${ch.body.challengeId}:paid` });
  }

  const s = await req(app, '/stats');
  assert.equal(s.body.totalPayments, 3);
  assert.equal(s.body.revenue, '0.99');
});

// --- Helper ---

function req(app: any, path: string, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://localhost:${port}${path}`, { headers: new Headers(headers) })
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}
