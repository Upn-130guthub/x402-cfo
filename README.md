# x402-cfo 🏦

[![npm](https://img.shields.io/npm/v/x402-cfo?style=flat-square&color=f5a623)](https://npmjs.com/package/x402-cfo)
[![license](https://img.shields.io/npm/l/x402-cfo?style=flat-square)](LICENSE)
[![zero deps](https://img.shields.io/badge/dependencies-0-10b981?style=flat-square)](package.json)
[![tests](https://img.shields.io/badge/tests-54%2F54-10b981?style=flat-square)](#tests)

**The financial brain for AI agents making x402 payments.**

Budget enforcement, cost policies, spend analytics, anomaly detection, and a complete audit trail for autonomous agents — whether they're calling paid APIs via the [Bazaar](https://x402.org/ecosystem), paying other agents through [A2A](https://github.com/google/A2A), or routing through [ClawRouter](https://github.com/BlockRunAI/ClawRouter). Works with [OpenClaw](https://openclawd.ai), [LangChain](https://langchain.com), [CrewAI](https://crewai.com), and [MCP](https://modelcontextprotocol.io).

Part of the [x402 protocol](https://www.x402.org/) ecosystem.

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
const res = await agent.fetch('https://api.chaindata.xyz/v1/prices');

// Before calling an endpoint, check what it usually costs
const estimate = agent.estimateCost('https://api.chaindata.xyz/v1/prices');
// → { average: 0.25, min: 0.20, max: 0.35, samples: 47 }

// Check budget status
agent.spent();    // { sessionSpent: "4.25", hourlyRemaining: "0.75", ... }
agent.summary();  // { burnRatePerMinute: "0.12", projectedDaily: "172.80", ... }
agent.audit();    // Full ledger — every decision with reason
```

## Why x402-cfo?

The x402 ecosystem gives agents wallets, facilitators, and API marketplaces — but **nothing watches the money.** Coinbase Agentic Wallets have basic session caps. The Bazaar lets agents find and pay for APIs. ClawRouter picks the cheapest LLM. But none of them track burn rate, detect spending anomalies, or enforce declarative cost policies.

**x402-cfo is the missing financial layer.**

| Capability | Coinbase AW | Bazaar | ClawRouter | x402-cfo |
|---|---|---|---|---|
| Budget enforcement (multi-window) | Session only | ❌ | ❌ | ✅ |
| Cost policies (allowlist, blocklist, currency, network) | Basic | ❌ | ❌ | ✅ |
| Spend analytics (burn rate, projections, top endpoints) | ❌ | ❌ | ❌ | ✅ |
| Cost estimation from history | ❌ | ❌ | ❌ | ✅ |
| Velocity spike detection | ❌ | ❌ | ❌ | ✅ |
| Event-driven alerts | ❌ | ❌ | ❌ | ✅ |
| Full audit ledger with export | ❌ | ❌ | ❌ | ✅ |
| Framework adapters (LangChain, CrewAI, MCP) | ❌ | ❌ | ❌ | ✅ |
| OpenClaw skill | ❌ | ❌ | ❌ | ✅ |
| Express middleware + live dashboard | ❌ | ❌ | ❌ | ✅ |

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
agent.estimateCost('https://api.chaindata.xyz/v1/prices');
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
// import { ChatAnthropic } from '@langchain/anthropic';            // Claude 4 Sonnet
// import { ChatOpenAI } from '@langchain/openai';                  // GPT-4.1
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

### Express middleware + live dashboard

Add x402-cfo to any Express app with one line. Includes a live dashboard at `/_cfo/html`:

```ts
import express from 'express';
import { AgentCFO, createExpressMiddleware } from 'x402-cfo';

const app = express();
const cfo = new AgentCFO({
  wallet: myWallet,
  budget: { hourly: 5, daily: 50, session: 200 },
  policy: { maxPerRequest: 2.00, allowedCurrencies: ['USDC'] },
});

// One line — all routes get budget enforcement + live dashboard
app.use(createExpressMiddleware(cfo));

// Your routes can access cfo via req.cfo
app.get('/research', async (req, res) => {
  const data = await req.cfo.fetch('https://api.chaindata.xyz/v1/prices');
  res.json(await data.json());
});

app.listen(3000);
// Dashboard at http://localhost:3000/_cfo/html
// JSON API at http://localhost:3000/_cfo
```

### OpenClaw

Install the x402-cfo skill to give any OpenClaw agent financial awareness. Every Bazaar API call and ClawRouter request goes through the CFO automatically:

```bash
# Install the skill
cp -r skills/x402-cfo ~/.openclaw/skills/x402-cfo

# Configure via environment
export X402_BUDGET_HOURLY=5
export X402_BUDGET_DAILY=50
export X402_MAX_PER_REQUEST=2.00
```

Once installed, the agent will:
- Route all x402 payments through budget + policy checks
- Track burn rate and project daily spend
- Alert on velocity spikes (spending 2x+ above average)
- Block payments that violate policy rules
- Maintain a full audit ledger across sessions

See [`skills/x402-cfo/skill.md`](skills/x402-cfo/skill.md) for the full skill specification.

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

