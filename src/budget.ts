/**
 * Budget manager for x402-cfo agent.
 *
 * Enforces spending limits across multiple time windows (per-request,
 * hourly, daily, session). Uses a rolling-window ledger to track
 * spend in real-time and reject requests that would exceed limits.
 *
 * All amounts are tracked as integer cents internally to avoid
 * floating-point drift.
 */

export interface BudgetLimits {
  /** Max spend per individual request, in dollars (e.g. 2.00) */
  maxPerRequest?: number;
  /** Max spend per rolling hour, in dollars */
  hourly?: number;
  /** Max spend per rolling 24h, in dollars */
  daily?: number;
  /** Max total spend for this session (agent lifetime), in dollars */
  session?: number;
}

export interface BudgetStatus {
  /** Total spent this session, dollars */
  sessionSpent: string;
  /** Spent in the current rolling hour, dollars */
  hourlySpent: string;
  /** Spent in the current rolling 24h, dollars */
  dailySpent: string;
  /** Remaining session budget (null if no limit) */
  sessionRemaining: string | null;
  /** Remaining hourly budget (null if no limit) */
  hourlyRemaining: string | null;
  /** Remaining daily budget (null if no limit) */
  dailyRemaining: string | null;
}

export type BudgetDenialReason =
  | 'exceeds_per_request_limit'
  | 'exceeds_hourly_limit'
  | 'exceeds_daily_limit'
  | 'exceeds_session_limit';

export interface BudgetDecision {
  allowed: boolean;
  reason?: BudgetDenialReason;
  /** Human-readable explanation */
  message?: string;
}

interface SpendEntry {
  amountCents: number;
  timestamp: number;
}

function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

function toDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export class Budget {
  private limits: BudgetLimits;
  private entries: SpendEntry[] = [];
  private sessionSpentCents = 0;

  constructor(limits: BudgetLimits = {}) {
    this.limits = limits;
  }

  /**
   * Check if a proposed spend amount is allowed under current limits.
   * Does NOT record the spend — call record() after payment succeeds.
   */
  check(amountDollars: number): BudgetDecision {
    const amountCents = toCents(amountDollars);
    const now = Date.now();

    // Per-request limit
    if (this.limits.maxPerRequest !== undefined) {
      if (amountCents > toCents(this.limits.maxPerRequest)) {
        return {
          allowed: false,
          reason: 'exceeds_per_request_limit',
          message: `$${amountDollars.toFixed(2)} exceeds per-request limit of $${this.limits.maxPerRequest.toFixed(2)}`,
        };
      }
    }

    // Session limit
    if (this.limits.session !== undefined) {
      if (this.sessionSpentCents + amountCents > toCents(this.limits.session)) {
        return {
          allowed: false,
          reason: 'exceeds_session_limit',
          message: `$${amountDollars.toFixed(2)} would exceed session budget of $${this.limits.session.toFixed(2)} (spent: $${toDollars(this.sessionSpentCents)})`,
        };
      }
    }

    // Hourly limit (rolling 1h window)
    if (this.limits.hourly !== undefined) {
      const hourAgo = now - 3_600_000;
      const hourlySpent = this.spentSince(hourAgo);
      if (hourlySpent + amountCents > toCents(this.limits.hourly)) {
        return {
          allowed: false,
          reason: 'exceeds_hourly_limit',
          message: `$${amountDollars.toFixed(2)} would exceed hourly budget of $${this.limits.hourly.toFixed(2)} (spent: $${toDollars(hourlySpent)})`,
        };
      }
    }

    // Daily limit (rolling 24h window)
    if (this.limits.daily !== undefined) {
      const dayAgo = now - 86_400_000;
      const dailySpent = this.spentSince(dayAgo);
      if (dailySpent + amountCents > toCents(this.limits.daily)) {
        return {
          allowed: false,
          reason: 'exceeds_daily_limit',
          message: `$${amountDollars.toFixed(2)} would exceed daily budget of $${this.limits.daily.toFixed(2)} (spent: $${toDollars(dailySpent)})`,
        };
      }
    }

    return { allowed: true };
  }

  /** Record a successful spend. */
  record(amountDollars: number, timestamp: number = Date.now()): void {
    const amountCents = toCents(amountDollars);
    this.entries.push({ amountCents, timestamp });
    this.sessionSpentCents += amountCents;

    // Prune entries older than 24h to keep memory bounded
    const cutoff = Date.now() - 86_400_000;
    this.entries = this.entries.filter(e => e.timestamp >= cutoff);
  }

  /** Get current budget status. */
  status(): BudgetStatus {
    const now = Date.now();
    const hourlySpent = this.spentSince(now - 3_600_000);
    const dailySpent = this.spentSince(now - 86_400_000);

    return {
      sessionSpent: toDollars(this.sessionSpentCents),
      hourlySpent: toDollars(hourlySpent),
      dailySpent: toDollars(dailySpent),
      sessionRemaining: this.limits.session !== undefined
        ? toDollars(Math.max(0, toCents(this.limits.session) - this.sessionSpentCents))
        : null,
      hourlyRemaining: this.limits.hourly !== undefined
        ? toDollars(Math.max(0, toCents(this.limits.hourly) - hourlySpent))
        : null,
      dailyRemaining: this.limits.daily !== undefined
        ? toDollars(Math.max(0, toCents(this.limits.daily) - dailySpent))
        : null,
    };
  }

  private spentSince(since: number): number {
    return this.entries
      .filter(e => e.timestamp >= since)
      .reduce((sum, e) => sum + e.amountCents, 0);
  }
}
