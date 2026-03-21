import { Policy, type PolicyRules, type PolicyDecision } from './policy.js';

/**
 * Multi-Agent Budget Pool — fleet-level budget management.
 *
 * Problem: When you have 10 agents sharing a $1000/day budget, you need:
 *   1. Centralized pool with per-agent allocation
 *   2. Real-time rebalancing (idle agents release budget to active ones)
 *   3. Cost-center accounting (who spent what, against which budget line)
 *   4. Pool-level analytics for finance teams
 *
 * This is game-theoretic budget allocation, not just counting.
 *
 * Allocation strategies:
 *   - EQUAL: every agent gets pool / N
 *   - WEIGHTED: agents get proportional shares (e.g. Agent A: 40%, Agent B: 60%)
 *   - PRIORITY: high-priority agents can borrow from low-priority ones
 *
 * Rebalancing:
 *   When an agent hits its limit, the pool checks if any agent has surplus
 *   (spent < 50% of allocation AND has been idle for > idleThresholdMs).
 *   If so, surplus is redistributed to the requesting agent. This is
 *   cooperative game theory: agents implicitly cooperate by releasing
 *   unused budget.
 */

/** Configuration for a single agent within a pool. */
export interface PoolAgentConfig {
  /** Unique identifier for this agent. */
  id: string;
  /** Weight for WEIGHTED allocation (higher = more budget). Default: 1 */
  weight?: number;
  /** Priority level for PRIORITY strategy (higher = can borrow more). Default: 1 */
  priority?: number;
  /** Optional label for cost-center reporting. */
  costCenter?: string;
  /** Per-agent policy overrides (merged with pool default policy). */
  policyOverrides?: Partial<PolicyRules>;
}

/** Allocation strategy. */
export type AllocationStrategy = 'equal' | 'weighted' | 'priority';

/** Pool configuration. */
export interface BudgetPoolConfig {
  /** Total pool budget (dollars). */
  total: number;
  /** Allocation strategy. Default: 'equal' */
  strategy?: AllocationStrategy;
  /** Agents in the pool. */
  agents: PoolAgentConfig[];
  /** How long an agent must be idle before its surplus can be rebalanced (ms). Default: 300000 (5 min) */
  idleThresholdMs?: number;
  /** Minimum surplus ratio before budget can be reclaimed (0-1). Default: 0.5 (agent used < 50%) */
  surplusThreshold?: number;
  /** Default policy rules applied to all agents (can be overridden per-agent). */
  defaultPolicy?: PolicyRules;
}

/** Per-agent budget state within the pool. */
interface AgentPoolState {
  id: string;
  weight: number;
  priority: number;
  costCenter: string;
  /** Allocated budget (initial + any rebalanced surplus) */
  allocated: number;
  /** Total spent so far */
  spent: number;
  /** Timestamp of last spend activity */
  lastActivityAt: number;
  /** Number of transactions */
  transactionCount: number;
  /** Spend by endpoint for cost-center drill-down */
  endpointSpend: Map<string, number>;
  /** Per-agent policy overrides */
  policyOverrides?: Partial<PolicyRules>;
}

/** Pool-level analytics for finance reporting. */
export interface PoolAnalytics {
  /** Total pool budget */
  totalBudget: number;
  /** Total spent across all agents */
  totalSpent: number;
  /** Total remaining across all agents */
  totalRemaining: number;
  /** Pool utilization percentage (0-1) */
  utilization: number;
  /** Per-agent breakdown */
  agents: AgentAnalytics[];
  /** Spend by cost center */
  byCostCenter: Record<string, { spent: number; allocated: number; agents: string[] }>;
  /** Number of rebalancing events that occurred */
  rebalanceCount: number;
}

/** Per-agent analytics within the pool. */
export interface AgentAnalytics {
  id: string;
  costCenter: string;
  allocated: number;
  spent: number;
  remaining: number;
  utilization: number;
  transactionCount: number;
  lastActivityAt: number;
  isIdle: boolean;
  topEndpoints: { url: string; spent: number }[];
}

