/**
 * AgentCFO — the financial brain for AI agents making x402 payments.
 *
 * Wraps `fetch` and intercepts x402 (402 Payment Required) responses.
 * Before paying, checks policy → budget → decides. After paying,
 * logs to ledger → updates budget. Provides analytics on demand.
 *
 * Usage:
 *   const agent = new AgentCFO({
 *     wallet: { pay: async (req) => paymentHeader },
 *     budget: { hourly: 5, daily: 50 },
 *     policy: { maxPerRequest: 2.00 },
 *   });
 *   const res = await agent.fetch('https://api.chaindata.xyz/v1/prices');
 */

import { Budget, type BudgetLimits, type BudgetStatus } from './budget.js';
import { Ledger, type LedgerEntry } from './ledger.js';
import { Policy, type PolicyRules } from './policy.js';
import { Analytics, type SpendSummary } from './analytics.js';
import { DashboardSync, type SyncConfig } from './sync.js';
import { AgentEvents, type AgentEventMap } from './events.js';
import { AnomalyDetector, type AnomalyDetectorConfig, type CostEstimate, type AnomalyResult } from './anomaly.js';
import type { StorageAdapter } from './storage.js';

/** x402 payment requirement from a 402 response. */
export interface X402PaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  payTo: string;
  asset: string;
}

/** x402 challenge from a 402 response body. */
export interface X402Challenge {
  x402Version: number;
  accepts: X402PaymentRequirement[];
  challengeId?: string;
  error?: string;
}

/** Wallet interface — implement this to connect to any payment provider. */
export interface AgentWallet {
  /**
   * Sign and submit payment for an x402 challenge.
   * Returns the value for the X-PAYMENT header.
   */
  pay(params: {
    requirement: X402PaymentRequirement;
    challengeId?: string;
  }): Promise<string>;
}

export interface AgentCFOConfig {
  /** Wallet that can sign x402 payments. */
  wallet: AgentWallet;
  /** Budget limits. */
  budget?: BudgetLimits;
  /** Cost policy rules. */
  policy?: PolicyRules;
  /** Sync to hosted dashboard (paid feature). */
  sync?: SyncConfig;
  /** Persistent storage adapter for ledger data. */
  storage?: StorageAdapter;
  /** Budget warning threshold (0-1). Default: 0.8 (80%). */
  warningThreshold?: number;
  /** Anomaly detection tuning. */
  anomaly?: AnomalyDetectorConfig;
  /** Custom fetch implementation (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

export class AgentCFO {
  private wallet: AgentWallet;
  private budget: Budget;
  private policy: Policy;
  private ledger: Ledger;
  private analytics: Analytics;
  private sync: DashboardSync | null;
  private storage: StorageAdapter | null;
  private warningThreshold: number;
  private fetchImpl: typeof fetch;
  /** Typed event emitter — subscribe to payment, budget, and velocity events. */
  public events: AgentEvents;
  /** Statistical anomaly detector (EWMA + Welford's + z-score). */
  private anomalyDetector: AnomalyDetector;

  constructor(config: AgentCFOConfig) {
    this.wallet = config.wallet;
    this.budget = new Budget(config.budget);
    this.policy = new Policy(config.policy);
    this.ledger = new Ledger();
    this.analytics = new Analytics(this.ledger);
    this.events = new AgentEvents();
    this.anomalyDetector = new AnomalyDetector(config.anomaly);
    this.sync = config.sync
      ? new DashboardSync(config.sync, () => this.budget.status(), () => this.analytics.summary())
      : null;
    this.storage = config.storage ?? null;
    this.warningThreshold = config.warningThreshold ?? 0.8;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;

    // Load persisted ledger entries
    if (this.storage) {
      const loaded = this.storage.load();
      if (Array.isArray(loaded)) {
        for (const entry of loaded) {
          this.ledger.record(entry);
          if (entry.status === 'paid') {
            this.budget.record(parseFloat(entry.amount));
            const host = this.extractHost(entry.url);
            this.anomalyDetector.observe(host, parseFloat(entry.amount), new Date(entry.timestamp).getTime());
          }
        }
      }
    }
  }

