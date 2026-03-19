/**
 * Cost policy engine for x402-cfo agent.
 *
 * Declarative rules that determine whether a payment should be made.
 * Policies are checked BEFORE budget enforcement — a policy denial
 * means the agent won't even attempt the payment.
 */

export interface PolicyRules {
  /** Max amount in dollars for any single request. */
  maxPerRequest?: number;
  /** URLs that are allowed (if set, only these are permitted). */
  allowlist?: string[];
  /** URLs that are explicitly blocked. */
  blocklist?: string[];
  /** Allowed currencies (e.g. ['USDC']). */
  allowedCurrencies?: string[];
  /** Allowed networks (e.g. ['base', 'ethereum']). */
  allowedNetworks?: string[];
}

export type PolicyDenialReason =
  | 'exceeds_max_per_request'
  | 'url_not_in_allowlist'
  | 'url_in_blocklist'
  | 'currency_not_allowed'
  | 'network_not_allowed';

export interface PolicyDecision {
  allowed: boolean;
  reason?: PolicyDenialReason;
  message?: string;
}

export class Policy {
  private rules: PolicyRules;

  constructor(rules: PolicyRules = {}) {
    this.rules = rules;
  }

  /**
   * Check if a proposed payment passes policy rules.
   */
  check(params: {
    url: string;
    amount: number;
    currency: string;
    network: string;
  }): PolicyDecision {
    const { url, amount, currency, network } = params;

    // Max per request
    if (this.rules.maxPerRequest !== undefined && amount > this.rules.maxPerRequest) {
      return {
        allowed: false,
        reason: 'exceeds_max_per_request',
        message: `$${amount.toFixed(2)} exceeds policy max of $${this.rules.maxPerRequest.toFixed(2)} per request`,
      };
    }

    // Allowlist
    if (this.rules.allowlist && this.rules.allowlist.length > 0) {
      if (!this.rules.allowlist.some(pattern => this.matchUrl(url, pattern))) {
        return {
          allowed: false,
          reason: 'url_not_in_allowlist',
          message: `${url} is not in the agent's allowlist`,
        };
      }
    }

    // Blocklist
    if (this.rules.blocklist && this.rules.blocklist.length > 0) {
      if (this.rules.blocklist.some(pattern => this.matchUrl(url, pattern))) {
        return {
          allowed: false,
          reason: 'url_in_blocklist',
          message: `${url} is blocked by policy`,
        };
      }
    }

    // Currency
    if (this.rules.allowedCurrencies && this.rules.allowedCurrencies.length > 0) {
      if (!this.rules.allowedCurrencies.includes(currency)) {
        return {
          allowed: false,
          reason: 'currency_not_allowed',
          message: `${currency} is not an allowed currency (allowed: ${this.rules.allowedCurrencies.join(', ')})`,
        };
      }
    }

    // Network
    if (this.rules.allowedNetworks && this.rules.allowedNetworks.length > 0) {
      if (!this.rules.allowedNetworks.includes(network)) {
        return {
          allowed: false,
          reason: 'network_not_allowed',
          message: `${network} is not an allowed network (allowed: ${this.rules.allowedNetworks.join(', ')})`,
        };
      }
    }

    return { allowed: true };
  }

  /** Simple URL matching: exact match or domain prefix match. */
  private matchUrl(url: string, pattern: string): boolean {
    if (url === pattern) return true;
    // Domain-level matching: "api.example.com" matches "https://api.example.com/anything"
    try {
      const parsed = new URL(url);
      if (parsed.hostname === pattern) return true;
      if (parsed.origin + parsed.pathname === pattern) return true;
    } catch {
      // Not a valid URL, just do string comparison
    }
    return url.startsWith(pattern);
  }
}
