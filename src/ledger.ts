/**
 * Append-only spend ledger for x402-cfo agent.
 *
 * Records every payment decision — approved, denied, or failed —
 * with full context. This is the audit trail.
 */

export type LedgerEntryStatus = 'paid' | 'denied' | 'failed';

export interface LedgerEntry {
  /** ISO timestamp */
  timestamp: string;
  /** URL that was requested */
  url: string;
  /** Amount in dollars (e.g. "0.25") */
  amount: string;
  /** Currency (e.g. "USDC") */
  currency: string;
  /** Network (e.g. "base") */
  network: string;
  /** Payment status */
  status: LedgerEntryStatus;
  /** Human-readable reason (e.g. "budget approved" or "exceeds_hourly_limit") */
  reason: string;
  /** HTTP status code received (402, 200, etc.) */
  httpStatus?: number;
  /** Challenge ID if applicable */
  challengeId?: string;
  /** Transaction hash if payment was made */
  txHash?: string;
  /** Anomaly detection result at decision time, if anomaly check ran */
  anomalyResult?: {
    isAnomaly: boolean;
    zScore: number;
    baseline: number;
    multiplier: number;
    mode: 'enforce' | 'review' | 'off';
  };
}

export class Ledger {
  private entries: LedgerEntry[] = [];

  /** Record a ledger entry. */
  record(entry: LedgerEntry): void {
    this.entries.push(entry);
  }

  /** Get all entries. */
  all(): readonly LedgerEntry[] {
    return this.entries;
  }

  /** Get entries by status. */
  byStatus(status: LedgerEntryStatus): LedgerEntry[] {
    return this.entries.filter(e => e.status === status);
  }

  /** Get entries for a specific URL. */
  byUrl(url: string): LedgerEntry[] {
    return this.entries.filter(e => e.url === url);
  }

  /** Total number of entries. */
  get size(): number {
    return this.entries.length;
  }

  /** Export to JSON string. */
  toJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /** Export to CSV string. */
  toCSV(): string {
    if (this.entries.length === 0) return '';
    const headers = ['timestamp', 'url', 'amount', 'currency', 'network', 'status', 'reason', 'httpStatus', 'challengeId', 'txHash'];
    const rows = this.entries.map(e =>
      headers.map(h => {
        const val = e[h as keyof LedgerEntry];
        if (val === undefined || val === null) return '';
        const str = String(val);
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }
}
