# x402-cfo 🏦

[![npm](https://img.shields.io/npm/v/x402-cfo?style=flat-square&color=f5a623)](https://npmjs.com/package/x402-cfo)
[![license](https://img.shields.io/npm/l/x402-cfo?style=flat-square)](LICENSE)
[![zero deps](https://img.shields.io/badge/dependencies-0-10b981?style=flat-square)](package.json)
[![tests](https://img.shields.io/badge/tests-54%2F54-10b981?style=flat-square)](#tests)

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

Pre-built adapters for **LangChain**, **CrewAI**, and **MCP**. Each creates 4 tools that give any AI agent financial awareness:

| Tool | What it does |
|---|---|
| `x402_fetch` | Make an HTTP request with automatic x402 payment handling |
| `x402_estimate_cost` | Predict cost of an endpoint based on historical data |
| `x402_check_budget` | Check remaining budget before committing to a task |
| `x402_audit_ledger` | Review all past payments and denials |

### LangChain

Give a LangChain agent a budget and let it make autonomous paid API calls:

```ts
import { AgentCFO, JsonFileStorage } from 'x402-cfo';
import { createLangChainTools } from 'x402-cfo';

// Works with ANY LangChain-compatible LLM:
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';  // Gemini
// import { ChatAnthropic } from '@langchain/anthropic';            // Claude
// import { ChatOpenAI } from '@langchain/openai';                  // GPT-4
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';

// 1. Create the CFO — this controls ALL spending
const cfo = new AgentCFO({
  wallet: myX402Wallet,
  budget: { hourly: 5, daily: 50, session: 200 },
  policy: { maxPerRequest: 2.00, allowedCurrencies: ['USDC'] },
  storage: new JsonFileStorage('./langchain-agent-ledger.json'),
});

// 2. Wire alerts — know when spending gets hot
cfo.events.on('budget:warning', ({ window, percentUsed }) => {
  console.warn(`⚠️  ${window} budget at ${(percentUsed * 100).toFixed(0)}%`);
});

// 3. Create LangChain tools from the CFO
const tools = createLangChainTools(cfo);

// 4. Give them to any LLM — swap one line, everything else stays the same
const llm = new ChatGoogleGenerativeAI({ model: 'gemini-2.0-flash' });
const agent = await createToolCallingAgent({ llm, tools, prompt });
const executor = new AgentExecutor({ agent, tools });

// 5. The agent can now autonomously:
//    - Fetch paid APIs (x402_fetch)
//    - Check if it can afford an endpoint (x402_estimate_cost)
//    - Monitor its own spending (x402_check_budget)
//    - Review what it's paid for (x402_audit_ledger)
const result = await executor.invoke({
  input: 'Get the latest market data and sentiment analysis, but stay under $2 total',
});

// 6. After the run — full financial audit
console.log(cfo.summary());
// → { totalSpent: "1.45", burnRatePerMinute: "0.24", projectedDaily: "345.60" }
```

### CrewAI

Give a CrewAI crew shared budget control — each agent checks before spending:

```ts
import { AgentCFO } from 'x402-cfo';
import { createCrewAITools } from 'x402-cfo';

const cfo = new AgentCFO({
  wallet: myX402Wallet,
  budget: { session: 10 },
  policy: { maxPerRequest: 1.00, allowedCurrencies: ['USDC'] },
});

// CrewAI tools — same 4 tools, CrewAI-compatible format
const tools = createCrewAITools(cfo);

// Assign to any agent in the crew — they all share the same budget
// If the researcher blows $8, the writer only has $2 left
const researcher = { tools, role: 'Market Researcher', ... };
const writer     = { tools, role: 'Report Writer', ... };
```

### MCP (Model Context Protocol)

Register x402-cfo as an MCP tool provider — any MCP-compatible AI client (Claude Desktop, custom agents) gets financial controls:

```ts
import { AgentCFO } from 'x402-cfo';
import { createMCPTools } from 'x402-cfo';

const cfo = new AgentCFO({
  wallet: myX402Wallet,
  budget: { daily: 25 },
  policy: { maxPerRequest: 0.50, allowedCurrencies: ['USDC'] },
});

const mcpTools = createMCPTools(cfo);

// Register with your MCP server — each tool has:
// { name, description, inputSchema, handler }
for (const tool of mcpTools) {
  mcpServer.registerTool(tool.name, {
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: tool.handler,
  });
}

// Now any MCP client can call:
// x402_fetch({ url: "https://api.paid-data.com/prices" })
// x402_check_budget({})
// x402_estimate_cost({ url: "https://api.paid-data.com/prices" })
// x402_audit_ledger({})
```

### Running the demo

See the full SDK in action without any framework dependency:

```bash
npm run demo
```

This runs a simulated agent making 6 x402 API calls, hitting budget limits, and showing the complete flow.

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

