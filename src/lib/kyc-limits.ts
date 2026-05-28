import crypto from 'crypto';

export type KYCStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type LimitTier = 'tier1' | 'tier2' | 'tier3';
export type AMLRiskLevel = 'low' | 'medium' | 'high' | 'blocked';

export interface AMLScreeningResult {
  userId: string;
  riskLevel: AMLRiskLevel;
  screenedAt: number;
  flags: string[];
  score: number;
}

export interface DocumentUpload {
  userId: string;
  documentType: string;
  documentId: string;
  uploadedAt: number;
  fileName?: string;
  mimeType?: string;
}

export interface ComplianceReport {
  generatedAt: number;
  period: { from: number; to: number };
  totalUsers: number;
  verifiedUsers: number;
  pendingVerifications: number;
  rejectedVerifications: number;
  highRiskUsers: number;
  blockedUsers: number;
  totalTransactionVolume: number;
  flaggedTransactions: number;
}

export interface KYCRenewalReminder {
  userId: string;
  reminderType: 'expiry_30d' | 'expiry_7d' | 'expiry_1d' | 'expired';
  scheduledAt: number;
  sent: boolean;
}

export interface KYCData {
  userId: string;
  status: KYCStatus;
  documentType: string;
  documentId: string;
  submittedAt: number;
  verifiedAt?: number;
  rejectionReason?: string;
}

export interface TransactionLimit {
  tier: LimitTier;
  dailyLimit: number;
  monthlyLimit: number;
  transactionLimit: number;
}

export interface UserLimits {
  userId: string;
  tier: LimitTier;
  dailyUsed: number;
  monthlyUsed: number;
  dailyResetAt: number;
  monthlyResetAt: number;
  limitIncreaseRequests: LimitIncreaseRequest[];
}

export interface LimitIncreaseRequest {
  id: string;
  userId: string;
  requestedTier: LimitTier;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  reviewedAt?: number;
}

const TIER_LIMITS: Record<LimitTier, TransactionLimit> = {
  tier1: { dailyLimit: 1000, monthlyLimit: 10000, transactionLimit: 500 },
  tier2: { dailyLimit: 5000, monthlyLimit: 50000, transactionLimit: 2500 },
  tier3: { dailyLimit: 50000, monthlyLimit: 500000, transactionLimit: 25000 },
};

export class KYCLimitService {
  private static readonly KYC_STORAGE_KEY = 'stellar_spend_kyc';
  private static readonly LIMITS_STORAGE_KEY = 'stellar_spend_limits';

  static submitKYC(userId: string, documentType: string, documentId: string): KYCData {
    const kyc: KYCData = {
      userId,
      status: 'pending',
      documentType,
      documentId,
      submittedAt: Date.now(),
    };

    const kycMap = this.getAllKYC();
    kycMap[userId] = kyc;
    this.persistKYC(kycMap);
    return kyc;
  }

  static getKYC(userId: string): KYCData | null {
    const kycMap = this.getAllKYC();
    return kycMap[userId] || null;
  }

  static verifyKYC(userId: string): KYCData | null {
    const kyc = this.getKYC(userId);
    if (!kyc) return null;

    kyc.status = 'verified';
    kyc.verifiedAt = Date.now();

    const kycMap = this.getAllKYC();
    kycMap[userId] = kyc;
    this.persistKYC(kycMap);

    // Upgrade to tier2 on verification
    this.initializeUserLimits(userId, 'tier2');
    return kyc;
  }

  static rejectKYC(userId: string, reason: string): KYCData | null {
    const kyc = this.getKYC(userId);
    if (!kyc) return null;

    kyc.status = 'rejected';
    kyc.rejectionReason = reason;

    const kycMap = this.getAllKYC();
    kycMap[userId] = kyc;
    this.persistKYC(kycMap);
    return kyc;
  }

  static initializeUserLimits(userId: string, tier: LimitTier = 'tier1'): UserLimits {
    const now = Date.now();
    const limits: UserLimits = {
      userId,
      tier,
      dailyUsed: 0,
      monthlyUsed: 0,
      dailyResetAt: now + 86400000,
      monthlyResetAt: now + 2592000000,
      limitIncreaseRequests: [],
    };

    const limitsMap = this.getAllLimits();
    limitsMap[userId] = limits;
    this.persistLimits(limitsMap);
    return limits;
  }

  static getUserLimits(userId: string): UserLimits | null {
    const limitsMap = this.getAllLimits();
    return limitsMap[userId] || null;
  }

