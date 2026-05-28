import { pool } from "./db/client";
import { logger } from "./logger";
import crypto from "crypto";

const LOG_INTEGRITY_KEY = process.env.AUDIT_LOG_INTEGRITY_KEY ?? 'default-dev-key-change-in-prod';

export interface AuditLog {
  id: string;
  userAddress?: string;
  actionType: string;
  resourceType: string;
  resourceId?: string;
  actionDetails?: string;
  status: "success" | "failure";
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  createdAt: number;
}

export interface AdminAction {
  id: string;
  adminAddress: string;
  actionType: string;
  targetUser?: string;
  actionDetails?: string;
  reason?: string;
  createdAt: number;
}

export interface ApiKeyUsageLog {
  id: string;
  apiKeyId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  ipAddress?: string;
  userAgent?: string;
  createdAt: number;
}

export interface SensitiveDataAccessLog {
  id: string;
  userAddress?: string;
  accessedBy: string;
  dataType: string;
  resourceId?: string;
  reason?: string;
  createdAt: number;
}

export interface AuditLogExport {
  exportedAt: string;
  format: 'json' | 'csv';
  data: string;
  recordCount: number;
}

export class AuditLoggingService {
  private readonly DEFAULT_RETENTION_DAYS = 90;

  async logAction(
    actionType: string,
    resourceType: string,
    status: "success" | "failure",
    options?: {
      userAddress?: string;
      resourceId?: string;
      actionDetails?: string;
      ipAddress?: string;
      userAgent?: string;
      sessionId?: string;
    },
  ): Promise<AuditLog> {
    const id = `audit_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
    const now = Date.now();

    await pool.query(
      `INSERT INTO audit_logs (id, user_address, action_type, resource_type, resource_id, action_details, status, ip_address, user_agent, session_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        options?.userAddress || null,
        actionType,
        resourceType,
        options?.resourceId || null,
        options?.actionDetails || null,
        status,
        options?.ipAddress || null,
        options?.userAgent || null,
        options?.sessionId || null,
        now,
      ],
    );

    logger.info(`Audit log created`, {
      auditId: id,
      actionType,
      resourceType,
      status,
      userId: options?.userAddress,
    });

