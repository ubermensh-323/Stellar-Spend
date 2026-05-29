import { NextRequest, NextResponse } from 'next/server';
import { disputeRepository } from '@/lib/repositories/dispute-repository';

export async function POST(req: NextRequest) {
  try {
    const adminId = req.headers.get('x-admin-id');
    if (!adminId) {
      return NextResponse.json({ error: 'Admin authorization required' }, { status: 401 });
    }

    const { disputeId, outcome, resolutionNotes } = await req.json();

    if (!disputeId || !outcome || !resolutionNotes) {
      return NextResponse.json(
        { error: 'disputeId, outcome, and resolutionNotes are required' },
        { status: 400 },
      );
    }

    if (!['resolved', 'rejected'].includes(outcome)) {
      return NextResponse.json(
        { error: "outcome must be 'resolved' or 'rejected'" },
        { status: 400 },
      );
    }

    const dispute = await disputeRepository.getDispute(disputeId);
    if (!dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const resolved = await disputeRepository.resolveDispute(disputeId, outcome, resolutionNotes);

    return NextResponse.json(resolved);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve dispute';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
