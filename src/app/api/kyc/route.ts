import { NextRequest, NextResponse } from 'next/server';
import { KYCLimitService } from '@/lib/kyc-limits';

// GET: KYC status, AML result, reminders, or compliance report
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    const action = req.nextUrl.searchParams.get('action');

    if (action === 'compliance-report') {
      const from = parseInt(req.nextUrl.searchParams.get('from') || '0');
      const to = parseInt(req.nextUrl.searchParams.get('to') || String(Date.now()));
      const report = KYCLimitService.generateComplianceReport(from, to);
      return NextResponse.json({ report });
    }

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (action === 'aml') {
      const result = KYCLimitService.getAMLResult(userId);
      return NextResponse.json({ aml: result });
    }

    if (action === 'reminders') {
      const reminders = KYCLimitService.getKYCRenewalReminders(userId);
      return NextResponse.json({ reminders });
    }

    if (action === 'limits') {
      const limits = KYCLimitService.getUserLimits(userId);
      return NextResponse.json({ limits });
    }

    const kyc = KYCLimitService.getKYC(userId);
    return NextResponse.json({ kyc });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST: submit KYC, upload document, run AML screening
export async function POST(req: NextRequest) {
  try {
    const { action, userId, documentType, documentId, fileName, mimeType, transactionAmount } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (action === 'upload-document') {
      if (!documentType || !documentId) {
        return NextResponse.json({ error: 'documentType and documentId are required' }, { status: 400 });
      }
      const upload = KYCLimitService.uploadDocument(userId, documentType, documentId, fileName, mimeType);
      return NextResponse.json({ success: true, upload, kyc: KYCLimitService.getKYC(userId) });
    }

    if (action === 'aml-screen') {
      const result = KYCLimitService.screenAML(userId, transactionAmount);
      return NextResponse.json({ success: true, aml: result });
    }

    if (action === 'submit') {
      if (!documentType || !documentId) {
        return NextResponse.json({ error: 'documentType and documentId are required' }, { status: 400 });
      }
      const kyc = KYCLimitService.submitKYC(userId, documentType, documentId);
      return NextResponse.json({ success: true, kyc });
    }

    return NextResponse.json({ error: 'action must be "submit", "upload-document", or "aml-screen"' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH: verify/reject KYC, approve/reject limit increase
export async function PATCH(req: NextRequest) {
  try {
    const { action, userId, reason, requestedTier, requestId } = await req.json();

    if (!userId || !action) {
      return NextResponse.json({ error: 'userId and action are required' }, { status: 400 });
    }

    if (action === 'verify') {
      const kyc = KYCLimitService.verifyKYC(userId);
      if (!kyc) return NextResponse.json({ error: 'No KYC submission found for user' }, { status: 404 });
      return NextResponse.json({ success: true, kyc });
    }

    if (action === 'reject') {
      if (!reason) return NextResponse.json({ error: 'reason is required to reject KYC' }, { status: 400 });
      const kyc = KYCLimitService.rejectKYC(userId, reason);
      if (!kyc) return NextResponse.json({ error: 'No KYC submission found for user' }, { status: 404 });
      return NextResponse.json({ success: true, kyc });
    }

    if (action === 'request-limit-increase') {
      if (!requestedTier) return NextResponse.json({ error: 'requestedTier is required' }, { status: 400 });
      const request = KYCLimitService.requestLimitIncrease(userId, requestedTier);
      return NextResponse.json({ success: true, request });
    }

    if (action === 'approve-limit-increase') {
      if (!requestId) return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
      const approved = KYCLimitService.approveLimitIncrease(userId, requestId);
      if (!approved) return NextResponse.json({ error: 'Request not found or already processed' }, { status: 404 });
      return NextResponse.json({ success: true, limits: KYCLimitService.getUserLimits(userId) });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