/** Result of a pool budget check. */
export interface PoolBudgetDecision {
  allowed: boolean;
  reason?: string;
  /** If allowed, which agent's budget is being debited. */
  agentId?: string;
  /** Remaining allocation for this agent after this spend. */
  remainingAfter?: number;
  /** Whether rebalancing was triggered to allow this. */
  rebalanced?: boolean;
}

/**
 * Multi-agent shared budget pool.
 *
 * Usage:
 *   const pool = new BudgetPool({
 *     total: 1000,
 *     strategy: 'weighted',
 *     agents: [
 *       { id: 'researcher', weight: 3, costCenter: 'R&D' },
 *       { id: 'support-bot', weight: 1, costCenter: 'Support' },
 *     ],
 *   });
 *
 *   // Before an agent pays:
 *   const decision = pool.check('researcher', 2.50);
 *   if (decision.allowed) {
 *     // ... execute payment ...
 *     pool.record('researcher', 2.50, 'https://api.data.com/prices');
 *   }
 */
export class BudgetPool {
  private agents: Map<string, AgentPoolState> = new Map();
  private totalBudget: number;
  private strategy: AllocationStrategy;
  private idleThresholdMs: number;
  private surplusThreshold: number;
  private rebalanceCount: number = 0;
  private defaultPolicy: PolicyRules;

  constructor(config: BudgetPoolConfig) {
    this.totalBudget = config.total;
    this.strategy = config.strategy ?? 'equal';
    this.idleThresholdMs = config.idleThresholdMs ?? 300_000;
    this.surplusThreshold = config.surplusThreshold ?? 0.5;
    this.defaultPolicy = config.defaultPolicy ?? {};

    if (config.agents.length === 0) {
      throw new Error('BudgetPool requires at least one agent');
    }

    // Calculate initial allocations
    const totalWeight = config.agents.reduce((sum, a) => sum + (a.weight ?? 1), 0);

    for (const agentConfig of config.agents) {
      const weight = agentConfig.weight ?? 1;
      let allocated: number;

      switch (this.strategy) {
        case 'equal':
          allocated = this.totalBudget / config.agents.length;
          break;
        case 'weighted':
        case 'priority':
          allocated = (weight / totalWeight) * this.totalBudget;
          break;
      }

      this.agents.set(agentConfig.id, {
        id: agentConfig.id,
        weight,
        priority: agentConfig.priority ?? 1,
        costCenter: agentConfig.costCenter ?? 'default',
        allocated: Math.round(allocated * 100) / 100,
        spent: 0,
        lastActivityAt: 0,
        transactionCount: 0,
        endpointSpend: new Map(),
        policyOverrides: agentConfig.policyOverrides,
      });
    }
  }

  /**
   * Check if an agent can spend a given amount.
   * If the agent is over budget, attempts rebalancing from idle agents.
   */
  check(agentId: string, amount: number): PoolBudgetDecision {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { allowed: false, reason: `Unknown agent: ${agentId}` };
    }

    const remaining = agent.allocated - agent.spent;

    // Simple case: agent has enough budget
    if (remaining >= amount) {
      return {
        allowed: true,
        agentId,
        remainingAfter: Math.round((remaining - amount) * 100) / 100,
        rebalanced: false,
      };
    }

    // Agent is over budget — try rebalancing
    const deficit = amount - remaining;
    const rebalanced = this.tryRebalance(agentId, deficit);

    if (rebalanced) {
      const newRemaining = agent.allocated - agent.spent;
      return {
        allowed: newRemaining >= amount,
        agentId,
        remainingAfter: Math.round((newRemaining - amount) * 100) / 100,
        rebalanced: true,
      };
    }

