import { randomUUID } from 'node:crypto';
import type { Challenge } from './types.js';

export class ChallengeStore {
  private readonly challenges = new Map<string, Challenge>();
  private readonly ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs: number = 15 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.startCleanup();
  }

  create(price: string, currency: string, recipient: string, resource: string): Challenge {
    const now = Date.now();
    const challenge: Challenge = {
      id: randomUUID(),
      createdAt: now,
      expiresAt: now + this.ttlMs,
      price,
      currency,
      recipient,
      resource,
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  consume(id: string): Challenge | null {
    const challenge = this.challenges.get(id);
    if (!challenge) return null;
    if (challenge.expiresAt < Date.now()) {
      this.challenges.delete(id);
      return null;
    }
    this.challenges.delete(id);
    return challenge;
  }

  get size(): number {
    return this.challenges.size;
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, ch] of this.challenges) {
        if (ch.expiresAt < now) this.challenges.delete(id);
      }
    }, 60_000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.challenges.clear();
  }
}
