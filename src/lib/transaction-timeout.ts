/**
 * Transaction timeout detection, cancellation, and refund triggering.
 *
 * A transaction is considered timed out if it has been in 'pending' status
 * for longer than TRANSACTION_TIMEOUT_MS without completing.
 */
import { dal } from '@/lib/db/dal';
import type { Transaction } from '@/lib/transaction-storage';
import { processRefund } from '@/lib/refund/refund-service';
import { notifyTransactionStatusUpdate } from '@/lib/notifications/service';

/** Transactions pending longer than this are considered timed out (30 minutes) */
export const TRANSACTION_TIMEOUT_MS = 30 * 60 * 1000;

/** Bridge transfers get a longer timeout (60 minutes) to account for cross-chain latency */
export const BRIDGE_TIMEOUT_MS = 60 * 60 * 1000;

/** Paycrest orders time out after 45 minutes */
export const PAYCREST_TIMEOUT_MS = 45 * 60 * 1000;

export interface TimeoutCheckResult {
  transactionId: string;
  timedOut: boolean;
  ageMs: number;
  cancelled: boolean;
  refundTriggered: boolean;
  error?: string;
}

export interface TimeoutMetrics {
  totalChecked: number;
  timedOut: number;
  refundTriggered: number;
  refundFailed: number;
  errors: number;
  bridgeTimeouts: number;
  paycrestTimeouts: number;
}

const _metrics: TimeoutMetrics = {
  totalChecked: 0,
  timedOut: 0,
  refundTriggered: 0,
  refundFailed: 0,
  errors: 0,
  bridgeTimeouts: 0,
  paycrestTimeouts: 0,
};

export function getTimeoutMetrics(): Readonly<TimeoutMetrics> {
  return { ..._metrics };
}

export function resetTimeoutMetrics(): void {
  Object.assign(_metrics, {
    totalChecked: 0,
    timedOut: 0,
    refundTriggered: 0,
    refundFailed: 0,
    errors: 0,
    bridgeTimeouts: 0,
    paycrestTimeouts: 0,
  });
}

/** Returns the applicable timeout for a transaction based on its type */
function getTimeoutMs(tx: Transaction): number {
  if (tx.bridgeStatus !== undefined) return BRIDGE_TIMEOUT_MS;
  if (tx.payoutOrderId !== undefined) return PAYCREST_TIMEOUT_MS;
  return TRANSACTION_TIMEOUT_MS;
}

/**
 * Returns true if the transaction has exceeded the timeout threshold.
 */
export function isTransactionTimedOut(tx: Transaction, nowMs = Date.now()): boolean {
  if (tx.status !== 'pending') return false;
  return nowMs - tx.timestamp > getTimeoutMs(tx);
}

/** Returns 'bridge', 'paycrest', or 'standard' based on transaction type */
export function getTransactionTimeoutType(tx: Transaction): 'bridge' | 'paycrest' | 'standard' {
  if (tx.bridgeStatus !== undefined) return 'bridge';
  if (tx.payoutOrderId !== undefined) return 'paycrest';
  return 'standard';
}

/**
 * Cancels a timed-out transaction: marks it failed and triggers a refund.
 */
