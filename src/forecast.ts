/**
 * Predictive Spend Forecaster for x402-cfo.
 *
 * Uses online linear regression on spend timestamps to forecast:
 *   - Time until budget exhaustion (per agent or pool)
 *   - Spend rate ($/minute, $/hour)
 *   - Confidence interval based on spend variance
 *
 * Based on ad pacing research: optimal spend is proportional to request
 * rate, not linear over time. The forecaster detects whether spend is
 * accelerating, decelerating, or steady.
 *
 * Uses online regression (no stored history) for O(1) memory.
 * Sufficient statistics: n, sum_x, sum_y, sum_xy, sum_x2
 * where x = time offset (seconds), y = cumulative spend.
 */

/** A spend observation for the forecaster. */
interface SpendPoint {
  timestamp: number; // ms since epoch
  cumulativeSpend: number; // total spend so far
}

/** Forecast result. */
export interface SpendForecast {
  /** Current spend rate ($/second) */
  ratePerSecond: number;
  /** Current spend rate ($/minute) */
  ratePerMinute: number;
  /** Current spend rate ($/hour) */
  ratePerHour: number;
  /** Estimated time until budget exhaustion (ms). Infinity if rate <= 0 or no budget set. */
  exhaustionEtaMs: number;
  /** Estimated timestamp when budget will be exhausted. null if not applicable. */
  exhaustionAt: Date | null;
  /** Spend trend: 'accelerating' | 'steady' | 'decelerating' */
  trend: 'accelerating' | 'steady' | 'decelerating';
  /** R² goodness-of-fit for the linear model (0-1). Higher = more predictable spend. */
  confidence: number;
  /** Total spend so far */
  totalSpent: number;
  /** Budget remaining. null if no budget set. */
  remaining: number | null;
  /** Number of observations */
  observations: number;
}

export interface ForecasterConfig {
  /** Total budget to forecast exhaustion against. */
  budget?: number;
  /** Minimum observations before forecasting. Default: 3 */
  minObservations?: number;
}

/**
 * Online linear regression forecaster for spend pacing.
 *
 * Tracks cumulative spend over time and fits y = mx + b where:
 *   x = time offset from first observation (seconds)
 *   y = cumulative spend ($)
 *   m = spend rate ($/second)
 *
 * Detects acceleration by comparing recent rate to overall rate.
 */
export class SpendForecaster {
  private budget: number | null;
  private minObservations: number;

  // Online regression sufficient statistics
  private n: number = 0;
  private sumX: number = 0;   // sum of time offsets
  private sumY: number = 0;   // sum of cumulative spends
  private sumXY: number = 0;  // sum of x*y
  private sumX2: number = 0;  // sum of x^2
  private sumY2: number = 0;  // sum of y^2

  // Tracking
  private firstTimestamp: number = 0;
  private lastTimestamp: number = 0;
  private totalSpent: number = 0;

  // Recent rate tracking (last 5 points) for trend detection
  private recentRates: number[] = [];
  private prevSpend: number = 0;
  private prevTimestamp: number = 0;

  constructor(config: ForecasterConfig = {}) {
    this.budget = config.budget ?? null;
    this.minObservations = config.minObservations ?? 3;
  }

  /**
   * Record a spend observation.
   *
   * @param amount - Amount spent in this transaction
   * @param timestamp - When it occurred (ms). Default: now.
   */
  observe(amount: number, timestamp: number = Date.now()): void {
    this.totalSpent += amount;

    if (this.n === 0) {
      this.firstTimestamp = timestamp;
    }

    // Track instantaneous rate for trend detection
    if (this.n > 0 && timestamp > this.prevTimestamp) {
      const dt = (timestamp - this.prevTimestamp) / 1000; // seconds
      const instantRate = amount / dt;
      this.recentRates.push(instantRate);
      if (this.recentRates.length > 5) this.recentRates.shift();
    }

    this.prevSpend = this.totalSpent;
    this.prevTimestamp = timestamp;
    this.lastTimestamp = timestamp;

    // Update sufficient statistics for regression
    const x = (timestamp - this.firstTimestamp) / 1000; // seconds from start
    const y = this.totalSpent;

    this.n++;
    this.sumX += x;
    this.sumY += y;
    this.sumXY += x * y;
    this.sumX2 += x * x;
    this.sumY2 += y * y;
  }

  /**
   * Get the current spend forecast.
   * Returns null if insufficient observations.
   */
  forecast(now: number = Date.now()): SpendForecast | null {
    if (this.n < this.minObservations) return null;

    // Linear regression: y = mx + b
    // m = (n*sumXY - sumX*sumY) / (n*sumX2 - sumX^2)
    const denominator = this.n * this.sumX2 - this.sumX * this.sumX;
    let slope = 0; // $/second

    if (denominator > 0) {
      slope = (this.n * this.sumXY - this.sumX * this.sumY) / denominator;
    }

    // R² for confidence
    const yMean = this.sumY / this.n;
    const ssTot = this.sumY2 - this.n * yMean * yMean;
    const b = (this.sumY - slope * this.sumX) / this.n;
    // SSres = sum((y_i - (m*x_i + b))^2) — compute from sufficient stats
    // SSres = sumY2 - 2*m*sumXY - 2*b*sumY + m^2*sumX2 + 2*m*b*sumX + n*b^2
    const ssRes = this.sumY2 - 2 * slope * this.sumXY - 2 * b * this.sumY
                + slope * slope * this.sumX2 + 2 * slope * b * this.sumX
                + this.n * b * b;
    const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;

    // Trend detection from recent instantaneous rates
    let trend: 'accelerating' | 'steady' | 'decelerating' = 'steady';
    if (this.recentRates.length >= 3) {
      const firstHalf = this.recentRates.slice(0, Math.floor(this.recentRates.length / 2));
      const secondHalf = this.recentRates.slice(Math.floor(this.recentRates.length / 2));
      const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      if (avgSecond > avgFirst * 1.2) trend = 'accelerating';
      else if (avgSecond < avgFirst * 0.8) trend = 'decelerating';
    }

    // Budget exhaustion
    const remaining = this.budget !== null ? this.budget - this.totalSpent : null;
    let exhaustionEtaMs = Infinity;
    let exhaustionAt: Date | null = null;

    if (remaining !== null && slope > 0) {
      const secondsRemaining = remaining / slope;
      exhaustionEtaMs = Math.round(secondsRemaining * 1000);
      exhaustionAt = new Date(now + exhaustionEtaMs);
    }

    return {
      ratePerSecond: Math.round(slope * 100000) / 100000,
      ratePerMinute: Math.round(slope * 60 * 10000) / 10000,
      ratePerHour: Math.round(slope * 3600 * 100) / 100,
      exhaustionEtaMs,
      exhaustionAt,
      trend,
      confidence: Math.round(r2 * 1000) / 1000,
      totalSpent: Math.round(this.totalSpent * 100) / 100,
      remaining: remaining !== null ? Math.round(remaining * 100) / 100 : null,
      observations: this.n,
    };
  }

  /** Update the budget target. */
  setBudget(budget: number): void {
    this.budget = budget;
  }
}
