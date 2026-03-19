import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentCFO, type AgentWallet, type X402Challenge } from '../src/controller.js';

/**
 * End-to-end controller tests.
 * Uses a fake fetch and wallet to test the full pipeline.
 */

function make402Response(amount: string = '0.25', currency: string = 'USDC', network: string = 'base'): Response {
  const challenge: X402Challenge = {
    x402Version: 1,
    accepts: [{
      scheme: 'exact',
      network,
      maxAmountRequired: amount,
      resource: '/api/data',
      description: 'Test endpoint',
      payTo: '0xRecipient',
      asset: currency,
    }],
    challengeId: 'challenge-001',
  };
  return new Response(JSON.stringify(challenge), {
    status: 402,
    headers: { 'Content-Type': 'application/json' },
  });
}

function make200Response(): Response {
  return new Response(JSON.stringify({ data: 'unlocked' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockWallet: AgentWallet = {
  pay: async ({ requirement, challengeId }) => {
    return `exact ${requirement.network} ${challengeId}:paid`;
  },
};

test('controller: passes through non-402 responses', async () => {
  const agent = new AgentCFO({
    wallet: mockWallet,
    fetchImpl: async () => make200Response(),
  });
  const res = await agent.fetch('https://api.example.com/free');
  assert.equal(res.status, 200);
  assert.equal(agent.audit().length, 0);
});

test('controller: handles 402 → pay → 200 flow', async () => {
  let callCount = 0;
  const agent = new AgentCFO({
    wallet: mockWallet,
    fetchImpl: async () => {
      callCount++;
      return callCount === 1 ? make402Response() : make200Response();
    },
  });

  const res = await agent.fetch('https://api.example.com/data');
  assert.equal(res.status, 200);
  assert.equal(callCount, 2); // initial + retry
  assert.equal(agent.audit().length, 1);
  assert.equal(agent.audit()[0].status, 'paid');
  assert.equal(agent.audit()[0].amount, '0.25');
  assert.equal(agent.spent().sessionSpent, '0.25');
});

test('controller: denies when policy blocks', async () => {
  const agent = new AgentCFO({
    wallet: mockWallet,
    policy: { maxPerRequest: 0.10 },
    fetchImpl: async () => make402Response('0.25'),
  });

  const res = await agent.fetch('https://api.example.com/data');
  assert.equal(res.status, 402); // returns original 402
  assert.equal(agent.audit().length, 1);
  assert.equal(agent.audit()[0].status, 'denied');
  assert.ok(agent.audit()[0].reason.includes('policy max'));
});

test('controller: denies when budget exhausted', async () => {
  let callCount = 0;
  const agent = new AgentCFO({
    wallet: mockWallet,
    budget: { session: 0.40 },
    fetchImpl: async () => {
      callCount++;
      return callCount % 2 === 1 ? make402Response('0.25') : make200Response();
    },
  });

  // First request succeeds
  const res1 = await agent.fetch('https://api.example.com/data');
  assert.equal(res1.status, 200);

  // Second request should be denied (0.25 + 0.25 = 0.50 > 0.40 limit)
  const res2 = await agent.fetch('https://api.example.com/data');
  assert.equal(res2.status, 402);
  assert.equal(agent.audit()[1].status, 'denied');
  assert.ok(agent.audit()[1].reason.includes('session budget'));
});

test('controller: logs wallet failures', async () => {
  const failWallet: AgentWallet = {
    pay: async () => { throw new Error('Insufficient funds'); },
  };

  const agent = new AgentCFO({
    wallet: failWallet,
    fetchImpl: async () => make402Response(),
  });

  const res = await agent.fetch('https://api.example.com/data');
  assert.equal(res.status, 402);
  assert.equal(agent.audit().length, 1);
  assert.equal(agent.audit()[0].status, 'failed');
  assert.ok(agent.audit()[0].reason.includes('Insufficient funds'));
});

test('controller: exports ledger as JSON', async () => {
  let callCount = 0;
  const agent = new AgentCFO({
    wallet: mockWallet,
    fetchImpl: async () => {
      callCount++;
      return callCount === 1 ? make402Response('0.10') : make200Response();
    },
  });

  await agent.fetch('https://api.example.com/data');
  const json = JSON.parse(agent.exportJSON());
  assert.equal(json.length, 1);
  assert.equal(json[0].amount, '0.10');
  assert.equal(json[0].status, 'paid');
});

test('controller: summary reports correct analytics', async () => {
  let callCount = 0;
  const agent = new AgentCFO({
    wallet: mockWallet,
    fetchImpl: async () => {
      callCount++;
      return callCount % 2 === 1 ? make402Response('1.00') : make200Response();
    },
  });

  await agent.fetch('https://api.example.com/a');
  await agent.fetch('https://api.example.com/b');
  await agent.fetch('https://api.example.com/a');

  const s = agent.summary();
  assert.equal(s.totalSpent, '3.00');
  assert.equal(s.totalTransactions, 3);
  assert.equal(s.topEndpoints.length, 2);
  assert.equal(s.topEndpoints[0].url, 'https://api.example.com/a');
  assert.equal(s.topEndpoints[0].count, 2);
});

test('controller: blocklisted URL is denied without calling wallet', async () => {
  let walletCalled = false;
  const trackWallet: AgentWallet = {
    pay: async (params) => { walletCalled = true; return 'paid'; },
  };

  const agent = new AgentCFO({
    wallet: trackWallet,
    policy: { blocklist: ['api.evil.com'] },
    fetchImpl: async () => make402Response(),
  });

  await agent.fetch('https://api.evil.com/data');
  assert.equal(walletCalled, false);
  assert.equal(agent.audit()[0].status, 'denied');
  assert.equal(agent.audit()[0].reason, 'https://api.evil.com/data is blocked by policy');
});
