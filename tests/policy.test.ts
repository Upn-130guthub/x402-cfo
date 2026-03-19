import test from 'node:test';
import assert from 'node:assert/strict';
import { Policy } from '../src/policy.js';

test('policy: allows when no rules set', () => {
  const p = new Policy({});
  const d = p.check({ url: 'https://example.com/api', amount: 100, currency: 'USDC', network: 'base' });
  assert.equal(d.allowed, true);
});

test('policy: denies over max per request', () => {
  const p = new Policy({ maxPerRequest: 1.00 });
  const d = p.check({ url: 'https://example.com/api', amount: 2.00, currency: 'USDC', network: 'base' });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'exceeds_max_per_request');
});

test('policy: denies URL not in allowlist', () => {
  const p = new Policy({ allowlist: ['api.trusted.com'] });
  const d = p.check({ url: 'https://api.untrusted.com/data', amount: 0.10, currency: 'USDC', network: 'base' });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'url_not_in_allowlist');
});

test('policy: allows URL in allowlist', () => {
  const p = new Policy({ allowlist: ['api.trusted.com'] });
  const d = p.check({ url: 'https://api.trusted.com/data', amount: 0.10, currency: 'USDC', network: 'base' });
  assert.equal(d.allowed, true);
});

test('policy: denies URL in blocklist', () => {
  const p = new Policy({ blocklist: ['api.evil.com'] });
  const d = p.check({ url: 'https://api.evil.com/steal', amount: 0.01, currency: 'USDC', network: 'base' });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'url_in_blocklist');
});

test('policy: denies disallowed currency', () => {
  const p = new Policy({ allowedCurrencies: ['USDC'] });
  const d = p.check({ url: 'https://example.com/api', amount: 0.10, currency: 'DOGE', network: 'base' });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'currency_not_allowed');
});

test('policy: denies disallowed network', () => {
  const p = new Policy({ allowedNetworks: ['base', 'ethereum'] });
  const d = p.check({ url: 'https://example.com/api', amount: 0.10, currency: 'USDC', network: 'solana' });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'network_not_allowed');
});

test('policy: combined rules all must pass', () => {
  const p = new Policy({
    maxPerRequest: 5.00,
    allowedCurrencies: ['USDC'],
    allowedNetworks: ['base'],
  });
  // All rules pass
  const d1 = p.check({ url: 'https://example.com/api', amount: 1.00, currency: 'USDC', network: 'base' });
  assert.equal(d1.allowed, true);
  // Amount fails
  const d2 = p.check({ url: 'https://example.com/api', amount: 10.00, currency: 'USDC', network: 'base' });
  assert.equal(d2.allowed, false);
});
