import type { TollboothConfig, TollboothReceipt } from './types.js';

export function createReceipt(challengeId: string, config: TollboothConfig): TollboothReceipt {
  return {
    paid: true,
    challengeId,
    amount: config.price,
    currency: config.currency,
    network: config.network,
    recipient: config.recipient,
    timestamp: new Date().toISOString(),
  };
}
