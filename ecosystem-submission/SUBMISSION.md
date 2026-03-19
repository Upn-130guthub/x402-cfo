# x402 Ecosystem Submission — x402-cfo

This folder contains the files needed to submit x402-cfo to the [x402 ecosystem directory](https://x402.org/ecosystem).

## Submission steps

1. Fork [coinbase/x402](https://github.com/coinbase/x402)
2. Create directory: `typescript/site/app/ecosystem/partners-data/x402-cfo/`
3. Copy `metadata.json` into that directory
4. Copy `x402-cfo-logo.png` into `typescript/site/public/logos/`
5. Open a PR with title: `ecosystem: add x402-cfo — agent financial controller`

## PR description template

```markdown
## New Ecosystem Project: x402-cfo

**Category:** Infrastructure & Tooling

**What it does:**
x402-cfo is the financial controller layer for AI agents making x402 payments.
While x402-fetch handles the wallet and payment flow, x402-cfo adds budget enforcement,
cost policies, spend analytics, an audit ledger, and event-driven monitoring on top.

**Key features:**
- Budget limits (per-request, hourly, daily, session)
- Cost policies (allowlist, blocklist, currency, network restrictions)
- Spend ledger with JSON/CSV export
- Event system (payment, budget, velocity alerts)
- Cost estimation from historical data
- Persistent storage (survives restarts)
- Framework integrations: LangChain, CrewAI, MCP

**Links:**
- npm: https://www.npmjs.com/package/x402-cfo
- GitHub: https://github.com/Upn-130guthub/x402-cfo
- Landing page: https://upn-130guthub.github.io/x402-cfo/
- 54 tests, zero dependencies, MIT licensed
```

## Files included

| File | Purpose |
|---|---|
| `metadata.json` | Project metadata for ecosystem directory |
| `x402-cfo-logo.png` | Logo (256×256, gold shield on dark background) |
| `SUBMISSION.md` | This file — instructions for submitting |
