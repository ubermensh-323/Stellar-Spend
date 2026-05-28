import { db } from '@/lib/db/client';

export interface InsuranceQuote {
  premium: number;
  coverage: number;
  provider: string;
  riskScore: number;
  expiresAt: number;
}

export interface InsuranceClaim {
  claimId: string;
  insuranceId: string;
  reason: string;
  amount: number;
  status: 'filed' | 'under_review' | 'approved' | 'rejected' | 'paid';
  filedAt: number;
  reviewedAt?: number;
  paidAt?: number;
  evidence?: string;
}

export interface InsuranceAnalytics {
  totalPolicies: number;
  activePolicies: number;
  totalPremiumsCollected: number;
  totalClaimsPaid: number;
  claimRate: number;
  averagePremium: number;
}

const PROVIDERS = ['default', 'premium', 'enterprise'];
const BASE_PREMIUM_RATE = 0.005; // 0.5%
const HIGH_VALUE_THRESHOLD = 10000;
const HIGH_VALUE_RATE = 0.003; // 0.3% for high-value (bulk discount)

export function calculateRiskScore(amount: number, currency: string): number {
  let score = 50;
  if (amount > HIGH_VALUE_THRESHOLD) score -= 10;
  if (amount < 100) score += 10;
  const stablecoins = ['USDC', 'USDT', 'DAI'];
  if (stablecoins.includes(currency.toUpperCase())) score -= 5;
  return Math.max(0, Math.min(100, score));
}

export async function calculateInsurancePremium(
  amount: number,
  currency: string
): Promise<InsuranceQuote> {
  const riskScore = calculateRiskScore(amount, currency);
  const rate = amount >= HIGH_VALUE_THRESHOLD ? HIGH_VALUE_RATE : BASE_PREMIUM_RATE;
  const riskMultiplier = 1 + (riskScore - 50) / 500;
  const premium = parseFloat((amount * rate * riskMultiplier).toFixed(6));
  const coverage = parseFloat((amount * 1.1).toFixed(6));
  const provider = amount >= HIGH_VALUE_THRESHOLD ? 'enterprise' : amount >= 1000 ? 'premium' : 'default';

  return {
    premium,
    coverage,
    provider,
    riskScore,
    expiresAt: Date.now() + 15 * 60 * 1000, // quote valid 15 min
  };
}

export async function createInsurance(
  transactionId: string,
  premium: number,
  coverage: number,
  provider: string
) {
  return db.query(
    `INSERT INTO transaction_insurance (transaction_id, premium_amount, coverage_amount, provider, status, created_at)
     VALUES ($1, $2, $3, $4, 'active', NOW())
     RETURNING *`,
    [transactionId, premium, coverage, provider]
  );
}

export async function getInsuranceStatus(transactionId: string) {
  return db.query(
    `SELECT * FROM transaction_insurance WHERE transaction_id = $1`,
    [transactionId]
  );
}

export async function getInsuranceById(insuranceId: string) {
  return db.query(
    `SELECT * FROM transaction_insurance WHERE id = $1`,
    [insuranceId]
  );
}

export async function fileClaim(insuranceId: string, reason: string, evidence?: string) {
  const claimId = `CLAIM-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  return db.query(
    `UPDATE transaction_insurance
     SET status = 'claimed', claim_id = $1, claim_reason = $2, claim_evidence = $3, claimed_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [claimId, reason, evidence || null, insuranceId]
  );
}

export async function verifyClaim(insuranceId: string): Promise<{ valid: boolean; reason?: string }> {
  const result = await db.query(
    `SELECT ti.*, t.amount, t.status as tx_status
     FROM transaction_insurance ti
     LEFT JOIN transactions t ON t.id = ti.transaction_id
     WHERE ti.id = $1`,
    [insuranceId]
  );

  const row = (result as { rows: Record<string, unknown>[] }).rows?.[0];
  if (!row) return { valid: false, reason: 'Insurance record not found' };
  if (row.status !== 'claimed') return { valid: false, reason: 'No active claim on this policy' };
  if (!row.claim_reason) return { valid: false, reason: 'Claim has no stated reason' };

  return { valid: true };
}

export async function approveClaim(insuranceId: string) {
  const verification = await verifyClaim(insuranceId);
  if (!verification.valid) {
    throw new Error(verification.reason || 'Claim verification failed');
  }

  return db.query(
    `UPDATE transaction_insurance
     SET status = 'claim_approved', approved_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [insuranceId]
  );
}

export async function rejectClaim(insuranceId: string, rejectionReason: string) {
  return db.query(
    `UPDATE transaction_insurance
     SET status = 'claim_rejected', rejection_reason = $1, reviewed_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [rejectionReason, insuranceId]
  );
}

export async function processInsurancePayout(insuranceId: string) {
  const result = await db.query(
    `SELECT * FROM transaction_insurance WHERE id = $1`,
    [insuranceId]
  );

  const row = (result as { rows: Record<string, unknown>[] }).rows?.[0];
  if (!row) throw new Error('Insurance record not found');
  if (row.status !== 'claim_approved') throw new Error('Claim must be approved before payout');

  const payoutRef = `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

  return db.query(
    `UPDATE transaction_insurance
     SET status = 'paid', payout_reference = $1, paid_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [payoutRef, insuranceId]
  );
}

export async function getInsuranceAnalytics(): Promise<InsuranceAnalytics> {
  const result = await db.query(
    `SELECT
       COUNT(*) as total_policies,
       COUNT(*) FILTER (WHERE status = 'active') as active_policies,
       COALESCE(SUM(premium_amount), 0) as total_premiums,
       COALESCE(SUM(coverage_amount) FILTER (WHERE status = 'paid'), 0) as total_paid,
       COUNT(*) FILTER (WHERE status IN ('claimed', 'claim_approved', 'claim_rejected', 'paid')) as total_claims
     FROM transaction_insurance`,
    []
  );

  const row = (result as { rows: Record<string, number>[] }).rows?.[0] ?? {};
  const total = Number(row.total_policies) || 0;
  const claims = Number(row.total_claims) || 0;

  return {
    totalPolicies: total,
    activePolicies: Number(row.active_policies) || 0,
    totalPremiumsCollected: Number(row.total_premiums) || 0,
    totalClaimsPaid: Number(row.total_paid) || 0,
    claimRate: total ? claims / total : 0,
    averagePremium: total ? Number(row.total_premiums) / total : 0,
  };
}
