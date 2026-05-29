import { NextResponse, type NextRequest } from 'next/server';
import { ErrorHandler } from '@/lib/error-handler';
import {
  calculateInsurancePremium,
  createInsurance,
  getInsuranceStatus,
  fileClaim,
} from '@/lib/services/insurance.service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/transactions/[id]/insurance
 * Returns the insurance policy for a transaction (if any).
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  try {
    const result = await getInsuranceStatus(id);
    const rows = (result as { rows: unknown[] }).rows ?? [];
    if (rows.length === 0) {
      return NextResponse.json({ insurance: null }, { status: 200 });
    }
    return NextResponse.json({ insurance: rows[0] }, { status: 200 });
  } catch (err) {
    return ErrorHandler.serverError(err);
  }
}

/**
 * POST /api/transactions/[id]/insurance
 * Purchases insurance for a transaction.
 * Body: { amount: number; currency: string }
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  let body: { amount?: unknown; currency?: unknown };
  try {
    body = await request.json();
  } catch {
    return ErrorHandler.validation('Invalid JSON body');
  }

  const amount = Number(body.amount);
  const currency = typeof body.currency === 'string' ? body.currency : 'USDC';

  if (!amount || isNaN(amount) || amount <= 0) {
    return ErrorHandler.validation('amount must be a positive number');
  }

  try {
    const quote = await calculateInsurancePremium(amount, currency);
    const result = await createInsurance(id, quote.premium, quote.coverage, quote.provider);
    const row = (result as { rows: unknown[] }).rows?.[0] ?? null;
    return NextResponse.json({ insurance: row, quote }, { status: 201 });
  } catch (err) {
    return ErrorHandler.serverError(err);
  }
}

/**
 * PATCH /api/transactions/[id]/insurance
 * Files a claim against an existing insurance policy.
 * Body: { insuranceId: string; reason: string; evidence?: string }
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id: _transactionId } = await params;

  let body: { insuranceId?: unknown; reason?: unknown; evidence?: unknown };
  try {
    body = await request.json();
  } catch {
    return ErrorHandler.validation('Invalid JSON body');
  }

  const insuranceId = typeof body.insuranceId === 'string' ? body.insuranceId : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const evidence = typeof body.evidence === 'string' ? body.evidence.trim() : undefined;

  if (!insuranceId) {
    return ErrorHandler.validation('insuranceId is required');
  }
  if (!reason) {
    return ErrorHandler.validation('reason is required');
  }

  try {
    const result = await fileClaim(insuranceId, reason, evidence);
    const row = (result as { rows: unknown[] }).rows?.[0] ?? null;
    return NextResponse.json({ claim: row }, { status: 200 });
  } catch (err) {
    return ErrorHandler.serverError(err);
  }
}
