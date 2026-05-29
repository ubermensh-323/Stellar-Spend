import { NextRequest, NextResponse } from 'next/server';
import { PriceAlertStorage } from '@/lib/price-alerts';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const history = req.nextUrl.searchParams.get('history') === 'true';
    const alert = PriceAlertStorage.getAlert(params.id);
    if (!alert) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });

    if (history) {
      return NextResponse.json({ history: alert.triggerHistory ?? [] });
    }
    return NextResponse.json({ alert });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch alert' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json();
    const { action, ...updates } = body;

    if (action === 'activate') {
      const updated = PriceAlertStorage.updateAlert(params.id, {
        status: 'active',
        notificationSent: false,
      });
      if (!updated) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
      return NextResponse.json({ alert: updated });
    }

    if (action === 'deactivate') {
      const updated = PriceAlertStorage.updateAlert(params.id, { status: 'inactive' });
      if (!updated) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
      return NextResponse.json({ alert: updated });
    }

    const updated = PriceAlertStorage.updateAlert(params.id, updates);
    if (!updated) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    return NextResponse.json({ alert: updated });
  } catch {
    return NextResponse.json({ error: 'Failed to update alert' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const deleted = PriceAlertStorage.deleteAlert(params.id);
    if (!deleted) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    return NextResponse.json({ deleted: params.id });
  } catch {
    return NextResponse.json({ error: 'Failed to delete alert' }, { status: 500 });
  }
}
