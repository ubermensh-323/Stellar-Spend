import crypto from 'crypto';

export interface TwoFAConfig {
  userId: string;
  method: 'totp' | 'sms';
  secret?: string;
  phoneNumber?: string;
  isEnabled: boolean;
  isEnforced: boolean;
  backupCodes: string[];
  usedBackupCodes: string[];
  createdAt: number;
  lastVerifiedAt?: number;
}

export interface TwoFAVerification {
  userId: string;
  code: string;
  timestamp: number;
  isValid: boolean;
}

export interface TwoFAEnforcementPolicy {
  requireFor: ('login' | 'withdrawal' | 'profile_change' | 'api_key')[];
  gracePeriodMs: number;
  allowedMethods: ('totp' | 'sms' | 'backup')[];
}

export interface RecoverySession {
  token: string;
  userId: string;
  expiresAt: number;
  used: boolean;
}

const DEFAULT_ENFORCEMENT: TwoFAEnforcementPolicy = {
  requireFor: ['withdrawal', 'api_key'],
  gracePeriodMs: 5 * 60 * 1000,  // 5 minutes
  allowedMethods: ['totp', 'sms', 'backup'],
};

// In-memory 2FA config store (replace with DB in production)
const configStore = new Map<string, TwoFAConfig>();
const recoveryStore = new Map<string, RecoverySession>();
let enforcementPolicy: TwoFAEnforcementPolicy = { ...DEFAULT_ENFORCEMENT };

export class TwoFAService {
  private static readonly TOTP_WINDOW = 30;    // seconds
  private static readonly TOTP_DIGITS = 6;
  private static readonly BACKUP_CODE_COUNT = 10;

  // ---------------------------------------------------------------------------
  // TOTP generation
  // ---------------------------------------------------------------------------

  static generateTOTPSecret(): string {
    return crypto.randomBytes(20).toString('base64');
  }

