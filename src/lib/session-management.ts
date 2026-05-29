import { pool } from "./db/client";
import { logger } from "./logger";
import crypto from "crypto";

export interface Session {
  id: string;
  userAddress: string;
  token: string;
  refreshToken?: string;
  ipAddress?: string;
  userAgent?: string;
  isActive: boolean;
  createdAt: number;
  expiresAt: number;
  lastActivityAt: number;
  refreshedAt?: number;
  deviceFingerprint?: string;
  activityCount: number;
}

export interface SessionActivity {
  id: string;
  sessionId: string;
  userAddress: string;
  action: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  recordedAt: number;
}

export interface SessionSecurityEvent {
  type: 'ip_mismatch' | 'concurrent_limit_exceeded' | 'suspicious_activity' | 'expired';
  sessionId: string;
  userAddress: string;
  detail: string;
  detectedAt: number;
}

export interface SessionLimitsConfig {
  maxConcurrentSessions: number;
  sessionTimeoutMs: number;
  refreshTokenExpiryMs: number;
  maxActivityLogEntries: number;
  enforceIpConsistency: boolean;
}

const DEFAULT_LIMITS: SessionLimitsConfig = {
  maxConcurrentSessions: 5,
  sessionTimeoutMs: 30 * 60 * 1000,         // 30 minutes
  refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxActivityLogEntries: 100,
  enforceIpConsistency: false,
};

function mapRow(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    userAddress: row.user_address as string,
    token: row.token as string,
    refreshToken: (row.refresh_token as string) || undefined,
    ipAddress: (row.ip_address as string) || undefined,
    userAgent: (row.user_agent as string) || undefined,
    isActive: row.is_active as boolean,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    lastActivityAt: Number(row.last_activity_at),
    refreshedAt: row.refreshed_at ? Number(row.refreshed_at) : undefined,
    deviceFingerprint: (row.device_fingerprint as string) || undefined,
    activityCount: Number(row.activity_count ?? 0),
  };
}

export class SessionManagementService {
  private limits: SessionLimitsConfig;

  constructor(limits: Partial<SessionLimitsConfig> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  // ---------------------------------------------------------------------------
  // Creation
  // ---------------------------------------------------------------------------

  async createSession(
    userAddress: string,
    ipAddress?: string,
    userAgent?: string,
    deviceFingerprint?: string,
  ): Promise<Session> {
    await this._enforceConcurrentLimit(userAddress);

    const id = `session_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
    const token = crypto.randomBytes(32).toString("hex");
    const refreshToken = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    const expiresAt = now + this.limits.sessionTimeoutMs;

    await pool.query(
      `INSERT INTO sessions (id, user_address, token, refresh_token, ip_address, user_agent, device_fingerprint, is_active, created_at, expires_at, last_activity_at, activity_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        userAddress,
        token,
        refreshToken,
        ipAddress || null,
        userAgent || null,
        deviceFingerprint || null,
        true,
        now,
        expiresAt,
        now,
        0,
      ],
    );

    logger.info("Session created", { userId: userAddress, sessionId: id, ipAddress });

    return {
      id,
      userAddress,
      token,
      refreshToken,
      ipAddress,
      userAgent,
      deviceFingerprint,
      isActive: true,
      createdAt: now,
      expiresAt,
      lastActivityAt: now,
      activityCount: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  async validateSession(token: string, requestIp?: string): Promise<Session | null> {
    const result = await pool.query(
      `SELECT id, user_address, token, refresh_token, ip_address, user_agent, device_fingerprint,
              is_active, created_at, expires_at, last_activity_at, refreshed_at, activity_count
       FROM sessions
       WHERE token = $1 AND is_active = true`,
      [token],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const now = Date.now();

    if (Number(row.expires_at) < now) {
      await this.revokeSession(row.id, "Session expired");
      this._emitSecurityEvent({
        type: "expired",
        sessionId: row.id,
        userAddress: row.user_address,
        detail: "Session expired during validation",
        detectedAt: now,
      });
      return null;
    }

    if (
      this.limits.enforceIpConsistency &&
      requestIp &&
      row.ip_address &&
      row.ip_address !== requestIp
    ) {
      this._emitSecurityEvent({
        type: "ip_mismatch",
        sessionId: row.id,
        userAddress: row.user_address,
        detail: `Session IP ${row.ip_address} vs request IP ${requestIp}`,
        detectedAt: now,
      });
    }

    await pool.query(
      `UPDATE sessions SET last_activity_at = $1, activity_count = activity_count + 1 WHERE id = $2`,
      [now, row.id],
    );

    return mapRow({ ...row, last_activity_at: now });
  }

  // ---------------------------------------------------------------------------
  // Refresh
  // ---------------------------------------------------------------------------

  async refreshSession(refreshToken: string): Promise<Session | null> {
    const result = await pool.query(
      `SELECT id, user_address, token, refresh_token, ip_address, user_agent, device_fingerprint,
              is_active, created_at, expires_at, last_activity_at, activity_count
       FROM sessions
       WHERE refresh_token = $1 AND is_active = true`,
      [refreshToken],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const now = Date.now();
    const newExpiresAt = now + this.limits.sessionTimeoutMs;

    await pool.query(
      `UPDATE sessions SET expires_at = $1, refreshed_at = $2, last_activity_at = $3
       WHERE id = $4`,
      [newExpiresAt, now, now, row.id],
    );

    logger.info("Session refreshed", { userId: row.user_address, sessionId: row.id });

    return mapRow({ ...row, expires_at: newExpiresAt, refreshed_at: now, last_activity_at: now });
  }

  // ---------------------------------------------------------------------------
  // Activity tracking
  // ---------------------------------------------------------------------------

  async trackActivity(
    sessionId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const result = await pool.query(
      `SELECT user_address, ip_address FROM sessions WHERE id = $1`,
      [sessionId],
    );
    if (result.rows.length === 0) return;

    const { user_address, ip_address } = result.rows[0];
    const activityId = `activity_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    await pool.query(
      `INSERT INTO session_activities (id, session_id, user_address, action, ip_address, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        activityId,
        sessionId,
        user_address,
        action,
        ip_address || null,
        metadata ? JSON.stringify(metadata) : null,
        Date.now(),
      ],
    );
  }

  async getSessionActivity(sessionId: string): Promise<SessionActivity[]> {
    const result = await pool.query(
      `SELECT id, session_id, user_address, action, ip_address, metadata, recorded_at
       FROM session_activities
       WHERE session_id = $1
       ORDER BY recorded_at DESC
       LIMIT $2`,
      [sessionId, this.limits.maxActivityLogEntries],
    );

    return result.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      userAddress: row.user_address,
      action: row.action,
      ipAddress: row.ip_address || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      recordedAt: Number(row.recorded_at),
    }));
  }

