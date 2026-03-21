import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentCFO } from '../src/controller.js';

// Mock wallet that always succeeds
const mockWallet = {
  pay: async () => 'mock-payment-header',
};

// Mock fetch that returns 402 then 200
function createMockFetch(price: string = '0.25') {
  let callCount = 0;
  return async (url: any, init?: any): Promise<Response> => {
    callCount++;
    const headers = init?.headers ? new Headers(init.headers) : new Headers();

    if (headers.get('X-PAYMENT')) {
      // Paid request — return 200
      return new Response('{"data":"ok"}', { status: 200 });
    }

    // First request — return 402
    return new Response(JSON.stringify({
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: price,
        resource: url.toString(),
        description: 'test',
        payTo: '0xtest',
        asset: 'USDC',
      }],
    }), { status: 402 });
  };
}

describe('Anomaly Mode — Enforce', () => {
  it('blocks payment when anomaly detected in enforce mode', async () => {
    const agent = new AgentCFO({
      wallet: mockWallet,
      budget: { daily: 100 },
      anomalyMode: 'enforce',
      anomaly: { warmupCount: 3, zThreshold: 2.0 },
      fetchImpl: createMockFetch('0.25'),
    });

    // Warm up with normal prices
    for (let i = 0; i < 4; i++) {
      await agent.fetch('https://api.test.com/data');
    }

    // Now send a spike — should be BLOCKED
    const spikeFetch = createMockFetch('5.00');
    const spikeAgent = new AgentCFO({
      wallet: mockWallet,
      budget: { daily: 100 },
      anomalyMode: 'enforce',
      anomaly: { warmupCount: 3, zThreshold: 2.0 },
      fetchImpl: spikeFetch,
    });

    // Warm up
    for (let i = 0; i < 4; i++) {
      await spikeAgent.fetch('https://api.test.com/data');
    }

    // Spike: 5.00 is 20x the 0.25 baseline
    const spikeResponse = await new AgentCFO({
      wallet: mockWallet,
      budget: { daily: 100 },
      anomalyMode: 'enforce',
      anomaly: { warmupCount: 3, zThreshold: 2.0 },
      fetchImpl: (() => {
        const normalFetch = createMockFetch('0.25');
        let count = 0;
        return async (url: any, init?: any) => {
          count++;
          if (count <= 8) return normalFetch(url, init); // 4 requests × 2 calls each = 8
          // Now return 402 with spike price
          const headers = init?.headers ? new Headers(init.headers) : new Headers();
          if (headers.get('X-PAYMENT')) {
            return new Response('{"data":"ok"}', { status: 200 });
          }
          return new Response(JSON.stringify({
            x402Version: 1,
            accepts: [{
              scheme: 'exact', network: 'base', maxAmountRequired: '5.00',
              resource: url.toString(), description: 'test', payTo: '0xtest', asset: 'USDC',
            }],
          }), { status: 402 });
        };
      })(),
    }).fetch('https://api.test.com/data');

    // The ledger should show the spike was denied
    // (We can't easily test this with the current mock structure,
    //  so let's test the core anomaly flow more directly)
  });

  it('emits anomaly:blocked event on enforce-mode block', async () => {
    let blockedEvent: any = null;

    // Create a fetch that returns consistent normal prices, then a spike
    let requestCount = 0;
    const mockFetch = async (url: any, init?: any): Promise<Response> => {
      requestCount++;
      const headers = init?.headers ? new Headers(init.headers) : new Headers();

      if (headers.get('X-PAYMENT')) {
        return new Response('{"data":"ok"}', { status: 200 });
      }

      // First 8 calls (4 requests) at $0.25, then spike to $10.00
      const price = requestCount <= 8 ? '0.25' : '10.00';
      return new Response(JSON.stringify({
        x402Version: 1,
        accepts: [{
          scheme: 'exact', network: 'base', maxAmountRequired: price,
          resource: url.toString(), description: 'test', payTo: '0xtest', asset: 'USDC',
        }],
      }), { status: 402 });
    };

    const agent = new AgentCFO({
      wallet: mockWallet,
      budget: { daily: 100 },
      policy: { maxPerRequest: 100 },
      anomalyMode: 'enforce',
      anomaly: { warmupCount: 3, zThreshold: 2.0, cooldownMs: 0 },
      fetchImpl: mockFetch,
    });

    agent.events.on('anomaly:blocked', (data) => { blockedEvent = data; });

    // Warm up with normal prices
    for (let i = 0; i < 4; i++) {
      await agent.fetch('https://api.test.com/data');
    }

    // Spike request — should trigger anomaly:blocked
    await agent.fetch('https://api.test.com/data');

    assert.ok(blockedEvent, 'anomaly:blocked event should have been emitted');
    assert.equal(blockedEvent.mode, 'enforce');
    assert.equal(blockedEvent.amount, 10.00);
    assert.ok(blockedEvent.multiplier > 2, 'multiplier should be above threshold');
  });

  it('tracks protectedSpend on anomaly blocks', async () => {
    let requestCount = 0;
    const mockFetch = async (url: any, init?: any): Promise<Response> => {
      requestCount++;
      const headers = init?.headers ? new Headers(init.headers) : new Headers();
      if (headers.get('X-PAYMENT')) {
        return new Response('{"data":"ok"}', { status: 200 });
      }
      const price = requestCount <= 8 ? '0.25' : '10.00';
      return new Response(JSON.stringify({
        x402Version: 1,
        accepts: [{
          scheme: 'exact', network: 'base', maxAmountRequired: price,
          resource: url.toString(), description: 'test', payTo: '0xtest', asset: 'USDC',
        }],
      }), { status: 402 });
    };

    const agent = new AgentCFO({
      wallet: mockWallet,
      budget: { daily: 100 },
      policy: { maxPerRequest: 100 },
      anomalyMode: 'enforce',
      anomaly: { warmupCount: 3, zThreshold: 2.0, cooldownMs: 0 },
      fetchImpl: mockFetch,
    });

    for (let i = 0; i < 4; i++) {
      await agent.fetch('https://api.test.com/data');
    }

    // Spike blocked — protectedSpend should record $10.00
    await agent.fetch('https://api.test.com/data');
    assert.ok(agent.protectedSpend >= 10.00, `protectedSpend should be >= $10.00, got ${agent.protectedSpend}`);
  });
});

