---
name: x402-cfo
description: Spend control plane for autonomous x402 payments — pre-payment anomaly detection (enforce/review/off), multi-agent budget pools with fleet policy inheritance, event sink for future hosted integration, proof metrics, payment routing, and spend forecasting.
version: 0.5.0
author: x402-cfo
tags: [x402, payments, budget, finance, usdc, analytics, cfo, audit, anomaly, forecasting, routing]
tools: [exec, read, write]
---

# x402-cfo Skill

You are an AI agent with a spend control plane for x402 payments. x402-cfo gives you pre-payment anomaly detection (blocks overspend before it happens), budget enforcement, fleet policy inheritance, and an event sink for audit. Every payment decision goes through policy → anomaly check → budget check before any money moves.

## Setup

```bash
npm list x402-cfo 2>/dev/null || npm install x402-cfo
```

## Core: Making paid requests

ALWAYS use `cfo.fetch()` instead of raw `fetch()` for any x402 endpoint:

```typescript
import { AgentCFO, JsonFileStorage } from 'x402-cfo';

const cfo = new AgentCFO({
  wallet: walletInstance,
  budget: {
    hourly: parseFloat(process.env.X402_BUDGET_HOURLY || '5'),
    daily: parseFloat(process.env.X402_BUDGET_DAILY || '50'),
    session: parseFloat(process.env.X402_BUDGET_SESSION || '200'),
  },
  policy: {
    maxPerRequest: parseFloat(process.env.X402_MAX_PER_REQUEST || '2.00'),
    allowedCurrencies: ['USDC'],
    allowedNetworks: (process.env.X402_NETWORKS || 'base').split(','),
    blocklist: (process.env.X402_BLOCKLIST || '').split(',').filter(Boolean),
  },
  storage: new JsonFileStorage('./x402-cfo-ledger.json'),
});

const response = await cfo.fetch('https://api.paid-service.com/v1/data');
```

## Cost estimation and budget checks

```typescript
const estimate = cfo.estimateCost('https://api.paid-service.com/v1/data');
// → { mean: 0.25, p50: 0.24, p95: 0.38, stddev: 0.05, samples: 47 }

const budget = cfo.spent();
// → { sessionSpent: "4.25", hourlyRemaining: "0.75", dailyRemaining: "45.75" }
```

## Anomaly detection

```typescript
import { AnomalyDetector } from 'x402-cfo';
const detector = new AnomalyDetector({ zThreshold: 2.5, cooldownMs: 60_000 });
const result = detector.observe('api.data.com', 5.00);
// → { isAnomaly: true, zScore: 4.2, baseline: 0.25, multiplier: 20 }
```

## Multi-agent budget pools

```typescript
import { BudgetPool } from 'x402-cfo';
const pool = new BudgetPool({
  total: 1000,
  strategy: 'weighted',
  agents: [
    { id: 'researcher', weight: 3, costCenter: 'R&D' },
    { id: 'support-bot', weight: 1, costCenter: 'Support' },
  ],
});
pool.check('researcher', 2.50); // → { allowed: true, remainingAfter: 747.50 }
```

## Payment routing

```typescript
import { PaymentRouter } from 'x402-cfo';
const router = new PaymentRouter();
const best = await router.select(challenge.accepts);
// → picks cheapest option by asset price + network fees + speed
```

## Spend forecasting

```typescript
import { SpendForecaster } from 'x402-cfo';
const forecaster = new SpendForecaster({ budget: 1000 });
forecaster.observe(0.25);
// ... after enough observations:
forecaster.forecast();
// → { ratePerHour: 12.50, exhaustionEtaMs: 72000000, trend: 'accelerating', confidence: 0.95 }
```

## Reacting to financial events

```typescript
cfo.events.on('budget:warning', ({ window, percentUsed }) => {
  // Budget running low — reduce spending or ask the user
});

cfo.events.on('anomaly:blocked', ({ amount, baseline, multiplier }) => {
  // Anomaly detected and blocked — payment did NOT happen
});

cfo.events.on('anomaly:flagged', ({ amount, baseline, multiplier }) => {
  // Anomaly detected but payment proceeded (review mode)
});

cfo.events.on('budget:exhausted', ({ window }) => {
  // No budget left — stop making paid requests
});
```

## Key rules

1. **Never bypass the CFO.** All x402 payments go through `cfo.fetch()`.
2. **Check budget before expensive operations.** Use `cfo.spent()` and `cfo.estimateCost()`.
3. **Report spending when asked.** Use `cfo.summary()` for high-level stats, `cfo.audit()` for the full ledger.
4. **Respect budget exhaustion.** When a `budget:exhausted` event fires, stop making paid requests.
5. **Use the forecaster.** Know when budget runs out before it happens.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `X402_BUDGET_HOURLY` | `5` | Maximum spend per hour (USDC) |
| `X402_BUDGET_DAILY` | `50` | Maximum spend per day (USDC) |
| `X402_BUDGET_SESSION` | `200` | Maximum spend per session (USDC) |
| `X402_MAX_PER_REQUEST` | `2.00` | Maximum spend per single request (USDC) |
| `X402_NETWORKS` | `base` | Comma-separated allowed networks |
| `X402_BLOCKLIST` | `` | Comma-separated blocked domains |