export async function cancelTimedOutTransaction(
  transactionId: string
): Promise<TimeoutCheckResult> {
  const now = Date.now();
  let tx: Transaction | null;

  try {
    tx = await dal.getById(transactionId);
  } catch (err) {
    return { transactionId, timedOut: false, ageMs: 0, cancelled: false, refundTriggered: false, error: String(err) };
  }

  if (!tx) {
    return { transactionId, timedOut: false, ageMs: 0, cancelled: false, refundTriggered: false, error: 'Transaction not found' };
  }

  const ageMs = now - tx.timestamp;

  if (!isTransactionTimedOut(tx, now)) {
    return { transactionId, timedOut: false, ageMs, cancelled: false, refundTriggered: false };
  }

  const timeoutType = getTransactionTimeoutType(tx);
  logTimeoutEvent(transactionId, tx.userAddress, ageMs, timeoutType);

  _metrics.timedOut++;
  if (timeoutType === 'bridge') _metrics.bridgeTimeouts++;
  if (timeoutType === 'paycrest') _metrics.paycrestTimeouts++;

  // Mark as failed/cancelled
  try {
    await dal.update(transactionId, { status: 'failed', error: 'Transaction timed out' });
    const updated = await dal.getById(transactionId);
    if (updated) {
      await notifyTransactionStatusUpdate({
        transaction: updated,
        previousStatus: tx.status,
        previousPayoutStatus: tx.payoutStatus,
        source: 'timeout',
      });
    }
  } catch (err) {
    _metrics.errors++;
    return { transactionId, timedOut: true, ageMs, cancelled: false, refundTriggered: false, error: String(err) };
  }

  // Trigger refund
  const refundResult = await processRefund(transactionId, 'timeout');

  if (refundResult.success) {
    _metrics.refundTriggered++;
  } else {
    _metrics.refundFailed++;
  }

  return {
    transactionId,
    timedOut: true,
    ageMs,
    cancelled: true,
    refundTriggered: refundResult.success,
    error: refundResult.success ? undefined : refundResult.error,
  };
}

/**
 * Checks all pending transactions for a user and cancels timed-out ones.
 */
export async function checkAndCancelTimedOutTransactions(
  userAddress: string
): Promise<TimeoutCheckResult[]> {
  let transactions: Transaction[];
  try {
    transactions = await dal.getByUser(userAddress);
  } catch {
    return [];
  }

  const pending = transactions.filter((tx) => tx.status === 'pending');
  _metrics.totalChecked += pending.length;
  const results = await Promise.all(
    pending.map((tx) => cancelTimedOutTransaction(tx.id))
  );
  return results.filter((r) => r.timedOut);
}

/**
 * Scans all provided transactions globally and cancels timed-out ones.
 * Use this for batch/scheduled timeout sweeps across all users.
 */
export async function scanAndCancelTimedOutTransactions(
  transactions: Transaction[]
): Promise<TimeoutCheckResult[]> {
  const pending = transactions.filter((tx) => tx.status === 'pending');
  _metrics.totalChecked += pending.length;
  const results = await Promise.all(
    pending.map((tx) => cancelTimedOutTransaction(tx.id))
  );
  return results.filter((r) => r.timedOut);
}

/**
 * Recovery procedure: attempts to retry a timed-out transaction instead of
 * immediately refunding. Returns false if recovery is not applicable.
 */
export async function attemptTimeoutRecovery(
  transactionId: string
): Promise<{ recovered: boolean; reason: string }> {
  let tx: Transaction | null;
  try {
    tx = await dal.getById(transactionId);
  } catch (err) {
    return { recovered: false, reason: String(err) };
  }

  if (!tx) return { recovered: false, reason: 'Transaction not found' };
  if (tx.status !== 'failed') return { recovered: false, reason: 'Transaction is not in failed state' };
  if (!tx.error?.includes('timed out')) return { recovered: false, reason: 'Transaction did not fail due to timeout' };

  // Only bridge transactions support recovery (re-queue)
  if (getTransactionTimeoutType(tx) !== 'bridge') {
    return { recovered: false, reason: 'Only bridge transactions support timeout recovery' };
  }

  try {
    await dal.update(transactionId, { status: 'pending', error: undefined });
    console.info(JSON.stringify({
      event: 'transaction.timeout_recovery',
      transactionId,
      userAddress: tx.userAddress,
      timestamp: new Date().toISOString(),
    }));
    return { recovered: true, reason: 'Transaction re-queued for bridge processing' };
  } catch (err) {
    return { recovered: false, reason: String(err) };
  }
}

/** Structured log for timeout events */
function logTimeoutEvent(
  transactionId: string,
  userAddress: string,
  ageMs: number,
  timeoutType: 'bridge' | 'paycrest' | 'standard' = 'standard'
): void {
  console.warn(JSON.stringify({
    event: 'transaction.timeout',
    transactionId,
    userAddress,
    ageMs,
    timeoutType,
    timestamp: new Date().toISOString(),
  }));
}
