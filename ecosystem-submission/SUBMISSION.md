# x402 Ecosystem Submission — x402-cfo

This folder contains the files needed to submit x402-cfo to the [x402 ecosystem directory](https://x402.org/ecosystem).

## Submission steps

1. Fork [coinbase/x402](https://github.com/coinbase/x402)
2. Create directory: `typescript/site/app/ecosystem/partners-data/x402-cfo/`
3. Copy `metadata.json` into that directory
4. Copy `x402-cfo-logo.png` into `typescript/site/public/logos/`
5. Open a PR with title: `ecosystem: add x402-cfo — spend control plane for autonomous agent payments`

## PR description template

```markdown
## New Ecosystem Project: x402-cfo

**Category:** Infrastructure & Tooling

**What it does:**
x402-cfo is the spend control plane for AI agents making x402 payments.
The x402 protocol handles HOW to pay. x402-cfo handles WHETHER to pay — with pre-payment
anomaly detection (enforce/review/off), multi-agent budget pools with fleet policy inheritance,
event sink for future hosted integration, and proof metrics.

**Key features:**
- Pre-payment anomaly detection with enforce/review/off modes (EWMA + Welford’s + z-score)
- Multi-agent budget pools with fleet policy inheritance and rebalancing
- Event sink for structured event log (transport stub for future hosted layer)
- Proof metrics: protectedSpend, anomalyBlocks, anomalyFlags, policyDenials
- Cost-optimal payment routing across multiple x402 options
- Predictive spend forecasting (online linear regression)
- Budget enforcement (per-request, hourly, daily, session)
- Cost policies (allowlist, blocklist, currency, network restrictions)
- Immutable audit ledger with JSON/CSV export
- Framework integrations: LangChain, CrewAI, MCP, Express

**Links:**
- npm: https://www.npmjs.com/package/x402-cfo
- GitHub: https://github.com/Upn-130guthub/x402-cfo
- Landing page: https://upn-130guthub.github.io/x402-cfo/
- 131 tests, zero dependencies, MIT licensed
```

## Files included

| File | Purpose |
|---|---|
| `metadata.json` | Project metadata for ecosystem directory |
| `x402-cfo-logo.png` | Logo (256×256, gold shield on dark background) |
| `SUBMISSION.md` | This file — instructions for submitting |
