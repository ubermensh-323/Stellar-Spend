import { NextRequest, NextResponse } from 'next/server';
import { TwoFAService } from '@/lib/two-fa';

export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 401 });
    }

    const config = TwoFAService.getConfig(userId);
    if (!config) {
      return NextResponse.json({ enabled: false, method: null, isEnforced: false });
    }

    return NextResponse.json({
      enabled: config.isEnabled,
      method: config.method,
      isEnforced: config.isEnforced,
      backupCodesRemaining: config.backupCodes.length,
      lastVerifiedAt: config.lastVerifiedAt,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch 2FA status' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 401 });
    }

    const { action } = await req.json();

    if (action === 'enable') {
      const config = TwoFAService.enable(userId);
      if (!config) {
        return NextResponse.json(
          { error: '2FA not configured. Call /setup first.' },
          { status: 400 },
        );
      }
      return NextResponse.json({ success: true, enabled: true });
    }

    if (action === 'disable') {
      const config = TwoFAService.disable(userId);
      if (!config) {
        return NextResponse.json({ error: '2FA not configured' }, { status: 400 });
      }
      return NextResponse.json({ success: true, enabled: false });
    }

    return NextResponse.json({ error: "action must be 'enable' or 'disable'" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update 2FA' }, { status: 500 });
  }
}
