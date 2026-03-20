/**
 * Anomaly detection engine for x402-cfo.
 *
 * Uses exponentially weighted moving average (EWMA) with adaptive
 * thresholds for velocity spike detection. Implements Welford's
 * online algorithm for numerically stable variance computation —
 * no need to store full history in memory.
 *
 * Design choices:
 *   - EWMA with α=0.3 gives ~70% weight to recent history, adapts
 *     quickly to legitimate spending pattern changes while still
 *     detecting true anomalies.
 *   - Z-score threshold of 2.5σ balances sensitivity with false-positive
 *     rate (~1.2% false positives under normal distribution).
 *   - Per-host tracking isolates anomalies: a spike on one API doesn't
 *     pollute the baseline for others.
 *   - Cooldown prevents alert fatigue — one spike event per host per
 *     cooldown window.
 */

/** A single cost observation. */
interface CostSample {
  amount: number;
  timestamp: number;
}

/** Stats tracked per host using Welford's online algorithm. */
interface HostStats {
  /** Number of observations */
  n: number;
  /** EWMA of cost */
  ewma: number;
  /** Running mean (Welford) */
  mean: number;
  /** Running M2 for variance (Welford) */
  m2: number;
  /** Timestamp of last spike alert */
  lastSpikeAt: number;
  /** Recent samples for percentile estimation (circular buffer) */
  samples: CircularBuffer;
}

/** Percentile-based cost estimate. */
export interface CostEstimate {
  /** Median cost (p50) */
  median: number;
  /** 50th percentile */
  p50: number;
  /** 75th percentile */
  p75: number;
  /** 95th percentile */
  p95: number;
  /** 99th percentile */
  p99: number;
  /** Arithmetic mean */
  mean: number;
  /** Standard deviation */
  stddev: number;
  /** Min observed cost */
  min: number;
  /** Max observed cost */
  max: number;
  /** Number of observations */
  samples: number;
}

/** Result of anomaly check. */
export interface AnomalyResult {
  /** Whether this observation is anomalous */
  isAnomaly: boolean;
  /** Z-score of the observation (how many σ from the mean) */
  zScore: number;
  /** The EWMA baseline it was compared against */
  baseline: number;
  /** Standard deviation of the baseline */
  stddev: number;
  /** How many times larger than baseline (multiplier) */
  multiplier: number;
  /** Whether alert was suppressed by cooldown */
  suppressed: boolean;
}

/**
 * Fixed-size circular buffer for O(1) insertion without allocation.
 * Used to maintain the last N cost samples per host for percentile
 * estimation without unbounded memory growth.
 */
class CircularBuffer {
  private buf: number[];
  private head: number = 0;
  private count: number = 0;

  constructor(private capacity: number) {
    this.buf = new Array(capacity).fill(0);
  }

  push(value: number): void {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Returns sorted copy of all stored values. */
  sorted(): number[] {
    const arr = this.count < this.capacity
      ? this.buf.slice(0, this.count)
      : [...this.buf];
    return arr.sort((a, b) => a - b);
  }

  size(): number { return this.count; }
}

export interface AnomalyDetectorConfig {
  /** EWMA smoothing factor (0-1). Higher = more weight to recent. Default: 0.3 */
  alpha?: number;
  /** Z-score threshold for anomaly. Default: 2.5 */
  zThreshold?: number;
  /** Cooldown between spike alerts per host (ms). Default: 60000 (1 min) */
  cooldownMs?: number;
  /** Max samples to retain per host for percentiles. Default: 200 */
  bufferSize?: number;
  /** Minimum observations before anomaly detection activates. Default: 5 */
  warmupCount?: number;
}

/**
 * Statistical anomaly detector using EWMA + Welford's online variance.
 *
 * This is the core intelligence engine. Every payment flows through
 * `observe()` which updates the statistical model and returns whether
 * the observation is anomalous. Zero external dependencies.
 */
export class AnomalyDetector {
  private hosts: Map<string, HostStats> = new Map();
  private globalStats: HostStats;
  private readonly alpha: number;
  private readonly zThreshold: number;
  private readonly cooldownMs: number;
  private readonly bufferSize: number;
  private readonly warmupCount: number;

  constructor(config: AnomalyDetectorConfig = {}) {
    this.alpha = config.alpha ?? 0.3;
    this.zThreshold = config.zThreshold ?? 2.5;
    this.cooldownMs = config.cooldownMs ?? 60_000;
    this.bufferSize = config.bufferSize ?? 200;
    this.warmupCount = config.warmupCount ?? 5;
    this.globalStats = this.createStats();
  }

