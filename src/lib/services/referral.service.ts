import { pool } from '@/lib/db/client';
import crypto from 'crypto';

export interface ReferralCode {
  id: string;
  userId: string;
  code: string;
  rewardAmount: number;
  claimedCount: number;
}

export interface ReferralAnalytics {
  totalReferrals: number;
  completedReferrals: number;
  pendingReferrals: number;
  totalRewardsEarned: number;
  conversionRate: number;
}

export interface LeaderboardEntry {
  userId: string;
  totalReferrals: number;
  totalRewardsEarned: number;
  rank: number;
}

export interface FraudCheckResult {
  suspicious: boolean;
  reasons: string[];
}

function generateReferralCode(): string {
  return crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 10);
}

export async function createReferralCode(
  userId: string,
  rewardAmount: number = 5,
) {
  const code = generateReferralCode();
  const result = await pool.query(
    `INSERT INTO referral_codes (user_id, code, reward_amount)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, code, rewardAmount],
  );
  return result.rows[0];
}

export async function getReferralCode(userId: string) {
  const result = await pool.query(
    `SELECT * FROM referral_codes WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0];
}

export async function trackReferral(referralCode: string, referredUserId: string) {
  const codeRecord = await pool.query(
    `SELECT * FROM referral_codes WHERE code = $1`,
    [referralCode],
  );

  if (!codeRecord.rows[0]) {
    throw new Error('Invalid referral code');
  }

  const referrerId = codeRecord.rows[0].user_id;
  const rewardAmount = codeRecord.rows[0].reward_amount;

  const result = await pool.query(
    `INSERT INTO referral_rewards (referrer_id, referred_user_id, referral_code, reward_amount, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING *`,
    [referrerId, referredUserId, referralCode, rewardAmount],
  );

  await pool.query(
    `UPDATE referral_codes SET claimed_count = claimed_count + 1 WHERE code = $1`,
    [referralCode],
  );

  return result.rows[0];
}

export async function getReferralStats(userId: string) {
  const rewards = await pool.query(
    `SELECT COUNT(*) as total_referrals, SUM(reward_amount) as total_rewards
     FROM referral_rewards WHERE referrer_id = $1 AND status = 'completed'`,
    [userId],
  );
  return rewards.rows[0];
}

/** Compute the reward amount for a referral based on tier thresholds. */
export function calculateReward(
  baseReward: number,
  claimedCount: number,
): number {
  if (claimedCount >= 50) return baseReward * 3;
  if (claimedCount >= 20) return baseReward * 2;
  if (claimedCount >= 10) return baseReward * 1.5;
  return baseReward;
}

/** Mark a pending referral reward as completed and credit the referrer. */
export async function distributeReward(referralId: string) {
  const existing = await pool.query(
    `SELECT * FROM referral_rewards WHERE id = $1`,
    [referralId],
  );

  if (!existing.rows[0]) {
    throw new Error('Referral reward not found');
  }

  if (existing.rows[0].status !== 'pending') {
    throw new Error('Reward already processed');
  }

  const result = await pool.query(
    `UPDATE referral_rewards
     SET status = 'completed', distributed_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [referralId],
  );

  return result.rows[0];
}

export async function getReferralAnalytics(userId: string): Promise<ReferralAnalytics> {
  const result = await pool.query(
    `SELECT
       COUNT(*) as total_referrals,
       COUNT(*) FILTER (WHERE status = 'completed') as completed_referrals,
       COUNT(*) FILTER (WHERE status = 'pending') as pending_referrals,
       COALESCE(SUM(reward_amount) FILTER (WHERE status = 'completed'), 0) as total_rewards_earned
     FROM referral_rewards
     WHERE referrer_id = $1`,
    [userId],
  );

  const row = result.rows[0];
  const total = Number(row.total_referrals);
  const completed = Number(row.completed_referrals);

  return {
    totalReferrals: total,
    completedReferrals: completed,
    pendingReferrals: Number(row.pending_referrals),
    totalRewardsEarned: Number(row.total_rewards_earned),
    conversionRate: total > 0 ? completed / total : 0,
  };
}

export async function getReferralLeaderboard(limit: number = 10): Promise<LeaderboardEntry[]> {
  const result = await pool.query(
    `SELECT
       referrer_id as user_id,
       COUNT(*) as total_referrals,
       COALESCE(SUM(reward_amount) FILTER (WHERE status = 'completed'), 0) as total_rewards_earned
     FROM referral_rewards
     GROUP BY referrer_id
     ORDER BY total_referrals DESC, total_rewards_earned DESC
     LIMIT $1`,
    [limit],
  );

  return result.rows.map((row, index) => ({
    userId: row.user_id,
    totalReferrals: Number(row.total_referrals),
    totalRewardsEarned: Number(row.total_rewards_earned),
    rank: index + 1,
  }));
}

/** Detect suspicious referral activity for a given user. */
export async function detectReferralFraud(
  userId: string,
  referralCode: string,
): Promise<FraudCheckResult> {
  const reasons: string[] = [];

  // Check if user is referring themselves
  const codeOwner = await pool.query(
    `SELECT user_id FROM referral_codes WHERE code = $1`,
    [referralCode],
  );
  if (codeOwner.rows[0]?.user_id === userId) {
    reasons.push('Self-referral detected');
  }

  // Check for multiple referral attempts by the same user
  const previousAttempts = await pool.query(
    `SELECT COUNT(*) as attempt_count
     FROM referral_rewards
     WHERE referred_user_id = $1`,
    [userId],
  );
  if (Number(previousAttempts.rows[0]?.attempt_count) > 0) {
    reasons.push('User already used a referral code');
  }

  // Check for rapid referral creation (more than 5 in the last hour from referrer)
  if (codeOwner.rows[0]?.user_id) {
    const recentReferrals = await pool.query(
      `SELECT COUNT(*) as recent_count
       FROM referral_rewards
       WHERE referrer_id = $1
         AND created_at >= NOW() - INTERVAL '1 hour'`,
      [codeOwner.rows[0].user_id],
    );
    if (Number(recentReferrals.rows[0]?.recent_count) >= 5) {
      reasons.push('Referrer has unusually high referral rate in the last hour');
    }
  }

  return { suspicious: reasons.length > 0, reasons };
}
