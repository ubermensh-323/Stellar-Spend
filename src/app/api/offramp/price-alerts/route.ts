import { NextRequest, NextResponse } from 'next/server';
import { AlertType, PriceAlert, PriceAlertStorage } from '@/lib/price-alerts';

const VALID_ALERT_TYPES: AlertType[] = ['above', 'below'];

export async function GET(req: NextRequest) {
  try {
    const userAddress = req.nextUrl.searchParams.get('userAddress');
    const analytics = req.nextUrl.searchParams.get('analytics');

    if (analytics === 'true') {
      const stats = PriceAlertStorage.getAnalytics();
      return NextResponse.json({ analytics: stats });
    }

    if (!userAddress) {
      return NextResponse.json({ error: 'Missing userAddress' }, { status: 400 });
    }

    const alerts = PriceAlertStorage.getAlertsByUser(userAddress);
    return NextResponse.json({ alerts });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch price alerts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { currency, targetPrice, alertType, userAddress, recurring } = body;

    if (!currency || targetPrice === undefined || !alertType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!VALID_ALERT_TYPES.includes(alertType)) {
      return NextResponse.json({ error: 'Invalid alertType' }, { status: 400 });
    }

    if (typeof targetPrice !== 'number' || targetPrice <= 0) {
      return NextResponse.json({ error: 'targetPrice must be a positive number' }, { status: 400 });
    }

    const alertInput: Omit<PriceAlert, 'id' | 'createdAt' | 'triggeredAt' | 'notificationSent' | 'triggerHistory'> = {
      currency,
      targetPrice,
      alertType,
      status: 'active',
      triggeredCount: 0,
      recurring: recurring ?? false,
      userAddress,
    };

    const alert = PriceAlertStorage.createAlert(alertInput);
    return NextResponse.json({ alert }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create price alert' }, { status: 500 });
  }
}