    return {
      allowed: false,
      agentId,
      reason: `Agent ${agentId} budget exhausted (allocated: $${agent.allocated.toFixed(2)}, spent: $${agent.spent.toFixed(2)}, requested: $${amount.toFixed(2)})`,
      remainingAfter: Math.round(remaining * 100) / 100,
      rebalanced: false,
    };
  }

  /**
   * Record a successful spend against an agent's budget.
   */
  record(agentId: string, amount: number, endpoint?: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);

    agent.spent = Math.round((agent.spent + amount) * 100) / 100;
    agent.lastActivityAt = Date.now();
    agent.transactionCount++;

    if (endpoint) {
      const current = agent.endpointSpend.get(endpoint) ?? 0;
      agent.endpointSpend.set(endpoint, Math.round((current + amount) * 100) / 100);
    }
  }

  /**
   * Get the effective policy for an agent (default + overrides merged).
   * Overrides take precedence: if an agent specifies maxPerRequest,
   * it replaces the org default for that field.
   */
  effectivePolicy(agentId: string): PolicyRules {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);

    const merged: PolicyRules = { ...this.defaultPolicy };
    const overrides = agent.policyOverrides;
    if (!overrides) return merged;

    // Scalar overrides replace
    if (overrides.maxPerRequest !== undefined) merged.maxPerRequest = overrides.maxPerRequest;

    // Array overrides: agent-specific replaces default entirely (not merge)
    if (overrides.allowlist) merged.allowlist = overrides.allowlist;
    if (overrides.blocklist) merged.blocklist = overrides.blocklist;
    if (overrides.allowedCurrencies) merged.allowedCurrencies = overrides.allowedCurrencies;
    if (overrides.allowedNetworks) merged.allowedNetworks = overrides.allowedNetworks;

    return merged;
  }

  /**
   * Check a payment against the agent's effective policy (org default + overrides).
   */
  checkPolicy(agentId: string, params: { url: string; amount: number; currency: string; network: string }): PolicyDecision {
    const rules = this.effectivePolicy(agentId);
    const policy = new Policy(rules);
    return policy.check(params);
  }

  /**
   * Update the default policy for all agents.
   * Existing per-agent overrides are preserved.
   */
  updateDefaultPolicy(rules: PolicyRules): void {
    this.defaultPolicy = rules;
  }

  /**
   * Get pool-level analytics for finance reporting.
   */
  analytics(): PoolAnalytics {
    const now = Date.now();
    const agentAnalytics: AgentAnalytics[] = [];
    const costCenters: Record<string, { spent: number; allocated: number; agents: string[] }> = {};

    let totalSpent = 0;

    for (const agent of this.agents.values()) {
      totalSpent += agent.spent;
      const remaining = Math.round((agent.allocated - agent.spent) * 100) / 100;
      const utilization = agent.allocated > 0 ? agent.spent / agent.allocated : 0;
      const isIdle = agent.lastActivityAt > 0 && (now - agent.lastActivityAt) > this.idleThresholdMs;

      // Top endpoints
      const topEndpoints = [...agent.endpointSpend.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([url, spent]) => ({ url, spent }));

      agentAnalytics.push({
        id: agent.id,
        costCenter: agent.costCenter,
        allocated: agent.allocated,
        spent: agent.spent,
        remaining,
        utilization: Math.round(utilization * 1000) / 1000,
        transactionCount: agent.transactionCount,
        lastActivityAt: agent.lastActivityAt,
        isIdle,
        topEndpoints,
      });

      // Aggregate by cost center
      if (!costCenters[agent.costCenter]) {
        costCenters[agent.costCenter] = { spent: 0, allocated: 0, agents: [] };
      }
      costCenters[agent.costCenter].spent = Math.round((costCenters[agent.costCenter].spent + agent.spent) * 100) / 100;
      costCenters[agent.costCenter].allocated = Math.round((costCenters[agent.costCenter].allocated + agent.allocated) * 100) / 100;
      costCenters[agent.costCenter].agents.push(agent.id);
    }

    return {
      totalBudget: this.totalBudget,
      totalSpent: Math.round(totalSpent * 100) / 100,
      totalRemaining: Math.round((this.totalBudget - totalSpent) * 100) / 100,
      utilization: this.totalBudget > 0 ? Math.round((totalSpent / this.totalBudget) * 1000) / 1000 : 0,
      agents: agentAnalytics,
      byCostCenter: costCenters,
      rebalanceCount: this.rebalanceCount,
    };
  }

  /**
   * Manually add a new agent to the pool with a specific allocation.
   * Does NOT reallocate existing agents — takes from unallocated pool.
   */
  addAgent(config: PoolAgentConfig, allocation: number): void {
    if (this.agents.has(config.id)) {
      throw new Error(`Agent ${config.id} already exists in pool`);
    }

    const totalAllocated = [...this.agents.values()].reduce((s, a) => s + a.allocated, 0);
    const unallocated = this.totalBudget - totalAllocated;

    if (allocation > unallocated) {
      throw new Error(`Cannot allocate $${allocation.toFixed(2)} — only $${unallocated.toFixed(2)} unallocated in pool`);
    }

    this.agents.set(config.id, {
      id: config.id,
      weight: config.weight ?? 1,
      priority: config.priority ?? 1,
      costCenter: config.costCenter ?? 'default',
      allocated: allocation,
      spent: 0,
      lastActivityAt: 0,
      transactionCount: 0,
      endpointSpend: new Map(),
      policyOverrides: config.policyOverrides,
    });
  }

  /**
   * Get a specific agent's state.
   */
  agentStatus(agentId: string): AgentAnalytics | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const now = Date.now();
    const remaining = Math.round((agent.allocated - agent.spent) * 100) / 100;
    const utilization = agent.allocated > 0 ? agent.spent / agent.allocated : 0;
    const isIdle = agent.lastActivityAt > 0 && (now - agent.lastActivityAt) > this.idleThresholdMs;

    const topEndpoints = [...agent.endpointSpend.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([url, spent]) => ({ url, spent }));

    return {
      id: agent.id,
      costCenter: agent.costCenter,
      allocated: agent.allocated,
      spent: agent.spent,
      remaining,
      utilization: Math.round(utilization * 1000) / 1000,
      transactionCount: agent.transactionCount,
      lastActivityAt: agent.lastActivityAt,
      isIdle,
      topEndpoints,
    };
  }

  // ---- Rebalancing engine ----

  /**
   * Try to rebalance budget from idle/surplus agents to a requesting agent.
   *
   * This is the cooperative game theory bit:
   * - Agents don't compete for budget — they implicitly cooperate
   * - An agent is a "donor" if: (a) it has surplus, (b) it's been idle
   * - PRIORITY strategy: higher priority agents can borrow from all lower ones
   * - EQUAL/WEIGHTED: only borrow from agents with surplus > threshold
   */
  private tryRebalance(requestingId: string, deficit: number): boolean {
    const now = Date.now();
    const requester = this.agents.get(requestingId)!;
    let totalRecovered = 0;

    // Find donors: agents with surplus who are idle
    const donors: { agent: AgentPoolState; surplus: number }[] = [];

    for (const agent of this.agents.values()) {
      if (agent.id === requestingId) continue;

      const remaining = agent.allocated - agent.spent;
      const utilization = agent.allocated > 0 ? agent.spent / agent.allocated : 1;

      // Is this agent a valid donor?
      const isIdle = agent.lastActivityAt === 0 || (now - agent.lastActivityAt) > this.idleThresholdMs;
      const hasSurplus = utilization < this.surplusThreshold;

      // Priority strategy: high-priority agents can borrow from any lower-priority agent
      const priorityAllows = this.strategy === 'priority'
        ? requester.priority > agent.priority
        : true;

      if (isIdle && hasSurplus && priorityAllows && remaining > 0) {
        // Don't take everything — leave 20% as a reserve for the donor
        const donatable = Math.round(remaining * 0.8 * 100) / 100;
        if (donatable > 0) {
          donors.push({ agent, surplus: donatable });
        }
      }
    }

    // Sort donors by surplus (largest first) for efficient rebalancing
    donors.sort((a, b) => b.surplus - a.surplus);

    for (const { agent, surplus } of donors) {
      const take = Math.min(surplus, deficit - totalRecovered);
      agent.allocated = Math.round((agent.allocated - take) * 100) / 100;
      requester.allocated = Math.round((requester.allocated + take) * 100) / 100;
      totalRecovered = Math.round((totalRecovered + take) * 100) / 100;
      this.rebalanceCount++;

      if (totalRecovered >= deficit) break;
    }

    return totalRecovered >= deficit;
  }
}
