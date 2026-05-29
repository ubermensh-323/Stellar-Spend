import {
  Dispute,
  CreateDisputeRequest,
  DisputeUpdate,
  DisputeStatus,
  DisputeNote,
  DisputeEscalation,
  DisputeAnalytics,
} from '@/types/disputes';

// ---------------------------------------------------------------------------
// In-memory store (replace with DB persistence when ready)
// ---------------------------------------------------------------------------
const disputes = new Map<string, Dispute>();
const notes = new Map<string, DisputeNote[]>();

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Status workflow
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  open: ['in_review', 'rejected', 'escalated'],
  in_review: ['resolved', 'rejected', 'escalated'],
  escalated: ['in_review', 'resolved', 'rejected'],
  resolved: [],
  rejected: [],
};

function isValidTransition(from: DisputeStatus, to: DisputeStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Notification hook (pluggable — replace with real notification service)
// ---------------------------------------------------------------------------

async function notifyDisputeEvent(
  dispute: Dispute,
  event: 'created' | 'status_changed' | 'escalated' | 'resolved',
): Promise<void> {
  // Hook point: forward to notification service, email, webhook, etc.
  // Intentionally a no-op stub until notification backend is wired.
  void dispute;
  void event;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class DisputeRepository {
  async createDispute(userAddress: string, req: CreateDisputeRequest): Promise<Dispute> {
    const id = generateId('dispute');
    const now = Date.now();

    const dispute: Dispute = {
      id,
      transactionId: req.transactionId,
      userAddress,
      reason: req.reason,
      description: req.description,
      status: 'open',
      priority: req.priority ?? 'medium',
      createdAt: now,
      updatedAt: now,
      notes: [],
    };

    disputes.set(id, dispute);
    notes.set(id, []);

    await notifyDisputeEvent(dispute, 'created');
    return dispute;
  }

  async getDispute(id: string): Promise<Dispute | null> {
    const dispute = disputes.get(id);
    if (!dispute) return null;
    return { ...dispute, notes: notes.get(id) ?? [] };
  }

  async getDisputesByTransaction(transactionId: string): Promise<Dispute[]> {
    return Array.from(disputes.values()).filter(
      (d) => d.transactionId === transactionId,
    );
  }

  async getDisputesByUser(userAddress: string): Promise<Dispute[]> {
    return Array.from(disputes.values())
      .filter((d) => d.userAddress === userAddress)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async updateDispute(id: string, update: DisputeUpdate): Promise<Dispute | null> {
    const existing = disputes.get(id);
    if (!existing) return null;

    if (update.status && update.status !== existing.status) {
      if (!isValidTransition(existing.status, update.status)) {
        throw new Error(
          `Invalid status transition: ${existing.status} → ${update.status}`,
        );
      }
    }

    const now = Date.now();
    const updated: Dispute = {
      ...existing,
      ...update,
      updatedAt: now,
      resolvedAt:
        update.status === 'resolved' || update.status === 'rejected'
          ? now
          : existing.resolvedAt,
    };

    disputes.set(id, updated);

    if (update.status && update.status !== existing.status) {
      await notifyDisputeEvent(updated, 'status_changed');
    }

    return { ...updated, notes: notes.get(id) ?? [] };
  }

  async listDisputes(
    status?: DisputeStatus,
    limit = 50,
    offset = 0,
  ): Promise<Dispute[]> {
    let result = Array.from(disputes.values());
    if (status) {
      result = result.filter((d) => d.status === status);
    }
    return result
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(offset, offset + limit);
  }

  // ---------------------------------------------------------------------------
  // Investigation tools
  // ---------------------------------------------------------------------------

  async addNote(
    disputeId: string,
    authorId: string,
    content: string,
    isInternal = false,
  ): Promise<DisputeNote | null> {
    if (!disputes.has(disputeId)) return null;

    const note: DisputeNote = {
      id: generateId('note'),
      disputeId,
      authorId,
      content,
      createdAt: Date.now(),
      isInternal,
    };

    const existing = notes.get(disputeId) ?? [];
    existing.push(note);
    notes.set(disputeId, existing);

    // Bump dispute updatedAt
    const dispute = disputes.get(disputeId)!;
    disputes.set(disputeId, { ...dispute, updatedAt: Date.now() });

    return note;
  }

  async getNotes(disputeId: string, includeInternal = false): Promise<DisputeNote[]> {
    const all = notes.get(disputeId) ?? [];
    return includeInternal ? all : all.filter((n) => !n.isInternal);
  }

  async assignDispute(disputeId: string, assignedTo: string): Promise<Dispute | null> {
    return this.updateDispute(disputeId, { assignedTo });
  }

  // ---------------------------------------------------------------------------
  // Escalation
  // ---------------------------------------------------------------------------

  async escalateDispute(
    disputeId: string,
    escalatedBy: string,
    reason: string,
    priority: DisputeEscalation['priority'] = 'high',
  ): Promise<Dispute | null> {
    const existing = disputes.get(disputeId);
    if (!existing) return null;

    if (!isValidTransition(existing.status, 'escalated')) {
      throw new Error(`Cannot escalate dispute in status: ${existing.status}`);
    }

    const escalation: DisputeEscalation = {
      id: generateId('escalation'),
      disputeId,
      escalatedBy,
      reason,
      priority,
      escalatedAt: Date.now(),
    };

    const updated: Dispute = {
      ...existing,
      status: 'escalated',
      priority,
      escalation,
      updatedAt: Date.now(),
    };

    disputes.set(disputeId, updated);
    await notifyDisputeEvent(updated, 'escalated');

    return { ...updated, notes: notes.get(disputeId) ?? [] };
  }

  // ---------------------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------------------

  async resolveDispute(
    disputeId: string,
    outcome: 'resolved' | 'rejected',
    resolutionNotes: string,
  ): Promise<Dispute | null> {
    const updated = await this.updateDispute(disputeId, {
      status: outcome,
      resolutionNotes,
    });

    if (updated) {
      await notifyDisputeEvent(updated, 'resolved');
    }

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  async getAnalytics(): Promise<DisputeAnalytics> {
    const all = Array.from(disputes.values());

    const byStatus: Record<DisputeStatus, number> = {
      open: 0,
      in_review: 0,
      resolved: 0,
      rejected: 0,
      escalated: 0,
    };
    const byPriority: Record<string, number> = {};

    let totalResolutionTime = 0;
    let resolvedCount = 0;
    let escalatedCount = 0;

    for (const d of all) {
      byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;

      const priority = d.priority ?? 'medium';
      byPriority[priority] = (byPriority[priority] ?? 0) + 1;

      if ((d.status === 'resolved' || d.status === 'rejected') && d.resolvedAt) {
        totalResolutionTime += d.resolvedAt - d.createdAt;
        resolvedCount++;
      }

      if (d.status === 'escalated' || d.escalation) {
        escalatedCount++;
      }
    }

    return {
      total: all.length,
      byStatus,
      byPriority,
      avgResolutionTimeMs: resolvedCount > 0 ? totalResolutionTime / resolvedCount : null,
      escalationRate: all.length > 0 ? escalatedCount / all.length : 0,
      resolutionRate: all.length > 0 ? resolvedCount / all.length : 0,
    };
  }
}

export const disputeRepository = new DisputeRepository();
