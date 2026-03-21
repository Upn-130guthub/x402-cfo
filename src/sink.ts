/**
 * Event Sink — structured event log for the control plane.
 *
 * Captures agent events into a queryable, time-ordered log.
 * This is a transport stub for future hosted integration: events
 * accumulate locally and can be flushed to an external system via onFlush.
 *
 * NOT an audit trail or compliance primitive. Delivery is best-effort,
 * at-most-once. The hosted layer owns durable persistence and retry.
 */

import type { AgentEventMap } from './events.js';

/** A single event in the sink. */
export interface SinkEvent {
  /** Unique event ID (monotonic counter + timestamp) */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** Event type from AgentEventMap */
  type: keyof AgentEventMap;
  /** Optional agent identifier (for fleet scenarios) */
  agentId?: string;
  /** Event payload */
  data: Record<string, unknown>;
}

export interface EventSinkConfig {
  /** Maximum events to retain in memory (circular buffer). Default: 10000 */
  maxEvents?: number;
  /** Callback invoked when events are flushed (for external systems). */
  onFlush?: (events: SinkEvent[]) => void | Promise<void>;
  /** Auto-flush interval in ms. Default: 30000 (30s). Set to 0 to disable. */
  flushIntervalMs?: number;
  /** Agent ID to tag all events with (for fleet identification). */
  agentId?: string;
}

/**
 * Structured event sink with circular buffer and flush support.
 *
 * Usage:
 *   const sink = new EventSink({
 *     agentId: 'researcher-01',
 *     onFlush: (events) => fetch('/api/events', { method: 'POST', body: JSON.stringify(events) }),
 *   });
 *
 *   // Wire up to AgentCFO events:
 *   agent.events.on('payment:success', (data) => sink.record('payment:success', data));
 *   agent.events.on('anomaly:blocked', (data) => sink.record('anomaly:blocked', data));
 */
export class EventSink {
  private buffer: SinkEvent[] = [];
  private maxEvents: number;
  private onFlush: ((events: SinkEvent[]) => void | Promise<void>) | null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private agentId: string | undefined;
  private counter: number = 0;

  constructor(config: EventSinkConfig = {}) {
    this.maxEvents = config.maxEvents ?? 10_000;
    this.onFlush = config.onFlush ?? null;
    this.agentId = config.agentId;

    const flushInterval = config.flushIntervalMs ?? 30_000;
    if (flushInterval > 0 && this.onFlush) {
      this.flushTimer = setInterval(() => this.flush(), flushInterval);
    }
  }

  /**
   * Record an event into the sink.
   */
  record(type: keyof AgentEventMap, data: Record<string, unknown>): void {
    this.counter++;
    const event: SinkEvent = {
      id: `${Date.now()}-${this.counter}`,
      timestamp: new Date().toISOString(),
      type,
      agentId: this.agentId,
      data,
    };

    this.buffer.push(event);

    // Circular buffer: discard oldest when full
    if (this.buffer.length > this.maxEvents) {
      this.buffer.shift();
    }
  }

  /**
   * Flush buffered events to the onFlush callback.
   * Returns the events that were flushed.
   */
  async flush(): Promise<SinkEvent[]> {
    if (this.buffer.length === 0 || !this.onFlush) return [];

    const batch = [...this.buffer];
    this.buffer = [];

    try {
      await this.onFlush(batch);
    } catch {
      // Flush failures are non-fatal — events are lost but SDK keeps working.
      // In production, the hosted layer would handle retry/DLQ.
    }

    return batch;
  }

  /** Get all buffered events (read-only). */
  all(): readonly SinkEvent[] {
    return this.buffer;
  }

  /** Get events by type. */
  byType(type: keyof AgentEventMap): SinkEvent[] {
    return this.buffer.filter(e => e.type === type);
  }

  /** Get events in a time range. */
  between(start: Date, end: Date): SinkEvent[] {
    const startMs = start.getTime();
    const endMs = end.getTime();
    return this.buffer.filter(e => {
      const t = new Date(e.timestamp).getTime();
      return t >= startMs && t <= endMs;
    });
  }

  /** Current buffer size. */
  get size(): number {
    return this.buffer.length;
  }

  /** Stop auto-flush timer. */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
