/**
 * Loyalty program — reward frequent users with tier-based benefits.
 * Tiers are determined by cumulative USDC volume transacted.
 */

export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface TierConfig {
  tier: LoyaltyTier;
  label: string;
  minVolume: number;   // USDC
  color: string;
  benefits: string[];
  pointsMultiplier: number;
  feeDiscount: number;        // percentage (0–1)
  maxConcurrentSessions: number;
  withdrawalLimit: number;    // daily USDC
}

export interface LoyaltyProgramConfig {
  pointsPerUSDC: number;
  minRedemptionPoints: number;
  redemptionRate: number;     // points per $1 redemption value
  tierReviewPeriodDays: number;
  enabled: boolean;
}

export const DEFAULT_PROGRAM_CONFIG: LoyaltyProgramConfig = {
  pointsPerUSDC: 10,
  minRedemptionPoints: 500,
  redemptionRate: 100,        // 100 points = $1
  tierReviewPeriodDays: 30,
  enabled: true,
};

export const TIERS: TierConfig[] = [
  {
    tier: 'bronze',
    label: 'Bronze',
    minVolume: 0,
    color: '#cd7f32',
    benefits: ['Transaction history', 'Basic support'],
    pointsMultiplier: 1,
    feeDiscount: 0,
    maxConcurrentSessions: 2,
    withdrawalLimit: 1000,
  },
  {
    tier: 'silver',
    label: 'Silver',
    minVolume: 500,
    color: '#c0c0c0',
    benefits: ['Priority support', '0.1% fee discount'],
    pointsMultiplier: 1.5,
    feeDiscount: 0.001,
    maxConcurrentSessions: 3,
    withdrawalLimit: 5000,
  },
  {
    tier: 'gold',
    label: 'Gold',
    minVolume: 2000,
    color: '#c9a962',
    benefits: ['Dedicated support', '0.25% fee discount', 'Early access to features'],
    pointsMultiplier: 2,
    feeDiscount: 0.0025,
    maxConcurrentSessions: 5,
    withdrawalLimit: 20000,
  },
  {
    tier: 'platinum',
    label: 'Platinum',
    minVolume: 10000,
    color: '#e5e4e2',
    benefits: ['VIP support', '0.5% fee discount', 'Early access', 'Custom limits'],
    pointsMultiplier: 3,
    feeDiscount: 0.005,
    maxConcurrentSessions: 10,
    withdrawalLimit: 100000,
  },
];

export interface LoyaltyProfile {
  userAddress: string;
  totalVolume: number;   // cumulative USDC
  transactionCount: number;
  tier: LoyaltyTier;
  points: number;
  lifetimePoints: number;
  updatedAt: number;
}

export interface RedemptionRecord {
  id: string;
  userAddress: string;
  pointsRedeemed: number;
  usdcValue: number;
  redeemedAt: number;
}

export interface LoyaltyAnalytics {
  userAddress: string;
  totalVolume: number;
  transactionCount: number;
  tier: LoyaltyTier;
  points: number;
  lifetimePoints: number;
  pointsToNextTier: number | null;
  volumeToNextTier: number | null;
  tierBenefits: string[];
  feeDiscount: number;
  pointsMultiplier: number;
  redemptionHistory: RedemptionRecord[];
  estimatedMonthlyPoints: number;
}

const STORAGE_KEY = 'stellar_spend_loyalty';
const REDEMPTION_KEY = 'stellar_spend_loyalty_redemptions';
const CONFIG_KEY = 'stellar_spend_loyalty_config';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function getTierForVolume(volume: number): LoyaltyTier {
  const sorted = [...TIERS].sort((a, b) => b.minVolume - a.minVolume);
  return (sorted.find((t) => volume >= t.minVolume) ?? TIERS[0]).tier;
}

export function getTierConfig(tier: LoyaltyTier): TierConfig {
  return TIERS.find((t) => t.tier === tier) ?? TIERS[0];
}

export function getNextTier(tier: LoyaltyTier): TierConfig | null {
  const idx = TIERS.findIndex((t) => t.tier === tier);
  return idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
}