  static canTransact(userId: string, amount: number): { allowed: boolean; reason?: string } {
    const limits = this.getUserLimits(userId);
    if (!limits) return { allowed: false, reason: 'User limits not initialized' };

    const tierLimit = TIER_LIMITS[limits.tier];
    const now = Date.now();

    // Reset if needed
    if (now > limits.dailyResetAt) {
      limits.dailyUsed = 0;
      limits.dailyResetAt = now + 86400000;
    }
    if (now > limits.monthlyResetAt) {
      limits.monthlyUsed = 0;
      limits.monthlyResetAt = now + 2592000000;
    }

    if (amount > tierLimit.transactionLimit) {
      return { allowed: false, reason: `Transaction exceeds limit of ${tierLimit.transactionLimit}` };
    }
    if (limits.dailyUsed + amount > tierLimit.dailyLimit) {
      return { allowed: false, reason: `Daily limit exceeded` };
    }
    if (limits.monthlyUsed + amount > tierLimit.monthlyLimit) {
      return { allowed: false, reason: `Monthly limit exceeded` };
    }

    return { allowed: true };
  }

  static recordTransaction(userId: string, amount: number): void {
    const limits = this.getUserLimits(userId);
    if (!limits) return;

    limits.dailyUsed += amount;
    limits.monthlyUsed += amount;

    const limitsMap = this.getAllLimits();
    limitsMap[userId] = limits;
    this.persistLimits(limitsMap);
  }

  static requestLimitIncrease(userId: string, requestedTier: LimitTier): LimitIncreaseRequest {
    const request: LimitIncreaseRequest = {
      id: crypto.randomUUID(),
      userId,
      requestedTier,
      status: 'pending',
      createdAt: Date.now(),
    };

    const limits = this.getUserLimits(userId);
    if (limits) {
      limits.limitIncreaseRequests.push(request);
      const limitsMap = this.getAllLimits();
      limitsMap[userId] = limits;
      this.persistLimits(limitsMap);
    }

    return request;
  }

  static approveLimitIncrease(userId: string, requestId: string): boolean {
    const limits = this.getUserLimits(userId);
    if (!limits) return false;

    const request = limits.limitIncreaseRequests.find(r => r.id === requestId);
    if (!request) return false;

    request.status = 'approved';
    request.reviewedAt = Date.now();
    limits.tier = request.requestedTier;

    const limitsMap = this.getAllLimits();
    limitsMap[userId] = limits;
    this.persistLimits(limitsMap);
    return true;
  }

  // ---------------------------------------------------------------------------
  // AML Screening
  // ---------------------------------------------------------------------------

  static screenAML(userId: string, transactionAmount?: number): AMLScreeningResult {
    let score = 0;
    const flags: string[] = [];

    const kyc = this.getKYC(userId);
    if (!kyc || kyc.status !== 'verified') {
      score += 30;
      flags.push('unverified_identity');
    }

    if (transactionAmount !== undefined) {
      if (transactionAmount >= 10000) {
        score += 20;
        flags.push('large_transaction');
      }
      if (transactionAmount >= 50000) {
        score += 30;
        flags.push('very_large_transaction');
      }
    }

    const limits = this.getUserLimits(userId);
    if (limits) {
      const tierLimit = { tier1: 1000, tier2: 5000, tier3: 50000 }[limits.tier];
      if (transactionAmount && transactionAmount > tierLimit * 0.9) {
        score += 15;
        flags.push('near_limit_transaction');
      }
    }

    let riskLevel: AMLRiskLevel = 'low';
    if (score >= 70) riskLevel = 'blocked';
    else if (score >= 45) riskLevel = 'high';
    else if (score >= 20) riskLevel = 'medium';

    const result: AMLScreeningResult = {
      userId,
      riskLevel,
      screenedAt: Date.now(),
      flags,
      score,
    };

    const amlMap = this.getAllAML();
    amlMap[userId] = result;
    this.persistAML(amlMap);

    return result;
  }

  static getAMLResult(userId: string): AMLScreeningResult | null {
    return this.getAllAML()[userId] || null;
  }

  // ---------------------------------------------------------------------------
  // Document upload handling
  // ---------------------------------------------------------------------------

