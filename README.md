# x402-cfo 🏦

[![npm](https://img.shields.io/npm/v/x402-cfo?style=flat-square&color=f5a623)](https://npmjs.com/package/x402-cfo)
[![license](https://img.shields.io/npm/l/x402-cfo?style=flat-square)](LICENSE)
[![zero deps](https://img.shields.io/badge/dependencies-0-10b981?style=flat-square)](package.json)

**Agent financial controller for x402 payments.**

Budget enforcement, cost policies, spend ledger, and analytics for AI agents making autonomous on-chain payments via the [x402 protocol](https://www.x402.org/).

```ts
import { AgentCFO } from 'x402-cfo';

const agent = new AgentCFO({
  wallet: myX402Wallet,
  budget: { hourly: 5, daily: 50, session: 200 },
  policy: {
    maxPerRequest: 2.00,
    allowedCurrencies: ['USDC'],
    allowedNetworks: ['base'],
  },
});

// Drop-in fetch replacement — handles 402 → pay → retry automatically
const res = await agent.fetch('https://api.example.com/premium/data');

// Budget-aware: denied if limits exceeded
// Policy-aware: denied if URL/currency/network not allowed
// Fully audited: every decision logged with reason

console.log(agent.spent());    // { sessionSpent: "4.25", hourlyRemaining: "0.75", ... }
console.log(agent.summary());  // { burnRatePerMinute: "0.12", projectedDaily: "172.80", ... }
console.log(agent.audit());    // [ { status: "paid", amount: "0.25", url: "...", reason: "..." }, ... ]
```

## Why x402-cfo?

The x402 protocol has client libraries (`x402-fetch`, `x402-axios`) that handle the 402→pay→retry flow. But they have zero opinions about **how much** an agent should spend, **where** it should spend, or **tracking** what it spent.

`x402-fetch` is the wallet. **x402-cfo is the CFO.**

| | x402-fetch | x402-cfo |
|---|---|---|
| Auto-pay on 402 | ✅ | ✅ |
| Budget limits | ❌ | ✅ per-request, hourly, daily, session |
| Cost policies | ❌ | ✅ allowlist, blocklist, currency, network |
| Spend tracking | ❌ | ✅ full audit ledger |
| Analytics | ❌ | ✅ burn rate, projected daily, top endpoints |
| Export | ❌ | ✅ JSON + CSV |

## Install

```bash
npm install x402-cfo
```

## API

### `new AgentCFO(config)`

| Option | Type | Description |
|---|---|---|
| `wallet` | `AgentWallet` | Wallet that signs x402 payments |
| `budget` | `BudgetLimits` | Spend limits (see below) |
| `policy` | `PolicyRules` | Cost policy rules (see below) |
| `fetchImpl` | `typeof fetch` | Custom fetch (defaults to global) |

### Budget Limits

```ts
{
  maxPerRequest: 2.00,  // Max per single payment
  hourly: 5.00,         // Rolling 1-hour cap
  daily: 50.00,         // Rolling 24-hour cap
  session: 200.00,      // Lifetime cap for this agent instance
}
```

### Policy Rules

```ts
{
  maxPerRequest: 2.00,                    // Hard price cap
  allowlist: ['api.trusted.com'],         // Only pay these domains
  blocklist: ['api.evil.com'],            // Never pay these
  allowedCurrencies: ['USDC'],            // Only accept USDC
  allowedNetworks: ['base', 'ethereum'],  // Only these chains
}
```

### Methods

| Method | Returns | Description |
|---|---|---|
| `agent.fetch(url, init?)` | `Promise<Response>` | Drop-in fetch with x402 handling |
| `agent.spent()` | `BudgetStatus` | Current budget status |
| `agent.summary()` | `SpendSummary` | Analytics: burn rate, projected spend, top endpoints |
| `agent.audit()` | `LedgerEntry[]` | Full audit trail |
| `agent.exportJSON()` | `string` | Export ledger as JSON |
| `agent.exportCSV()` | `string` | Export ledger as CSV |

### AgentWallet Interface

Implement this to connect any wallet:

```ts
interface AgentWallet {
  pay(params: {
    requirement: X402PaymentRequirement;
    challengeId?: string;
  }): Promise<string>;  // Returns X-PAYMENT header value
}
```

## Decision Pipeline

When `agent.fetch()` hits a 402:

```
402 received → parse challenge → check POLICY → check BUDGET → PAY → log to LEDGER
                                      ↓ deny          ↓ deny      ↓ fail
                                   log denied      log denied   log failed
```

Every decision is logged with a reason. Policy denials never touch the wallet.

## Run tests

```bash
npm test
```

23 tests covering budget enforcement, policy rules, and full controller flows.

## License

MIT
