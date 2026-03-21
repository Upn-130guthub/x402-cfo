#!/usr/bin/env npx tsx
/**
 * x402-cfo v0.5 Demo — Spend Control Plane in Action
 *
 *   npx tsx examples/demo-v05.ts
 *
 * Shows the three core v0.5 features a design partner cares about:
 * 1. Enforce mode: blocks an anomalous payment BEFORE money moves
 * 2. Review mode: flags the same anomaly but lets payment proceed
 * 3. lastDecision(): structured caller feedback (no more mystery 402s)
 *
 * Also demonstrates: default $2.00 safety cap, event sink, proof metrics.
 */

import { AgentCFO, EventSink, type AgentWallet, type X402Challenge } from '../src/index.js';

// ─── Mock wallet ───────────────────────────────────────────

let walletCallCount = 0;
const mockWallet: AgentWallet = {
  pay: async ({ requirement }) => {
    walletCallCount++;
    return 'proof-' + Date.now();
  },
};

// ─── Mock fetch: normal prices, then a spike ───────────────

function createSpikeFetch(normalPrice: string, spikePrice: string, spikeAfter: number) {
  let callCount = 0;
  return async (url: any, init?: any): Promise<Response> => {
    callCount++;
    const headers = init?.headers ? new Headers(init.headers) : new Headers();

    if (headers.get('X-PAYMENT')) {
      return new Response('{"data":"premium-content"}', { status: 200 });
    }

    const price = callCount <= spikeAfter * 2 ? normalPrice : spikePrice;
    const challenge: X402Challenge = {
      x402Version: 1,
      accepts: [{
        scheme: 'exact', network: 'base', maxAmountRequired: price,
        resource: url.toString(), description: 'API access', payTo: '0xService', asset: 'USDC',
      }],
    };
    return new Response(JSON.stringify(challenge), { status: 402 });
  };
}

// ─── Demo ──────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     x402-cfo v0.5 — Agent Spend Control Plane Demo     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Part 1: Default safety cap ───────────────────────────
  console.log('━━━ 1. DEFAULT SAFETY CAP ━━━');
  console.log('   No policy set → default $2.00 maxPerRequest kicks in');
  console.log('');

  const unsafeAgent = new AgentCFO({
    wallet: mockWallet,
    budget: { daily: 100 },
    anomalyMode: 'off',
    fetchImpl: createSpikeFetch('5.00', '5.00', 100), // $5 per request
  });

  await unsafeAgent.fetch('https://api.expensive.com/data');
  const d = unsafeAgent.lastDecision();
  console.log(`   Request: $5.00 to api.expensive.com`);
  console.log(`   lastDecision(): { allowed: ${d?.allowed}, gate: "${d?.gate}", reason: "${d?.reason}" }`);
  console.log(`   → Blocked by default safety cap. No money moved.`);
  console.log('');
  unsafeAgent.stop();

  // ── Part 2: Enforce mode — block the spike ───────────────
  console.log('━━━ 2. ENFORCE MODE — BLOCK ANOMALOUS PAYMENT ━━━');
  console.log('   4 normal $0.25 requests, then a $10 spike');
  console.log('');

  walletCallCount = 0;
  const enforceAgent = new AgentCFO({
    wallet: mockWallet,
    budget: { daily: 100 },
    policy: { maxPerRequest: 50 },
    anomalyMode: 'enforce',
    anomaly: { warmupCount: 3, zThreshold: 2.0, cooldownMs: 0 },
    fetchImpl: createSpikeFetch('0.25', '10.00', 4),
  });

  const sink = new EventSink({ agentId: 'researcher-01' });
  enforceAgent.events.on('payment:success', (data) => sink.record('payment:success', data as any));
  enforceAgent.events.on('anomaly:blocked', (data) => {
    sink.record('anomaly:blocked', data as any);
    console.log(`   🛡️  BLOCKED: $${data.amount} (${data.multiplier.toFixed(1)}× baseline $${data.baseline.toFixed(2)})`);
  });

  for (let i = 0; i < 4; i++) {
    await enforceAgent.fetch('https://api.market.com/prices');
    console.log(`   ✅ Request ${i + 1}: $0.25 paid`);
  }

  const walletBefore = walletCallCount;
  await enforceAgent.fetch('https://api.market.com/prices');
  const enforceDecision = enforceAgent.lastDecision();

  console.log(`   lastDecision(): { allowed: ${enforceDecision?.allowed}, gate: "${enforceDecision?.gate}" }`);
  console.log(`   wallet.pay() called: ${walletCallCount > walletBefore ? 'YES ❌' : 'NO ✅ — money never left'}`);
  console.log(`   protectedSpend: $${enforceAgent.protectedSpend}`);
  console.log('');

  // ── Part 3: Review mode — flag but allow ─────────────────
  console.log('━━━ 3. REVIEW MODE — FLAG BUT ALLOW ━━━');
  console.log('   Same spike, but payment proceeds with a flag');
  console.log('');

  const reviewAgent = new AgentCFO({
    wallet: mockWallet,
    budget: { daily: 100 },
    policy: { maxPerRequest: 50 },
    anomalyMode: 'review',
    anomaly: { warmupCount: 3, zThreshold: 2.0, cooldownMs: 0 },
    fetchImpl: createSpikeFetch('0.25', '10.00', 4),
  });

  reviewAgent.events.on('anomaly:flagged', (data) => {
    console.log(`   ⚠️  FLAGGED: $${data.amount} (${data.multiplier.toFixed(1)}× baseline) — payment proceeding`);
  });

  for (let i = 0; i < 4; i++) {
    await reviewAgent.fetch('https://api.market.com/prices');
  }

  const spikeRes = await reviewAgent.fetch('https://api.market.com/prices');
  const reviewDecision = reviewAgent.lastDecision();
  console.log(`   HTTP status: ${spikeRes.status} — payment went through`);
  console.log(`   lastDecision(): { allowed: ${reviewDecision?.allowed}, gate: "${reviewDecision?.gate}" }`);
  console.log(`   protectedSpend: $${reviewAgent.protectedSpend} — nothing blocked, just flagged`);
  console.log('');

  // ── Part 4: Proof metrics ────────────────────────────────
  console.log('━━━ 4. PROOF METRICS ━━━');
  const summary = enforceAgent.summary();
  console.log(`   totalSpent:      $${summary.totalSpent}`);
  console.log(`   totalDenied:     ${summary.totalDenied}`);
  console.log(`   protectedSpend:  $${summary.protectedSpend} (denied transaction value)`);
  console.log(`   anomalyBlocks:   ${summary.anomalyBlocks}`);
  console.log(`   policyDenials:   ${summary.policyDenials}`);
  console.log('');

  // ── Part 5: Event sink flush ─────────────────────────────
  console.log('━━━ 5. EVENT SINK ━━━');
  const events = sink.all();
  console.log(`   ${events.length} events captured for agent "${events[0]?.agentId}"`);
  for (const e of events) {
    const icon = e.type === 'anomaly:blocked' ? '🛡️' : '✅';
    console.log(`   ${icon} ${e.type.padEnd(18)} ${e.timestamp}`);
  }
  console.log('');
  console.log(`   Ready to flush to hosted endpoint: sink.flush()`);
  console.log('');

  // ── Done ─────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Summary: execution is not judgement.                   ║');
  console.log('║  A wallet can pay. That does not mean it should pay.    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  enforceAgent.stop();
  reviewAgent.stop();
  sink.stop();
}

main().catch(console.error);
