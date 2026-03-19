import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { JsonFileStorage } from '../src/storage.js';

const TMP_DIR = join(import.meta.dirname ?? '.', '..', '.test-tmp');
const TMP_FILE = join(TMP_DIR, 'test-ledger.json');

function cleanup() {
  try { if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true }); } catch {}
}

function makeEntry(overrides: Partial<any> = {}) {
  return {
    timestamp: new Date().toISOString(),
    url: 'https://api.test.com/data',
    amount: '0.25',
    currency: 'USDC',
    network: 'base',
    status: 'paid' as const,
    reason: 'ok',
    ...overrides,
  };
}

test('storage: load returns empty array for nonexistent file', () => {
  cleanup();
  const storage = new JsonFileStorage(TMP_FILE);
  const entries = storage.load();
  assert.deepEqual(entries, []);
  cleanup();
});

test('storage: append creates file and persists entry', () => {
  cleanup();
  const storage = new JsonFileStorage(TMP_FILE);
  const entry = makeEntry();

  storage.append(entry);

  assert.ok(existsSync(TMP_FILE));
  const loaded = storage.load();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].amount, '0.25');
  cleanup();
});

test('storage: append accumulates entries', () => {
  cleanup();
  const storage = new JsonFileStorage(TMP_FILE);

  storage.append(makeEntry({ amount: '0.10' }));
  storage.append(makeEntry({ amount: '0.20' }));
  storage.append(makeEntry({ amount: '0.30' }));

  const loaded = storage.load();
  assert.equal(loaded.length, 3);
  assert.equal(loaded[0].amount, '0.10');
  assert.equal(loaded[2].amount, '0.30');
  cleanup();
});

test('storage: save overwrites all entries', () => {
  cleanup();
  const storage = new JsonFileStorage(TMP_FILE);

  storage.append(makeEntry({ amount: '0.10' }));
  storage.append(makeEntry({ amount: '0.20' }));

  storage.save([makeEntry({ amount: '9.99' })]);

  const loaded = storage.load();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].amount, '9.99');
  cleanup();
});

test('storage: survives corrupt file gracefully', () => {
  cleanup();
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_FILE, 'not json at all!!!', 'utf-8');

  const storage = new JsonFileStorage(TMP_FILE);
  const loaded = storage.load();
  assert.deepEqual(loaded, []);
  cleanup();
});

test('storage: creates nested directories', () => {
  const deepPath = join(TMP_DIR, 'a', 'b', 'c', 'ledger.json');
  cleanup();

  const storage = new JsonFileStorage(deepPath);
  storage.append(makeEntry());

  assert.ok(existsSync(deepPath));
  cleanup();
});