  /**
   * Drop-in fetch replacement. Automatically handles x402 payment flows:
   * 1. Makes the initial request
   * 2. If 402 → parses challenge → checks policy → checks budget → pays → retries
   * 3. If not 402 → returns response as-is
   */
  async fetch(url: string | URL, init?: RequestInit): Promise<Response> {
    const urlStr = url.toString();

    // Initial request
    const res = await this.fetchImpl(url, init);

    // Not a 402 — nothing to do
    if (res.status !== 402) return res;

    // Parse the x402 challenge
    let challenge: X402Challenge;
    try {
      challenge = await res.json() as X402Challenge;
    } catch {
      this.logDenied(urlStr, '0.00', 'unknown', 'unknown', 'Failed to parse 402 response body');
      return res;
    }

    if (!challenge.accepts || challenge.accepts.length === 0) {
      this.logDenied(urlStr, '0.00', 'unknown', 'unknown', 'No payment requirements in 402 response');
      return res;
    }

    // Use the first acceptable payment requirement
    const req = challenge.accepts[0];
    const amount = parseFloat(req.maxAmountRequired);
    const currency = req.asset;
    const network = req.network;

    // Check policy first
    const policyDecision = this.policy.check({ url: urlStr, amount, currency, network });
    if (!policyDecision.allowed) {
      this.logDenied(urlStr, amount.toFixed(2), currency, network, policyDecision.message ?? policyDecision.reason ?? 'policy_denied');
      return res;
    }

    // Check budget
    const budgetDecision = this.budget.check(amount);
    if (!budgetDecision.allowed) {
      this.logDenied(urlStr, amount.toFixed(2), currency, network, budgetDecision.message ?? budgetDecision.reason ?? 'budget_denied');
      return res;
    }

    // Pay
    let paymentHeader: string;
    try {
      paymentHeader = await this.wallet.pay({
        requirement: req,
        challengeId: challenge.challengeId,
      });
    } catch (err) {
      this.logFailed(urlStr, amount.toFixed(2), currency, network, `Wallet error: ${(err as Error).message}`);
      return res;
    }

    // Retry with payment
    const retryInit: RequestInit = {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers).entries()),
        'X-PAYMENT': paymentHeader,
      },
    };

    const paidRes = await this.fetchImpl(url, retryInit);

    if (paidRes.ok) {
      // Success — record the spend
      this.budget.record(amount);
      this.logPaid(urlStr, amount.toFixed(2), currency, network, 'Payment verified', paidRes.status, challenge.challengeId);
    } else {
      this.logFailed(urlStr, amount.toFixed(2), currency, network, `Payment retry returned ${paidRes.status}`);
    }

    return paidRes;
  }

  /** Get current budget status. */
  spent(): BudgetStatus {
    return this.budget.status();
  }

  /** Get spend analytics summary. */
  summary(): SpendSummary {
    return this.analytics.summary();
  }

  /** Get the full audit ledger. */
  audit(): readonly LedgerEntry[] {
    return this.ledger.all();
  }

  /** Export ledger as JSON. */
  exportJSON(): string {
    return this.ledger.toJSON();
  }

  /** Export ledger as CSV. */
  exportCSV(): string {
    return this.ledger.toCSV();
  }

  /**
   * Estimate the cost of calling a URL based on historical data.
   * Returns percentile-based statistics (p50, p75, p95, p99) using
   * Welford's online algorithm and circular buffer sampling.
   * Returns null if insufficient history exists.
   */
  estimateCost(url: string): CostEstimate | null {
    const host = this.extractHost(url);
    return this.anomalyDetector.estimate(host);
  }

  /**
   * Get the full anomaly detector for advanced usage.
   * Exposes global estimates, per-host stats, and configuration.
   */
  get detector(): AnomalyDetector {
    return this.anomalyDetector;
  }

  /** Stop dashboard sync and event handlers (call on agent shutdown). */
  stop(): void {
    this.sync?.stop();
    this.events.clear();
  }

  // ---- Internal helpers ----

  private extractHost(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
  }

  private checkBudgetWarnings(): void {
    const status = this.budget.status();
    const checks: { window: string; spent: string; limit: string | undefined }[] = [
      { window: 'hourly', spent: status.hourlySpent, limit: status.hourlyRemaining ? String(parseFloat(status.hourlySpent) + parseFloat(status.hourlyRemaining)) : undefined },
      { window: 'daily', spent: status.dailySpent, limit: status.dailyRemaining ? String(parseFloat(status.dailySpent) + parseFloat(status.dailyRemaining)) : undefined },
      { window: 'session', spent: status.sessionSpent, limit: status.sessionRemaining ? String(parseFloat(status.sessionSpent) + parseFloat(status.sessionRemaining)) : undefined },
    ];

    for (const { window, spent, limit } of checks) {
      if (!limit || limit === '0') continue;
      const pct = parseFloat(spent) / parseFloat(limit);
      if (pct >= 1.0) {
        this.events.emit('budget:exhausted', { status, window });
      } else if (pct >= this.warningThreshold) {
        this.events.emit('budget:warning', { status, window, percentUsed: pct });
      }
    }
  }

  /**
   * Check for velocity anomalies using EWMA + z-score detection.
   * Replaces the naive 2x-multiplier approach with proper statistical
   * anomaly detection (Welford's online variance + z-score thresholds).
   */
  private checkVelocity(url: string, amount: number): void {
    const host = this.extractHost(url);
    const result = this.anomalyDetector.observe(host, amount);

    if (result.isAnomaly) {
      this.events.emit('velocity:spike', {
        currentRate: amount,
        averageRate: result.baseline,
        multiplier: result.multiplier,
      });
    }
  }

  // ---- Internal logging ----

  private logPaid(url: string, amount: string, currency: string, network: string, reason: string, httpStatus?: number, challengeId?: string): void {
    const entry: LedgerEntry = {
      timestamp: new Date().toISOString(),
      url, amount, currency, network,
      status: 'paid', reason, httpStatus, challengeId,
    };
    this.ledger.record(entry);
    this.sync?.push(entry);
    this.storage?.append(entry);
    this.events.emit('payment:success', { entry });
    this.checkBudgetWarnings();
    this.checkVelocity(url, parseFloat(amount));
  }

  private logDenied(url: string, amount: string, currency: string, network: string, reason: string): void {
    const entry: LedgerEntry = {
      timestamp: new Date().toISOString(),
      url, amount, currency, network,
      status: 'denied', reason, httpStatus: 402,
    };
    this.ledger.record(entry);
    this.sync?.push(entry);
    this.storage?.append(entry);
    this.events.emit('payment:denied', { entry });
  }

  private logFailed(url: string, amount: string, currency: string, network: string, reason: string): void {
    const entry: LedgerEntry = {
      timestamp: new Date().toISOString(),
      url, amount, currency, network,
      status: 'failed', reason, httpStatus: 402,
    };
    this.ledger.record(entry);
    this.sync?.push(entry);
    this.storage?.append(entry);
    this.events.emit('payment:failed', { entry });
  }
}

