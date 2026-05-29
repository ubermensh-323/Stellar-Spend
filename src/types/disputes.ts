export type DisputeStatus = 'open' | 'in_review' | 'resolved' | 'rejected' | 'escalated';

export type DisputeReason =
  | 'unauthorized_transaction'
  | 'duplicate_charge'
  | 'incorrect_amount'
  | 'service_not_received'
  | 'other';

export interface DisputeNote {
  id: string;
  disputeId: string;
  authorId: string;
  content: string;
  createdAt: number;
  isInternal: boolean;
}

export interface DisputeEscalation {
  id: string;
  disputeId: string;
  escalatedBy: string;
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  escalatedAt: number;
}

export interface Dispute {
  id: string;
  transactionId: string;
  userAddress: string;
  reason: string;
  description?: string;
  status: DisputeStatus;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  resolutionNotes?: string;
  escalation?: DisputeEscalation;
  notes?: DisputeNote[];
  assignedTo?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface CreateDisputeRequest {
  transactionId: string;
  reason: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface DisputeUpdate {
  status?: DisputeStatus;
  resolutionNotes?: string;
  assignedTo?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface DisputeAnalytics {
  total: number;
  byStatus: Record<DisputeStatus, number>;
  byPriority: Record<string, number>;
  avgResolutionTimeMs: number | null;
  escalationRate: number;
  resolutionRate: number;
}
