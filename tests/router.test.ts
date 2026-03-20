import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentRouter, type PaymentOption } from '../src/router.js';

const makeOption = (overrides: Partial<PaymentOption> = {}): PaymentOption => ({
  scheme: 'exact',
  network: 'base',
  maxAmountRequired: '0.25',
  asset: 'USDC',
  payTo: '0xRecipient',
  resource: 'https://api.test.com/data',
  ...overrides,
});

describe('PaymentRouter', () => {
  it('returns null for empty options', async () => {
    const router = new PaymentRouter();
    assert.equal(await router.select([]), null);
  });

  it('returns the single option if only one', async () => {
    const router = new PaymentRouter();
    const result = await router.select([makeOption()]);
    assert.ok(result);
    assert.equal(result.option.asset, 'USDC');
  });

  it('picks cheaper network when amounts are equal', async () => {
    const router = new PaymentRouter();
    const result = await router.select([
      makeOption({ network: 'ethereum', maxAmountRequired: '0.25' }),
      makeOption({ network: 'base', maxAmountRequired: '0.25' }),
    ]);
    assert.ok(result);
    assert.equal(result.option.network, 'base', 'should pick Base (cheaper fees)');
  });

  it('picks lower amount even on expensive network', async () => {
    const router = new PaymentRouter();
    const result = await router.select([
      makeOption({ network: 'base', maxAmountRequired: '10.00' }),
      makeOption({ network: 'ethereum', maxAmountRequired: '0.10' }),
    ]);
    assert.ok(result);
    assert.equal(result.option.network, 'ethereum', 'should pick cheaper total cost');
    assert.ok(result.totalCostUsd < 1, 'total cost should be low');
  });

  it('ranks options from cheapest to most expensive', async () => {
    const router = new PaymentRouter();
    const ranked = await router.rank([
      makeOption({ network: 'ethereum', maxAmountRequired: '1.00' }),
      makeOption({ network: 'base', maxAmountRequired: '1.00' }),
      makeOption({ network: 'arbitrum', maxAmountRequired: '1.00' }),
    ]);
    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].option.network, 'base', 'Base should be cheapest');
    assert.equal(ranked[2].option.network, 'ethereum', 'Ethereum should be most expensive');
  });

  it('uses custom PriceFeed', async () => {
    const router = new PaymentRouter({
      priceFeed: {
        getAssetPriceUsd: (asset) => asset === 'EURC' ? 1.10 : 1.0,
        getNetworkFeeUsd: () => 0.001,
      },
    });
    const result = await router.select([
      makeOption({ asset: 'USDC', maxAmountRequired: '1.00' }),
      makeOption({ asset: 'EURC', maxAmountRequired: '1.00' }),
    ]);
    assert.ok(result);
    // USDC at $1.00 vs EURC at $1.10 — USDC is cheaper
    assert.equal(result.option.asset, 'USDC');
  });
});
