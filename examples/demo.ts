#!/usr/bin/env npx tsx
/**
 * x402-cfo Demo — Run this to see the SDK in action.
 *
 *   npx tsx examples/demo.ts
 *
 * Simulates an AI agent making x402 API calls. Demonstrates:
 * - Budget enforcement (hits limit and denies)
 * - Event system (budget:warning, budget:exhausted)
 * - Cost estimation (learns endpoint costs from history)
 * - Spend analytics (burn rate, top endpoints)
 * - Persistent storage (writes ledger to demo-ledger.json)
 * - Audit ledger (full export at the end)
 *
 * No real blockchain or wallet needed — uses a mock.
 */

import { AgentCFO, JsonFileStorage, type AgentWallet, type X402Challenge } from '../src/index.js';
import { existsSync, unlinkSync } from 'fs';

// Clean up old demo ledger
if (existsSync('./demo-ledger.json')) unlinkSync('./demo-ledger.json');

// ─── Mock x402 infrastructure ──────────────────────────────

const mockWallet: AgentWallet = {
  pay: async ({ requirement }) => {
    console.log(`   💳 Wallet signed $${requirement.maxAmountRequired} USDC → ${requirement.payTo.slice(0, 10)}...`);
    return 'x-payment-proof-' + Date.now();
  },
};

/** Costs for each endpoint (deterministic for nice demo output) */
const endpointCosts: Record<string, number[]> = {
  'https://api.market-data.com/prices':      [0.20, 0.25, 0.22],
  'https://api.news-feed.com/latest':        [0.15, 0.18],
  'https://api.sentiment.ai/analyze':        [0.40],
  'https://api.blockchain-intel.com/wallets': [0.35],
};
const costIndex: Record<string, number> = {};

function createMockFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = new Headers(init?.headers);

    // If request has X-PAYMENT header → payment accepted, return 200
    if (headers.get('X-PAYMENT')) {
      return new Response(JSON.stringify({ data: 'premium-content', source: url }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Otherwise, return 402 with a challenge
    const costs = endpointCosts[url] || [0.25];
    const idx = costIndex[url] ?? 0;
    costIndex[url] = (idx + 1) % costs.length;
    const cost = costs[idx].toFixed(2);

    const challenge: X402Challenge = {
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: cost,
        resource: url,
        description: 'API access fee',
        payTo: '0xServiceProvider',
        asset: 'USDC',
      }],
    };

    return new Response(JSON.stringify(challenge), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

// ─── Demo ──────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║           x402-cfo — Agent CFO Demo              ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');

  const agent = new AgentCFO({
    wallet: mockWallet,
    budget: { session: 1.00 },                          // $1.00 total budget
    policy: { maxPerRequest: 0.50, allowedCurrencies: ['USDC'] },
    storage: new JsonFileStorage('./demo-ledger.json'),
    warningThreshold: 0.6,                              // Warn at 60%
    fetchImpl: createMockFetch(),
  });

  // Subscribe to events
  agent.events.on('payment:success', ({ entry }) => {
    console.log(`   ✅ Logged: $${entry.amount} → ${entry.url.split('/').pop()}`);
  });
  agent.events.on('payment:denied', ({ entry }) => {
    console.log(`   ❌ DENIED: ${entry.reason}`);
  });
  agent.events.on('budget:warning', ({ window, percentUsed }) => {
    console.log(`   ⚠️  Budget warning: ${window} at ${(percentUsed * 100).toFixed(0)}%`);
  });
  agent.events.on('budget:exhausted', ({ window }) => {
    console.log(`   🛑 Budget EXHAUSTED: ${window} — no more payments will be approved`);
  });

  const endpoints = [
    'https://api.market-data.com/prices',
    'https://api.news-feed.com/latest',
    'https://api.sentiment.ai/analyze',
    'https://api.market-data.com/prices',
    'https://api.blockchain-intel.com/wallets',
    'https://api.market-data.com/prices',          // Will be denied — budget exhausted
  ];

  console.log('📎 Config: $1.00 session budget | $0.50 max per request | USDC only');
  console.log('');

  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    const shortUrl = url.replace('https://', '');
    console.log(`── Call ${i + 1}/${endpoints.length}: ${shortUrl}`);
    const res = await agent.fetch(url);
    console.log(`   → HTTP ${res.status}`);
    console.log('');
  }

  // Cost estimation
  console.log('═══ Cost Estimation ═══');
  const estimate = agent.estimateCost('https://api.market-data.com/prices');
  if (estimate) {
    console.log(`   api.market-data.com/prices → avg: $${estimate.average.toFixed(2)}, min: $${estimate.min.toFixed(2)}, max: $${estimate.max.toFixed(2)} (${estimate.samples} samples)`);
  } else {
    console.log('   No data yet');
  }
  console.log('');

  // Analytics
  console.log('═══ Spend Analytics ═══');
  const summary = agent.summary();
  console.log(`   Total spent:     $${summary.totalSpent}`);
  console.log(`   Transactions:    ${summary.totalTransactions} paid, ${summary.totalDenied} denied`);
  console.log(`   Burn rate:       $${summary.burnRatePerMinute}/min`);
  console.log(`   Projected daily: $${summary.projectedDaily}`);
  console.log('');

  // Budget
  console.log('═══ Budget Status ═══');
  const budget = agent.spent();
  console.log(`   Session spent:     $${budget.sessionSpent}`);
  console.log(`   Session remaining: $${budget.sessionRemaining}`);
  console.log('');

  // Ledger
  console.log('═══ Audit Ledger ═══');
  const entries = agent.audit();
  for (const e of entries) {
    const icon = e.status === 'paid' ? '✅' : e.status === 'denied' ? '❌' : '⚠️';
    console.log(`   ${icon} ${e.status.padEnd(6)} $${e.amount.padEnd(5)} ${e.url.replace('https://', '')}`);
  }
  console.log('');
  console.log(`   📁 Ledger persisted to: ./demo-ledger.json`);
  console.log(`   📊 ${entries.length} entries total`);
  console.log('');

  agent.stop();
}

main().catch(console.error);
