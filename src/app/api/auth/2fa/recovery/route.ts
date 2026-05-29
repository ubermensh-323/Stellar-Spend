import { NextRequest, NextResponse } from 'next/server';
import { TwoFAService } from '@/lib/two-fa';

// Initiate recovery — issues a short-lived token
export async function POST(req: NextRequest) {
  try {
    const { userId, recoveryToken, newMethod } = await req.json();

    // Start recovery: userId provided, no token yet
    if (userId && !recoveryToken) {
      const session = TwoFAService.initiateRecovery(userId);
      // In production: send `session.token` to verified contact (email/phone)
      return NextResponse.json({
        message: 'Recovery initiated. Check your registered contact for the token.',
        expiresAt: session.expiresAt,
      });
    }

    // Complete recovery: token + new method provided
    if (recoveryToken && newMethod) {
      if (!['totp', 'sms'].includes(newMethod)) {
        return NextResponse.json({ error: "newMethod must be 'totp' or 'sms'" }, { status: 400 });
      }

      const config = TwoFAService.completeRecovery(recoveryToken, newMethod);
      if (!config) {
        return NextResponse.json(
          { error: 'Invalid or expired recovery token' },
          { status: 400 },
        );
      }

      return NextResponse.json({
        message: '2FA reset successfully. Complete setup to re-enable.',
        method: config.method,
        secret: config.method === 'totp' ? config.secret : undefined,
        backupCodes: config.backupCodes,
      });
    }

    return NextResponse.json(
      { error: 'Provide userId to initiate, or recoveryToken + newMethod to complete' },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json({ error: 'Recovery flow failed' }, { status: 500 });
  }
}