export function volumeToNextTier(profile: LoyaltyProfile): number | null {
  const next = getNextTier(profile.tier);
  if (!next) return null;
  return Math.max(0, next.minVolume - profile.totalVolume);
}

export function calculatePoints(usdcAmount: number, tier: LoyaltyTier, config: LoyaltyProgramConfig): number {
  const tierConfig = getTierConfig(tier);
  return Math.floor(usdcAmount * config.pointsPerUSDC * tierConfig.pointsMultiplier);
}

export function pointsToUSDC(points: number, config: LoyaltyProgramConfig): number {
  return points / config.redemptionRate;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export class LoyaltyStorage {
  static getConfig(): LoyaltyProgramConfig {
    if (typeof window === 'undefined') return DEFAULT_PROGRAM_CONFIG;
    try {
      const stored = localStorage.getItem(CONFIG_KEY);
      if (stored) return { ...DEFAULT_PROGRAM_CONFIG, ...JSON.parse(stored) };
    } catch {
      // ignore
    }
    return DEFAULT_PROGRAM_CONFIG;
  }

  static updateConfig(updates: Partial<LoyaltyProgramConfig>): LoyaltyProgramConfig {
    const current = this.getConfig();
    const updated = { ...current, ...updates };
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
    }
    return updated;
  }

  static get(userAddress: string): LoyaltyProfile {
    if (typeof window === 'undefined') return this._default(userAddress);
    try {
      const all: Record<string, LoyaltyProfile> = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? '{}',
      );
      return all[userAddress.toLowerCase()] ?? this._default(userAddress);
    } catch {
      return this._default(userAddress);
    }
  }

  static getAll(): LoyaltyProfile[] {
    if (typeof window === 'undefined') return [];
    try {
      const all: Record<string, LoyaltyProfile> = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? '{}',
      );
      return Object.values(all);
    } catch {
      return [];
    }
  }

  /**
   * Record a completed transaction, accumulate points, and return the updated profile.
   * Returns the new tier if it changed (for upgrade notification), else null.
   */
  static recordTransaction(
    userAddress: string,
    usdcAmount: number,
  ): { profile: LoyaltyProfile; upgradedTo: LoyaltyTier | null } {
    const config = this.getConfig();
    if (!config.enabled) {
      const profile = this.get(userAddress);
      return { profile, upgradedTo: null };
    }

    const prev = this.get(userAddress);
    const newVolume = prev.totalVolume + usdcAmount;
    const newTier = getTierForVolume(newVolume);
    const earnedPoints = calculatePoints(usdcAmount, newTier, config);

    const profile: LoyaltyProfile = {
      userAddress: userAddress.toLowerCase(),
      totalVolume: newVolume,
      transactionCount: prev.transactionCount + 1,
      tier: newTier,
      points: prev.points + earnedPoints,
      lifetimePoints: prev.lifetimePoints + earnedPoints,
      updatedAt: Date.now(),
    };
    this._save(profile);
    return {
      profile,
      upgradedTo: newTier !== prev.tier ? newTier : null,
    };
  }

  static redeemPoints(
    userAddress: string,
    pointsToRedeem: number,
  ): { success: boolean; usdcValue: number; profile: LoyaltyProfile; error?: string } {
    const config = this.getConfig();
    const profile = this.get(userAddress);

    if (pointsToRedeem < config.minRedemptionPoints) {
      return {
        success: false,
        usdcValue: 0,
        profile,
        error: `Minimum redemption is ${config.minRedemptionPoints} points`,
      };
    }

    if (profile.points < pointsToRedeem) {
      return {
        success: false,
        usdcValue: 0,
        profile,
        error: 'Insufficient points',
      };
    }

    const usdcValue = pointsToUSDC(pointsToRedeem, config);
    const updated: LoyaltyProfile = {
      ...profile,
      points: profile.points - pointsToRedeem,
      updatedAt: Date.now(),
    };
    this._save(updated);

    const redemption: RedemptionRecord = {
      id: `redemption_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userAddress: userAddress.toLowerCase(),
      pointsRedeemed: pointsToRedeem,
      usdcValue,
      redeemedAt: Date.now(),
    };
    this._saveRedemption(redemption);

    return { success: true, usdcValue, profile: updated };
  }

  static getRedemptionHistory(userAddress: string): RedemptionRecord[] {
    if (typeof window === 'undefined') return [];
    try {
      const all: RedemptionRecord[] = JSON.parse(
        localStorage.getItem(REDEMPTION_KEY) ?? '[]',
      );
      return all.filter((r) => r.userAddress === userAddress.toLowerCase());
    } catch {
      return [];
    }
  }

  static getAnalytics(userAddress: string): LoyaltyAnalytics {
    const profile = this.get(userAddress);
    const tierCfg = getTierConfig(profile.tier);
    const next = getNextTier(profile.tier);
    const redemptionHistory = this.getRedemptionHistory(userAddress);

    const avgPointsPerTx =
      profile.transactionCount > 0
        ? profile.lifetimePoints / profile.transactionCount
        : 0;
    const estimatedMonthlyPoints = Math.floor(avgPointsPerTx * 30);

    return {
      userAddress: profile.userAddress,
      totalVolume: profile.totalVolume,
      transactionCount: profile.transactionCount,
      tier: profile.tier,
      points: profile.points,
      lifetimePoints: profile.lifetimePoints,
      pointsToNextTier: null,
      volumeToNextTier: next ? Math.max(0, next.minVolume - profile.totalVolume) : null,
      tierBenefits: tierCfg.benefits,
      feeDiscount: tierCfg.feeDiscount,
      pointsMultiplier: tierCfg.pointsMultiplier,
      redemptionHistory,
      estimatedMonthlyPoints,
    };
  }

  static getProgramAnalytics(): {
    totalUsers: number;
    tierBreakdown: Record<LoyaltyTier, number>;
    totalPointsIssued: number;
    totalPointsRedeemed: number;
    totalVolumeTracked: number;
  } {
    const profiles = this.getAll();
    const tierBreakdown: Record<LoyaltyTier, number> = {
      bronze: 0,
      silver: 0,
      gold: 0,
      platinum: 0,
    };
    let totalPointsIssued = 0;
    let totalVolumeTracked = 0;

    for (const p of profiles) {
      tierBreakdown[p.tier] = (tierBreakdown[p.tier] ?? 0) + 1;
      totalPointsIssued += p.lifetimePoints;
      totalVolumeTracked += p.totalVolume;
    }

    let totalPointsRedeemed = 0;
    if (typeof window !== 'undefined') {
      try {
        const all: RedemptionRecord[] = JSON.parse(
          localStorage.getItem(REDEMPTION_KEY) ?? '[]',
        );
        totalPointsRedeemed = all.reduce((sum, r) => sum + r.pointsRedeemed, 0);
      } catch {
        // ignore
      }
    }

    return {
      totalUsers: profiles.length,
      tierBreakdown,
      totalPointsIssued,
      totalPointsRedeemed,
      totalVolumeTracked,
    };
  }

  private static _saveRedemption(record: RedemptionRecord): void {
    if (typeof window === 'undefined') return;
    try {
      const all: RedemptionRecord[] = JSON.parse(
        localStorage.getItem(REDEMPTION_KEY) ?? '[]',
      );
      all.push(record);
      localStorage.setItem(REDEMPTION_KEY, JSON.stringify(all));
    } catch {
      // ignore
    }
  }

  private static _save(profile: LoyaltyProfile): void {
    if (typeof window === 'undefined') return;
    try {
      const all: Record<string, LoyaltyProfile> = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? '{}',
      );
      all[profile.userAddress.toLowerCase()] = profile;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      // ignore
    }
  }

  private static _default(userAddress: string): LoyaltyProfile {
    return {
      userAddress: userAddress.toLowerCase(),
      totalVolume: 0,
      transactionCount: 0,
      tier: 'bronze',
      points: 0,
      lifetimePoints: 0,
      updatedAt: Date.now(),
    };
  }
}
