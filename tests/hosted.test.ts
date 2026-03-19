import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { tollbooth } from '../src/index.js';

/**
 * Tests for hosted verification mode.
 *
 * These spin up a fake "Tollbooth API" server to test the full
 * hosted flow: API key auth, verification, error handling, timeouts.
 */

function createFakeHostedApi(
  handler: (body: any, authHeader: string | undefined) => { status: number; body: any },
): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const auth = req.headers.authorization;
      const result = handler(body, auth);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });
    server.listen(0, () => {
      const port = (server.address() as any).port;
      resolve({ url: `http://localhost:${port}`, close: () => server.close() });
    });
  });
}

function createTestApp(apiUrl: string, apiKey: string = 'test-key-123') {
  const app = express();
  app.use(express.json());

  app.use('/api', tollbooth({
    price: '0.25',
    currency: 'USDC',
    network: 'base',
    recipient: '0xTestWallet',
    mode: 'hosted',
    apiKey,
    apiUrl,
  }));

  app.get('/api/data', (req, res) => {
    res.json({ premium: true, receipt: req.tollbooth });
  });

  return app;
}

async function req(app: any, path: string, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://localhost:${port}${path}`, { headers: new Headers(headers) })
        .then(async (res) => { server.close(); resolve({ status: res.status, body: await res.json() }); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

test('hosted: issues 402 challenge with exact scheme', async () => {
  const app = createTestApp('http://localhost:9999');
  const res = await req(app, '/api/data');
  assert.equal(res.status, 402);
  assert.ok(res.body.challengeId);
  assert.equal(res.body.accepts[0].scheme, 'exact');
  assert.equal(res.body._mock, undefined); // no mock hint in hosted mode
});

test('hosted: valid payment via hosted API returns 200', async () => {
  const api = await createFakeHostedApi((body, auth) => {
    assert.equal(auth, 'Bearer test-key-123');
    assert.equal(body.network, 'base');
    assert.equal(body.amount, '0.25');
    assert.equal(body.currency, 'USDC');
    assert.equal(body.recipient, '0xTestWallet');
    return { status: 200, body: { valid: true, txHash: '0xabc123' } };
  });

  try {
    const app = createTestApp(api.url);
    const paid = await req(app, '/api/data', {
      'X-PAYMENT': 'exact base 0xMyTxHash',
    });
    assert.equal(paid.status, 200);
    assert.ok(paid.body.receipt);
    assert.equal(paid.body.receipt.paid, true);
    assert.equal(paid.body.receipt.amount, '0.25');
  } finally {
    api.close();
  }
});

test('hosted: invalid payment via hosted API returns 402', async () => {
  const api = await createFakeHostedApi(() => {
    return { status: 200, body: { valid: false, error: 'Transaction not found' } };
  });

  try {
    const app = createTestApp(api.url);
    const res = await req(app, '/api/data', {
      'X-PAYMENT': 'exact base 0xBadTx',
    });
    assert.equal(res.status, 402);
    assert.equal(res.body.error, 'payment_invalid');
  } finally {
    api.close();
  }
});

test('hosted: 401 from API returns auth error', async () => {
  const api = await createFakeHostedApi(() => {
    return { status: 401, body: { error: 'Unauthorized' } };
  });

  try {
    const app = createTestApp(api.url, 'bad-key');
    const res = await req(app, '/api/data', {
      'X-PAYMENT': 'exact base 0xTx',
    });
    assert.equal(res.status, 402);
    assert.ok(res.body.message.includes('Invalid API key'));
  } finally {
    api.close();
  }
});

test('hosted: 429 from API returns rate limit error', async () => {
  const api = await createFakeHostedApi(() => {
    return { status: 429, body: { error: 'Too many requests' } };
  });

  try {
    const app = createTestApp(api.url);
    const res = await req(app, '/api/data', {
      'X-PAYMENT': 'exact base 0xTx',
    });
    assert.equal(res.status, 402);
    assert.ok(res.body.message.includes('Rate limited'));
  } finally {
    api.close();
  }
});

test('hosted: missing apiKey returns clear error', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', tollbooth({
    price: '0.25',
    currency: 'USDC',
    network: 'base',
    recipient: '0xWallet',
    mode: 'hosted',
    // NO apiKey
  }));
  app.get('/api/data', (req, res) => res.json({ ok: true }));

  const res = await req(app, '/api/data', {
    'X-PAYMENT': 'exact base 0xTx',
  });
  assert.equal(res.status, 402);
  assert.ok(res.body.message.includes('apiKey'));
});

test('hosted: API sends correct proof and config in the request body', async () => {
  let capturedBody: any = null;

  const api = await createFakeHostedApi((body) => {
    capturedBody = body;
    return { status: 200, body: { valid: true, txHash: '0xdef' } };
  });

  try {
    const app = createTestApp(api.url);
    await req(app, '/api/data', {
      'X-PAYMENT': 'exact base 0xMyTxHash456',
    });

    assert.deepEqual(capturedBody.proof, {
      scheme: 'exact',
      networkId: 'base',
      payload: '0xMyTxHash456',
    });
    assert.equal(capturedBody.network, 'base');
    assert.equal(capturedBody.recipient, '0xTestWallet');
    assert.equal(capturedBody.amount, '0.25');
    assert.equal(capturedBody.currency, 'USDC');
  } finally {
    api.close();
  }
});
