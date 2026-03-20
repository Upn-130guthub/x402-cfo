/**
 * Framework integrations for x402-cfo.
 *
 * Pre-built adapters for LangChain, CrewAI, MCP, and generic tool-use
 * patterns. Gives any agent framework financial controls with one import.
 *
 * Usage with LangChain:
 *   import { AgentCFO } from 'x402-cfo';
 *   import { createLangChainTool } from 'x402-cfo/integrations';
 *
 *   const agent = new AgentCFO({ wallet, budget: { daily: 50 } });
 *   const tools = [createLangChainTool(agent)];
 *   // Pass tools to your LangChain agent
 */

import type { AgentCFO } from './controller.js';

// ─── Generic Tool Interface ────────────────────────────────

/**
 * Generic tool definition compatible with most agent frameworks.
 * Framework-specific adapters build on top of this.
 */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    required?: boolean;
  }>;
  execute: (params: Record<string, any>) => Promise<any>;
}

// ─── Tool Factory ──────────────────────────────────────────

/**
 * Create a set of tools that expose AgentCFO capabilities to any
 * agent framework. Returns 4 tools: fetch, estimate, budget, and audit.
 */
export function createAgentTools(cfo: AgentCFO): AgentTool[] {
  return [
    {
      name: 'x402_fetch',
      description: 'Fetch a URL with automatic x402 payment handling. Enforces budget limits and cost policies before paying. Use this instead of raw fetch when calling APIs that may require x402 payments.',
      parameters: {
        url: { type: 'string', description: 'The URL to fetch', required: true },
        method: { type: 'string', description: 'HTTP method (GET, POST, etc). Default: GET' },
        body: { type: 'string', description: 'Request body for POST/PUT requests' },
      },
      execute: async (params) => {
        const init: RequestInit = {};
        if (params.method) init.method = params.method;
        if (params.body) init.body = params.body;

        const response = await cfo.fetch(params.url, init);
        const text = await response.text();

        return {
          status: response.status,
          ok: response.ok,
          body: text,
          budgetAfter: cfo.spent(),
        };
      },
    },
    {
      name: 'x402_estimate_cost',
      description: 'Estimate the cost of calling a URL based on historical payment data. Returns average, min, max cost and sample count. Use this before making expensive calls to check if budget allows it.',
      parameters: {
        url: { type: 'string', description: 'The URL to estimate cost for', required: true },
      },
      execute: async (params) => {
        const estimate = cfo.estimateCost(params.url);
        if (!estimate) {
          return { known: false, message: 'No historical data for this endpoint yet.' };
        }
        return { known: true, ...estimate };
      },
    },
    {
      name: 'x402_check_budget',
      description: 'Check current budget status — how much has been spent, how much remains in each time window (hourly, daily, session). Use this to decide whether to proceed with expensive operations.',
      parameters: {},
      execute: async () => {
        return {
          budget: cfo.spent(),
          analytics: cfo.summary(),
        };
      },
    },
    {
      name: 'x402_audit_ledger',
      description: 'Get the full audit trail of all payment decisions. Each entry includes timestamp, amount, URL, status (paid/denied/failed), and reason. Use for debugging or reporting.',
      parameters: {
        format: { type: 'string', description: 'Output format: "json" or "csv". Default: "json"' },
      },
      execute: async (params) => {
        if (params.format === 'csv') {
          return { format: 'csv', data: cfo.exportCSV() };
        }
        return { format: 'json', entries: cfo.audit() };
      },
    },
  ];
}

// ─── LangChain Integration ─────────────────────────────────

/**
 * LangChain-compatible tool definition.
 * Follows the LangChain StructuredTool interface pattern.
 *
 * Usage:
 *   const tools = createLangChainTools(agent);
 *   const executor = AgentExecutor.fromAgentAndTools({ agent, tools });
 */
export interface LangChainToolDef {
  name: string;
  description: string;
  schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  func: (input: Record<string, any>) => Promise<string>;
}

export function createLangChainTools(cfo: AgentCFO): LangChainToolDef[] {
  const tools = createAgentTools(cfo);
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        Object.entries(tool.parameters).map(([key, val]) => [key, { type: val.type, description: val.description }])
      ),
      required: Object.entries(tool.parameters)
        .filter(([, val]) => val.required)
        .map(([key]) => key),
    },
    func: async (input: Record<string, any>) => {
      const result = await tool.execute(input);
      return JSON.stringify(result, null, 2);
    },
  }));
}

// ─── CrewAI Integration ────────────────────────────────────

/**
 * CrewAI-compatible tool definition.
 * Follows CrewAI's BaseTool pattern.
 *
 * Usage:
 *   const tools = createCrewAITools(agent);
 *   const researcher = new Agent({ tools });
 */
export interface CrewAIToolDef {
  name: string;
  description: string;
  args_schema: Record<string, { type: string; description: string; required: boolean }>;
  run: (args: Record<string, any>) => Promise<string>;
}

export function createCrewAITools(cfo: AgentCFO): CrewAIToolDef[] {
  const tools = createAgentTools(cfo);
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    args_schema: Object.fromEntries(
      Object.entries(tool.parameters).map(([key, val]) => [key, { type: val.type, description: val.description, required: val.required ?? false }])
    ),
    run: async (args: Record<string, any>) => {
      const result = await tool.execute(args);
      return JSON.stringify(result, null, 2);
    },
  }));
}

// ─── MCP (Model Context Protocol) Integration ──────────────

/**
 * MCP-compatible tool definition.
 * Follows Anthropic's Model Context Protocol for tool use.
 *
 * Usage:
 *   const tools = createMCPTools(agent);
 *   // Register with your MCP server
 */
export interface MCPToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  handler: (input: Record<string, any>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

export function createMCPTools(cfo: AgentCFO): MCPToolDef[] {
  const tools = createAgentTools(cfo);
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        Object.entries(tool.parameters).map(([key, val]) => [key, { type: val.type, description: val.description }])
      ),
      required: Object.entries(tool.parameters)
        .filter(([, val]) => val.required)
        .map(([key]) => key),
    },
    handler: async (input: Record<string, any>) => {
      const result = await tool.execute(input);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  }));
}
