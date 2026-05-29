import { NextRequest, NextResponse } from 'next/server';
import { TwoFAService } from '@/lib/two-fa';

export async function GET(req: NextRequest) {
  try {
    const adminId = req.headers.get('x-admin-id');
    if (!adminId) {
      return NextResponse.json({ error: 'Admin authorization required' }, { status: 401 });
    }

    const policy = TwoFAService.getEnforcementPolicy();
    return NextResponse.json(policy);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch enforcement policy' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const adminId = req.headers.get('x-admin-id');
    if (!adminId) {
      return NextResponse.json({ error: 'Admin authorization required' }, { status: 401 });
    }

    const updates = await req.json();
    const policy = TwoFAService.updateEnforcementPolicy(updates);
    return NextResponse.json(policy);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update enforcement policy' }, { status: 500 });
  }
}

// Enforce or unenforce 2FA for a specific user
export async function POST(req: NextRequest) {
  try {
    const adminId = req.headers.get('x-admin-id');
    if (!adminId) {
      return NextResponse.json({ error: 'Admin authorization required' }, { status: 401 });
    }

    const { userId, enforce } = await req.json();
    if (!userId || typeof enforce !== 'boolean') {
      return NextResponse.json({ error: 'userId and enforce (boolean) are required' }, { status: 400 });
    }

    const result = enforce ? TwoFAService.enforce(userId) : TwoFAService.unenforce(userId);
    if (!result) {
      return NextResponse.json({ error: '2FA not configured for this user' }, { status: 404 });
    }

    return NextResponse.json({ userId, isEnforced: enforce });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update enforcement' }, { status: 500 });
  }
}
