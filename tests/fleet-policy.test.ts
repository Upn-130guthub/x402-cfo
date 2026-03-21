import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetPool } from '../src/pool.js';

describe('Fleet Policy Inheritance', () => {
  it('returns default policy when no agent overrides', () => {
    const pool = new BudgetPool({
      total: 1000,
      agents: [{ id: 'agent-1' }],
      defaultPolicy: { maxPerRequest: 5.00, allowedCurrencies: ['USDC'] },
    });

    const policy = pool.effectivePolicy('agent-1');
    assert.equal(policy.maxPerRequest, 5.00);
    assert.deepEqual(policy.allowedCurrencies, ['USDC']);
  });

  it('agent overrides replace default values', () => {
    const pool = new BudgetPool({
      total: 1000,
      agents: [
        { id: 'agent-1', policyOverrides: { maxPerRequest: 10.00 } },
      ],
      defaultPolicy: { maxPerRequest: 5.00, allowedCurrencies: ['USDC'] },
    });

    const policy = pool.effectivePolicy('agent-1');
    assert.equal(policy.maxPerRequest, 10.00); // Overridden
    assert.deepEqual(policy.allowedCurrencies, ['USDC']); // Inherited
  });

  it('array overrides replace entirely, not merge', () => {
    const pool = new BudgetPool({
      total: 1000,
      agents: [
        { id: 'agent-1', policyOverrides: { allowedCurrencies: ['USDC', 'DAI'] } },
      ],
      defaultPolicy: { allowedCurrencies: ['USDC'], allowedNetworks: ['base'] },
    });

    const policy = pool.effectivePolicy('agent-1');
    assert.deepEqual(policy.allowedCurrencies, ['USDC', 'DAI']); // Replaced
    assert.deepEqual(policy.allowedNetworks, ['base']); // Inherited
  });

  it('checkPolicy uses effective merged policy', () => {
    const pool = new BudgetPool({
      total: 1000,
      agents: [
        { id: 'agent-1', policyOverrides: { maxPerRequest: 10.00 } },
        { id: 'agent-2' },
      ],
      defaultPolicy: { maxPerRequest: 5.00 },
    });

    // Agent-1 has override: $10 max
    const d1 = pool.checkPolicy('agent-1', { url: 'https://api.test.com', amount: 8.00, currency: 'USDC', network: 'base' });
    assert.ok(d1.allowed);

    // Agent-2 uses default: $5 max
    const d2 = pool.checkPolicy('agent-2', { url: 'https://api.test.com', amount: 8.00, currency: 'USDC', network: 'base' });
    assert.ok(!d2.allowed);
  });

  it('updateDefaultPolicy changes for all agents without overrides', () => {
    const pool = new BudgetPool({
      total: 1000,
      agents: [
        { id: 'agent-1', policyOverrides: { maxPerRequest: 10.00 } },
        { id: 'agent-2' },
      ],
      defaultPolicy: { maxPerRequest: 5.00 },
    });

    // Update default from $5 to $15
    pool.updateDefaultPolicy({ maxPerRequest: 15.00 });

    // Agent-1 still has its override: $10
    const p1 = pool.effectivePolicy('agent-1');
    assert.equal(p1.maxPerRequest, 10.00);

    // Agent-2 gets new default: $15
    const p2 = pool.effectivePolicy('agent-2');
    assert.equal(p2.maxPerRequest, 15.00);
  });

  it('throws for unknown agent in effectivePolicy', () => {
    const pool = new BudgetPool({
      total: 1000,
      agents: [{ id: 'agent-1' }],
    });

    assert.throws(() => pool.effectivePolicy('unknown'), /Unknown agent/);
  });

  it('agent added at construction inherits default policy', () => {
    const pool = new BudgetPool({
      total: 1000,
      agents: [
        { id: 'agent-1' },
        { id: 'agent-2' },
        { id: 'agent-3' },
      ],
      defaultPolicy: { maxPerRequest: 5.00 },
    });

    // All agents should inherit the default policy
    const p1 = pool.effectivePolicy('agent-1');
    const p3 = pool.effectivePolicy('agent-3');
    assert.equal(p1.maxPerRequest, 5.00);
    assert.equal(p3.maxPerRequest, 5.00);
  });

  it('mixed construction: some agents override, some inherit', () => {
    const pool = new BudgetPool({
      total: 1000,
      agents: [
        { id: 'agent-1', policyOverrides: { maxPerRequest: 20.00 } },
        { id: 'agent-2' },
        { id: 'agent-3', policyOverrides: { allowedCurrencies: ['DAI'] } },
      ],
      defaultPolicy: { maxPerRequest: 5.00, allowedCurrencies: ['USDC'] },
    });

    // Agent-1: overridden maxPerRequest, inherited allowedCurrencies
    const p1 = pool.effectivePolicy('agent-1');
    assert.equal(p1.maxPerRequest, 20.00);
    assert.deepEqual(p1.allowedCurrencies, ['USDC']);

    // Agent-2: all inherited
    const p2 = pool.effectivePolicy('agent-2');
    assert.equal(p2.maxPerRequest, 5.00);
    assert.deepEqual(p2.allowedCurrencies, ['USDC']);

    // Agent-3: inherited maxPerRequest, overridden currencies
    const p3 = pool.effectivePolicy('agent-3');
    assert.equal(p3.maxPerRequest, 5.00);
    assert.deepEqual(p3.allowedCurrencies, ['DAI']);
  });
});
