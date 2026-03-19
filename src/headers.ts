import type { PaymentProof, PaymentRequirement } from './types.js';

/**
 * Parse the X-PAYMENT header.
 * Format: `<scheme> <networkId> <payload>`
 */
export function parsePaymentHeader(header: string | undefined): PaymentProof | null {
  if (!header) return null;

  const parts = header.trim().split(' ');
  if (parts.length < 3) return null;

  return {
    scheme: parts[0],
    networkId: parts[1],
    payload: parts.slice(2).join(' '),
  };
}

/**
 * Format payment requirements into the x402 response body.
 */
export function formatPaymentRequirements(
  req: PaymentRequirement,
  challengeId: string,
  mock?: { hint: string; expiresAt: string },
): object {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: req.scheme,
        network: req.network,
        maxAmountRequired: req.maxAmountRequired,
        resource: req.resource,
        description: req.description,
        mimeType: req.mimeType,
        payTo: req.payTo,
        maxTimeoutSeconds: req.maxTimeoutSeconds,
        asset: req.asset,
      },
    ],
    challengeId,
    ...(mock && { _mock: mock }),
  };
}
