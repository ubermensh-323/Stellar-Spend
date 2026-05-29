import { NextRequest, NextResponse } from 'next/server';
import {
  createReferralCode,
  getReferralCode,
  trackReferral,
  getReferralStats,
  distributeReward,
  getReferralAnalytics,
  getReferralLeaderboard,
  detectReferralFraud,
} from '@/lib/services/referral.service';

export async function POST(req: NextRequest) {
  try {
    const { userId, action, referralCode, referralId, limit } = await req.json();

    if (action === 'generate') {
      const code = await createReferralCode(userId);
      return NextResponse.json({ code });
    }

    if (action === 'track') {
      if (!referralCode || !userId) {
        return NextResponse.json({ error: 'Missing referralCode or userId' }, { status: 400 });
      }

      const fraudCheck = await detectReferralFraud(userId, referralCode);
      if (fraudCheck.suspicious) {
        return NextResponse.json(
          { error: 'Referral flagged', reasons: fraudCheck.reasons },
          { status: 422 },
        );
      }

      const reward = await trackReferral(referralCode, userId);
      return NextResponse.json({ reward });
    }

    if (action === 'distribute') {
      if (!referralId) {
        return NextResponse.json({ error: 'Missing referralId' }, { status: 400 });
      }
      const distributed = await distributeReward(referralId);
      return NextResponse.json({ distributed });
    }

    if (action === 'leaderboard') {
      const leaderboard = await getReferralLeaderboard(limit ?? 10);
      return NextResponse.json({ leaderboard });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to process referral' },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const view = req.nextUrl.searchParams.get('view');

    if (view === 'analytics') {
      const analytics = await getReferralAnalytics(userId);
      return NextResponse.json({ analytics });
    }

    const code = await getReferralCode(userId);
    const stats = await getReferralStats(userId);

    return NextResponse.json({ code, stats });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get referral data' },
      { status: 500 },
    );
  }
}
