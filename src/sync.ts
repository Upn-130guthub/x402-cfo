/**
 * Sync client for x402-cfo hosted dashboard.
 *
 * Pushes ledger entries and budget status to the hosted service
 * for centralized monitoring, alerts, and compliance reporting.
 *
 * Free users never configure this — everything works locally.
 * Paid users add one line: sync: { apiKey: 'xxx' }
 */

import type { LedgerEntry } from './ledger.js';
import type { BudgetStatus } from './budget.js';
import type { SpendSummary } from './analytics.js';

export interface SyncConfig {
  /** API key from dashboard.x402cfo.com */
  apiKey: string;
  /** Agent identifier (for multi-agent setups) */
  agentId?: string;
  /** Dashboard API URL override. Default: https://api.x402cfo.com */
  apiUrl?: string;
  /** Sync interval in ms. Default: 30000 (30s) */
  intervalMs?: number;
  /** Disable sync (useful for testing). Default: false */
  disabled?: boolean;
}

interface SyncPayload {
  agentId: string;
  timestamp: string;
  entries: LedgerEntry[];
  budget: BudgetStatus;
  summary: SpendSummary;
}

export class DashboardSync {
  private config: Required<Pick<SyncConfig, 'apiKey' | 'agentId' | 'apiUrl' | 'intervalMs'>>;
  private buffer: LedgerEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private getBudget: () => BudgetStatus;
  private getSummary: () => SpendSummary;

  constructor(
    config: SyncConfig,
    getBudget: () => BudgetStatus,
    getSummary: () => SpendSummary
  ) {
    this.config = {
      apiKey: config.apiKey,
      agentId: config.agentId ?? `agent-${Date.now().toString(36)}`,
      apiUrl: config.apiUrl ?? 'https://api.x402cfo.com',
      intervalMs: config.intervalMs ?? 30_000,
    };
    this.getBudget = getBudget;
    this.getSummary = getSummary;

    if (!config.disabled) {
      this.start();
    }
  }

  /** Buffer a ledger entry for the next sync. */
  push(entry: LedgerEntry): void {
    this.buffer.push(entry);
  }

  /** Start periodic sync. */
  private start(): void {
    this.timer = setInterval(() => this.flush(), this.config.intervalMs);
    // Don't keep the process alive just for sync
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  /** Stop periodic sync. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Flush buffered entries to the dashboard. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const payload: SyncPayload = {
      agentId: this.config.agentId,
      timestamp: new Date().toISOString(),
      entries: [...this.buffer],
      budget: this.getBudget(),
      summary: this.getSummary(),
    };

    this.buffer = [];

    try {
      await fetch(`${this.config.apiUrl}/v1/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-Agent-Id': this.config.agentId,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Sync failures are silent — never break the agent's primary function.
      // Entries are lost on failure, which is acceptable for a monitoring layer.
    }
  }
}