  static generateTOTPURI(secret: string, email: string, issuer = 'Stellar-Spend'): string {
    const encodedEmail = encodeURIComponent(email);
    const encodedIssuer = encodeURIComponent(issuer);
    return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&digits=${this.TOTP_DIGITS}&period=${this.TOTP_WINDOW}`;
  }

  static verifyTOTP(secret: string, code: string): boolean {
    if (!secret || !code || code.length !== this.TOTP_DIGITS) return false;

    const now = Math.floor(Date.now() / 1000);
    const timeCounter = Math.floor(now / this.TOTP_WINDOW);

    for (let i = -1; i <= 1; i++) {
      const counter = timeCounter + i;
      const counterBuf = Buffer.alloc(8);
      let tmp = counter;
      for (let j = 7; j >= 0; j--) {
        counterBuf[j] = tmp & 0xff;
        tmp = tmp >>> 8;
      }

      const hmac = crypto
        .createHmac('sha1', Buffer.from(secret, 'base64'))
        .update(counterBuf)
        .digest();

      const offset = hmac[hmac.length - 1] & 0x0f;
      const value =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

      const totp = (value % Math.pow(10, this.TOTP_DIGITS))
        .toString()
        .padStart(this.TOTP_DIGITS, '0');

      if (crypto.timingSafeEqual(Buffer.from(totp), Buffer.from(code))) {
        return true;
      }
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Backup codes
  // ---------------------------------------------------------------------------

  static generateBackupCodes(count = this.BACKUP_CODE_COUNT): string[] {
    return Array.from({ length: count }, () =>
      crypto.randomBytes(4).toString('hex').toUpperCase(),
    );
  }

  static verifyBackupCode(
    backupCodes: string[],
    usedCodes: string[],
    code: string,
  ): { isValid: boolean; remainingCodes: string[]; usedCodes: string[] } {
    const normalised = code.toUpperCase().trim();
    if (usedCodes.includes(normalised)) {
      return { isValid: false, remainingCodes: backupCodes, usedCodes };
    }
    const index = backupCodes.indexOf(normalised);
    if (index === -1) {
      return { isValid: false, remainingCodes: backupCodes, usedCodes };
    }
    const remainingCodes = backupCodes.filter((_, i) => i !== index);
    return { isValid: true, remainingCodes, usedCodes: [...usedCodes, normalised] };
  }

  // ---------------------------------------------------------------------------
  // 2FA config management
  // ---------------------------------------------------------------------------

  static setup(
    userId: string,
    method: 'totp' | 'sms',
    extra?: { secret?: string; phoneNumber?: string },
  ): TwoFAConfig {
    const existing = configStore.get(userId);
    const config: TwoFAConfig = {
      userId,
      method,
      secret: method === 'totp' ? (extra?.secret ?? this.generateTOTPSecret()) : undefined,
      phoneNumber: method === 'sms' ? extra?.phoneNumber : undefined,
      isEnabled: false,        // enabled after first successful verification
      isEnforced: false,
      backupCodes: this.generateBackupCodes(),
      usedBackupCodes: existing?.usedBackupCodes ?? [],
      createdAt: existing?.createdAt ?? Date.now(),
    };
    configStore.set(userId, config);
    return config;
  }

  static enable(userId: string): TwoFAConfig | null {
    const config = configStore.get(userId);
    if (!config) return null;
    const updated = { ...config, isEnabled: true, lastVerifiedAt: Date.now() };
    configStore.set(userId, updated);
    return updated;
  }

  static disable(userId: string): TwoFAConfig | null {
    const config = configStore.get(userId);
    if (!config) return null;
    const updated = { ...config, isEnabled: false, isEnforced: false };
    configStore.set(userId, updated);
    return updated;
  }

  static getConfig(userId: string): TwoFAConfig | null {
    return configStore.get(userId) ?? null;
  }

  static regenerateBackupCodes(userId: string): string[] | null {
    const config = configStore.get(userId);
    if (!config) return null;
    const newCodes = this.generateBackupCodes();
    configStore.set(userId, { ...config, backupCodes: newCodes, usedBackupCodes: [] });
    return newCodes;
  }

  // ---------------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------------

  static verify(userId: string, code: string, method: 'totp' | 'backup'): boolean {
    const config = configStore.get(userId);
    if (!config || !config.isEnabled) return false;

    if (method === 'totp') {
      if (!config.secret) return false;
      const valid = this.verifyTOTP(config.secret, code);
      if (valid) {
        configStore.set(userId, { ...config, lastVerifiedAt: Date.now() });
      }
      return valid;
    }

    if (method === 'backup') {
      const { isValid, remainingCodes, usedCodes } = this.verifyBackupCode(
        config.backupCodes,
        config.usedBackupCodes,
        code,
      );
      if (isValid) {
        configStore.set(userId, {
          ...config,
          backupCodes: remainingCodes,
          usedBackupCodes: usedCodes,
          lastVerifiedAt: Date.now(),
        });
      }
      return isValid;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Recovery flow
  // ---------------------------------------------------------------------------

  static initiateRecovery(userId: string): RecoverySession {
    const token = crypto.randomBytes(32).toString('hex');
    const session: RecoverySession = {
      token,
      userId,
      expiresAt: Date.now() + 15 * 60 * 1000,  // 15 minutes
      used: false,
    };
    recoveryStore.set(token, session);
    return session;
  }

  static completeRecovery(token: string, newMethod: 'totp' | 'sms'): TwoFAConfig | null {
    const session = recoveryStore.get(token);
    if (!session || session.used || session.expiresAt < Date.now()) return null;

    recoveryStore.set(token, { ...session, used: true });
    return this.setup(session.userId, newMethod);
  }

  // ---------------------------------------------------------------------------
  // Enforcement policies
  // ---------------------------------------------------------------------------

  static getEnforcementPolicy(): TwoFAEnforcementPolicy {
    return { ...enforcementPolicy };
  }

  static updateEnforcementPolicy(updates: Partial<TwoFAEnforcementPolicy>): TwoFAEnforcementPolicy {
    enforcementPolicy = { ...enforcementPolicy, ...updates };
    return { ...enforcementPolicy };
  }

  static isRequired(action: TwoFAEnforcementPolicy['requireFor'][number]): boolean {
    return enforcementPolicy.requireFor.includes(action);
  }

  static enforce(userId: string): boolean {
    const config = configStore.get(userId);
    if (!config) return false;
    const updated = { ...config, isEnforced: true };
    configStore.set(userId, updated);
    return true;
  }

  static unenforce(userId: string): boolean {
    const config = configStore.get(userId);
    if (!config) return false;
    configStore.set(userId, { ...config, isEnforced: false });
    return true;
  }
}
