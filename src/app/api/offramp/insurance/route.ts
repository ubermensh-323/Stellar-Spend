import { NextRequest, NextResponse } from 'next/server';
import {
  calculateInsurancePremium,
  createInsurance,
  getInsuranceStatus,
  fileClaim,
  approveClaim,
  rejectClaim,
  processInsurancePayout,
  getInsuranceAnalytics,
} from '@/lib/services/insurance.service';

// GET: fetch insurance status or analytics
export async function GET(req: NextRequest) {
  try {
    const transactionId = req.nextUrl.searchParams.get('transactionId');
    const analytics = req.nextUrl.searchParams.get('analytics');

    if (analytics === 'true') {
      const data = await getInsuranceAnalytics();
      return NextResponse.json({ analytics: data });
    }

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId or analytics=true is required' }, { status: 400 });
    }

    const result = await getInsuranceStatus(transactionId);
    return NextResponse.json({ insurance: (result as { rows: unknown[] }).rows[0] || null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST: purchase insurance or file a claim
export async function POST(req: NextRequest) {
  try {
    const { action, transactionId, insuranceId, amount, currency, includeInsurance, reason, evidence } = await req.json();

    if (action === 'claim') {
      if (!insuranceId || !reason) {
        return NextResponse.json({ error: 'Missing required fields: insuranceId, reason' }, { status: 400 });
      }
      const result = await fileClaim(insuranceId, reason, evidence);
      return NextResponse.json({ success: true, claim: (result as { rows: unknown[] }).rows[0] });
    }

    // Default: purchase insurance
    if (!includeInsurance) {
      return NextResponse.json({ insurance: null });
    }

    if (!transactionId || !amount || !currency) {
      return NextResponse.json({ error: 'Missing required fields: transactionId, amount, currency' }, { status: 400 });
    }

    const quote = await calculateInsurancePremium(parseFloat(amount), currency);
    const insurance = await createInsurance(transactionId, quote.premium, quote.coverage, quote.provider);

    return NextResponse.json({
      insurance: (insurance as { rows: unknown[] }).rows[0],
      quote,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process insurance request' },
      { status: 500 }
    );
  }
}

// PATCH: approve/reject claim or process payout
export async function PATCH(req: NextRequest) {
  try {
    const { action, insuranceId, rejectionReason } = await req.json();

    if (!action || !insuranceId) {
      return NextResponse.json({ error: 'Missing required fields: action, insuranceId' }, { status: 400 });
    }

    if (action === 'approve') {
      const result = await approveClaim(insuranceId);
      return NextResponse.json({ success: true, insurance: (result as { rows: unknown[] }).rows[0] });
    }

    if (action === 'reject') {
      if (!rejectionReason) {
        return NextResponse.json({ error: 'rejectionReason is required to reject a claim' }, { status: 400 });
      }
      const result = await rejectClaim(insuranceId, rejectionReason);
      return NextResponse.json({ success: true, insurance: (result as { rows: unknown[] }).rows[0] });
    }

    if (action === 'payout') {
      const result = await processInsurancePayout(insuranceId);
      return NextResponse.json({ success: true, insurance: (result as { rows: unknown[] }).rows[0] });
    }

    return NextResponse.json({ error: 'action must be "approve", "reject", or "payout"' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
