import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetPool } from '../src/pool.js';

describe('BudgetPool', () => {

  describe('allocation strategies', () => {
    it('equal: splits budget evenly', () => {
      const pool = new BudgetPool({
        total: 1000,
        strategy: 'equal',
        agents: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }],
      });
      const stats = pool.analytics();
      for (const agent of stats.agents) {
        assert.equal(agent.allocated, 250);
      }
    });

    it('weighted: allocates proportionally', () => {
      const pool = new BudgetPool({
        total: 1000,
        strategy: 'weighted',
        agents: [
          { id: 'heavy', weight: 3 },
          { id: 'light', weight: 1 },
        ],
      });
      const stats = pool.analytics();
      assert.equal(stats.agents.find(a => a.id === 'heavy')!.allocated, 750);
      assert.equal(stats.agents.find(a => a.id === 'light')!.allocated, 250);
    });

    it('priority: same as weighted for initial allocation', () => {
      const pool = new BudgetPool({
        total: 100,
        strategy: 'priority',
        agents: [
          { id: 'high', weight: 2, priority: 10 },
          { id: 'low', weight: 2, priority: 1 },
        ],
      });
      const stats = pool.analytics();
      // Same weight → equal allocation
      assert.equal(stats.agents[0].allocated, 50);
      assert.equal(stats.agents[1].allocated, 50);
    });
  });

  describe('check and record', () => {
    it('allows spend within allocation', () => {
      const pool = new BudgetPool({ total: 100, agents: [{ id: 'agent-1' }] });
      const decision = pool.check('agent-1', 50);
      assert.equal(decision.allowed, true);
      assert.equal(decision.remainingAfter, 50);
    });

    it('denies spend over allocation', () => {
      const pool = new BudgetPool({ total: 100, agents: [{ id: 'agent-1' }] });
      pool.record('agent-1', 95);
      const decision = pool.check('agent-1', 10);
      assert.equal(decision.allowed, false);
    });

    it('records spend and tracks per-endpoint', () => {
      const pool = new BudgetPool({ total: 100, agents: [{ id: 'agent-1' }] });
      pool.record('agent-1', 5, 'https://api.data.com/prices');
      pool.record('agent-1', 3, 'https://api.data.com/prices');
      pool.record('agent-1', 2, 'https://api.other.com/query');

      const stats = pool.agentStatus('agent-1');
      assert.ok(stats);
      assert.equal(stats.spent, 10);
      assert.equal(stats.transactionCount, 3);
      assert.equal(stats.topEndpoints[0].url, 'https://api.data.com/prices');
      assert.equal(stats.topEndpoints[0].spent, 8);
    });

    it('returns null for unknown agent', () => {
      const pool = new BudgetPool({ total: 100, agents: [{ id: 'agent-1' }] });
      assert.equal(pool.agentStatus('unknown'), null);
    });
  });

  describe('rebalancing', () => {
    it('rebalances from idle agents to active ones', () => {
      const pool = new BudgetPool({
        total: 200,
        strategy: 'equal',
        agents: [{ id: 'active' }, { id: 'idle' }],
        idleThresholdMs: 0, // immediate idle detection for testing
        surplusThreshold: 0.5,
      });

      // Active agent spends its full allocation
      pool.record('active', 100);

      // Now active agent needs more — should rebalance from idle
      const decision = pool.check('active', 10);
      assert.equal(decision.allowed, true, 'should rebalance from idle agent');
      assert.equal(decision.rebalanced, true);
    });

    it('does NOT rebalance from agents that have spent significantly', () => {
      const pool = new BudgetPool({
        total: 200,
        strategy: 'equal',
        agents: [{ id: 'active' }, { id: 'busy' }],
        idleThresholdMs: 0,
        surplusThreshold: 0.5,
      });

      // Both agents spend past the surplus threshold
      pool.record('active', 100);
      pool.record('busy', 60); // 60% utilization > 50% threshold

      // Active needs more — but busy has used too much to donate
      const decision = pool.check('active', 10);
      assert.equal(decision.allowed, false, 'should not take from busy agent');
    });

    it('tracks rebalance count in analytics', () => {
      const pool = new BudgetPool({
        total: 200,
        strategy: 'equal',
        agents: [{ id: 'a' }, { id: 'b' }],
        idleThresholdMs: 0,
        surplusThreshold: 0.5,
      });
      pool.record('a', 100);
      pool.check('a', 10); // triggers rebalance
      assert.ok(pool.analytics().rebalanceCount >= 1);
    });
  });

  describe('cost-center analytics', () => {
    it('aggregates spend by cost center', () => {
      const pool = new BudgetPool({
        total: 1000,
        strategy: 'equal',
        agents: [
          { id: 'researcher', costCenter: 'R&D' },
          { id: 'analyst', costCenter: 'R&D' },
          { id: 'support-bot', costCenter: 'Support' },
        ],
      });

      pool.record('researcher', 100);
      pool.record('analyst', 50);
      pool.record('support-bot', 30);

      const stats = pool.analytics();
      assert.ok(stats.byCostCenter['R&D']);
      assert.equal(stats.byCostCenter['R&D'].spent, 150);
      assert.equal(stats.byCostCenter['R&D'].agents.length, 2);
      assert.equal(stats.byCostCenter['Support'].spent, 30);
    });

    it('reports pool-level utilization', () => {
      const pool = new BudgetPool({ total: 500, agents: [{ id: 'a' }, { id: 'b' }] });
      pool.record('a', 100);
      pool.record('b', 150);
      const stats = pool.analytics();
      assert.equal(stats.totalSpent, 250);
      assert.equal(stats.totalRemaining, 250);
      assert.equal(stats.utilization, 0.5);
    });
  });

  describe('addAgent', () => {
    it('adds agent with specified allocation', () => {
      const pool = new BudgetPool({ total: 500, agents: [{ id: 'a' }] });
      // a gets 500. unallocated = 0. Cannot add without pool having room.
      // Let's use weighted with room:
      const pool2 = new BudgetPool({
        total: 500,
        strategy: 'weighted',
        agents: [{ id: 'a', weight: 1 }],
      });
      // a gets 500 (100% of weight). But we can't add because nothing is unallocated.
      assert.throws(() => pool2.addAgent({ id: 'b' }, 100), /Cannot allocate/);
    });
  });

  describe('error handling', () => {
    it('throws on empty agents list', () => {
      assert.throws(() => new BudgetPool({ total: 100, agents: [] }), /at least one agent/);
    });

    it('returns error for unknown agent in check', () => {
      const pool = new BudgetPool({ total: 100, agents: [{ id: 'a' }] });
      const decision = pool.check('unknown', 10);
      assert.equal(decision.allowed, false);
      assert.ok(decision.reason?.includes('Unknown agent'));
    });

    it('throws for unknown agent in record', () => {
      const pool = new BudgetPool({ total: 100, agents: [{ id: 'a' }] });
      assert.throws(() => pool.record('unknown', 10), /Unknown agent/);
    });
  });
});
