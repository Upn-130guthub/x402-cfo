import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { tollbooth } from '../src/index.js';

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.get('/free', (_req, res) => res.json({ free: true }));

  app.use('/paid', tollbooth({
    price: '0.50',
    currency: 'USDC',
    network: 'base',
    recipient: '0xTestWallet',
  }));

  app.get('/paid/data', (req, res) => {
    res.json({ premium: true, receipt: (req as any).tollbooth });
  });

  return app;
}

async function request(app: any, path: string, headers?: Record<string, string>) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const url = `http://localhost:${port}${path}`;
      const h = new Headers({ ...headers });

      fetch(url, { headers: h })
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

test('free endpoint returns 200', async () => {
  const app = createTestApp();
  const res = await request(app, '/free');
  assert.equal(res.status, 200);
  assert.equal(res.body.free, true);
});

test('paid endpoint without payment returns 402', async () => {
  const app = createTestApp();
  const res = await request(app, '/paid/data');

  assert.equal(res.status, 402);
  assert.ok(res.body.challengeId);
  assert.ok(res.body.accepts);
  assert.equal(res.body.accepts[0].maxAmountRequired, '0.50');
  assert.equal(res.body.accepts[0].asset, 'USDC');
  assert.ok(res.body._mock?.hint);
});

test('paid endpoint with valid payment returns 200 + receipt', async () => {
  const app = createTestApp();

  // Step 1: Get challenge
  const challenge = await request(app, '/paid/data');
  assert.equal(challenge.status, 402);
  const challengeId = challenge.body.challengeId;

  // Step 2: Pay and retry
  const paid = await request(app, '/paid/data', {
    'X-PAYMENT': `mock base ${challengeId}:paid`,
  });

  assert.equal(paid.status, 200);
  assert.equal(paid.body.premium, true);
  assert.ok(paid.body.receipt);
  assert.equal(paid.body.receipt.paid, true);
  assert.equal(paid.body.receipt.amount, '0.50');
});

test('paid endpoint with invalid payment returns 402', async () => {
  const app = createTestApp();
  const res = await request(app, '/paid/data', {
    'X-PAYMENT': 'mock base fake-id:paid',
  });

  assert.equal(res.status, 402);
  assert.ok(res.body.error);
});
