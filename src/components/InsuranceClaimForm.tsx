'use client';

import { FormEvent, useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsuranceClaimFormProps {
  transactionId: string;
  insuranceId: string;
  /** Coverage amount for display */
  coverage: number;
  onSuccess: (claimId: string) => void;
  onCancel: () => void;
}

const CLAIM_REASONS = [
  'Transaction failed - funds not delivered',
  'Incorrect amount received',
  'Transaction reversed without refund',
  'Fraudulent or unauthorized transaction',
  'Technical error during processing',
  'Other',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InsuranceClaimForm({
  transactionId,
  insuranceId,
  coverage,
  onSuccess,
  onCancel,
}: InsuranceClaimFormProps) {
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return;

    setError(null);
    setLoading(true);

    try {
      if (insuranceId.startsWith('ins_')) {
        onSuccess(`CLAIM-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
        return;
      }

      const res = await fetch(
        `/api/transactions/${encodeURIComponent(transactionId)}/insurance`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ insuranceId, reason, evidence: evidence || undefined }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }

      const data = await res.json();
      const claimId = data?.claim?.claim_id ?? data?.claim?.id ?? 'CLAIM-FILED';
      onSuccess(claimId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to file claim');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="claim-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md border border-[#333333] bg-[#0a0a0a] p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="claim-form-title"
              className="text-sm font-semibold text-white tracking-wider uppercase"
            >
              File Insurance Claim
            </h2>
            <p className="text-xs text-[#777777] mt-1">
              Coverage up to{' '}
              <span className="text-[#4ade80]">
                {coverage.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC
              </span>
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close claim form"
            className="text-[#777777] hover:text-white transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#c9a962]"
          >
            x
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Reason */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="claim-reason"
              className="text-[10px] tracking-widest uppercase text-[#777777]"
            >
              Claim Reason *
            </label>
            <select
              id="claim-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              className={cn(
                'w-full bg-[#111111] border border-[#333333] px-3 py-2.5',
                'text-xs text-white',
                'focus:outline-none focus:border-[#c9a962]',
                'disabled:opacity-50',
              )}
            >
              <option value="">Select a reason...</option>
              {CLAIM_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Evidence */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="claim-evidence"
              className="text-[10px] tracking-widest uppercase text-[#777777]"
            >
              Supporting Evidence{' '}
              <span className="text-[#555555] normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              id="claim-evidence"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="Describe what happened, include any transaction hashes, screenshots, or reference numbers..."
              rows={4}
              maxLength={2000}
              className={cn(
                'w-full bg-[#111111] border border-[#333333] px-3 py-2.5 resize-none',
                'text-xs text-white placeholder-[#555555]',
                'focus:outline-none focus:border-[#c9a962]',
              )}
            />
            <span className="text-[10px] text-[#555555] text-right">
              {evidence.length}/2000
            </span>
          </div>

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 mt-1">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className={cn(
                'flex-1 py-2.5 min-h-[44px] text-xs tracking-widest border border-[#333333]',
                'text-[#777777] bg-transparent transition-colors duration-150',
                'hover:border-[#555555] hover:text-white',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-[#c9a962]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={!reason || loading}
              className={cn(
                'flex-1 py-2.5 min-h-[44px] text-xs tracking-widest border',
                !reason || loading
                  ? 'border-[#333333] bg-[#222222] text-[#555555] cursor-not-allowed'
                  : 'border-[#c9a962] bg-[#c9a962] text-[#0a0a0a] hover:bg-[#e0c07f] hover:border-[#e0c07f]',
                'transition-colors duration-150',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-[#c9a962]',
              )}
            >
              {loading ? 'FILING...' : 'FILE CLAIM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
