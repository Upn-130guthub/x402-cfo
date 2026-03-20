# x402 Ecosystem Submission — x402-cfo

This folder contains the files needed to submit x402-cfo to the [x402 ecosystem directory](https://x402.org/ecosystem).

## Submission steps

1. Fork [coinbase/x402](https://github.com/coinbase/x402)
2. Create directory: `typescript/site/app/ecosystem/partners-data/x402-cfo/`
3. Copy `metadata.json` into that directory
4. Copy `x402-cfo-logo.png` into `typescript/site/public/logos/`
5. Open a PR with title: `ecosystem: add x402-cfo — machine-native financial reasoning for autonomous agents`

## PR description template

```markdown
## New Ecosystem Project: x402-cfo

**Category:** Infrastructure & Tooling

**What it does:**
x402-cfo is the machine-native financial reasoning engine for AI agents making x402 payments.
The x402 protocol handles HOW to pay. x402-cfo handles WHETHER to pay — with statistical
anomaly detection, multi-agent budget pools, cost-optimal payment routing, predictive spend
forecasting, and network intelligence.

**Key features:**
- Statistical anomaly detection (EWMA + Welford's + z-score)
- Multi-agent budget pools with game-theoretic rebalancing
- Cost-optimal payment routing across multiple x402 options
- Predictive spend forecasting (online linear regression)
- Network intelligence — anonymized pricing signals create network effects
- Budget enforcement (per-request, hourly, daily, session)
- Cost policies (allowlist, blocklist, currency, network restrictions)
- Immutable audit ledger with JSON/CSV export
- Framework integrations: LangChain, CrewAI, MCP, Express

**Links:**
- npm: https://www.npmjs.com/package/x402-cfo
- GitHub: https://github.com/Upn-130guthub/x402-cfo
- Landing page: https://upn-130guthub.github.io/x402-cfo/
- 107 tests, zero dependencies, MIT licensed
```

## Files included

| File | Purpose |
|---|---|
| `metadata.json` | Project metadata for ecosystem directory |
| `x402-cfo-logo.png` | Logo (256×256, gold shield on dark background) |
| `SUBMISSION.md` | This file — instructions for submitting |
