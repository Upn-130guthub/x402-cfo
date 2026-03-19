import type { Request, Response, NextFunction } from 'express';
import type { TollboothConfig, PaymentRequirement } from './types.js';
import { ChallengeStore } from './challenge.js';
import { parsePaymentHeader, formatPaymentRequirements } from './headers.js';
import { verifyPayment } from './verifier.js';
import { createReceipt } from './receipt.js';
import { MetricsCollector } from './metrics.js';

/**
 * Create Tollbooth middleware.
 *
 * ```ts
 * app.use('/api/premium', tollbooth({
 *   price: '0.25',
 *   currency: 'USDC',
 *   network: 'base',
 *   recipient: '0xYourWallet',
 * }));
 * ```
 */
export function tollbooth(config: TollboothConfig) {
  const {
    price,
    currency,
    network,
    recipient,
    mode = 'mock',
    challengeTtlMs = 15 * 60 * 1000,
    description = 'Payment required to access this resource.',
  } = config;

  const store = new ChallengeStore(challengeTtlMs);
  const scheme = mode === 'mock' ? 'mock' : 'exact';
  const metrics = new MetricsCollector(price);

  async function tollboothMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // --- Check for existing payment ---
    const paymentHeader = req.header('x-payment');
    const proof = parsePaymentHeader(paymentHeader);

    if (proof) {
      const result = await verifyPayment(proof, store, config);

      if (result.valid) {
        const receipt = createReceipt(result.challengeId ?? 'unknown', config);
        req.tollbooth = receipt;
        res.setHeader('X-Payment-Receipt', JSON.stringify(receipt));
        metrics.recordPayment();
        config.onPaymentVerified?.(receipt, req);
        next();
        return;
      }

      metrics.recordFailure();
      const errorMsg = result.error ?? 'Payment verification failed.';
      config.onPaymentFailed?.(errorMsg, req);
      res.status(402).json({
        error: 'payment_invalid',
        message: errorMsg,
      });
      return;
    }

    // --- No payment: issue 402 challenge ---
    const challenge = store.create(price, currency, recipient, req.originalUrl);
    metrics.recordChallenge();
    config.onChallenge?.(challenge, req);

    const requirement: PaymentRequirement = {
      scheme,
      network,
      maxAmountRequired: price,
      resource: req.originalUrl,
      description,
      mimeType: 'application/json',
      payTo: recipient,
      maxTimeoutSeconds: Math.floor(challengeTtlMs / 1000),
      asset: currency,
    };

    const mockHint = mode === 'mock'
      ? { hint: `Retry with header → X-PAYMENT: mock ${network} ${challenge.id}:paid`, expiresAt: new Date(challenge.expiresAt).toISOString() }
      : undefined;

    res.status(402).json(formatPaymentRequirements(requirement, challenge.id, mockHint));
  }

  // Attach metrics so tollboothStats() can access them
  (tollboothMiddleware as any).__metrics = metrics;

  return tollboothMiddleware;
}