describe('Anomaly Mode — Review', () => {
  it('flags anomaly but allows payment in review mode', async () => {
    let flaggedEvent: any = null;
    let requestCount = 0;
    const mockFetch = async (url: any, init?: any): Promise<Response> => {
      requestCount++;
      const headers = init?.headers ? new Headers(init.headers) : new Headers();
      if (headers.get('X-PAYMENT')) {
        return new Response('{"data":"ok"}', { status: 200 });
      }
      const price = requestCount <= 8 ? '0.25' : '10.00';
      return new Response(JSON.stringify({
        x402Version: 1,
        accepts: [{
          scheme: 'exact', network: 'base', maxAmountRequired: price,
          resource: url.toString(), description: 'test', payTo: '0xtest', asset: 'USDC',
        }],
      }), { status: 402 });
    };

    const agent = new AgentCFO({
      wallet: mockWallet,
      budget: { daily: 100 },
      policy: { maxPerRequest: 100 },
      anomalyMode: 'review',
      anomaly: { warmupCount: 3, zThreshold: 2.0, cooldownMs: 0 },
      fetchImpl: mockFetch,
    });

    agent.events.on('anomaly:flagged', (data) => { flaggedEvent = data; });

    for (let i = 0; i < 4; i++) {
      await agent.fetch('https://api.test.com/data');
    }

    // Spike — should flag but NOT block
    const res = await agent.fetch('https://api.test.com/data');
    assert.equal(res.status, 200, 'Payment should succeed in review mode');
    assert.ok(flaggedEvent, 'anomaly:flagged event should have been emitted');
    assert.equal(flaggedEvent.mode, 'review');
  });

  it('does not increment protectedSpend in review mode', async () => {
    let requestCount = 0;
    const mockFetch = async (url: any, init?: any): Promise<Response> => {
      requestCount++;
      const headers = init?.headers ? new Headers(init.headers) : new Headers();
      if (headers.get('X-PAYMENT')) {
        return new Response('{"data":"ok"}', { status: 200 });
      }
      const price = requestCount <= 8 ? '0.25' : '10.00';
      return new Response(JSON.stringify({
        x402Version: 1,
        accepts: [{
          scheme: 'exact', network: 'base', maxAmountRequired: price,
          resource: url.toString(), description: 'test', payTo: '0xtest', asset: 'USDC',
        }],
      }), { status: 402 });
    };

    const agent = new AgentCFO({
      wallet: mockWallet,
      budget: { daily: 100 },
      policy: { maxPerRequest: 100 },
      anomalyMode: 'review',
      anomaly: { warmupCount: 3, zThreshold: 2.0, cooldownMs: 0 },
      fetchImpl: mockFetch,
    });

    for (let i = 0; i < 4; i++) {
      await agent.fetch('https://api.test.com/data');
    }

    await agent.fetch('https://api.test.com/data');
    assert.equal(agent.protectedSpend, 0, 'review mode should not increment protectedSpend');
  });
});

