'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsuranceQuote {
  premium: number;
  coverage: number;
  provider: 'default' | 'premium' | 'enterprise';
  riskScore: number;
  expiresAt: number;
}

export interface InsuranceOptionProps {
  /** Transaction amount in USDC */
  amount: number;
  /** Currency code for risk scoring (e.g. "USDC", "NGN") */
  currency?: string;
  /** Called when the user toggles insurance on/off */
  onToggle: (enabled: boolean, quote: InsuranceQuote | null) => void;
  /** Whether the parent form is disabled (e.g. wallet not connected) */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  default: 'Standard',
  premium: 'Premium',
  enterprise: 'Enterprise',
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  default: 'Basic coverage for everyday transactions',
  premium: 'Enhanced coverage with priority claim processing',
  enterprise: 'Full coverage with dedicated support & bulk discount',
};

const RISK_LABELS: Record<string, { label: string; color: string }> = {
  low: { label: 'Low Risk', color: 'text-[#4ade80]' },
  medium: { label: 'Medium Risk', color: 'text-[#fbbf24]' },
  high: { label: 'High Risk', color: 'text-[#f87171]' },
};

function getRiskBand(score: number): 'low' | 'medium' | 'high' {
  if (score < 40) return 'low';
  if (score < 65) return 'medium';
  return 'high';
}

