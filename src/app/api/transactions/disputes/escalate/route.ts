import { NextRequest, NextResponse } from 'next/server';
import { disputeRepository } from '@/lib/repositories/dispute-repository';
import { DisputeEscalation } from '@/types/disputes';

export async function POST(req: NextRequest) {
  try {
    const userAddress = req.headers.get('x-user-address');
    if (!userAddress) {
      return NextResponse.json({ error: 'User address required' }, { status: 401 });
    }

    const { disputeId, reason, priority } = await req.json();

    if (!disputeId || !reason) {
      return NextResponse.json({ error: 'disputeId and reason are required' }, { status: 400 });
    }

    const dispute = await disputeRepository.getDispute(disputeId);
    if (!dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    if (dispute.userAddress !== userAddress) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const escalated = await disputeRepository.escalateDispute(
      disputeId,
      userAddress,
      reason,
      priority as DisputeEscalation['priority'],
    );

    return NextResponse.json(escalated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to escalate dispute';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
