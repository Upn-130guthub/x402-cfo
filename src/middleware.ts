/**
 * Express/Connect middleware for x402-cfo.
 *
 * Wraps any Express app so every outbound x402 payment goes through 
 * the CFO's budget enforcement, cost policies, and audit trail.
 * Also exposes a GET /_cfo endpoint for live spend monitoring.
 *
 * Usage:
 *   import express from 'express';
 *   import { AgentCFO } from 'x402-cfo';
 *   import { createExpressMiddleware } from 'x402-cfo';
 *
 *   const app = express();
 *   const cfo = new AgentCFO({ wallet, budget: { daily: 50 } });
 *   app.use(createExpressMiddleware(cfo));
 */

import type { AgentCFO } from './controller.js';

export interface ExpressMiddlewareOptions {
  /** Mount path for the dashboard endpoint. Default: '/_cfo' */
  dashboardPath?: string;
  /** Enable the /_cfo dashboard endpoint. Default: true */
  enableDashboard?: boolean;
}

/**
 * Create Express middleware that:
 * 1. Attaches the AgentCFO instance to req.cfo for route handlers
 * 2. Exposes a GET /_cfo endpoint returning live spend data as JSON
 * 3. Exposes a GET /_cfo/html endpoint returning a styled dashboard page
 */
export function createExpressMiddleware(
  cfo: AgentCFO,
  options: ExpressMiddlewareOptions = {}
) {
  const { dashboardPath = '/_cfo', enableDashboard = true } = options;

  return (req: any, res: any, next: any) => {
    // Attach CFO to request for downstream handlers
    req.cfo = cfo;

    if (!enableDashboard) return next();

    // JSON dashboard endpoint
    if (req.method === 'GET' && req.path === dashboardPath) {
      const data = {
        budget: cfo.spent(),
        analytics: cfo.summary(),
        recentPayments: cfo.audit().slice(-20),
        generatedAt: new Date().toISOString(),
      };
      return res.json(data);
    }

    // HTML dashboard endpoint
    if (req.method === 'GET' && req.path === `${dashboardPath}/html`) {
      const budget = cfo.spent();
      const analytics = cfo.summary();
      const recent = cfo.audit().slice(-20);

      const html = renderDashboardHTML(budget, analytics, recent);
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    next();
  };
}

function renderDashboardHTML(budget: any, analytics: any, recent: any[]): string {
  const paidEntries = recent.filter((e: any) => e.status === 'paid');
  const deniedEntries = recent.filter((e: any) => e.status === 'denied');

  const recentRows = recent
    .reverse()
    .map(
      (e: any) =>
        `<tr>
          <td>${new Date(e.timestamp).toLocaleTimeString()}</td>
          <td>${e.url ? new URL(e.url).pathname : '—'}</td>
          <td>${e.amount ? '$' + Number(e.amount).toFixed(4) : '—'}</td>
          <td><span class="badge ${e.status}">${e.status}</span></td>
          <td>${e.reason || '—'}</td>
        </tr>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>x402-cfo Dashboard</title>
  <meta http-equiv="refresh" content="5">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0e1a; --surface: #111827; --border: rgba(245,166,35,0.12);
      --txt: #e8ecf4; --txt2: #94a3b8; --txt3: #64748b;
      --amber: #f5a623; --green: #10b981; --red: #ef4444; --blue: #6366f1;
    }
    body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--txt); padding: 24px; }
    h1 { font-size: 20px; font-weight: 800; margin-bottom: 4px; }
    .subtitle { color: var(--txt3); font-size: 12px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card {
      background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px;
    }
    .card-label { font-size: 11px; font-weight: 600; color: var(--txt3); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .card-value { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
    .card-value.amber { color: var(--amber); }
    .card-value.green { color: var(--green); }
    .card-value.red { color: var(--red); }
    .card-value.blue { color: var(--blue); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px 12px; color: var(--txt3); font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.03); color: var(--txt2); }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .badge.paid { background: rgba(16,185,129,0.1); color: var(--green); }
    .badge.denied { background: rgba(239,68,68,0.1); color: var(--red); }
    .badge.failed { background: rgba(99,102,241,0.1); color: var(--blue); }
    .section-title { font-size: 14px; font-weight: 700; margin-bottom: 12px; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>x402-cfo Dashboard</h1>
  <p class="subtitle">Auto-refreshes every 5 seconds &middot; ${new Date().toLocaleTimeString()}</p>

  <div class="grid">
    <div class="card">
      <div class="card-label">Session Spent</div>
      <div class="card-value amber">$${budget.sessionSpent || '0.00'}</div>
    </div>
    <div class="card">
      <div class="card-label">Hourly Remaining</div>
      <div class="card-value green">$${budget.hourlyRemaining || '—'}</div>
    </div>
    <div class="card">
      <div class="card-label">Daily Remaining</div>
      <div class="card-value green">$${budget.dailyRemaining || '—'}</div>
    </div>
    <div class="card">
      <div class="card-label">Burn Rate / min</div>
      <div class="card-value blue">$${analytics.burnRatePerMinute || '0.00'}</div>
    </div>
    <div class="card">
      <div class="card-label">Projected Daily</div>
      <div class="card-value ${Number(analytics.projectedDaily) > 100 ? 'red' : 'amber'}">$${analytics.projectedDaily || '0.00'}</div>
    </div>
    <div class="card">
      <div class="card-label">Payments / Denied</div>
      <div class="card-value">${paidEntries.length} <span style="color:var(--txt3)">/</span> <span style="color:var(--red)">${deniedEntries.length}</span></div>
    </div>
  </div>

  <div class="section-title">Recent Transactions</div>
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
    <table>
      <thead>
        <tr><th>Time</th><th>Endpoint</th><th>Amount</th><th>Status</th><th>Reason</th></tr>
      </thead>
      <tbody>
        ${recentRows || '<tr><td colspan="5" style="text-align:center;color:var(--txt3)">No transactions yet</td></tr>'}
      </tbody>
    </table>
  </div>

  <p style="margin-top:16px;font-size:11px;color:var(--txt3)">Powered by <a href="https://npmjs.com/package/x402-cfo" style="color:var(--amber);text-decoration:none">x402-cfo</a></p>
</body>
</html>`;
}