function formatAmount(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Client-side premium calculation matching the service logic */
function calculateQuote(amount: number, currency: string): InsuranceQuote {
  const HIGH_VALUE_THRESHOLD = 10000;
  const BASE_RATE = 0.005;
  const HIGH_VALUE_RATE = 0.003;
  const stablecoins = ['USDC', 'USDT', 'DAI'];

  let riskScore = 50;
  if (amount > HIGH_VALUE_THRESHOLD) riskScore -= 10;
  if (amount < 100) riskScore += 10;
  if (stablecoins.includes(currency.toUpperCase())) riskScore -= 5;
  riskScore = Math.max(0, Math.min(100, riskScore));

  const rate = amount >= HIGH_VALUE_THRESHOLD ? HIGH_VALUE_RATE : BASE_RATE;
  const riskMultiplier = 1 + (riskScore - 50) / 500;
  const premium = parseFloat((amount * rate * riskMultiplier).toFixed(6));
  const coverage = parseFloat((amount * 1.1).toFixed(6));
  const provider =
    amount >= HIGH_VALUE_THRESHOLD ? 'enterprise' : amount >= 1000 ? 'premium' : 'default';

  return {
    premium,
    coverage,
    provider,
    riskScore,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
}

// ---------------------------------------------------------------------------
// Insurance Terms Modal
// ---------------------------------------------------------------------------

interface TermsModalProps {
  onClose: () => void;
}

function TermsModal({ onClose }: TermsModalProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="insurance-terms-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg border border-[#333333] bg-[#0a0a0a] p-6 flex flex-col gap-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <h2
            id="insurance-terms-title"
            className="text-sm font-semibold text-white tracking-wider uppercase"
          >
            Insurance Terms &amp; Conditions
          </h2>
          <button
            onClick={onClose}
            aria-label="Close terms"
            className="text-[#777777] hover:text-white transition-colors duration-150 flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#c9a962]"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 text-xs text-[#aaaaaa] leading-relaxed">
          <section>
            <h3 className="text-[10px] tracking-widest uppercase text-[#c9a962] mb-2">Coverage</h3>
            <p>
              Transaction insurance covers up to 110% of the insured transaction amount in the event
              of a verified loss. Coverage applies to failed, reversed, or fraudulent transactions
              confirmed by our review team.
            </p>
          </section>

          <section>
            <h3 className="text-[10px] tracking-widest uppercase text-[#c9a962] mb-2">Premium</h3>
            <p>
              The premium is calculated based on transaction amount, currency risk profile, and
              provider tier. Premiums are non-refundable once a transaction is submitted. High-value
              transactions (≥ $10,000 USDC) qualify for a bulk discount rate of 0.3%.
            </p>
          </section>

          <section>
            <h3 className="text-[10px] tracking-widest uppercase text-[#c9a962] mb-2">
              Filing a Claim
            </h3>
            <p>
              Claims must be filed within 30 days of the transaction date. You will need to provide
              a reason and any supporting evidence. Claims are reviewed within 5–10 business days.
              Approved claims are paid out to your connected wallet.
            </p>
          </section>

          <section>
            <h3 className="text-[10px] tracking-widest uppercase text-[#c9a962] mb-2">Exclusions</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>Transactions cancelled by the user</li>
              <li>Losses due to user error (wrong account, wrong amount)</li>
              <li>Transactions already covered by a separate dispute</li>
              <li>Fraudulent claims</li>
            </ul>
          </section>

          <section>
            <h3 className="text-[10px] tracking-widest uppercase text-[#c9a962] mb-2">
              Provider Tiers
            </h3>
            <div className="flex flex-col gap-2">
              {(['default', 'premium', 'enterprise'] as const).map((tier) => (
                <div key={tier} className="border border-[#222222] bg-[#111111] px-3 py-2">
                  <span className="text-white font-semibold">{PROVIDER_LABELS[tier]}</span>
                  <span className="text-[#777777] ml-2">— {PROVIDER_DESCRIPTIONS[tier]}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <button
          onClick={onClose}
          className={cn(
            'mt-2 w-full py-2.5 min-h-[44px] text-xs tracking-widest border border-[#c9a962]',
            'text-[#c9a962] bg-transparent transition-colors duration-150',
            'hover:bg-[#c9a962] hover:text-[#0a0a0a]',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-[#c9a962]',
          )}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function InsuranceOption({
  amount,
  currency = 'USDC',
  onToggle,
  disabled = false,
}: InsuranceOptionProps) {
  const [enabled, setEnabled] = useState(false);
  const [quote, setQuote] = useState<InsuranceQuote | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Recalculate quote whenever amount/currency changes
  useEffect(() => {
    if (amount <= 0) {
      setQuote(null);
      if (enabled) {
        onToggle(false, null);
      }
      setEnabled(false);
      setTimeLeft(null);
      return;
    }
    const q = calculateQuote(amount, currency);
    setQuote(q);
    // If insurance was already enabled, update the parent with the new quote
    if (enabled) {
      onToggle(true, q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, currency]);

  // Countdown timer for quote expiry
  useEffect(() => {
    if (!quote || !enabled) {
      setTimeLeft(null);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const tick = () => {
      const remaining = quote.expiresAt - Date.now();
      if (remaining <= 0) {
        setTimeLeft(0);
        // Refresh quote on expiry
        const fresh = calculateQuote(amount, currency);
        setQuote(fresh);
        onToggle(true, fresh);
      } else {
        setTimeLeft(remaining);
      }
    };

    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [quote, enabled, amount, currency, onToggle]);

  const handleToggle = useCallback(() => {
    if (disabled || amount <= 0) return;
    const newState = !enabled;
    setEnabled(newState);
    if (newState && !quote) {
      const q = calculateQuote(amount, currency);
      setQuote(q);
      onToggle(true, q);
    } else {
      onToggle(newState, newState ? quote : null);
    }
  }, [disabled, amount, currency, enabled, quote, onToggle]);

  const riskBand = quote ? getRiskBand(quote.riskScore) : null;
  const riskInfo = riskBand ? RISK_LABELS[riskBand] : null;
  const isDisabled = disabled || amount <= 0;

  return (
    <>
      <div
        className={cn(
          'border transition-colors duration-150',
          enabled ? 'border-[#c9a962] bg-[#c9a962]/5' : 'border-[#333333] bg-[#0a0a0a]',
          isDisabled && 'opacity-50 cursor-not-allowed',
        )}
        role="group"
        aria-labelledby="insurance-option-label"
      >
        {/* ── Header row ── */}
        <div className="px-4 py-3 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Toggle switch */}
            <button
              role="switch"
              aria-checked={enabled}
              aria-labelledby="insurance-option-label"
              aria-disabled={isDisabled}
              onClick={handleToggle}
              disabled={isDisabled}
              className={cn(
                'relative flex-shrink-0 mt-0.5 w-10 h-5 rounded-full transition-colors duration-200',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a962] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]',
                enabled ? 'bg-[#c9a962]' : 'bg-[#333333]',
                isDisabled && 'cursor-not-allowed',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200',
                  enabled && 'translate-x-5',
                )}
                aria-hidden="true"
              />
            </button>

            {/* Label + description */}
            <div className="flex-1 min-w-0">
              <p
                id="insurance-option-label"
                className={cn(
                  'text-sm font-semibold tracking-wide',
                  enabled ? 'text-[#c9a962]' : 'text-white',
                )}
              >
                Transaction Insurance
              </p>
              <p className="text-xs text-[#777777] mt-0.5">
                Protect this transaction against loss or failure
              </p>
            </div>
          </div>

          {/* Terms link */}
          <button
            onClick={() => setShowTerms(true)}
            className={cn(
              'flex-shrink-0 text-[10px] tracking-widest uppercase text-[#777777]',
              'hover:text-[#c9a962] transition-colors duration-150',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-[#c9a962]',
            )}
            aria-label="View insurance terms and conditions"
          >
            Terms
          </button>
        </div>

        {/* ── Premium breakdown (always visible when amount > 0) ── */}
        {quote && amount > 0 && (
          <div className="border-t border-[#222222] px-4 py-3 flex flex-col gap-2">
            {/* Provider tier badge */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] tracking-widest uppercase text-[#777777]">Provider</span>
              <span
                className={cn(
                  'text-[10px] tracking-widest uppercase px-2 py-0.5 border',
                  quote.provider === 'enterprise'
                    ? 'border-[#c9a962] text-[#c9a962]'
                    : quote.provider === 'premium'
                      ? 'border-[#60a5fa] text-[#60a5fa]'
                      : 'border-[#555555] text-[#aaaaaa]',
                )}
              >
                {PROVIDER_LABELS[quote.provider]}
              </span>
            </div>

            {/* Risk score */}
            {riskInfo && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] tracking-widest uppercase text-[#777777]">
                  Risk Score
                </span>
                <span className={cn('text-xs tabular-nums', riskInfo.color)}>
                  {quote.riskScore}/100 — {riskInfo.label}
                </span>
              </div>
            )}

            {/* Premium */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] tracking-widest uppercase text-[#777777]">Premium</span>
              <span className="text-xs text-white tabular-nums">
                {formatAmount(quote.premium)} USDC
                <span className="text-[#777777] ml-1">
                  ({amount >= 10000 ? '0.3%' : '0.5%'} rate)
                </span>
              </span>
            </div>

            {/* Coverage */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] tracking-widest uppercase text-[#777777]">Coverage</span>
              <span className="text-xs text-[#4ade80] tabular-nums">
                Up to {formatAmount(quote.coverage)} USDC
              </span>
            </div>

            {/* Quote expiry countdown (only when enabled) */}
            {enabled && timeLeft !== null && (
              <div className="flex items-center justify-between gap-2 mt-1 pt-2 border-t border-[#222222]">
                <span className="text-[10px] tracking-widest uppercase text-[#777777]">
                  Quote expires
                </span>
                <span
                  className={cn(
                    'text-[10px] tabular-nums font-mono',
                    timeLeft < 60000 ? 'text-[#f87171]' : 'text-[#777777]',
                  )}
                  aria-live="polite"
                  aria-label={`Quote expires in ${formatCountdown(timeLeft)}`}
                >
                  {formatCountdown(timeLeft)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Disabled hint ── */}
        {amount <= 0 && (
          <div className="border-t border-[#222222] px-4 py-2">
            <p className="text-[10px] text-[#555555] tracking-wide">
              Enter a transaction amount to see insurance options
            </p>
          </div>
        )}
      </div>

      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
    </>
  );
}
