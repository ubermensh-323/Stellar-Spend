import { NextRequest, NextResponse } from 'next/server';
import { disputeRepository } from '@/lib/repositories/dispute-repository';

export async function POST(req: NextRequest) {
  try {
    const authorId = req.headers.get('x-user-address') ?? req.headers.get('x-admin-id');
    if (!authorId) {
      return NextResponse.json({ error: 'Authorization required' }, { status: 401 });
    }

    const isAdmin = !!req.headers.get('x-admin-id');
    const { disputeId, content, isInternal } = await req.json();

    if (!disputeId || !content) {
      return NextResponse.json({ error: 'disputeId and content are required' }, { status: 400 });
    }

    const dispute = await disputeRepository.getDispute(disputeId);
    if (!dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    // Only admins can post internal notes
    const internal = isAdmin ? (isInternal ?? false) : false;

    const note = await disputeRepository.addNote(disputeId, authorId, content, internal);
    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add note' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const disputeId = searchParams.get('disputeId');

    if (!disputeId) {
      return NextResponse.json({ error: 'disputeId is required' }, { status: 400 });
    }

    const includeInternal = !!req.headers.get('x-admin-id');
    const disputeNotes = await disputeRepository.getNotes(disputeId, includeInternal);
    return NextResponse.json(disputeNotes);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
  }
}
