import type { Request } from 'express';

/** Configuration for the Tollbooth middleware. */
export interface TollboothConfig {
  /** Price per request, e.g. "0.25" */
  price: string;
  /** Currency / asset symbol, e.g. "USDC" */
  currency: string;
  /** Blockchain network, e.g. "base", "ethereum", "solana" */
  network: string;
  /** Recipient wallet address */
  recipient: string;
  /** 'mock' for development, 'verify' for custom verifier, 'hosted' for managed verification. Default: 'mock' */
  mode?: 'mock' | 'verify' | 'hosted';
  /** API key for hosted verification mode. Get one at https://tollbooth.dev */
  apiKey?: string;
  /** Hosted API base URL override (for self-hosted deployments). Default: 'https://api.tollbooth.dev' */
  apiUrl?: string;
  /** Challenge TTL in milliseconds. Default: 900000 (15 min) */
  challengeTtlMs?: number;
  /** Human-readable description shown in 402 response */
  description?: string;
  /** Custom async payment verifier for production mode */
  verifyPayment?: (proof: PaymentProof) => Promise<boolean> | boolean;
  /** Called after a payment is successfully verified. */
  onPaymentVerified?: (receipt: TollboothReceipt, req: Request) => void;
  /** Called when a payment fails verification. */
  onPaymentFailed?: (error: string, req: Request) => void;
  /** Called when a new 402 challenge is issued. */
  onChallenge?: (challenge: Challenge, req: Request) => void;
}

/** x402 payment requirement advertised in the 402 response. */
export interface PaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
}

/** Parsed payment proof from the X-PAYMENT header. */
export interface PaymentProof {
  scheme: string;
  networkId: string;
  payload: string;
}

/** Internal challenge record. */
export interface Challenge {
  id: string;
  createdAt: number;
  expiresAt: number;
  price: string;
  currency: string;
  recipient: string;
  resource: string;
}

/** Receipt attached to the request after successful payment. */
export interface TollboothReceipt {
  paid: boolean;
  challengeId: string;
  amount: string;
  currency: string;
  network: string;
  recipient: string;
  timestamp: string;
}

/** Aggregated metrics for a tollbooth instance. */
export interface TollboothStats {
  /** Total 402 challenges issued */
  totalChallenges: number;
  /** Total successful payments */
  totalPayments: number;
  /** Total failed payment attempts */
  totalFailures: number;
  /** Cumulative revenue as a decimal string, e.g. "12.50" */
  revenue: string;
  /** Human-readable uptime, e.g. "2h 14m" */
  uptime: string;
  /** ISO timestamp when the middleware was created */
  startedAt: string;
}

// Express Request augmentation — consumers get req.tollbooth typed automatically
declare global {
  namespace Express {
    interface Request {
      /** Tollbooth payment receipt, present after successful payment verification. */
      tollbooth?: TollboothReceipt;
    }
  }
}

