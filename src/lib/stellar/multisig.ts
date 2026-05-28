/**
 * Multi-signature Stellar wallet support.
 *
 * Stellar supports multi-sig via account thresholds and signers. A transaction
 * requires accumulated signature weights >= the operation threshold before it
 * can be submitted to the network.
 *
 * Reference: https://developers.stellar.org/docs/learn/encyclopedia/signatures-multisig
 */

import crypto from 'crypto';

export interface MultiSigSigner {
  publicKey: string;
  weight: number;
}

export interface MultiSigConfig {
  /** Account public key that owns the transaction */
  accountId: string;
  /** Required accumulated weight to authorise operations */
  threshold: number;
  /** Authorised signers and their weights */
  signers: MultiSigSigner[];
}

export interface PartialSignature {
  id: string;
  transactionId: string;
  signerPublicKey: string;
  /** Base64-encoded XDR signature */
  signatureXdr: string;
  weight: number;
  collectedAt: number;
  /** Millisecond epoch after which this partial signature is no longer valid */
  expiresAt: number;
}

export interface MultiSigTransactionStatus {
  transactionId: string;
  transactionXdr: string;
  config: MultiSigConfig;
  partialSignatures: PartialSignature[];
  accumulatedWeight: number;
  isReady: boolean;
  createdAt: number;
  /** Expiration in ms epoch — once expired, collected signatures must be discarded */
  expiresAt: number;
}

export type MultiSigStatusCode =
  | 'pending'       // waiting for more signatures
  | 'ready'         // threshold met, ready to submit
  | 'expired'       // signature collection window closed
  | 'submitted';    // submitted to Stellar network

/** Default window for collecting signatures: 24 hours */
const DEFAULT_SIGNATURE_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** In-memory store keyed by transactionId. Replace with DB persistence in production. */
const _store = new Map<string, MultiSigTransactionStatus>();

/**
 * Initialises a new multi-sig transaction collection session.
 */
export function createMultiSigTransaction(
  transactionId: string,
  transactionXdr: string,
  config: MultiSigConfig,
  expiryMs = DEFAULT_SIGNATURE_EXPIRY_MS,
): MultiSigTransactionStatus {
  const now = Date.now();
  const entry: MultiSigTransactionStatus = {
    transactionId,
    transactionXdr,
    config,
    partialSignatures: [],
    accumulatedWeight: 0,
    isReady: false,
    createdAt: now,
    expiresAt: now + expiryMs,
  };
  _store.set(transactionId, entry);
  return entry;
}

/**
 * Adds a partial signature from one of the authorised signers.
 * Returns the updated status, or throws if the signer is not authorised, the
 * signature collection window has closed, or the signer has already signed.
 */
export function addPartialSignature(
  transactionId: string,
  signerPublicKey: string,
  signatureXdr: string,
  signatureExpiryMs = DEFAULT_SIGNATURE_EXPIRY_MS,
): MultiSigTransactionStatus {
  const entry = _store.get(transactionId);
  if (!entry) throw new Error(`Multi-sig transaction ${transactionId} not found`);

  if (Date.now() > entry.expiresAt) {
    throw new Error(`Signature collection window for transaction ${transactionId} has expired`);
  }

  const signer = entry.config.signers.find((s) => s.publicKey === signerPublicKey);
  if (!signer) {
    throw new Error(`Signer ${signerPublicKey} is not authorised for transaction ${transactionId}`);
  }

  const alreadySigned = entry.partialSignatures.some((p) => p.signerPublicKey === signerPublicKey);
  if (alreadySigned) {
    throw new Error(`Signer ${signerPublicKey} has already submitted a signature for transaction ${transactionId}`);
  }

  const now = Date.now();
  const partial: PartialSignature = {
    id: `sig_${crypto.randomBytes(8).toString('hex')}`,
    transactionId,
    signerPublicKey,
    signatureXdr,
    weight: signer.weight,
    collectedAt: now,
    expiresAt: now + signatureExpiryMs,
  };

  entry.partialSignatures.push(partial);
  entry.accumulatedWeight = entry.partialSignatures
    .filter((p) => Date.now() <= p.expiresAt)
    .reduce((sum, p) => sum + p.weight, 0);
  entry.isReady = entry.accumulatedWeight >= entry.config.threshold;

  return entry;
}

/**
 * Verifies that all collected partial signatures are still within their expiry
 * window and removes any that have expired. Re-computes accumulated weight.
 */
export function pruneExpiredSignatures(transactionId: string): MultiSigTransactionStatus {
  const entry = _store.get(transactionId);
  if (!entry) throw new Error(`Multi-sig transaction ${transactionId} not found`);

  const now = Date.now();
  entry.partialSignatures = entry.partialSignatures.filter((p) => now <= p.expiresAt);
  entry.accumulatedWeight = entry.partialSignatures.reduce((sum, p) => sum + p.weight, 0);
  entry.isReady = entry.accumulatedWeight >= entry.config.threshold;

  return entry;
}

/**
 * Returns the current status of a multi-sig transaction, including whether
 * the threshold has been met and which signers have yet to sign.
 */
export function getMultiSigStatus(transactionId: string): MultiSigTransactionStatus | null {
  return _store.get(transactionId) ?? null;
}

/**
 * Returns the status code for a multi-sig transaction.
 */
export function getMultiSigStatusCode(transactionId: string): MultiSigStatusCode {
  const entry = _store.get(transactionId);
  if (!entry) return 'expired';
  if (Date.now() > entry.expiresAt) return 'expired';
  if (entry.isReady) return 'ready';
  return 'pending';
}

/**
 * Returns the list of signers who have not yet signed.
 */
export function getPendingSigners(transactionId: string): MultiSigSigner[] {
  const entry = _store.get(transactionId);
  if (!entry) return [];
  const signed = new Set(entry.partialSignatures.map((p) => p.signerPublicKey));
  return entry.config.signers.filter((s) => !signed.has(s.publicKey));
}

/**
 * Validates a multi-sig configuration: checks that the threshold can
 * theoretically be reached by the listed signers.
 */
export function validateMultiSigConfig(config: MultiSigConfig): { valid: boolean; reason?: string } {
  if (config.threshold <= 0) return { valid: false, reason: 'Threshold must be greater than 0' };
  if (config.signers.length === 0) return { valid: false, reason: 'At least one signer is required' };

  const maxWeight = config.signers.reduce((sum, s) => sum + s.weight, 0);
  if (maxWeight < config.threshold) {
    return {
      valid: false,
      reason: `Combined signer weight (${maxWeight}) can never reach the threshold (${config.threshold})`,
    };
  }

  const invalidSigner = config.signers.find((s) => s.weight <= 0);
  if (invalidSigner) {
    return { valid: false, reason: `Signer ${invalidSigner.publicKey} has an invalid weight (${invalidSigner.weight})` };
  }

  return { valid: true };
}

/**
 * Removes a completed or expired multi-sig transaction from the store.
 */
export function removeMultiSigTransaction(transactionId: string): void {
  _store.delete(transactionId);
}

/** Exposed for testing only */
export function _clearMultiSigStore(): void {
  _store.clear();
}
