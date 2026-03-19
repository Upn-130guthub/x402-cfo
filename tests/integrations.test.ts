import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTools, createLangChainTools, createCrewAITools, createMCPTools } from '../src/integrations.js';
import { AgentCFO, type AgentWallet, type X402Challenge } from '../src/controller.js';

const mockWallet: AgentWallet = {
  pay: async () => 'payment-token-123',
};

function make402Response(amount = '0.25') {
  const challenge: X402Challenge = {
    x402Version: 1,
    accepts: [{
      scheme: 'exact', network: 'base',
      maxAmountRequired: amount,
      resource: 'https://api.test.com/data',
      description: 'API access',
      payTo: '0xRecipient', asset: 'USDC',
    }],
  };
  return new Response(JSON.stringify(challenge), {
    status: 402,
    headers: { 'Content-Type': 'application/json' },
  });
}

function make200Response(body = '{"result":"ok"}') {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function makeAgent() {
  let callCount = 0;
  return new AgentCFO({
    wallet: mockWallet,
    budget: { daily: 50 },
    fetchImpl: async () => {
      callCount++;
      return callCount % 2 === 1 ? make402Response() : make200Response();
    },
  });
}

// ─── createAgentTools ──────────────────────────────────────

test('integrations: createAgentTools returns 4 tools', () => {
  const tools = createAgentTools(makeAgent());
  assert.equal(tools.length, 4);
  assert.deepEqual(tools.map(t => t.name), ['x402_fetch', 'x402_estimate_cost', 'x402_check_budget', 'x402_audit_ledger']);
});

test('integrations: x402_fetch tool makes request and returns budget', async () => {
  const agent = makeAgent();
  const tools = createAgentTools(agent);
  const fetchTool = tools.find(t => t.name === 'x402_fetch')!;

  const result = await fetchTool.execute({ url: 'https://api.test.com/data' });
  assert.equal(result.status, 200);
  assert.ok(result.budgetAfter);
});

test('integrations: x402_check_budget tool returns status and analytics', async () => {
  const agent = makeAgent();
  const tools = createAgentTools(agent);
  const budgetTool = tools.find(t => t.name === 'x402_check_budget')!;

  const result = await budgetTool.execute({});
  assert.ok(result.budget);
  assert.ok(result.analytics);
});

test('integrations: x402_estimate_cost returns null for unknown URL', async () => {
  const tools = createAgentTools(makeAgent());
  const estimateTool = tools.find(t => t.name === 'x402_estimate_cost')!;

  const result = await estimateTool.execute({ url: 'https://unknown.com' });
  assert.equal(result.known, false);
});

test('integrations: x402_audit_ledger returns entries after fetch', async () => {
  const agent = makeAgent();
  const tools = createAgentTools(agent);

  await tools.find(t => t.name === 'x402_fetch')!.execute({ url: 'https://api.test.com/data' });
  const result = await tools.find(t => t.name === 'x402_audit_ledger')!.execute({ format: 'json' });

  assert.equal(result.format, 'json');
  assert.ok(result.entries.length > 0);
});

test('integrations: x402_audit_ledger supports CSV format', async () => {
  const agent = makeAgent();
  const tools = createAgentTools(agent);

  await tools.find(t => t.name === 'x402_fetch')!.execute({ url: 'https://api.test.com/data' });
  const result = await tools.find(t => t.name === 'x402_audit_ledger')!.execute({ format: 'csv' });

  assert.equal(result.format, 'csv');
  assert.ok(result.data.includes('timestamp'));
});

// ─── LangChain ─────────────────────────────────────────────

test('integrations: createLangChainTools returns correct schema format', () => {
  const tools = createLangChainTools(makeAgent());
  assert.equal(tools.length, 4);

  const fetchTool = tools.find(t => t.name === 'x402_fetch')!;
  assert.equal(fetchTool.schema.type, 'object');
  assert.ok(fetchTool.schema.properties.url);
  assert.ok(fetchTool.schema.required.includes('url'));
  assert.equal(typeof fetchTool.func, 'function');
});

test('integrations: LangChain tool func returns JSON string', async () => {
  const tools = createLangChainTools(makeAgent());
  const fetchTool = tools.find(t => t.name === 'x402_fetch')!;

  const result = await fetchTool.func({ url: 'https://api.test.com/data' });
  assert.equal(typeof result, 'string');
  const parsed = JSON.parse(result);
  assert.equal(parsed.status, 200);
});

// ─── CrewAI ────────────────────────────────────────────────

test('integrations: createCrewAITools returns correct schema format', () => {
  const tools = createCrewAITools(makeAgent());
  assert.equal(tools.length, 4);

  const fetchTool = tools.find(t => t.name === 'x402_fetch')!;
  assert.ok(fetchTool.args_schema.url);
  assert.equal(fetchTool.args_schema.url.required, true);
  assert.equal(typeof fetchTool.run, 'function');
});

// ─── MCP ───────────────────────────────────────────────────

test('integrations: createMCPTools returns correct MCP format', () => {
  const tools = createMCPTools(makeAgent());
  assert.equal(tools.length, 4);

  const fetchTool = tools.find(t => t.name === 'x402_fetch')!;
  assert.equal(fetchTool.input_schema.type, 'object');
  assert.ok(fetchTool.input_schema.properties.url);
  assert.equal(typeof fetchTool.handler, 'function');
});

test('integrations: MCP handler returns content array', async () => {
  const tools = createMCPTools(makeAgent());
  const budgetTool = tools.find(t => t.name === 'x402_check_budget')!;

  const result = await budgetTool.handler({});
  assert.ok(Array.isArray(result.content));
  assert.equal(result.content[0].type, 'text');
  assert.equal(typeof result.content[0].text, 'string');
});
