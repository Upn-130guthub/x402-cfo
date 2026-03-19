/**
 * Real-time spend analytics for x402-cfo agent.
 *
 * Computes burn rate, projected spend, and top endpoints from
 * the ledger data. Designed to be queried frequently by agent
 * orchestration layers that need to make cost-aware decisions.
 */

import type { Ledger, LedgerEntry } from './ledger.js';

export interface SpendSummary {
  /** Total amount spent (paid only), dollars */
  totalSpent: string;
  /** Number of paid transactions */
  totalTransactions: number;
  /** Number of denied transactions */
  totalDenied: number;
  /** Number of failed transactions */
  totalFailed: number;
  /** Current burn rate in dollars per minute (rolling 15-min average) */
  burnRatePerMinute: string;
  /** Projected daily spend based on current burn rate, dollars */
  projectedDaily: string;
  /** Top endpoints by total spend */
  topEndpoints: { url: string; spent: string; count: number }[];
  /** Spend breakdown by currency */
  byCurrency: Record<string, string>;
}

function toCents(dollars: string): number {
  return Math.round(parseFloat(dollars) * 100);
}

function toDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export class Analytics {
  private ledger: Ledger;

  constructor(ledger: Ledger) {
    this.ledger = ledger;
  }

  /** Generate a full spend summary from current ledger data. */
  summary(): SpendSummary {
    const entries = this.ledger.all();
    const paid = entries.filter(e => e.status === 'paid');
    const denied = entries.filter(e => e.status === 'denied');
    const failed = entries.filter(e => e.status === 'failed');

    const totalCents = paid.reduce((s, e) => s + toCents(e.amount), 0);

    // Burn rate: average $/min over the last 15 minutes
    const now = Date.now();
    const fifteenMinAgo = now - 15 * 60 * 1000;
    const recentPaid = paid.filter(e => new Date(e.timestamp).getTime() >= fifteenMinAgo);
    const recentCents = recentPaid.reduce((s, e) => s + toCents(e.amount), 0);
    const windowMinutes = recentPaid.length > 0
      ? Math.max(1, (now - new Date(recentPaid[0].timestamp).getTime()) / 60_000)
      : 1;
    const burnCentsPerMin = recentPaid.length > 0 ? recentCents / windowMinutes : 0;
    const projectedDailyCents = burnCentsPerMin * 60 * 24;

    // Top endpoints
    const endpointMap = new Map<string, { cents: number; count: number }>();
    for (const e of paid) {
      const existing = endpointMap.get(e.url) ?? { cents: 0, count: 0 };
      existing.cents += toCents(e.amount);
      existing.count += 1;
      endpointMap.set(e.url, existing);
    }
    const topEndpoints = [...endpointMap.entries()]
      .sort((a, b) => b[1].cents - a[1].cents)
      .slice(0, 10)
      .map(([url, data]) => ({ url, spent: toDollars(data.cents), count: data.count }));

    // By currency
    const currencyMap = new Map<string, number>();
    for (const e of paid) {
      const c = currencyMap.get(e.currency) ?? 0;
      currencyMap.set(e.currency, c + toCents(e.amount));
    }
    const byCurrency: Record<string, string> = {};
    for (const [currency, cents] of currencyMap) {
      byCurrency[currency] = toDollars(cents);
    }

    return {
      totalSpent: toDollars(totalCents),
      totalTransactions: paid.length,
      totalDenied: denied.length,
      totalFailed: failed.length,
      burnRatePerMinute: toDollars(Math.round(burnCentsPerMin)),
      projectedDaily: toDollars(Math.round(projectedDailyCents)),
      topEndpoints,
      byCurrency,
    };
  }
}
