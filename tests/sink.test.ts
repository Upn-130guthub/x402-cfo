import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventSink } from '../src/sink.js';

describe('EventSink', () => {
  it('records events and retrieves them', () => {
    const sink = new EventSink({ flushIntervalMs: 0 });
    sink.record('payment:success', { amount: 0.25 });
    sink.record('payment:denied', { amount: 1.00, reason: 'budget' });

    assert.equal(sink.size, 2);
    assert.equal(sink.all()[0].type, 'payment:success');
    assert.equal(sink.all()[1].type, 'payment:denied');
  });

  it('assigns unique IDs and timestamps', () => {
    const sink = new EventSink({ flushIntervalMs: 0 });
    sink.record('payment:success', { amount: 0.25 });
    sink.record('payment:success', { amount: 0.50 });

    const events = sink.all();
    assert.notEqual(events[0].id, events[1].id);
    assert.ok(events[0].timestamp);
    assert.ok(events[1].timestamp);
  });

  it('tags events with agentId', () => {
    const sink = new EventSink({ agentId: 'researcher-01', flushIntervalMs: 0 });
    sink.record('payment:success', { amount: 0.25 });

    assert.equal(sink.all()[0].agentId, 'researcher-01');
  });

  it('enforces circular buffer max size', () => {
    const sink = new EventSink({ maxEvents: 3, flushIntervalMs: 0 });
    sink.record('payment:success', { n: 1 });
    sink.record('payment:success', { n: 2 });
    sink.record('payment:success', { n: 3 });
    sink.record('payment:success', { n: 4 });

    assert.equal(sink.size, 3);
    // Oldest event (n:1) should have been evicted
    assert.equal((sink.all()[0].data as any).n, 2);
  });

  it('filters events by type', () => {
    const sink = new EventSink({ flushIntervalMs: 0 });
    sink.record('payment:success', { amount: 0.25 });
    sink.record('payment:denied', { amount: 1.00 });
    sink.record('anomaly:blocked', { amount: 2.80 });
    sink.record('payment:success', { amount: 0.30 });

    const blocked = sink.byType('anomaly:blocked');
    assert.equal(blocked.length, 1);
    assert.equal((blocked[0].data as any).amount, 2.80);
  });

  it('flushes events to onFlush callback', async () => {
    const flushed: any[] = [];
    const sink = new EventSink({
      flushIntervalMs: 0,
      onFlush: (events) => { flushed.push(...events); },
    });

    sink.record('payment:success', { amount: 0.25 });
    sink.record('payment:denied', { amount: 1.00 });

    const batch = await sink.flush();
    assert.equal(batch.length, 2);
    assert.equal(flushed.length, 2);
    // Buffer should be empty after flush
    assert.equal(sink.size, 0);
  });

  it('returns empty array when flushing with no callback', async () => {
    const sink = new EventSink({ flushIntervalMs: 0 });
    sink.record('payment:success', { amount: 0.25 });

    const batch = await sink.flush();
    assert.equal(batch.length, 0); // No callback = nothing flushed
  });

  it('survives flush callback errors without crashing', async () => {
    const sink = new EventSink({
      flushIntervalMs: 0,
      onFlush: () => { throw new Error('network error'); },
    });

    sink.record('payment:success', { amount: 0.25 });

    // Should not throw
    const batch = await sink.flush();
    assert.equal(batch.length, 1);
    // Events are lost on failed flush (by design — SDK keeps working)
    assert.equal(sink.size, 0);
  });

  it('stops auto-flush timer', () => {
    const sink = new EventSink({ flushIntervalMs: 100, onFlush: () => {} });
    // Should not throw
    sink.stop();
  });
});