    return {
      id,
      userAddress: options?.userAddress,
      actionType,
      resourceType,
      resourceId: options?.resourceId,
      actionDetails: options?.actionDetails,
      status,
      ipAddress: options?.ipAddress,
      userAgent: options?.userAgent,
      sessionId: options?.sessionId,
      createdAt: now,
    };
  }

  async logAdminAction(
    adminAddress: string,
    actionType: string,
    options?: {
      targetUser?: string;
      actionDetails?: string;
      reason?: string;
    },
  ): Promise<AdminAction> {
    const id = `admin_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
    const now = Date.now();

    await pool.query(
      `INSERT INTO admin_actions (id, admin_address, action_type, target_user, action_details, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        adminAddress,
        actionType,
        options?.targetUser || null,
        options?.actionDetails || null,
        options?.reason || null,
        now,
      ],
    );

    logger.warn(`Admin action logged`, {
      adminId: id,
      adminAddress,
      actionType,
      targetUser: options?.targetUser,
    });

    return {
      id,
      adminAddress,
      actionType,
      targetUser: options?.targetUser,
      actionDetails: options?.actionDetails,
      reason: options?.reason,
      createdAt: now,
    };
  }

  async getUserAuditLogs(
    userAddress: string,
    limit = 100,
    offset = 0,
  ): Promise<AuditLog[]> {
    const result = await pool.query(
      `SELECT id, user_address, action_type, resource_type, resource_id, action_details, status, ip_address, user_agent, session_id, created_at
       FROM audit_logs
       WHERE user_address = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userAddress, limit, offset],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userAddress: row.user_address || undefined,
      actionType: row.action_type,
      resourceType: row.resource_type,
      resourceId: row.resource_id || undefined,
      actionDetails: row.action_details || undefined,
      status: row.status,
      ipAddress: row.ip_address || undefined,
      userAgent: row.user_agent || undefined,
      sessionId: row.session_id || undefined,
      createdAt: Number(row.created_at),
    }));
  }

  async getAuditLogs(
    filters?: {
      actionType?: string;
      resourceType?: string;
      status?: "success" | "failure";
      startDate?: number;
      endDate?: number;
    },
    limit = 100,
    offset = 0,
  ): Promise<AuditLog[]> {
    let query = `SELECT id, user_address, action_type, resource_type, resource_id, action_details, status, ip_address, user_agent, session_id, created_at
                 FROM audit_logs WHERE 1=1`;
    const params: unknown[] = [];
    let paramCount = 1;

    if (filters?.actionType) {
      query += ` AND action_type = $${paramCount}`;
      params.push(filters.actionType);
      paramCount++;
    }

    if (filters?.resourceType) {
      query += ` AND resource_type = $${paramCount}`;
      params.push(filters.resourceType);
      paramCount++;
    }

    if (filters?.status) {
      query += ` AND status = $${paramCount}`;
      params.push(filters.status);
      paramCount++;
    }

    if (filters?.startDate) {
      query += ` AND created_at >= $${paramCount}`;
      params.push(filters.startDate);
      paramCount++;
    }

    if (filters?.endDate) {
      query += ` AND created_at <= $${paramCount}`;
      params.push(filters.endDate);
      paramCount++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      userAddress: row.user_address || undefined,
      actionType: row.action_type,
      resourceType: row.resource_type,
      resourceId: row.resource_id || undefined,
      actionDetails: row.action_details || undefined,
      status: row.status,
      ipAddress: row.ip_address || undefined,
      userAgent: row.user_agent || undefined,
      sessionId: row.session_id || undefined,
      createdAt: Number(row.created_at),
    }));
  }

  async getAdminActions(
    adminAddress?: string,
    limit = 100,
    offset = 0,
  ): Promise<AdminAction[]> {
    let query = `SELECT id, admin_address, action_type, target_user, action_details, reason, created_at
                 FROM admin_actions`;
    const params: unknown[] = [];

    if (adminAddress) {
      query += ` WHERE admin_address = $1`;
      params.push(adminAddress);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      adminAddress: row.admin_address,
      actionType: row.action_type,
      targetUser: row.target_user || undefined,
      actionDetails: row.action_details || undefined,
      reason: row.reason || undefined,
      createdAt: Number(row.created_at),
    }));
  }

  async cleanupOldLogs(retentionDays = this.DEFAULT_RETENTION_DAYS): Promise<number> {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const result = await pool.query(
      `DELETE FROM audit_logs WHERE created_at < $1`,
      [cutoffTime],
    );

    logger.info(`Old audit logs cleaned up`, {
      count: result.rowCount,
      retentionDays,
    });

    return result.rowCount || 0;
  }

  async setRetentionPolicy(retentionDays: number): Promise<void> {
    const id = `retention_${Date.now()}`;
    const now = Date.now();

    await pool.query(
      `INSERT INTO audit_log_retention (id, retention_days, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET retention_days = $2, last_cleanup_at = $3`,
      [id, retentionDays, now],
    );

    logger.info(`Audit log retention policy updated`, {
      retentionDays,
    });
  }

  async getRetentionPolicy(): Promise<number> {
    const result = await pool.query(
      `SELECT retention_days FROM audit_log_retention ORDER BY created_at DESC LIMIT 1`,
    );

    if (result.rows.length === 0) {
      return this.DEFAULT_RETENTION_DAYS;
    }

    return result.rows[0].retention_days;
  }

  async logApiKeyUsage(
    apiKeyId: string,
    endpoint: string,
    method: string,
    statusCode: number,
    options?: { ipAddress?: string; userAgent?: string },
  ): Promise<ApiKeyUsageLog> {
    const id = `apikey_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();

    await pool.query(
      `INSERT INTO api_key_usage_logs (id, api_key_id, endpoint, method, status_code, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, apiKeyId, endpoint, method, statusCode, options?.ipAddress ?? null, options?.userAgent ?? null, now],
    );

    return { id, apiKeyId, endpoint, method, statusCode, ipAddress: options?.ipAddress, userAgent: options?.userAgent, createdAt: now };
  }

  async logSensitiveDataAccess(
    accessedBy: string,
    dataType: string,
    options?: { userAddress?: string; resourceId?: string; reason?: string },
  ): Promise<SensitiveDataAccessLog> {
    const id = `sensitive_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();

    await pool.query(
      `INSERT INTO sensitive_data_access_logs (id, user_address, accessed_by, data_type, resource_id, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, options?.userAddress ?? null, accessedBy, dataType, options?.resourceId ?? null, options?.reason ?? null, now],
    );

    logger.warn('Sensitive data access logged', { id, accessedBy, dataType, resourceId: options?.resourceId });

    return {
      id,
      userAddress: options?.userAddress,
      accessedBy,
      dataType,
      resourceId: options?.resourceId,
      reason: options?.reason,
      createdAt: now,
    };
  }

  async searchAuditLogs(
    query: string,
    options?: { limit?: number; offset?: number },
  ): Promise<AuditLog[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const like = `%${query}%`;

    const result = await pool.query(
      `SELECT id, user_address, action_type, resource_type, resource_id, action_details, status, ip_address, user_agent, session_id, created_at
       FROM audit_logs
       WHERE action_type ILIKE $1
          OR resource_type ILIKE $1
          OR action_details ILIKE $1
          OR resource_id ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [like, limit, offset],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userAddress: row.user_address || undefined,
      actionType: row.action_type,
      resourceType: row.resource_type,
      resourceId: row.resource_id || undefined,
      actionDetails: row.action_details || undefined,
      status: row.status,
      ipAddress: row.ip_address || undefined,
      userAgent: row.user_agent || undefined,
      sessionId: row.session_id || undefined,
      createdAt: Number(row.created_at),
    }));
  }

  async exportAuditLogs(
    format: 'json' | 'csv' = 'json',
    filters?: { startDate?: number; endDate?: number; actionType?: string },
  ): Promise<AuditLogExport> {
    const logs = await this.getAuditLogs(filters, 10000, 0);

    let data: string;
    if (format === 'csv') {
      const header = 'id,userAddress,actionType,resourceType,resourceId,status,ipAddress,createdAt';
      const rows = logs.map((l) =>
        [l.id, l.userAddress ?? '', l.actionType, l.resourceType, l.resourceId ?? '', l.status, l.ipAddress ?? '', l.createdAt].join(','),
      );
      data = [header, ...rows].join('\n');
    } else {
      data = JSON.stringify(logs, null, 2);
    }

    return { exportedAt: new Date().toISOString(), format, data, recordCount: logs.length };
  }

  /**
   * Computes an HMAC for a log entry to detect tampering.
   * Store the returned hash alongside the log and verify with verifyLogIntegrity().
   */
  computeLogIntegrityHash(log: AuditLog): string {
    const payload = JSON.stringify({
      id: log.id,
      actionType: log.actionType,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      status: log.status,
      createdAt: log.createdAt,
    });
    return crypto.createHmac('sha256', LOG_INTEGRITY_KEY).update(payload).digest('hex');
  }

  verifyLogIntegrity(log: AuditLog, storedHash: string): boolean {
    const expected = this.computeLogIntegrityHash(log);
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(storedHash, 'hex'));
  }
}

export const auditLoggingService = new AuditLoggingService();
