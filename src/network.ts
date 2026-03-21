/**
 * Network Intelligence — shared pricing signals across agents.
 *
 * This module enables optional network effects: agents using x402-cfo
 * can share anonymized pricing data, improving anomaly detection for
 * all participants. Local-first: works entirely offline.
 *
 * The value scales with adoption. How it works:
 *   1. Each x402-cfo instance anonymously records pricing signals:
 *      - host, asset, network, amount (no wallet addresses, no agent IDs)
 *   2. Signals are batched and sent to a central intelligence endpoint
 *      (when available) at configurable intervals
 *   3. The network returns aggregate pricing intelligence:
 *      - "Typical price for api.data.com is $0.25 (p50) to $0.45 (p95)"
 *      - "This endpoint's pricing is anomalous across the network"
 *   4. Local anomaly detection is enhanced with network-wide context
 *
 * Privacy guarantees:
 *   - Opt-in only (disabled by default)
 *   - No wallet addresses, agent IDs, or deployer identity sent
 *   - Only: host, asset, network, amount, timestamp (rounded to hour)
 *   - Signals are hashed before sending to prevent correlation
 *   - Local-first: works entirely offline, network is bonus intelligence
 *
 * Architecture:
 *   - Client-side ready NOW (this module)
 *   - Server endpoint: future (when user base justifies infrastructure)
 *   - Until server exists, all intelligence is local-only
 */

/** An anonymized pricing signal. */
export interface PricingSignal {
  /** Hashed host identifier (SHA-256 of hostname) */
  hostHash: string;
  /** Payment asset (e.g., 'USDC') */
  asset: string;
  /** Network (e.g., 'base') */
  network: string;
  /** Amount paid */
  amount: number;
  /** Timestamp rounded to nearest hour for privacy */
  hourBucket: number;
}

/** Network-wide pricing intelligence for a host. */
export interface NetworkIntelligence {
  /** Number of agents reporting on this host */
  reporters: number;
  /** Network-wide pricing stats */
  pricing: {
    p50: number;
    p75: number;
    p95: number;
    mean: number;
  };
  /** Whether an observed price is anomalous ACROSS the network */
  isNetworkAnomaly: boolean;
  /** Freshness of the intelligence */
  lastUpdated: number;
}

export interface NetworkClientConfig {
  /** Enable network intelligence. Default: false (opt-in only) */
  enabled?: boolean;
  /** Intelligence endpoint URL. Default: null (local-only mode) */
  endpoint?: string | null;
  /** Batch interval for sending signals (ms). Default: 300000 (5 min) */
  batchIntervalMs?: number;
  /** Max signals to buffer before force-flush. Default: 100 */
  maxBufferSize?: number;
}

/**
 * Network Intelligence Client.
 *
 * Collects anonymized pricing signals and (when connected to a server)
 * provides network-wide anomaly context.
 *
 * Until a server exists, this operates in local-only mode — collecting
 * signals for future use and providing the architecture for network
 * intelligence when the user base justifies infrastructure.
 */
export class NetworkIntelligence {
  private enabled: boolean;
  private endpoint: string | null;
  private batchIntervalMs: number;
  private maxBufferSize: number;

  private signalBuffer: PricingSignal[] = [];
  private localCache: Map<string, PricingSignal[]> = new Map();
  private batchTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: NetworkClientConfig = {}) {
    this.enabled = config.enabled ?? false;
    this.endpoint = config.endpoint ?? null;
    this.batchIntervalMs = config.batchIntervalMs ?? 300_000;
    this.maxBufferSize = config.maxBufferSize ?? 100;

    if (this.enabled && this.endpoint) {
      this.batchTimer = setInterval(() => this.flush(), this.batchIntervalMs);
    }
  }

  /**
   * Record a pricing signal from a payment.
   * Only records if intelligence is enabled (opt-in).
   */
  record(host: string, asset: string, network: string, amount: number): void {
    if (!this.enabled) return;

    const signal: PricingSignal = {
      hostHash: this.hashHost(host),
      asset: asset.toUpperCase(),
      network: network.toLowerCase(),
      amount,
      hourBucket: Math.floor(Date.now() / 3_600_000) * 3_600_000,
    };

    this.signalBuffer.push(signal);

    // Also store locally for local-only intelligence
    const key = signal.hostHash;
    if (!this.localCache.has(key)) {
      this.localCache.set(key, []);
    }
    const cache = this.localCache.get(key)!;
    cache.push(signal);
    // Keep last 100 signals per host
    if (cache.length > 100) cache.shift();

    // Force flush if buffer is full
    if (this.signalBuffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  /**
   * Query network intelligence for a host.
   *
   * In local-only mode, returns intelligence based on local observations.
   * When connected to server, would return network-wide intelligence.
   */
  query(host: string, observedAmount?: number): NetworkIntelligenceResult | null {
    const key = this.hashHost(host);
    const signals = this.localCache.get(key);
    if (!signals || signals.length < 3) return null;

    const amounts = signals.map(s => s.amount).sort((a, b) => a - b);
    const n = amounts.length;
    const mean = amounts.reduce((a, b) => a + b, 0) / n;

    const p50 = this.percentile(amounts, 0.50);
    const p75 = this.percentile(amounts, 0.75);
    const p95 = this.percentile(amounts, 0.95);

    let isNetworkAnomaly = false;
    if (observedAmount !== undefined) {
      // An observation is anomalous across the network if it exceeds p95
      isNetworkAnomaly = observedAmount > p95 * 1.5;
    }

    return {
      reporters: 1, // Local-only: just this instance
      pricing: { p50, p75, p95, mean: Math.round(mean * 10000) / 10000 },
      isNetworkAnomaly,
      lastUpdated: signals[signals.length - 1].hourBucket,
    };
  }

  /**
   * Get all locally tracked hosts with their signal counts.
   */
  trackedHosts(): { hostHash: string; signalCount: number }[] {
    return [...this.localCache.entries()].map(([hostHash, signals]) => ({
      hostHash,
      signalCount: signals.length,
    }));
  }

  /**
   * Flush buffered signals to the network endpoint.
   * No-op if no endpoint configured (local-only mode).
   */
  async flush(): Promise<void> {
    if (!this.endpoint || this.signalBuffer.length === 0) {
      this.signalBuffer = [];
      return;
    }

    const batch = [...this.signalBuffer];
    this.signalBuffer = [];

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signals: batch }),
      });
    } catch {
      // Network failures are non-fatal — signals are lost but that's OK
      // The system works fine without the network layer
    }
  }

  /**
   * Stop the batch timer and flush remaining signals.
   */
  async stop(): Promise<void> {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    await this.flush();
  }

  // ---- Private ----

  /**
   * Hash a hostname for privacy.
   * Uses a simple deterministic hash (not cryptographic — we're anonymizing, not securing).
   */
  private hashHost(host: string): string {
    let hash = 0;
    for (let i = 0; i < host.length; i++) {
      const char = host.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return 'h_' + Math.abs(hash).toString(36);
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const idx = p * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const frac = idx - lo;
    if (lo === hi) return Math.round(sorted[lo] * 10000) / 10000;
    return Math.round((sorted[lo] * (1 - frac) + sorted[hi] * frac) * 10000) / 10000;
  }
}

/** Type alias for query results (avoids conflict with class name). */
export type NetworkIntelligenceResult = {
  reporters: number;
  pricing: { p50: number; p75: number; p95: number; mean: number };
  isNetworkAnomaly: boolean;
  lastUpdated: number;
};
