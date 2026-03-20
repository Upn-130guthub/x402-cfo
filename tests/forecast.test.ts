import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SpendForecaster } from '../src/forecast.js';

describe('SpendForecaster', () => {
  it('returns null with insufficient observations', () => {
    const f = new SpendForecaster({ budget: 100 });
    f.observe(1.0, 1000);
    f.observe(1.0, 2000);
    assert.equal(f.forecast(), null, 'need at least 3 observations');
  });

  it('computes accurate spend rate', () => {
    const f = new SpendForecaster({ budget: 100 });
    const start = 1000;
    // $1 per second for 10 seconds
    for (let i = 0; i < 10; i++) {
      f.observe(1.0, start + i * 1000);
    }
    const result = f.forecast(start + 10000);
    assert.ok(result);
    assert.ok(result.ratePerSecond > 0.5 && result.ratePerSecond < 2, `rate/s should be ~1.0, got ${result.ratePerSecond}`);
    assert.ok(result.ratePerMinute > 30 && result.ratePerMinute < 120, `rate/min should be ~60, got ${result.ratePerMinute}`);
  });

  it('predicts budget exhaustion', () => {
    const f = new SpendForecaster({ budget: 100 });
    const start = 0;
    // $10 per second
    for (let i = 0; i < 5; i++) {
      f.observe(10.0, start + i * 1000);
    }
    const result = f.forecast(start + 5000);
    assert.ok(result);
    assert.equal(result.totalSpent, 50);
    assert.equal(result.remaining, 50);
    assert.ok(result.exhaustionEtaMs > 0 && result.exhaustionEtaMs < 30_000, `ETA should be ~5s, got ${result.exhaustionEtaMs}ms`);
    assert.ok(result.exhaustionAt instanceof Date);
  });

  it('reports Infinity ETA when no budget set', () => {
    const f = new SpendForecaster(); // no budget
    for (let i = 0; i < 5; i++) {
      f.observe(1.0, i * 1000);
    }
    const result = f.forecast();
    assert.ok(result);
    assert.equal(result.exhaustionEtaMs, Infinity);
    assert.equal(result.remaining, null);
  });

  it('detects accelerating spend', () => {
    const f = new SpendForecaster({ budget: 1000 });
    const start = 0;
    // Increasing spend amounts
    f.observe(1.0, start);
    f.observe(1.0, start + 1000);
    f.observe(2.0, start + 2000);
    f.observe(3.0, start + 3000);
    f.observe(5.0, start + 4000);
    f.observe(8.0, start + 5000);
    const result = f.forecast(start + 6000);
    assert.ok(result);
    assert.equal(result.trend, 'accelerating');
  });

  it('detects steady spend', () => {
    const f = new SpendForecaster({ budget: 1000 });
    const start = 0;
    for (let i = 0; i < 10; i++) {
      f.observe(1.0, start + i * 1000);
    }
    const result = f.forecast(start + 10000);
    assert.ok(result);
    assert.equal(result.trend, 'steady');
  });

  it('has high confidence for linear spend', () => {
    const f = new SpendForecaster({ budget: 1000 });
    const start = 0;
    for (let i = 0; i < 20; i++) {
      f.observe(1.0, start + i * 1000);
    }
    const result = f.forecast(start + 20000);
    assert.ok(result);
    assert.ok(result.confidence > 0.9, `R² should be high for linear spend, got ${result.confidence}`);
  });

  it('allows dynamic budget update', () => {
    const f = new SpendForecaster({ budget: 50 });
    for (let i = 0; i < 5; i++) {
      f.observe(5.0, i * 1000);
    }
    let result = f.forecast(5000);
    assert.ok(result);
    assert.equal(result.remaining, 25);

    f.setBudget(200);
    result = f.forecast(5000);
    assert.ok(result);
    assert.equal(result.remaining, 175);
  });
});
