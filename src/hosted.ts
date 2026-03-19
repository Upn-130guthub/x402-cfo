import type { PaymentProof, TollboothConfig } from './types.js';
import type { VerificationResult } from './verifier.js';

const DEFAULT_API_URL = 'https://api.tollbooth.dev';
const TIMEOUT_MS = 10_000;

interface HostedVerifyResponse {
  valid: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Verify a payment via the Tollbooth hosted verification API.
 *
 * The hosted service handles on-chain transaction verification across
 * Base, Ethereum, Solana, and other supported networks. This is the
 * managed alternative to bringing your own `verifyPayment` function.
 *
 * POST /v1/verify
 * Authorization: Bearer <apiKey>
 * Body: { proof, network, recipient, amount, currency }
 * Response: { valid, txHash?, error? }
 */
export async function verifyHosted(
  proof: PaymentProof,
  config: TollboothConfig,
): Promise<VerificationResult> {
  const apiKey = config.apiKey;
  if (!apiKey) {
    return {
      valid: false,
      error: 'Hosted mode requires an apiKey. Get one at https://tollbooth.dev',
    };
  }

  const baseUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${baseUrl}/v1/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'tollbooth-sdk/0.1.0',
      },
      body: JSON.stringify({
        proof: {
          scheme: proof.scheme,
          networkId: proof.networkId,
          payload: proof.payload,
        },
        network: config.network,
        recipient: config.recipient,
        amount: config.price,
        currency: config.currency,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.status === 401) {
      return { valid: false, error: 'Invalid API key. Check your key at https://tollbooth.dev' };
    }

    if (res.status === 429) {
      return { valid: false, error: 'Rate limited. Upgrade your plan at https://tollbooth.dev' };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { valid: false, error: `Hosted verification failed (${res.status}): ${text}` };
    }

    const body: HostedVerifyResponse = await res.json();

    return {
      valid: body.valid,
      challengeId: body.txHash ?? proof.payload,
      error: body.error,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { valid: false, error: 'Hosted verification timed out. Try again.' };
    }
    return { valid: false, error: `Hosted verification error: ${(err as Error).message}` };
  }
}