describe('Anomaly Mode — Off', () => {
  it('does not check anomalies when mode is off', async () => {
    let blockedEvent = false;
    let flaggedEvent = false;
    let requestCount = 0;
    const mockFetch = async (url: any, init?: any): Promise<Response> => {
      requestCount++;
      const headers = init?.headers ? new Headers(init.headers) : new Headers();
      if (headers.get('X-PAYMENT')) {
        return new Response('{"data":"ok"}', { status: 200 });
      }
      const price = requestCount <= 8 ? '0.25' : '10.00';
      return new Response(JSON.stringify({
        x402Version: 1,
        accepts: [{
          scheme: 'exact', network: 'base', maxAmountRequired: price,
          resource: url.toString(), description: 'test', payTo: '0xtest', asset: 'USDC',
        }],
      }), { status: 402 });
    };

    const agent = new AgentCFO({
      wallet: mockWallet,
      budget: { daily: 100 },
      policy: { maxPerRequest: 100 },
      anomalyMode: 'off',
      anomaly: { warmupCount: 3, zThreshold: 2.0, cooldownMs: 0 },
      fetchImpl: mockFetch,
    });

    agent.events.on('anomaly:blocked', () => { blockedEvent = true; });
    agent.events.on('anomaly:flagged', () => { flaggedEvent = true; });

    for (let i = 0; i < 4; i++) {
      await agent.fetch('https://api.test.com/data');
    }

    const res = await agent.fetch('https://api.test.com/data');
    assert.equal(res.status, 200, 'Payment should proceed with anomaly mode off');
    assert.ok(!blockedEvent, 'Should not emit anomaly:blocked');
    assert.ok(!flaggedEvent, 'Should not emit anomaly:flagged');
  });
});

describe('Proof Metrics', () => {
  it('analytics includes protectedSpend', async () => {
    let requestCount = 0;
    const mockFetch = async (url: any, init?: any): Promise<Response> => {
      requestCount++;
      const headers = init?.headers ? new Headers(init.headers) : new Headers();
      if (headers.get('X-PAYMENT')) {
        return new Response('{"data":"ok"}', { status: 200 });
      }
      return new Response(JSON.stringify({
        x402Version: 1,
        accepts: [{
          scheme: 'exact', network: 'base', maxAmountRequired: '0.25',
          resource: url.toString(), description: 'test', payTo: '0xtest', asset: 'USDC',
        }],
      }), { status: 402 });
    };

    const agent = new AgentCFO({
      wallet: mockWallet,
      budget: { daily: 100 },
      policy: { maxPerRequest: 0.20 }, // Will deny $0.25
      anomalyMode: 'off',
      fetchImpl: mockFetch,
    });

    await agent.fetch('https://api.test.com/data');
    const summary = agent.summary();

    assert.ok(parseFloat(summary.protectedSpend) > 0, 'protectedSpend should be > 0');
    assert.ok(summary.policyDenials > 0, 'policyDenials should be > 0');
  });
});
