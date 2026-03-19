import type { PaymentProof, TollboothConfig } from './types.js';
import type { ChallengeStore } from './challenge.js';
import { verifyHosted } from './hosted.js';

export interface VerificationResult {
  valid: boolean;
  challengeId?: string;
  error?: string;
}

/**
 * Verify a payment proof.
 * Mock mode: accepts `mock <network> <challengeId>:paid`.
 * Hosted mode: calls the Tollbooth hosted verification API.
 * Verify mode: delegates to the user-supplied `verifyPayment` function.
 */
export async function verifyPayment(
  proof: PaymentProof,
  store: ChallengeStore,
  config: TollboothConfig,
): Promise<VerificationResult> {
  const mode = config.mode ?? 'mock';

  if (mode === 'mock') {
    return verifyMock(proof, store);
  }

  if (mode === 'hosted') {
    return verifyHosted(proof, config);
  }

  // mode === 'verify'
  if (config.verifyPayment) {
    try {
      const valid = await config.verifyPayment(proof);
      return { valid, challengeId: proof.payload };
    } catch (err) {
      return { valid: false, error: `Verification error: ${(err as Error).message}` };
    }
  }

  return { valid: false, error: 'No verifyPayment function configured for verify mode.' };
}

function verifyMock(proof: PaymentProof, store: ChallengeStore): VerificationResult {
  if (proof.scheme !== 'mock') {
    return { valid: false, error: `Unknown scheme '${proof.scheme}'. In mock mode, use scheme 'mock'.` };
  }

  const parts = proof.payload.split(':');
  const challengeId = parts[0];
  const status = parts[1];

  if (!challengeId || status !== 'paid') {
    return { valid: false, error: 'Invalid mock format. Use: X-PAYMENT: mock <network> <challengeId>:paid' };
  }

  const challenge = store.consume(challengeId);
  if (!challenge) {
    return { valid: false, error: 'Challenge not found or expired.' };
  }

  return { valid: true, challengeId: challenge.id };
}
