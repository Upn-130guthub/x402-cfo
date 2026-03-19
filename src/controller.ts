/**
 * AgentCFO — the agent financial controller.
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
 *   const res = await agent.fetch('https://api.example.com/data');
 */

import { Budget, type BudgetLimits } from './budget.js';
import { Ledger, type LedgerEntry } from './ledger.js';
import { Policy, type PolicyRules } from './policy.js';
import { Analytics, type SpendSummary } from './analytics.js';

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
  /** Custom fetch implementation (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

export class AgentCFO {
  private wallet: AgentWallet;
  private budget: Budget;
  private policy: Policy;
  private ledger: Ledger;
  private analytics: Analytics;
  private fetchImpl: typeof fetch;

  constructor(config: AgentCFOConfig) {
    this.wallet = config.wallet;
    this.budget = new Budget(config.budget);
    this.policy = new Policy(config.policy);
    this.ledger = new Ledger();
    this.analytics = new Analytics(this.ledger);
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
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
  spent(): ReturnType<Budget['status']> {
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

  // ---- Internal logging ----

  private logPaid(url: string, amount: string, currency: string, network: string, reason: string, httpStatus?: number, challengeId?: string): void {
    this.ledger.record({
      timestamp: new Date().toISOString(),
      url, amount, currency, network,
      status: 'paid', reason, httpStatus, challengeId,
    });
  }

  private logDenied(url: string, amount: string, currency: string, network: string, reason: string): void {
    this.ledger.record({
      timestamp: new Date().toISOString(),
      url, amount, currency, network,
      status: 'denied', reason, httpStatus: 402,
    });
  }

  private logFailed(url: string, amount: string, currency: string, network: string, reason: string): void {
    this.ledger.record({
      timestamp: new Date().toISOString(),
      url, amount, currency, network,
      status: 'failed', reason, httpStatus: 402,
    });
  }
}
