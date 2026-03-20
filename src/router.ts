/**
 * Cost-Optimal Payment Router for x402 challenges.
 *
 * When an x402 challenge includes multiple `accepts[]` options (different
 * assets, networks, or facilitators), the router picks the cheapest one.
 *
 * This is utility-maximising routing: given N payment options, select the
 * one that minimises total cost to the agent. Total cost = asset amount +
 * estimated network fee - any discount for faster settlement.
 *
 * The router uses a pluggable PriceFeed interface so users can bring
 * their own pricing data (CoinGecko, Chainlink, custom oracle, or just
 * hardcoded stablecoin parity).
 *
 * Design:
 *   - Stablecoins (USDC, EURC, DAI) are assumed to be ~$1 unless a
 *     PriceFeed says otherwise.
 *   - Network fee estimates are configurable per-network. Defaults
 *     based on typical L2 vs L1 costs.
 *   - Settlement speed is a tiebreaker, not a primary factor.
 */

/** An x402 payment option from the challenge's accepts[] array. */
export interface PaymentOption {
  /** Payment scheme (e.g., 'exact') */
  scheme: string;
  /** Blockchain network (e.g., 'base', 'ethereum', 'arbitrum') */
  network: string;
  /** Maximum amount required (as decimal string) */
  maxAmountRequired: string;
  /** Asset to pay with (e.g., 'USDC', 'EURC') */
  asset: string;
  /** Recipient address */
  payTo: string;
  /** Resource URL */
  resource: string;
  /** Description */
  description?: string;
  /** Any extra fields from the challenge */
  [key: string]: unknown;
}

/** Provides asset prices and network fee estimates. */
export interface PriceFeed {
  /** Get USD price of an asset. Return 1.0 for stablecoins. */
  getAssetPriceUsd(asset: string): number | Promise<number>;
  /** Get estimated network fee in USD for a transaction on this network. */
  getNetworkFeeUsd(network: string): number | Promise<number>;
}

/** Scored payment option with cost breakdown. */
export interface ScoredOption {
  /** The original payment option */
  option: PaymentOption;
  /** Asset amount in USD */
  amountUsd: number;
  /** Estimated network fee in USD */
  networkFeeUsd: number;
  /** Total estimated cost in USD */
  totalCostUsd: number;
  /** Settlement speed tier (1=fast L2, 2=medium, 3=slow L1) */
  speedTier: number;
  /** Composite score (lower = better) */
  score: number;
}

/** Default network fee estimates (USD) based on typical 2025-2026 costs. */
const DEFAULT_NETWORK_FEES: Record<string, number> = {
  'base': 0.001,           // Base L2 — near-zero fees
  'base-sepolia': 0.0001,  // Testnet
  'optimism': 0.002,       // Optimism L2
  'arbitrum': 0.003,       // Arbitrum L2
  'polygon': 0.005,        // Polygon
  'ethereum': 0.50,        // Ethereum L1 — expensive
  'solana': 0.002,         // Solana
};

/** Speed tier by network (1=fastest/cheapest, 3=slowest/expensive). */
const SPEED_TIERS: Record<string, number> = {
  'base': 1,
  'base-sepolia': 1,
  'optimism': 1,
  'arbitrum': 1,
  'solana': 1,
  'polygon': 2,
  'ethereum': 3,
};

/** Stablecoins assumed to be $1 unless PriceFeed says otherwise. */
const KNOWN_STABLECOINS = new Set(['USDC', 'EURC', 'DAI', 'USDT', 'PYUSD']);

/** Default price feed — uses hardcoded stablecoin parity and typical L2 fees. */
class DefaultPriceFeed implements PriceFeed {
  getAssetPriceUsd(asset: string): number {
    return KNOWN_STABLECOINS.has(asset.toUpperCase()) ? 1.0 : 1.0;
  }
  getNetworkFeeUsd(network: string): number {
    return DEFAULT_NETWORK_FEES[network.toLowerCase()] ?? 0.01;
  }
}

export interface PaymentRouterConfig {
  /** Custom price feed. Default: stablecoin parity + typical L2 fees. */
  priceFeed?: PriceFeed;
  /** Weight for network fees in scoring (0-1). Default: 0.3 */
  feeWeight?: number;
  /** Weight for settlement speed in scoring (0-1). Default: 0.1 */
  speedWeight?: number;
}

/**
 * Routes x402 payments to the cheapest option.
 *
 * Usage:
 *   const router = new PaymentRouter();
 *   const best = await router.select(challenge.accepts);
 *   // best.option is the PaymentOption to use
 *   // best.totalCostUsd is the estimated total cost
 */
export class PaymentRouter {
  private priceFeed: PriceFeed;
  private feeWeight: number;
  private speedWeight: number;

  constructor(config: PaymentRouterConfig = {}) {
    this.priceFeed = config.priceFeed ?? new DefaultPriceFeed();
    this.feeWeight = config.feeWeight ?? 0.3;
    this.speedWeight = config.speedWeight ?? 0.1;
  }

  /**
   * Score and rank all payment options, return the best one.
   * Returns null if no options provided.
   */
  async select(options: PaymentOption[]): Promise<ScoredOption | null> {
    if (options.length === 0) return null;
    if (options.length === 1) {
      return this.score(options[0]);
    }

    const scored = await Promise.all(options.map(o => this.score(o)));
    scored.sort((a, b) => a.score - b.score);
    return scored[0];
  }

  /**
   * Score all options and return ranked list (cheapest first).
   */
  async rank(options: PaymentOption[]): Promise<ScoredOption[]> {
    const scored = await Promise.all(options.map(o => this.score(o)));
    return scored.sort((a, b) => a.score - b.score);
  }

  /**
   * Score a single payment option.
   */
  private async score(option: PaymentOption): Promise<ScoredOption> {
    const assetPrice = await this.priceFeed.getAssetPriceUsd(option.asset);
    const networkFee = await this.priceFeed.getNetworkFeeUsd(option.network);
    const amount = parseFloat(option.maxAmountRequired);
    const amountUsd = amount * assetPrice;
    const speedTier = SPEED_TIERS[option.network.toLowerCase()] ?? 2;

    const totalCostUsd = Math.round((amountUsd + networkFee) * 10000) / 10000;

    // Composite score: weighted sum of cost, fees, and speed
    // Lower is better
    const costWeight = 1 - this.feeWeight - this.speedWeight;
    const score = Math.round((
      costWeight * amountUsd +
      this.feeWeight * networkFee +
      this.speedWeight * speedTier * 0.1  // Normalize speed to small range
    ) * 10000) / 10000;

    return {
      option,
      amountUsd: Math.round(amountUsd * 10000) / 10000,
      networkFeeUsd: networkFee,
      totalCostUsd,
      speedTier,
      score,
    };
  }
}