  // ---------------------------------------------------------------------------
  // Concurrent session limits
  // ---------------------------------------------------------------------------

  private async _enforceConcurrentLimit(userAddress: string): Promise<void> {
    const sessions = await this.getUserSessions(userAddress);
    if (sessions.length >= this.limits.maxConcurrentSessions) {
      // Revoke the oldest session to make room
      const oldest = sessions.sort((a, b) => a.createdAt - b.createdAt)[0];
      await this.revokeSession(oldest.id, "Concurrent session limit exceeded");
      this._emitSecurityEvent({
        type: "concurrent_limit_exceeded",
        sessionId: oldest.id,
        userAddress,
        detail: `Limit of ${this.limits.maxConcurrentSessions} concurrent sessions reached`,
        detectedAt: Date.now(),
      });
    }
  }

  updateLimits(updates: Partial<SessionLimitsConfig>): void {
    this.limits = { ...this.limits, ...updates };
  }

  getLimits(): SessionLimitsConfig {
    return { ...this.limits };
  }

  // ---------------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------------

  async getUserSessions(userAddress: string): Promise<Session[]> {
    const result = await pool.query(
      `SELECT id, user_address, token, refresh_token, ip_address, user_agent, device_fingerprint,
              is_active, created_at, expires_at, last_activity_at, refreshed_at, activity_count
       FROM sessions
       WHERE user_address = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [userAddress],
    );

    return result.rows.map(mapRow);
  }

  // ---------------------------------------------------------------------------
  // Revocation
  // ---------------------------------------------------------------------------

  async revokeSession(sessionId: string, reason?: string): Promise<void> {
    const result = await pool.query(
      `SELECT user_address FROM sessions WHERE id = $1`,
      [sessionId],
    );
    if (result.rows.length === 0) return;

    const userAddress = result.rows[0].user_address;

    await pool.query(`UPDATE sessions SET is_active = false WHERE id = $1`, [sessionId]);

    const revocationId = `revocation_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
    await pool.query(
      `INSERT INTO session_revocations (id, session_id, user_address, reason, revoked_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [revocationId, sessionId, userAddress, reason || null, Date.now()],
    );

    logger.info("Session revoked", { userId: userAddress, sessionId, reason });
  }

  async revokeAllUserSessions(userAddress: string, reason?: string): Promise<void> {
    const result = await pool.query(
      `SELECT id FROM sessions WHERE user_address = $1 AND is_active = true`,
      [userAddress],
    );

    for (const row of result.rows) {
      await this.revokeSession(row.id, reason);
    }

    logger.info("All sessions revoked for user", { userId: userAddress, reason });
  }

  // ---------------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------------

  async detectSuspiciousActivity(userAddress: string): Promise<SessionSecurityEvent[]> {
    const sessions = await this.getUserSessions(userAddress);
    const events: SessionSecurityEvent[] = [];
    const now = Date.now();

    const ipSet = new Set(sessions.map((s) => s.ipAddress).filter(Boolean));
    if (ipSet.size > 3) {
      events.push({
        type: "suspicious_activity",
        sessionId: "multiple",
        userAddress,
        detail: `Active sessions from ${ipSet.size} different IP addresses`,
        detectedAt: now,
      });
    }

    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
    for (const s of sessions) {
      if (now - s.lastActivityAt > staleThreshold) {
        events.push({
          type: "suspicious_activity",
          sessionId: s.id,
          userAddress,
          detail: "Session inactive for over 24 hours but still active",
          detectedAt: now,
        });
      }
    }

    return events;
  }

  private _emitSecurityEvent(event: SessionSecurityEvent): void {
    logger.warn("Session security event", event);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  async cleanupExpiredSessions(): Promise<number> {
    const now = Date.now();
    const result = await pool.query(
      `UPDATE sessions SET is_active = false WHERE expires_at < $1 AND is_active = true`,
      [now],
    );

    logger.info("Expired sessions cleaned up", { count: result.rowCount });
    return result.rowCount || 0;
  }
}

export const sessionManagementService = new SessionManagementService();