  /**
   * Record a cost observation and check for anomalies.
   *
   * @param host - The API hostname (e.g. "api.chaindata.xyz")
   * @param amount - The cost in dollars
   * @param timestamp - When the payment occurred (ms since epoch)
   * @returns Anomaly check result
   */
  observe(host: string, amount: number, timestamp: number = Date.now()): AnomalyResult {
    // Get or create per-host stats
    if (!this.hosts.has(host)) {
      this.hosts.set(host, this.createStats());
    }
    const stats = this.hosts.get(host)!;

    // ---- Compute anomaly BEFORE updating stats ----
    // This is critical: we detect against what we knew before seeing this data point.
    // Otherwise a single spike would pollute the baseline immediately.
    let isAnomaly = false;
    let zScore = 0;
    let baseline = stats.ewma;
    let currentStddev = this.stddev(stats);
    let multiplier = 1;

    if (stats.n >= this.warmupCount) {
      multiplier = stats.ewma > 0 ? amount / stats.ewma : 1;

      if (currentStddev > 0) {
        // Normal path: z-score based anomaly detection
        zScore = (amount - stats.ewma) / currentStddev;
        isAnomaly = zScore > this.zThreshold;
      } else {
        // Zero-variance edge case: all baseline values were identical.
        // Can't compute z-score (division by zero). Fall back to
        // multiplier-based detection: flag if > 2x baseline.
        zScore = multiplier > 2 ? Infinity : 0;
        isAnomaly = amount !== stats.ewma && multiplier > 2;
      }
    }

    // ---- Now update the model ----
    this.updateStats(this.globalStats, amount);
    this.updateStats(stats, amount);

    // Store sample for percentile estimation
    stats.samples.push(amount);
    this.globalStats.samples.push(amount);

    // Not enough data yet
    if (stats.n <= this.warmupCount) {
      return {
        isAnomaly: false,
        zScore: 0,
        baseline: stats.ewma,
        stddev: 0,
        multiplier: 1,
        suppressed: false,
      };
    }

    // Cooldown check
    const suppressed = isAnomaly && (timestamp - stats.lastSpikeAt) < this.cooldownMs;
    if (isAnomaly && !suppressed) {
      stats.lastSpikeAt = timestamp;
    }

    return {
      isAnomaly: isAnomaly && !suppressed,
      zScore: Math.round(zScore * 100) / 100,
      baseline: Math.round(baseline * 100) / 100,
      stddev: Math.round(currentStddev * 100) / 100,
      multiplier: Math.round(multiplier * 100) / 100,
      suppressed,
    };
  }

  /**
   * Get percentile-based cost estimate for a host.
   * Returns null if insufficient data.
   */
  estimate(host: string): CostEstimate | null {
    const stats = this.hosts.get(host);
    if (!stats || stats.samples.size() < 2) return null;

    const sorted = stats.samples.sorted();
    const n = sorted.length;

    return {
      median: this.percentile(sorted, 0.50),
      p50: this.percentile(sorted, 0.50),
      p75: this.percentile(sorted, 0.75),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99),
      mean: Math.round(stats.mean * 100) / 100,
      stddev: Math.round(this.stddev(stats) * 100) / 100,
      min: sorted[0],
      max: sorted[n - 1],
      samples: stats.n,
    };
  }

  /**
   * Get global cost estimate across all hosts.
   */
  estimateGlobal(): CostEstimate | null {
    if (this.globalStats.samples.size() < 2) return null;

    const sorted = this.globalStats.samples.sorted();
    const n = sorted.length;

    return {
      median: this.percentile(sorted, 0.50),
      p50: this.percentile(sorted, 0.50),
      p75: this.percentile(sorted, 0.75),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99),
      mean: Math.round(this.globalStats.mean * 100) / 100,
      stddev: Math.round(this.stddev(this.globalStats) * 100) / 100,
      min: sorted[0],
      max: sorted[n - 1],
      samples: this.globalStats.n,
    };
  }

  // ---- Internal ----

  private createStats(): HostStats {
    return {
      n: 0,
      ewma: 0,
      mean: 0,
      m2: 0,
      lastSpikeAt: 0,
      samples: new CircularBuffer(this.bufferSize),
    };
  }

  /**
   * Update stats using Welford's online algorithm + EWMA.
   *
   * Welford's gives numerically stable running variance without
   * storing all values. EWMA gives an exponentially-weighted
   * baseline that adapts to legitimate pattern changes.
   */
  private updateStats(stats: HostStats, value: number): void {
    stats.n++;

    // EWMA update
    if (stats.n === 1) {
      stats.ewma = value;
    } else {
      stats.ewma = this.alpha * value + (1 - this.alpha) * stats.ewma;
    }

    // Welford's online mean and variance
    const delta = value - stats.mean;
    stats.mean += delta / stats.n;
    const delta2 = value - stats.mean;
    stats.m2 += delta * delta2;
  }

  /** Compute standard deviation from Welford's M2. */
  private stddev(stats: HostStats): number {
    if (stats.n < 2) return 0;
    return Math.sqrt(stats.m2 / (stats.n - 1));
  }

  /** Linear interpolation percentile on sorted array. */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];

    const idx = p * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const frac = idx - lo;

    if (lo === hi) return Math.round(sorted[lo] * 100) / 100;
    return Math.round((sorted[lo] * (1 - frac) + sorted[hi] * frac) * 100) / 100;
  }
}
