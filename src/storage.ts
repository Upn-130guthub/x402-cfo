/**
 * Persistent storage adapter for x402-cfo.
 *
 * By default everything is in-memory. This interface lets users
 * plug in file-based, SQLite, or any other storage so ledger
 * history survives agent restarts.
 *
 * Ships with a built-in JSON file adapter.
 */

import type { LedgerEntry } from './ledger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/** Storage adapter interface — implement this for custom backends. */
export interface StorageAdapter {
  /** Load all ledger entries. */
  load(): LedgerEntry[] | Promise<LedgerEntry[]>;
  /** Append a single entry. */
  append(entry: LedgerEntry): void | Promise<void>;
  /** Save all entries (full sync). */
  save(entries: LedgerEntry[]): void | Promise<void>;
}

/**
 * JSON file storage adapter.
 *
 * Simple, zero-dependency persistence. Writes a JSON file on every
 * append so no data is lost. Good enough for single-agent setups.
 *
 * Usage:
 *   const agent = new AgentCFO({
 *     wallet: myWallet,
 *     storage: new JsonFileStorage('./agent-ledger.json'),
 *   });
 */
export class JsonFileStorage implements StorageAdapter {
  private path: string;

  constructor(filePath: string) {
    this.path = filePath;
  }

  load(): LedgerEntry[] {
    if (!existsSync(this.path)) return [];
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  append(entry: LedgerEntry): void {
    const entries = this.load();
    entries.push(entry);
    this.save(entries);
  }

  save(entries: LedgerEntry[]): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.path, JSON.stringify(entries, null, 2), 'utf-8');
  }
}
