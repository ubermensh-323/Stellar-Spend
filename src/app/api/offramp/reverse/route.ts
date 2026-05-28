import { NextRequest, NextResponse } from 'next/server';
import { TransactionStorage } from '@/lib/transaction-storage';

const REVERSAL_FEE_RATE = 0.01; // 1% reversal fee
const REVERSAL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ReversalRequest {
  transactionId: string;
  requestId: string;
  amount: string;
  fee: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  requestedAt: number;
  approvedAt?: number;
  completedAt?: number;
}

export interface ReversalAnalytics {
  totalReversals: number;
  totalReversalAmount: number;
  totalFeesCollected: number;
  approvalRate: number;
  averageProcessingTimeMs: number;
  reversalsByReason: Record<string, number>;
}

const reversalRequests = new Map<string, ReversalRequest>();

function calculateReversalFee(amount: number): number {
  return parseFloat((amount * REVERSAL_FEE_RATE).toFixed(6));
}

function isWithinReversalWindow(tx: { timestamp: number }): boolean {
  return Date.now() - tx.timestamp <= REVERSAL_WINDOW_MS;
}

// GET: check eligibility and current reversal status
export async function GET(req: NextRequest) {
  try {
    const transactionId = req.nextUrl.searchParams.get('transactionId');
    const requestId = req.nextUrl.searchParams.get('requestId');

    if (requestId) {
      const request = reversalRequests.get(requestId);
      if (!request) {
        return NextResponse.json({ error: 'Reversal request not found' }, { status: 404 });
      }
      return NextResponse.json({ request });
    }

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId or requestId is required' }, { status: 400 });
    }

    const tx = TransactionStorage.getById(transactionId);
    if (!tx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const eligible = TransactionStorage.isReversalEligible(tx);
    const withinWindow = isWithinReversalWindow(tx);
    const amount = parseFloat(tx.amount);
    const fee = calculateReversalFee(amount);

    return NextResponse.json({
      transactionId,
      eligible: eligible && withinWindow,
      reason: !eligible
        ? 'Transaction already reversed or not completed'
        : !withinWindow
        ? 'Outside 24-hour reversal window'
        : null,
      reversalFee: fee,
      maxReversalAmount: amount,
      netAmount: parseFloat((amount - fee).toFixed(6)),
      currentReversal: tx.reversal || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST: initiate reversal request
export async function POST(req: NextRequest) {
  try {
    const { transactionId, amount, reason } = await req.json();

    if (!transactionId || !amount || !reason) {
      return NextResponse.json(
        { error: 'Missing required fields: transactionId, amount, reason' },
        { status: 400 }
      );
    }

    const tx = TransactionStorage.getById(transactionId);
    if (!tx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (!TransactionStorage.isReversalEligible(tx)) {
      return NextResponse.json({ error: 'Transaction is not eligible for reversal' }, { status: 400 });
    }

    if (!isWithinReversalWindow(tx)) {
      return NextResponse.json({ error: 'Outside 24-hour reversal window' }, { status: 400 });
    }

    const reversalAmount = parseFloat(amount);
    const txAmount = parseFloat(tx.amount);
    if (reversalAmount <= 0 || reversalAmount > txAmount) {
      return NextResponse.json({ error: 'Invalid reversal amount' }, { status: 400 });
    }

    const fee = calculateReversalFee(reversalAmount);
    const requestId = `REV-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    const request: ReversalRequest = {
      transactionId,
      requestId,
      amount,
      fee: fee.toFixed(6),
      reason,
      status: 'pending',
      requestedAt: Date.now(),
    };
    reversalRequests.set(requestId, request);

    TransactionStorage.reverse(transactionId, amount, reason);

    return NextResponse.json({
      success: true,
      message: 'Reversal request submitted',
      requestId,
      reversalFee: fee,
      netAmount: parseFloat((reversalAmount - fee).toFixed(6)),
      transaction: TransactionStorage.getById(transactionId),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH: approve or reject a reversal request
export async function PATCH(req: NextRequest) {
  try {
    const { requestId, action, notes } = await req.json();

    if (!requestId || !action) {
      return NextResponse.json({ error: 'Missing required fields: requestId, action' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
    }

    const request = reversalRequests.get(requestId);
    if (!request) {
      return NextResponse.json({ error: 'Reversal request not found' }, { status: 404 });
    }

    if (request.status !== 'pending') {
      return NextResponse.json({ error: `Reversal is already ${request.status}` }, { status: 400 });
    }

    if (action === 'approve') {
      request.status = 'approved';
      request.approvedAt = Date.now();
      TransactionStorage.updateReversalStatus(request.transactionId, 'completed');
      request.status = 'completed';
      request.completedAt = Date.now();
    } else {
      request.status = 'rejected';
      TransactionStorage.updateReversalStatus(request.transactionId, 'failed');
    }

    reversalRequests.set(requestId, request);

    return NextResponse.json({
      success: true,
      request,
      notes: notes || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET analytics via ?analytics=true handled above; add dedicated handler
export async function PUT(req: NextRequest) {
  try {
    const { action } = await req.json();

    if (action === 'analytics') {
      const requests = Array.from(reversalRequests.values());
      const completed = requests.filter((r) => r.status === 'completed');
      const approved = requests.filter((r) => r.status === 'approved' || r.status === 'completed');

      const analytics: ReversalAnalytics = {
        totalReversals: requests.length,
        totalReversalAmount: completed.reduce((s, r) => s + parseFloat(r.amount), 0),
        totalFeesCollected: completed.reduce((s, r) => s + parseFloat(r.fee), 0),
        approvalRate: requests.length ? approved.length / requests.length : 0,
        averageProcessingTimeMs:
          completed.length
            ? completed.reduce((s, r) => s + ((r.completedAt ?? r.requestedAt) - r.requestedAt), 0) / completed.length
            : 0,
        reversalsByReason: requests.reduce<Record<string, number>>((acc, r) => {
          acc[r.reason] = (acc[r.reason] || 0) + 1;
          return acc;
        }, {}),
      };

      return NextResponse.json({ analytics });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
