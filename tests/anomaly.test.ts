import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AnomalyDetector } from '../src/anomaly.js';

describe('AnomalyDetector', () => {

  describe('warmup phase', () => {
    it('should not flag anomalies during warmup (< 5 observations)', () => {
      const detector = new AnomalyDetector();
      // First 4 observations — all within warmup
      for (let i = 0; i < 4; i++) {
        const result = detector.observe('api.test.com', 0.25);
        assert.equal(result.isAnomaly, false, `observation ${i} should not be anomalous`);
      }
    });

    it('should respect custom warmup count', () => {
      const detector = new AnomalyDetector({ warmupCount: 10 });
      for (let i = 0; i < 9; i++) {
        const result = detector.observe('api.test.com', 0.25);
        assert.equal(result.isAnomaly, false);
      }
    });
  });

  describe('normal operation', () => {
    it('should not flag consistent spending as anomalous', () => {
      const detector = new AnomalyDetector();
      // Build baseline with consistent values
      for (let i = 0; i < 20; i++) {
        const result = detector.observe('api.test.com', 0.25 + Math.random() * 0.05);
        // After warmup, consistent values should never be anomalous
        if (i >= 5) {
          assert.equal(result.isAnomaly, false, `consistent observation ${i} flagged as anomaly`);
        }
      }
    });

    it('should track EWMA baseline correctly', () => {
      const detector = new AnomalyDetector({ alpha: 0.3 });
      // Feed 10 identical values
      for (let i = 0; i < 10; i++) {
        detector.observe('api.test.com', 1.00);
      }
      const estimate = detector.estimate('api.test.com');
      assert.ok(estimate, 'estimate should exist');
      assert.equal(estimate.mean, 1.00, 'mean should be exactly 1.00');
      assert.equal(estimate.stddev, 0, 'stddev should be 0 for identical values');
    });
  });

  describe('anomaly detection', () => {
    it('should detect a genuine spending spike (> 2.5σ)', () => {
      const detector = new AnomalyDetector({ warmupCount: 5, cooldownMs: 0 });

      // Build a stable baseline: 20 observations at ~$0.25
      for (let i = 0; i < 20; i++) {
        detector.observe('api.test.com', 0.25);
      }

      // Spike: 10x the baseline
      const result = detector.observe('api.test.com', 2.50);
      assert.equal(result.isAnomaly, true, 'should detect a 10x spike');
      assert.ok(result.zScore > 2.5, `z-score ${result.zScore} should exceed threshold`);
      assert.ok(result.multiplier > 2, `multiplier ${result.multiplier} should be significantly above baseline`);
    });

    it('should NOT flag a moderate increase as anomalous', () => {
      const detector = new AnomalyDetector({ warmupCount: 5, cooldownMs: 0 });

      // Build baseline with real variance (deterministic, alternating pattern)
      const baselineValues = [0.20, 0.25, 0.30, 0.22, 0.28, 0.24, 0.26, 0.21, 0.29, 0.23,
                              0.27, 0.20, 0.25, 0.30, 0.22, 0.28, 0.24, 0.26, 0.21, 0.29];
      for (const v of baselineValues) {
        detector.observe('api.test.com', v);
      }

      // Moderate increase — $0.32 is ~2.1σ from baseline (mean=0.25, sd=0.033)
      // This is a natural fluctuation, not a spike
      const result = detector.observe('api.test.com', 0.32);
      assert.equal(result.isAnomaly, false, 'moderate increase should not be flagged');
    });
  });

  describe('cooldown', () => {
    it('should suppress repeated alerts within cooldown window', () => {
      const detector = new AnomalyDetector({ warmupCount: 5, cooldownMs: 60_000 });
      const now = Date.now();

      // Build baseline
      for (let i = 0; i < 20; i++) {
        detector.observe('api.test.com', 0.25, now + i * 1000);
      }

      // First spike should fire
      const r1 = detector.observe('api.test.com', 5.00, now + 21_000);
      assert.equal(r1.isAnomaly, true, 'first spike should fire');

      // Second spike within cooldown — observe returns suppressed=true
      const r2 = detector.observe('api.test.com', 5.00, now + 22_000);
      // The anomaly is detected but suppressed by cooldown
      assert.equal(r2.suppressed, true, 'second spike should be suppressed by cooldown');
      assert.equal(r2.isAnomaly, false, 'suppressed spike should not be reported as anomaly');
    });

    it('should allow alerts after cooldown expires', () => {
      const detector = new AnomalyDetector({ warmupCount: 5, cooldownMs: 1000 });
      const now = Date.now();

      // Build baseline
      for (let i = 0; i < 20; i++) {
        detector.observe('api.test.com', 0.25, now + i * 100);
      }

      // First spike
      detector.observe('api.test.com', 5.00, now + 5000);

      // After cooldown
      const r = detector.observe('api.test.com', 5.00, now + 7000);
      assert.equal(r.isAnomaly, true, 'should fire after cooldown expires');
    });
  });

  describe('per-host isolation', () => {
    it('should track hosts independently', () => {
      const detector = new AnomalyDetector({ warmupCount: 5, cooldownMs: 0 });

      // Build different baselines for two hosts
      for (let i = 0; i < 20; i++) {
        detector.observe('cheap.api.com', 0.10);
        detector.observe('expensive.api.com', 5.00);
      }

      // $1.00 is a spike for cheap API but normal for expensive API
      const cheapResult = detector.observe('cheap.api.com', 1.00);
      const expensiveResult = detector.observe('expensive.api.com', 5.00);

      assert.equal(cheapResult.isAnomaly, true, '$1 should be anomalous for cheap API');
      assert.equal(expensiveResult.isAnomaly, false, '$5 should be normal for expensive API');
    });
  });

  describe('cost estimation (percentiles)', () => {
    it('should compute accurate percentiles', () => {
      const detector = new AnomalyDetector();

      // Feed values 1-100
      for (let i = 1; i <= 100; i++) {
        detector.observe('api.test.com', i);
      }

      const est = detector.estimate('api.test.com');
      assert.ok(est, 'estimate should exist');
      assert.equal(est.samples, 100);
      assert.equal(est.min, 1);
      assert.equal(est.max, 100);
      assert.ok(Math.abs(est.p50 - 50) <= 1, `p50 should be ~50, got ${est.p50}`);
      assert.ok(Math.abs(est.p95 - 95) <= 1, `p95 should be ~95, got ${est.p95}`);
      assert.ok(Math.abs(est.p99 - 99) <= 1, `p99 should be ~99, got ${est.p99}`);
      assert.ok(est.stddev > 25 && est.stddev < 35, `stddev should be ~29, got ${est.stddev}`);
    });

    it('should return null for unknown hosts', () => {
      const detector = new AnomalyDetector();
      assert.equal(detector.estimate('unknown.api.com'), null);
    });

    it('should compute global estimates across all hosts', () => {
      const detector = new AnomalyDetector();
      for (let i = 0; i < 10; i++) {
        detector.observe('host-a.com', 1.00);
        detector.observe('host-b.com', 2.00);
      }
      const global = detector.estimateGlobal();
      assert.ok(global, 'global estimate should exist');
      assert.equal(global.samples, 20);
      assert.ok(Math.abs(global.mean - 1.5) < 0.01, `global mean should be ~1.5, got ${global.mean}`);
    });
  });

  describe('Welford numerical stability', () => {
    it('should handle very large and very small values without NaN', () => {
      const detector = new AnomalyDetector({ warmupCount: 3 });
      detector.observe('api.test.com', 0.001);
      detector.observe('api.test.com', 0.001);
      detector.observe('api.test.com', 0.001);
      detector.observe('api.test.com', 1000000);

      const est = detector.estimate('api.test.com');
      assert.ok(est, 'estimate should exist');
      assert.ok(!Number.isNaN(est.stddev), 'stddev should not be NaN');
      assert.ok(!Number.isNaN(est.mean), 'mean should not be NaN');
      assert.ok(est.stddev > 0, 'stddev should be positive');
    });
  });
});