  static uploadDocument(userId: string, documentType: string, documentId: string, fileName?: string, mimeType?: string): DocumentUpload {
    const upload: DocumentUpload = {
      userId,
      documentType,
      documentId,
      uploadedAt: Date.now(),
      fileName,
      mimeType,
    };

    // Trigger KYC submission with uploaded document
    this.submitKYC(userId, documentType, documentId);

    const uploadsMap = this.getAllUploads();
    if (!uploadsMap[userId]) uploadsMap[userId] = [];
    uploadsMap[userId].push(upload);
    this.persistUploads(uploadsMap);

    return upload;
  }

  // ---------------------------------------------------------------------------
  // Compliance reporting
  // ---------------------------------------------------------------------------

  static generateComplianceReport(from: number, to: number): ComplianceReport {
    const allKYC = this.getAllKYC();
    const allAML = this.getAllAML();
    const allLimits = this.getAllLimits();

    const users = Object.values(allKYC);
    const amlResults = Object.values(allAML);

    const totalTransactionVolume = Object.values(allLimits).reduce(
      (sum, l) => sum + l.monthlyUsed,
      0
    );

    return {
      generatedAt: Date.now(),
      period: { from, to },
      totalUsers: users.length,
      verifiedUsers: users.filter((u) => u.status === 'verified').length,
      pendingVerifications: users.filter((u) => u.status === 'pending').length,
      rejectedVerifications: users.filter((u) => u.status === 'rejected').length,
      highRiskUsers: amlResults.filter((r) => r.riskLevel === 'high').length,
      blockedUsers: amlResults.filter((r) => r.riskLevel === 'blocked').length,
      totalTransactionVolume,
      flaggedTransactions: amlResults.filter((r) => r.flags.length > 0).length,
    };
  }

  // ---------------------------------------------------------------------------
  // KYC renewal reminders
  // ---------------------------------------------------------------------------

  static getKYCRenewalReminders(userId: string): KYCRenewalReminder[] {
    const kyc = this.getKYC(userId);
    if (!kyc || kyc.status !== 'verified' || !kyc.verifiedAt) return [];

    const RENEWAL_PERIOD_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
    const expiryAt = kyc.verifiedAt + RENEWAL_PERIOD_MS;
    const now = Date.now();
    const timeToExpiry = expiryAt - now;

    const reminders: KYCRenewalReminder[] = [];
    const milestones: Array<{ ms: number; type: KYCRenewalReminder['reminderType'] }> = [
      { ms: 30 * 24 * 60 * 60 * 1000, type: 'expiry_30d' },
      { ms: 7 * 24 * 60 * 60 * 1000, type: 'expiry_7d' },
      { ms: 24 * 60 * 60 * 1000, type: 'expiry_1d' },
    ];

    for (const m of milestones) {
      reminders.push({
        userId,
        reminderType: m.type,
        scheduledAt: expiryAt - m.ms,
        sent: now > expiryAt - m.ms,
      });
    }

    if (timeToExpiry <= 0) {
      reminders.push({ userId, reminderType: 'expired', scheduledAt: expiryAt, sent: true });
    }

    return reminders;
  }

  private static getAllKYC(): Record<string, KYCData> {
    if (typeof window === 'undefined') return {};
    const stored = localStorage.getItem(this.KYC_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  }

  private static getAllLimits(): Record<string, UserLimits> {
    if (typeof window === 'undefined') return {};
    const stored = localStorage.getItem(this.LIMITS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  }

  private static getAllAML(): Record<string, AMLScreeningResult> {
    if (typeof window === 'undefined') return {};
    const stored = localStorage.getItem('stellar_spend_aml');
    return stored ? JSON.parse(stored) : {};
  }

  private static getAllUploads(): Record<string, DocumentUpload[]> {
    if (typeof window === 'undefined') return {};
    const stored = localStorage.getItem('stellar_spend_doc_uploads');
    return stored ? JSON.parse(stored) : {};
  }

  private static persistKYC(kycMap: Record<string, KYCData>): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(this.KYC_STORAGE_KEY, JSON.stringify(kycMap));
    }
  }

  private static persistLimits(limitsMap: Record<string, UserLimits>): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(this.LIMITS_STORAGE_KEY, JSON.stringify(limitsMap));
    }
  }

  private static persistAML(amlMap: Record<string, AMLScreeningResult>): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('stellar_spend_aml', JSON.stringify(amlMap));
    }
  }

  private static persistUploads(uploadsMap: Record<string, DocumentUpload[]>): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('stellar_spend_doc_uploads', JSON.stringify(uploadsMap));
    }
  }
}
