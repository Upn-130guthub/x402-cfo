# x402-cfo 🏦

[![npm](https://img.shields.io/npm/v/x402-cfo?style=flat-square&color=f5a623)](https://npmjs.com/package/x402-cfo)
[![license](https://img.shields.io/npm/l/x402-cfo?style=flat-square)](LICENSE)
[![zero deps](https://img.shields.io/badge/dependencies-0-10b981?style=flat-square)](package.json)
[![tests](https://img.shields.io/badge/tests-43%2F43-10b981?style=flat-square)](#tests)

**Agent financial controller for x402 payments.**

Budget enforcement, cost policies, spend ledger, analytics, events, and persistent storage for AI agents making autonomous on-chain payments via the [x402 protocol](https://www.x402.org/).

## Quick start

```ts
import { AgentCFO, JsonFileStorage } from 'x402-cfo';

const agent = new AgentCFO({
  wallet: myX402Wallet,
  budget: { hourly: 5, daily: 50, session: 200 },
  policy: {
    maxPerRequest: 2.00,
    allowedCurrencies: ['USDC'],
    allowedNetworks: ['base'],
    blocklist: ['api.untrusted.com'],
  },
  storage: new JsonFileStorage('./agent-ledger.json'), // Survive restarts
});

// React to financial events
agent.events.on('budget:warning', ({ window, percentUsed }) => {
  console.warn(`⚠️  ${window} budget at ${(percentUsed * 100).toFixed(0)}%`);
});
agent.events.on('velocity:spike', ({ multiplier }) => {
  console.warn(`🔥 Spending ${multiplier.toFixed(1)}x above average`);
});

// Drop-in fetch replacement — handles 402 → policy → budget → pay → log
const res = await agent.fetch('https://api.example.com/premium/data');

// Before calling an endpoint, check what it usually costs
const estimate = agent.estimateCost('https://api.example.com/premium/data');
// → { average: 0.25, min: 0.20, max: 0.35, samples: 47 }

// Check budget status
agent.spent();    // { sessionSpent: "4.25", hourlyRemaining: "0.75", ... }
agent.summary();  // { burnRatePerMinute: "0.12", projectedDaily: "172.80", ... }
agent.audit();    // Full ledger — every decision with reason
```

## Why x402-cfo?

`x402-fetch` handles the 402→pay→retry flow. But it has zero opinions about **how much** to spend, **where** to spend, or **tracking** what was spent.

**x402-fetch is the wallet. x402-cfo is the CFO.**

| | x402-fetch | x402-cfo |
|---|---|---|
| Auto-pay on 402 | ✅ | ✅ |
| Budget limits (per-request, hourly, daily, session) | ❌ | ✅ |
| Cost policies (allowlist, blocklist, currency, network) | ❌ | ✅ |
| Spend tracking & audit ledger | ❌ | ✅ |
| Analytics (burn rate, projected daily, top endpoints) | ❌ | ✅ |
| Event system (payment, budget, velocity alerts) | ❌ | ✅ |
| Persistent storage (survives restarts) | ❌ | ✅ |
| Cost estimation from historical data | ❌ | ✅ |
| Spending velocity spike detection | ❌ | ✅ |
| JSON + CSV export | ❌ | ✅ |

## Install

```bash
npm install x402-cfo
```

## Features

### 🏦 Budget enforcement
Per-request, hourly, daily, and session spend limits with rolling-window tracking.

```ts
budget: { maxPerRequest: 2.00, hourly: 5, daily: 50, session: 200 }
```

### 📋 Cost policies
Declarative rules. Policy denials never touch the wallet.

```ts
policy: {
  maxPerRequest: 2.00,
  allowlist: ['api.trusted.com'],
  blocklist: ['api.evil.com'],
  allowedCurrencies: ['USDC'],
  allowedNetworks: ['base', 'ethereum'],
}
```

### 📒 Audit ledger
Every payment decision logged with timestamp, amount, URL, status, and reason. Exportable as JSON or CSV.

### 📊 Spend analytics
Burn rate, projected daily spend, top endpoints by cost, and currency breakdown.

### ⚡ Typed event system
Subscribe to financial events — build Slack alerts, circuit breakers, or custom monitoring.

```ts
agent.events.on('payment:success', ({ entry }) => { ... });
agent.events.on('payment:denied', ({ entry }) => { ... });
agent.events.on('payment:failed', ({ entry }) => { ... });
agent.events.on('budget:warning', ({ window, percentUsed }) => { ... });
agent.events.on('budget:exhausted', ({ window }) => { ... });
agent.events.on('velocity:spike', ({ multiplier }) => { ... });
```

### 💾 Persistent storage
Plug in any storage backend. Ships with `JsonFileStorage`:

```ts
import { JsonFileStorage } from 'x402-cfo';
storage: new JsonFileStorage('./agent-ledger.json')
```

Implement the `StorageAdapter` interface for SQLite, Redis, etc.

### 🔮 Cost estimation
After an agent makes a few calls, it knows what endpoints typically cost:

```ts
agent.estimateCost('https://api.example.com/data');
// → { average: 0.25, min: 0.20, max: 0.35, samples: 47 }
```

### 🔥 Velocity detection
Automatically detects when recent spending is 2x+ above the historical average and fires a `velocity:spike` event.

## API

### `new AgentCFO(config)`

| Option | Type | Description |
|---|---|---|
| `wallet` | `AgentWallet` | Wallet that signs x402 payments |
| `budget` | `BudgetLimits` | Spend limits |
| `policy` | `PolicyRules` | Cost policy rules |
| `storage` | `StorageAdapter` | Persistent ledger storage |
| `warningThreshold` | `number` | Budget warning threshold (0-1, default 0.8) |
| `sync` | `SyncConfig` | Dashboard sync (Pro/Scale) |
| `fetchImpl` | `typeof fetch` | Custom fetch (defaults to global) |

### Methods

| Method | Returns | Description |
|---|---|---|
| `agent.fetch(url, init?)` | `Promise<Response>` | Drop-in fetch with x402 handling |
| `agent.spent()` | `BudgetStatus` | Current budget status |
| `agent.summary()` | `SpendSummary` | Burn rate, projected spend, top endpoints |
| `agent.audit()` | `LedgerEntry[]` | Full audit trail |
| `agent.estimateCost(url)` | `object \| null` | Expected cost based on history |
| `agent.exportJSON()` | `string` | Export ledger as JSON |
| `agent.exportCSV()` | `string` | Export ledger as CSV |
| `agent.stop()` | `void` | Cleanup sync and event handlers |

### `AgentWallet` interface

```ts
interface AgentWallet {
  pay(params: {
    requirement: X402PaymentRequirement;
    challengeId?: string;
  }): Promise<string>;  // Returns X-PAYMENT header value
}
```

## Decision pipeline

```
402 received → parse challenge → POLICY check → BUDGET check → PAY → LOG → EVENTS
                                      ↓ deny          ↓ deny      ↓ fail
                                   emit denied     emit denied  emit failed
```

## Framework integrations

Pre-built adapters for LangChain, CrewAI, and MCP. Each creates 4 tools: `x402_fetch`, `x402_estimate_cost`, `x402_check_budget`, `x402_audit_ledger`.

### LangChain

```ts
import { AgentCFO } from 'x402-cfo';
import { createLangChainTools } from 'x402-cfo';

const agent = new AgentCFO({ wallet, budget: { daily: 50 } });
const tools = createLangChainTools(agent);
// Pass tools to your LangChain agent executor
```

### CrewAI

```ts
import { createCrewAITools } from 'x402-cfo';
const tools = createCrewAITools(agent);
// Assign to CrewAI agents
```

### MCP (Model Context Protocol)

```ts
import { createMCPTools } from 'x402-cfo';
const tools = createMCPTools(agent);
// Register with your MCP server
```

## Dashboard (Pro/Scale)

The npm package works standalone forever. For teams running multiple agents, connect to the hosted dashboard with one line:

```ts
sync: { apiKey: 'your-api-key' }
```

| | Free | Pro ($49/mo) | Scale ($199/mo) |
|---|---|---|---|
| Budget + policies + ledger | ✅ | ✅ | ✅ |
| Events + storage + analytics | ✅ | ✅ | ✅ |
| Framework integrations | ✅ | ✅ | ✅ |
| Dashboard — all agents in one view | — | ✅ | ✅ |
| Alerts at 80% budget | — | ✅ | ✅ |
| Kill switch — freeze spend remotely | — | — | ✅ |
| Compliance audit reports | — | — | ✅ |

## Tests

```bash
npm test
```

54 tests across 7 suites: budget, policy, controller, events, storage, advanced, and integrations.

## License

MIT

