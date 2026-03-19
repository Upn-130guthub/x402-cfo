import type { Request, Response } from 'express';
import type { TollboothStats } from './types.js';

/**
 * Tracks challenges issued, payments verified/failed, and revenue.
 * Attached to each tollbooth middleware instance.
 */
export class MetricsCollector {
  private challenges = 0;
  private payments = 0;
  private failures = 0;
  private revenueMinor = 0; // tracked in cents to avoid float drift
  private readonly priceMinor: number;
  private readonly startedAt: Date;

  constructor(price: string) {
    this.priceMinor = Math.round(parseFloat(price) * 100);
    this.startedAt = new Date();
  }

  recordChallenge(): void {
    this.challenges++;
  }

  recordPayment(): void {
    this.payments++;
    this.revenueMinor += this.priceMinor;
  }

  recordFailure(): void {
    this.failures++;
  }

  snapshot(): TollboothStats {
    const elapsed = Date.now() - this.startedAt.getTime();
    return {
      totalChallenges: this.challenges,
      totalPayments: this.payments,
      totalFailures: this.failures,
      revenue: (this.revenueMinor / 100).toFixed(2),
      uptime: formatUptime(elapsed),
      startedAt: this.startedAt.toISOString(),
    };
  }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60) % 60;
  const h = Math.floor(s / 3600) % 24;
  const d = Math.floor(s / 86400);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

/**
 * Create an Express handler that returns stats for a tollbooth instance.
 *
 * ```ts
 * const gate = tollbooth({ ... });
 * app.use('/api', gate);
 * app.get('/_tollbooth/stats', tollboothStats(gate));
 * ```
 */
export function tollboothStats(
  middleware: ((...args: any[]) => any) & { __metrics?: MetricsCollector },
): (req: Request, res: Response) => void {
  return (_req: Request, res: Response) => {
    if (!middleware.__metrics) {
      res.status(500).json({ error: 'No metrics available. Is this a tollbooth middleware?' });
      return;
    }
    res.json(middleware.__metrics.snapshot());
  };
}
