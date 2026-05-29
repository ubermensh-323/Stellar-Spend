import { NextRequest, NextResponse } from 'next/server';
import { TwoFAService } from '@/lib/two-fa';

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 401 });
    }

    const newCodes = TwoFAService.regenerateBackupCodes(userId);
    if (!newCodes) {
      return NextResponse.json({ error: '2FA not configured' }, { status: 400 });
    }

    return NextResponse.json({ backupCodes: newCodes });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to regenerate backup codes' }, { status: 500 });
  }
}
