import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentCFO, type AgentWallet, type X402Challenge } from '../src/controller.js';

/**
 * Tests for advanced controller features:
 * - Event firing on payment decisions
 * - Budget warning events
 * - Cost estimation from historical data
 */

const mockWallet: AgentWallet = {
  pay: async () => 'payment-token-123',
};

function make402Response(amount = '0.25') {
  const challenge: X402Challenge = {
    x402Version: 1,
    accepts: [{
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: amount,
      resource: 'https://api.test.com/data',
      description: 'API access',
      payTo: '0xRecipient',
      asset: 'USDC',
    }],
  };
  return new Response(JSON.stringify(challenge), {
    status: 402,
    headers: { 'Content-Type': 'application/json' },
  });
}

function make200Response() {
  return new Response('{"result":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('advanced: emits payment:success on successful payment', async () => {
  let callCount = 0;
  const agent = new AgentCFO({
    wallet: mockWallet,
    fetchImpl: async () => {
      callCount++;
      return callCount === 1 ? make402Response() : make200Response();
    },
  });

  let received: any = null;
  agent.events.on('payment:success', (data) => { received = data; });

  await agent.fetch('https://api.test.com/data');

  assert.ok(received);
  assert.equal(received.entry.status, 'paid');
  assert.equal(received.entry.amount, '0.25');
});

test('advanced: emits payment:denied when policy blocks', async () => {
  const agent = new AgentCFO({
    wallet: mockWallet,
    policy: { maxPerRequest: 0.10 },
    fetchImpl: async () => make402Response('0.50'),
  });

  let received: any = null;
  agent.events.on('payment:denied', (data) => { received = data; });

  await agent.fetch('https://api.test.com/data');

  assert.ok(received);
  assert.equal(received.entry.status, 'denied');
});

test('advanced: emits budget:warning when threshold crossed', async () => {
  let callCount = 0;
  const agent = new AgentCFO({
    wallet: mockWallet,
    budget: { session: 1.00 },
    warningThreshold: 0.5,
    fetchImpl: async () => {
      callCount++;
      return callCount % 2 === 1 ? make402Response('0.60') : make200Response();
    },
  });

  let warning: any = null;
  agent.events.on('budget:warning', (data) => { warning = data; });

  await agent.fetch('https://api.test.com/data');

  assert.ok(warning, 'should fire budget:warning when 60% of $1.00 session is used');
  assert.equal(warning.window, 'session');
  assert.ok(warning.percentUsed >= 0.5);
});

test('advanced: emits budget:exhausted when limit fully used', async () => {
  let callCount = 0;
  const agent = new AgentCFO({
    wallet: mockWallet,
    budget: { session: 0.25 },
    fetchImpl: async () => {
      callCount++;
      return callCount % 2 === 1 ? make402Response('0.25') : make200Response();
    },
  });

  let exhausted: any = null;
  agent.events.on('budget:exhausted', (data) => { exhausted = data; });

  // First call: will spend 0.25, exhausting the 0.25 session budget
  await agent.fetch('https://api.test.com/data');

  assert.ok(exhausted, 'should fire budget:exhausted when session limit hit');
  assert.equal(exhausted.window, 'session');
});

test('advanced: estimateCost returns null for unknown endpoint', () => {
  const agent = new AgentCFO({
    wallet: mockWallet,
    fetchImpl: async () => make200Response(),
  });

  const estimate = agent.estimateCost('https://unknown-api.com/data');
  assert.equal(estimate, null);
});

test('advanced: estimateCost tracks historical costs', async () => {
  let callCount = 0;
  const amounts = ['0.10', '0.20', '0.30'];

  const agent = new AgentCFO({
    wallet: mockWallet,
    fetchImpl: async () => {
      callCount++;
      const idx = Math.floor((callCount - 1) / 2);
      if (callCount % 2 === 1) return make402Response(amounts[idx] || '0.25');
      return make200Response();
    },
  });

  await agent.fetch('https://api.test.com/data');
  await agent.fetch('https://api.test.com/data');
  await agent.fetch('https://api.test.com/data');

  const estimate = agent.estimateCost('https://api.test.com/data');
  assert.ok(estimate);
  assert.equal(estimate.samples, 3);
  assert.equal(estimate.min, 0.10);
  assert.equal(estimate.max, 0.30);
  assert.ok(Math.abs(estimate.average - 0.20) < 0.001);
});

test('advanced: emits payment:failed on wallet error', async () => {
  const failWallet: AgentWallet = {
    pay: async () => { throw new Error('Insufficient funds'); },
  };

  const agent = new AgentCFO({
    wallet: failWallet,
    fetchImpl: async () => make402Response(),
  });

  let received: any = null;
  agent.events.on('payment:failed', (data) => { received = data; });

  await agent.fetch('https://api.test.com/data');

  assert.ok(received);
  assert.equal(received.entry.status, 'failed');
});

test('advanced: stop() clears all event handlers', async () => {
  let callCount = 0;
  const agent = new AgentCFO({
    wallet: mockWallet,
    fetchImpl: async () => {
      callCount++;
      return callCount % 2 === 1 ? make402Response() : make200Response();
    },
  });

  let eventCount = 0;
  agent.events.on('payment:success', () => { eventCount++; });

  await agent.fetch('https://api.test.com/data');
  assert.equal(eventCount, 1);

  agent.stop();

  await agent.fetch('https://api.test.com/data');
  assert.equal(eventCount, 1); // Should not fire after stop()
});
