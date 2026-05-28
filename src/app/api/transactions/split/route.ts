import { NextRequest, NextResponse } from 'next/server';
import {
  validateSplit,
  computeSplitAmounts,
  SplitStorage,
  calculateSplitFees,
  reconcileSplit,
  type SplitRecipient,
  type SplitTransaction,
} from '@/lib/transaction-split';

// GET: fetch split, reconciliation, or analytics
export async function GET(req: NextRequest) {
  try {
    const splitId = req.nextUrl.searchParams.get('splitId');
    const action = req.nextUrl.searchParams.get('action');

    if (action === 'analytics') {
      return NextResponse.json({ analytics: SplitStorage.getAnalytics() });
    }

    if (action === 'reconcile' && splitId) {
      const reconciliation = reconcileSplit(splitId);
      if (!reconciliation) return NextResponse.json({ error: 'Split not found' }, { status: 404 });
      return NextResponse.json({ reconciliation });
    }

    if (splitId) {
      const split = SplitStorage.getById(splitId);
      if (!split) return NextResponse.json({ error: 'Split not found' }, { status: 404 });
      return NextResponse.json({ split });
    }

    return NextResponse.json({ splits: SplitStorage.getAll() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST: create a new split transaction
export async function POST(req: NextRequest) {
  try {
    const { totalAmount, currency, recipients } = await req.json();

    if (!totalAmount || !currency || !recipients) {
      return NextResponse.json(
        { error: 'Missing required fields: totalAmount, currency, recipients' },
        { status: 400 }
      );
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ error: 'recipients must be a non-empty array' }, { status: 400 });
    }

    const validationError = validateSplit(recipients as SplitRecipient[]);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const fees = calculateSplitFees(totalAmount, recipients.length);
    if (fees.netAmount <= 0) {
      return NextResponse.json({ error: 'Amount too small to cover split fees' }, { status: 400 });
    }

    const splitId = SplitStorage.generateId();
    const recipientsWithAmounts = computeSplitAmounts(String(fees.netAmount), recipients as SplitRecipient[]);

    const split: SplitTransaction = {
      id: splitId,
      createdAt: Date.now(),
      totalAmount: String(totalAmount),
      currency,
      recipients: recipientsWithAmounts,
      status: 'pending',
      results: {},
    };

    SplitStorage.save(split);

    return NextResponse.json({
      success: true,
      splitId,
      fees,
      split,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH: update recipient result (partial failure handling)
export async function PATCH(req: NextRequest) {
  try {
    const { splitId, recipientId, status, error: recipientError } = await req.json();

    if (!splitId || !recipientId || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: splitId, recipientId, status' },
        { status: 400 }
      );
    }

    if (!['completed', 'failed'].includes(status)) {
      return NextResponse.json({ error: 'status must be "completed" or "failed"' }, { status: 400 });
    }

    const split = SplitStorage.getById(splitId);
    if (!split) return NextResponse.json({ error: 'Split not found' }, { status: 404 });

    SplitStorage.updateResult(splitId, recipientId, { status, error: recipientError });

    const updated = SplitStorage.getById(splitId);
    return NextResponse.json({ success: true, split: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
