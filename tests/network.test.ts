import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkIntelligence } from '../src/network.js';

describe('NetworkIntelligence', () => {
  it('does not record when disabled', () => {
    const net = new NetworkIntelligence({ enabled: false });
    net.record('api.test.com', 'USDC', 'base', 0.25);
    assert.equal(net.trackedHosts().length, 0);
  });

  it('records signals when enabled', () => {
    const net = new NetworkIntelligence({ enabled: true });
    net.record('api.test.com', 'USDC', 'base', 0.25);
    net.record('api.test.com', 'USDC', 'base', 0.30);
    assert.equal(net.trackedHosts().length, 1);
    assert.equal(net.trackedHosts()[0].signalCount, 2);
  });

  it('hashes host names deterministically', () => {
    const net = new NetworkIntelligence({ enabled: true });
    net.record('api.test.com', 'USDC', 'base', 0.25);
    net.record('api.test.com', 'USDC', 'base', 0.30);
    const hosts = net.trackedHosts();
    assert.equal(hosts.length, 1, 'same host should map to same hash');
  });

  it('tracks different hosts separately', () => {
    const net = new NetworkIntelligence({ enabled: true });
    net.record('api.alpha.com', 'USDC', 'base', 0.25);
    net.record('api.beta.com', 'USDC', 'base', 0.50);
    assert.equal(net.trackedHosts().length, 2);
  });

  it('returns null for unknown hosts in query', () => {
    const net = new NetworkIntelligence({ enabled: true });
    assert.equal(net.query('unknown.com'), null);
  });

  it('returns null for hosts with too few signals', () => {
    const net = new NetworkIntelligence({ enabled: true });
    net.record('api.test.com', 'USDC', 'base', 0.25);
    net.record('api.test.com', 'USDC', 'base', 0.30);
    assert.equal(net.query('api.test.com'), null, 'need at least 3 signals');
  });

  it('provides local intelligence with enough signals', () => {
    const net = new NetworkIntelligence({ enabled: true });
    for (let i = 0; i < 10; i++) {
      net.record('api.test.com', 'USDC', 'base', 0.20 + i * 0.02);
    }
    const intel = net.query('api.test.com');
    assert.ok(intel);
    assert.equal(intel.reporters, 1); // local-only
    assert.ok(intel.pricing.p50 > 0);
    assert.ok(intel.pricing.p95 > intel.pricing.p50);
    assert.equal(intel.isNetworkAnomaly, false);
  });

  it('detects network-wide anomaly when price exceeds p95 * 1.5', () => {
    const net = new NetworkIntelligence({ enabled: true });
    for (let i = 0; i < 20; i++) {
      net.record('api.test.com', 'USDC', 'base', 0.25);
    }
    // Query with an extreme price
    const intel = net.query('api.test.com', 10.00);
    assert.ok(intel);
    assert.equal(intel.isNetworkAnomaly, true);
  });

  it('does not flag normal price as network anomaly', () => {
    const net = new NetworkIntelligence({ enabled: true });
    for (let i = 0; i < 20; i++) {
      net.record('api.test.com', 'USDC', 'base', 0.25);
    }
    const intel = net.query('api.test.com', 0.25);
    assert.ok(intel);
    assert.equal(intel.isNetworkAnomaly, false);
  });

  it('caps local cache at 100 signals per host', () => {
    const net = new NetworkIntelligence({ enabled: true });
    for (let i = 0; i < 150; i++) {
      net.record('api.test.com', 'USDC', 'base', 0.25 + i * 0.001);
    }
    assert.equal(net.trackedHosts()[0].signalCount, 100);
  });
});
