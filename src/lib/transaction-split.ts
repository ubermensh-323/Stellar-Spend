/**
 * Transaction splitting — split a single USDC amount across multiple beneficiaries.
 * All amounts are in USDC (string decimals). Percentages must sum to 100.
 */

export interface SplitFeeBreakdown {
  baseFee: number;
  perRecipientFee: number;
  totalFee: number;
  netAmount: number;
}

export interface SplitReconciliation {
  splitId: string;
  reconciledAt: number;
  expectedTotal: number;
  executedTotal: number;
  variance: number;
  status: 'balanced' | 'over' | 'under';
  recipientBreakdown: Record<string, { expected: number; executed: number; variance: number }>;
}

export interface SplitAnalytics {
  totalSplits: number;
  completedSplits: number;
  partialSplits: number;
  failedSplits: number;
  totalVolumeUsdc: number;
  averageRecipientsPerSplit: number;
  successRate: number;
}

export interface SplitRecipient {
  id: string;
  label: string;
  /** Percentage of the total (0–100, must sum to 100 across all recipients) */
  percentage: number;
  /** Resolved USDC amount (computed from percentage × total) */
  amount?: string;
}

export interface SplitTransaction {
  id: string;
  createdAt: number;
  totalAmount: string;
  currency: string;
  recipients: SplitRecipient[];
  status: 'pending' | 'partial' | 'completed' | 'failed';
  /** Per-recipient execution results */
  results: Record<string, { status: 'pending' | 'completed' | 'failed'; error?: string }>;
}

const STORAGE_KEY = 'stellar_spend_splits';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function validateSplit(recipients: SplitRecipient[]): string | null {
  if (recipients.length < 2) return 'At least 2 recipients required';
  const total = recipients.reduce((s, r) => s + r.percentage, 0);
  if (Math.abs(total - 100) > 0.01) return `Percentages must sum to 100 (currently ${total.toFixed(2)})`;
  if (recipients.some((r) => r.percentage <= 0)) return 'Each recipient must have a positive percentage';
  return null;
}

export function computeSplitAmounts(
  totalAmount: string,
  recipients: SplitRecipient[],
): SplitRecipient[] {
  const total = parseFloat(totalAmount);
  if (isNaN(total) || total <= 0) return recipients;
  return recipients.map((r) => ({
    ...r,
    amount: ((total * r.percentage) / 100).toFixed(2),
  }));
}

export function deriveSplitStatus(
  results: SplitTransaction['results'],
  recipientCount: number,
): SplitTransaction['status'] {
  const values = Object.values(results);
  if (values.length === 0) return 'pending';
  const completed = values.filter((v) => v.status === 'completed').length;
  const failed = values.filter((v) => v.status === 'failed').length;
  if (completed === recipientCount) return 'completed';
  if (failed === recipientCount) return 'failed';
  if (completed + failed === recipientCount) return 'partial';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export class SplitStorage {
  static getAll(): SplitTransaction[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  static save(split: SplitTransaction): void {
    if (typeof window === 'undefined') return;
    const all = this.getAll().filter((s) => s.id !== split.id);
    all.unshift(split);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, 20)));
  }

  static updateResult(
    splitId: string,
    recipientId: string,
    result: { status: 'completed' | 'failed'; error?: string },
  ): void {
    const all = this.getAll();
    const idx = all.findIndex((s) => s.id === splitId);
    if (idx === -1) return;
    all[idx].results[recipientId] = result;
    all[idx].status = deriveSplitStatus(all[idx].results, all[idx].recipients.length);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  static generateId(): string {
    return `split_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  static getById(splitId: string): SplitTransaction | undefined {
    return this.getAll().find((s) => s.id === splitId);
  }

  static getAnalytics(): SplitAnalytics {
    const all = this.getAll();
    const completed = all.filter((s) => s.status === 'completed').length;
    const partial = all.filter((s) => s.status === 'partial').length;
    const failed = all.filter((s) => s.status === 'failed').length;
    const totalVolume = all.reduce((sum, s) => sum + parseFloat(s.totalAmount || '0'), 0);
    const avgRecipients = all.length ? all.reduce((sum, s) => sum + s.recipients.length, 0) / all.length : 0;

    return {
      totalSplits: all.length,
      completedSplits: completed,
      partialSplits: partial,
      failedSplits: failed,
      totalVolumeUsdc: parseFloat(totalVolume.toFixed(6)),
      averageRecipientsPerSplit: parseFloat(avgRecipients.toFixed(2)),
      successRate: all.length ? completed / all.length : 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Fee calculation
// ---------------------------------------------------------------------------

export function calculateSplitFees(totalAmount: string, recipientCount: number): SplitFeeBreakdown {
  const BASE_FEE = 0.5; // flat base fee in USDC
  const PER_RECIPIENT_FEE = 0.1; // per recipient fee
  const total = parseFloat(totalAmount);

  const baseFee = BASE_FEE;
  const perRecipientFee = PER_RECIPIENT_FEE * recipientCount;
  const totalFee = parseFloat((baseFee + perRecipientFee).toFixed(6));
  const netAmount = parseFloat((total - totalFee).toFixed(6));

  return { baseFee, perRecipientFee, totalFee, netAmount };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export async function executeSplit(
  splitId: string,
  executeRecipient: (recipientId: string, amount: string) => Promise<void>,
): Promise<SplitTransaction> {
  const split = SplitStorage.getById(splitId);
  if (!split) throw new Error(`Split ${splitId} not found`);

  const withAmounts = computeSplitAmounts(split.totalAmount, split.recipients);

  for (const recipient of withAmounts) {
    try {
      await executeRecipient(recipient.id, recipient.amount ?? '0');
      SplitStorage.updateResult(splitId, recipient.id, { status: 'completed' });
    } catch (err) {
      SplitStorage.updateResult(splitId, recipient.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return SplitStorage.getById(splitId) ?? split;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export function reconcileSplit(splitId: string): SplitReconciliation | null {
  const split = SplitStorage.getById(splitId);
  if (!split) return null;

  const withAmounts = computeSplitAmounts(split.totalAmount, split.recipients);
  const expectedTotal = parseFloat(split.totalAmount);
  let executedTotal = 0;
  const recipientBreakdown: SplitReconciliation['recipientBreakdown'] = {};

  for (const r of withAmounts) {
    const expected = parseFloat(r.amount ?? '0');
    const resultStatus = split.results[r.id]?.status;
    const executed = resultStatus === 'completed' ? expected : 0;
    executedTotal += executed;
    recipientBreakdown[r.id] = {
      expected,
      executed,
      variance: parseFloat((executed - expected).toFixed(6)),
    };
  }

  const variance = parseFloat((executedTotal - expectedTotal).toFixed(6));
  const status = variance === 0 ? 'balanced' : variance > 0 ? 'over' : 'under';

  return {
    splitId,
    reconciledAt: Date.now(),
    expectedTotal,
    executedTotal: parseFloat(executedTotal.toFixed(6)),
    variance,
    status,
    recipientBreakdown,
  };
}
