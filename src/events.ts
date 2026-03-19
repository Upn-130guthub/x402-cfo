/**
 * Event system for x402-cfo agent.
 *
 * Typed event emitter that fires on every financial decision.
 * This is what makes the SDK worth integrating — developers
 * can react to events, wire up Slack alerts, trigger circuit
 * breakers, or log to external systems.
 */

import type { LedgerEntry } from './ledger.js';
import type { BudgetStatus } from './budget.js';

export type AgentEventMap = {
  /** Fired when a payment is made successfully. */
  'payment:success': { entry: LedgerEntry };
  /** Fired when a payment is denied by policy or budget. */
  'payment:denied': { entry: LedgerEntry };
  /** Fired when a wallet payment fails. */
  'payment:failed': { entry: LedgerEntry };
  /** Fired when budget usage crosses a warning threshold (default 80%). */
  'budget:warning': { status: BudgetStatus; window: string; percentUsed: number };
  /** Fired when a budget limit is fully exhausted. */
  'budget:exhausted': { status: BudgetStatus; window: string };
  /** Fired when spending velocity exceeds the historical average. */
  'velocity:spike': { currentRate: number; averageRate: number; multiplier: number };
};

type EventHandler<T> = (data: T) => void;

export class AgentEvents {
  private handlers: Map<string, Set<EventHandler<any>>> = new Map();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof AgentEventMap>(event: K, handler: EventHandler<AgentEventMap[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  /** Subscribe to an event, but only fire once. */
  once<K extends keyof AgentEventMap>(event: K, handler: EventHandler<AgentEventMap[K]>): () => void {
    const wrapper: EventHandler<AgentEventMap[K]> = (data) => {
      unsub();
      handler(data);
    };
    const unsub = this.on(event, wrapper);
    return unsub;
  }

  /** Emit an event to all subscribers. */
  emit<K extends keyof AgentEventMap>(event: K, data: AgentEventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(data); } catch { /* event handlers must never crash the agent */ }
    }
  }

  /** Remove all handlers. */
  clear(): void {
    this.handlers.clear();
  }
}
