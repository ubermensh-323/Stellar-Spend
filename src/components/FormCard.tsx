"use client";

import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  validateAmount,
  validateAccountNumber,
  isValidQuote,
} from "@/lib/offramp/utils/validation";
import { getCurrencyFlag } from "@/lib/currency-flags";
import { Skeleton } from "@/components/ui/Skeleton";
import { Label } from "@/components/ui/Label";
import { FormCardSkeleton } from "@/components/skeletons";
import { BankAccountInput, type BankMode } from "@/components/BankAccountInput";
import { QuoteComparison, type ProviderQuote } from "@/components/QuoteComparison";
import { Tooltip } from "@/components/Tooltip";
import { InsuranceOption, type InsuranceQuote } from "@/components/InsuranceOption";
import { useFxRate } from "@/hooks/useFxRate";
import type { QuoteResult as QuoteFetcherResult } from "@/lib/offramp/utils/quote-fetcher";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeeMethod = "USDC" | "XLM";

export type QuoteResult = QuoteFetcherResult;

export interface Currency {
  code: string;
  name: string;
}

export interface Institution {
  code: string;
  name: string;
}

export interface GasFeeOptions {
  usdcFee: string;
  xlmFee: string;
}

export interface OfframpPayload {
  amount: string;
  currency: string;
  institution: string;
  /** Account number, ABA routing number, or IBAN depending on bankMode */
  accountIdentifier: string;
  accountName: string;
  feeMethod: FeeMethod;
  bankMode: BankMode;
  routingNumber?: string;
  iban?: string;
  quote: QuoteResult | null;
  insurance: {
    enabled: boolean;
    quote: InsuranceQuote | null;
  };
}

export interface FormCardProps {
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onSubmit: (payload: OfframpPayload) => void;
  resetKey?: number;
  onQuoteChange?: (quote: QuoteResult | null) => void;
  onAmountChange?: (v: string) => void;
  onCurrencyChange?: (v: string) => void;
  /** Show a full-form skeleton (e.g. on first mount before wallet is ready) */
  isInitialLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: "₦",
  USD: "$",
  EUR: "€",
  GBP: "£",
  KES: "KSh",
  GHS: "₵",
  ZAR: "R",
};

function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] || currency.toUpperCase();
}

function formatPayout(amount: string, currency: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return "—";
  const symbol = getCurrencySymbol(currency);
  if (currency.toUpperCase() === "NGN") {
    return `${symbol}${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(num)}`;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${symbol} ${num.toFixed(2)}`;
  }
}

function buildProviderQuotes(quote: QuoteResult, currency: string): ProviderQuote[] {
  const base = parseFloat(quote.destinationAmount);
  const baseRate = quote.rate;
  const baseFee = parseFloat(quote.bridgeFee ?? "0.5");

  return [
    {
      id: "paycrest",
      provider: "Paycrest",
      rate: baseRate,
      bridgeFee: baseFee.toFixed(2),
      payoutFee: "0.00",
      totalFee: baseFee.toFixed(2),
      estimatedTime: 300,
      destinationAmount: base.toFixed(2),
      currency,
      rating: 5,
      badge: "Best Rate",
    },
    {
      id: "yellowcard",
      provider: "Yellow Card",
      rate: Math.round(baseRate * 0.992),
      bridgeFee: (baseFee + 0.3).toFixed(2),
      payoutFee: "0.50",
      totalFee: (baseFee + 0.8).toFixed(2),
      estimatedTime: 180,
      destinationAmount: (base * 0.992).toFixed(2),
      currency,
      rating: 4,
      badge: "Fastest",
    },
    {
      id: "kotani",
      provider: "Kotani Pay",
      rate: Math.round(baseRate * 0.985),
      bridgeFee: (baseFee + 0.1).toFixed(2),
      payoutFee: "0.20",
      totalFee: (baseFee + 0.3).toFixed(2),
      estimatedTime: 420,
      destinationAmount: (base * 0.985).toFixed(2),
      currency,
      rating: 4,
      badge: "Lowest Fee",
    },
  ];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface InputFieldProps {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  suffix?: string;
  error?: string;
  success?: string;
  touched?: boolean;
  inputMode?: "numeric" | "decimal" | "text";
  help?: string;
  validating?: boolean;
}

function InputField({
  label,
  id,
  value,
  onChange,
  onBlur,
  type = "text",
  placeholder,
  disabled,
  suffix,
  error,
  success,
  touched,
  inputMode,
  help,
  validating,
}: InputFieldProps) {
  const showError = touched && !!error;
  const showSuccess = touched && !error && !!success && !!value && !validating;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label
          htmlFor={id}
          className="text-[10px] tracking-[0.18em] text-[#777777] uppercase"
        >
          {label}
        </label>
        {help && (
          <Tooltip content={help} position="top">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-[#777777] hover:text-[#c9a962] cursor-help transition-colors"
              aria-label="Help"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          </Tooltip>
        )}
      </div>
      <div className="relative flex items-center">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          inputMode={inputMode}
          aria-invalid={showError ? "true" : undefined}
          aria-describedby={
            showError ? `${id}-error` : showSuccess ? `${id}-success` : help ? `${id}-help` : undefined
          }
          className={cn(
            "w-full bg-[#0a0a0a] border px-3 py-2.5 text-sm text-white placeholder-[#444444]",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-[#c9a962]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "transition-colors duration-150",
            showError
              ? "border-red-500/60 focus:border-red-500/80"
              : showSuccess
              ? "border-green-500/50 focus:border-green-500/70"
              : "border-[#333333] focus:border-[#c9a962]",
            suffix && "pr-20",
          )}
        />
        <span className="absolute right-3 pointer-events-none select-none flex items-center gap-2">
          {validating && (
            <span
              className="inline-block h-3 w-3 border-2 border-[#c9a962] border-t-transparent rounded-full animate-spin"
              aria-label="Validating…"
            />
          )}
          {!validating && showError && (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-red-400" aria-hidden="true">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4.5V8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="11" r="0.75" fill="currentColor" />
            </svg>
          )}
          {!validating && showSuccess && (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-green-400" aria-hidden="true">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M5 8L7 10L11 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {suffix && !showError && !showSuccess && !validating && (
            <span className="text-xs text-[#777777]">{suffix}</span>
          )}
        </span>
      </div>
      {showError && (
        <span id={`${id}-error`} role="alert" className="text-[10px] text-red-400 tracking-wide">
          {error}
        </span>
      )}
      {showSuccess && (
        <span id={`${id}-success`} className="text-[10px] text-green-400 tracking-wide">
          {success}
        </span>
      )}
      {!showError && !showSuccess && help && (
        <span id={`${id}-help`} className="text-[10px] text-[#666666] tracking-wide">
          {help}
        </span>
      )}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  touched?: boolean;
}

function SelectField({
  label,
  id,
  value,
  onChange,
  onBlur,
  options,
  placeholder = "Select...",
  disabled,
  loading,
  error,
  touched,
}: SelectFieldProps) {
  const showError = touched && !!error && !value;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[10px] tracking-[0.18em] text-[#777777] uppercase">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled || loading}
          aria-invalid={showError ? "true" : undefined}
          aria-describedby={showError ? `${id}-error` : undefined}
          className={cn(
            "w-full appearance-none bg-[#0a0a0a] border px-3 py-2.5 text-sm",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-[#c9a962] focus:border-[#c9a962]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "transition-colors duration-150",
            showError ? "border-red-500/60" : value ? "border-[#c9a962]/40" : "border-[#333333]",
            value ? "text-white" : "text-[#444444]",
          )}
        >
          <option value="" disabled>
            {loading ? "Loading..." : placeholder}
          </option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#111111] text-white">
              {opt.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#777777] text-xs">
          ▾
        </span>
      </div>
      {showError && (
        <span id={`${id}-error`} role="alert" className="text-[10px] text-red-400 tracking-wide">
          {error}
        </span>
      )}
    </div>
  );
}

function ResolvedField({
  label,
  value,
  loading,
  placeholder = "—",
}: {
  label: string;
  value: string;
  loading?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] tracking-[0.18em] text-[#777777] uppercase">{label}</span>
      <div
        className={cn(
          "bg-[#0a0a0a] border px-3 py-2.5 text-sm min-h-[42px] flex items-center justify-between",
          value && !loading ? "border-green-500/40" : "border-[#333333]",
        )}
      >
        <span>
          {loading ? (
            <span className="text-[#777777] text-xs tracking-wider">Resolving...</span>
          ) : value ? (
            <span className="text-[#c9a962]">{value}</span>
          ) : (
            <span className="text-[#444444]">{placeholder}</span>
          )}
        </span>
        {value && !loading && (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-green-400 shrink-0" aria-hidden="true">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 8L7 10L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}

function PayoutBox({
  quote,
  currency,
  liveRate,
  flash,
}: {
  quote: QuoteResult;
  currency: string;
  liveRate?: number | null;
  flash?: boolean;
}) {
  const effectiveRate = liveRate ?? quote.rate;
  const amount = parseFloat(quote.destinationAmount);
  const liveDestination =
    liveRate && quote.rate > 0
      ? ((amount / quote.rate) * liveRate).toFixed(2)
      : quote.destinationAmount;

  return (
    <div className="border border-[#c9a962]/30 bg-[#c9a962]/5 px-4 py-3 flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] tracking-[0.18em] text-[#777777] uppercase">Estimated Payout</span>
        <span className="text-[10px] text-[#777777]">
          Rate:{" "}
          {currency.toUpperCase() === "NGN"
            ? `${getCurrencySymbol(currency)}${new Intl.NumberFormat("en-NG").format(effectiveRate)}`
            : `${getCurrencySymbol(currency)} ${effectiveRate.toFixed(4)}`}{" "}
          / USDC
        </span>
      </div>
      <span
        className={cn(
          "font-bold text-lg tabular-nums transition-colors duration-300",
          flash ? "text-white" : "text-[#c9a962]",
        )}
      >
        {formatPayout(liveDestination, currency)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type CtaState = "disconnected" | "connecting" | "ready" | "submitting";

function getCtaLabel(state: CtaState): string {
  switch (state) {
    case "disconnected":
      return "CONNECT WALLET";
    case "connecting":
      return "WAITING FOR SIGNATURE...";
    case "submitting":
      return "INITIATING OFFRAMP...";
    default:
      return "INITIATE OFFRAMP →";
  }
}

export function FormCard({
  isConnecting,
  isConnected,
  onConnect,
  onSubmit,
  resetKey = 0,
  onQuoteChange,
  onAmountChange,
  onCurrencyChange,
  isInitialLoading,
}: FormCardProps) {
  const [amount, setAmount] = useState("");
  const [feeMethod, setFeeMethod] = useState<FeeMethod>("USDC");
  const [currency, setCurrency] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankMode, setBankMode] = useState<BankMode>("local");
  const [routingNumber, setRoutingNumber] = useState("");
  const [iban, setIban] = useState("");
  const [institution, setInstitution] = useState("");
  const [accountName, setAccountName] = useState("");

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [insuranceQuote, setInsuranceQuote] = useState<InsuranceQuote | null>(null);
  const [insuranceEnabled, setInsuranceEnabled] = useState(false);
  const [gasFees, setGasFees] = useState<GasFeeOptions | null>(null);

  const { rate: liveRate, flash: rateFlash } = useFxRate();

  const [isCurrenciesLoading, setIsCurrenciesLoading] = useState(false);
  const [isInstitutionsLoading, setIsInstitutionsLoading] = useState(false);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);
  const [isVerifyingAccount, setIsVerifyingAccount] = useState(false);
  const [isGasFeesLoading, setIsGasFeesLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [amountError, setAmountError] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string>("paycrest");

  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const touchField = (field: string) =>
    setTouchedFields((prev) => ({ ...prev, [field]: true }));

  const quoteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset form when resetKey changes
  useEffect(() => {
    if (resetKey === 0) return;
    setAmount("");
    setFeeMethod("USDC");
    setCurrency("");
    setAccountNumber("");
    setRoutingNumber("");
    setIban("");
    setInstitution("");
    setAccountName("");
    setQuote(null);
    setInsuranceQuote(null);
    setInsuranceEnabled(false);
    onQuoteChange?.(null);
    setAmountError("");
    setQuoteError("");
    setVerifyError("");
    setTouchedFields({});
  }, [resetKey, onQuoteChange]);

  // Fetch currencies on mount
  useEffect(() => {
    setIsCurrenciesLoading(true);
    fetch("/api/offramp/currencies")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCurrencies(data);
          const hasNGN = data.some((c: Currency) => c.code === "NGN");
          if (hasNGN) {
            setCurrency("NGN");
            onCurrencyChange?.("NGN");
          }
        }
      })
      .catch(() => {})
      .finally(() => setIsCurrenciesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch gas fee options on mount
  useEffect(() => {
    setIsGasFeesLoading(true);
    fetch("/api/offramp/bridge/gas-fee-options")
      .then((r) => r.json())
      .then((data) => setGasFees(data))
      .catch(() => setGasFees(null))
      .finally(() => setIsGasFeesLoading(false));
  }, []);

  // Fetch institutions when currency changes
  useEffect(() => {
    if (!currency) {
      setInstitutions([]);
      setInstitution("");
      return;
    }
    setIsInstitutionsLoading(true);
    setInstitution("");
    setAccountName("");
    fetch(`/api/offramp/institutions/${currency}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setInstitutions(data);
      })
      .catch(() => {})
      .finally(() => setIsInstitutionsLoading(false));
  }, [currency]);

  const fetchQuote = useCallback(
    (amt: string, cur: string, fee: FeeMethod) => {
      if (quoteDebounceRef.current) clearTimeout(quoteDebounceRef.current);
      const num = parseFloat(amt);
      if (!amt || isNaN(num) || num < 0.7 || !cur) {
        setQuote(null);
        onQuoteChange?.(null);
        return;
      }
      quoteDebounceRef.current = setTimeout(async () => {
        setIsQuoteLoading(true);
        setQuoteError("");
        try {
          const res = await fetch("/api/offramp/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount: amt, currency: cur, feeMethod: fee }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to fetch quote");
          if (!isValidQuote(data)) throw new Error("Invalid quote received");
          const result: QuoteResult = { ...data, currency: cur };
          setQuote(result);
          onQuoteChange?.(result);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Could not fetch quote";
          if (!msg.includes("Not implemented")) setQuoteError(msg);
          setQuote(null);
          onQuoteChange?.(null);
        } finally {
          setIsQuoteLoading(false);
        }
      }, 500);
    },
    [onQuoteChange],
  );

  const verifyAccount = useCallback(
    (accNum: string, inst: string, cur: string) => {
      if (verifyDebounceRef.current) clearTimeout(verifyDebounceRef.current);
      if (!validateAccountNumber(accNum) || !inst || !cur) {
        setAccountName("");
        return;
      }
      verifyDebounceRef.current = setTimeout(async () => {
        setIsVerifyingAccount(true);
        setVerifyError("");
        setAccountName("");
        try {
          const res = await fetch("/api/offramp/verify-account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              institution: inst,
              accountIdentifier: accNum,
              currency: cur,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Verification failed");
          setAccountName(data.accountName ?? "");
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Could not verify account";
          setVerifyError(msg);
        } finally {
          setIsVerifyingAccount(false);
        }
      }, 400);
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  const handleAmountChange = (val: string) => {
    setAmount(val);
    onAmountChange?.(val);
    if (!val) {
      setAmountError("");
    } else if (!validateAmount(val)) {
      setAmountError("Enter a valid number");
    } else if (parseFloat(val) < 0.7) {
      setAmountError("Minimum amount is 0.7 USDC");
    } else {
      setAmountError("");
    }
    fetchQuote(val, currency, feeMethod);
  };

  const handleCurrencyChange = (val: string) => {
    setCurrency(val);
    onCurrencyChange?.(val);
    fetchQuote(amount, val, feeMethod);
  };

  const handleInstitutionChange = (val: string) => {
    setInstitution(val);
    setAccountName("");
    setVerifyError("");
    if (accountNumber) verifyAccount(accountNumber, val, currency);
  };

  const handleAccountNumberChange = (val: string) => {
    setAccountNumber(val);
    verifyAccount(val, institution, currency);
  };

  const handleFeeMethodChange = (m: FeeMethod) => {
    setFeeMethod(m);
    fetchQuote(amount, currency, m);
  };

  const handleSubmit = async () => {
    // Mark all fields touched so validation messages appear
    setTouchedFields({
      amount: true,
      currency: true,
      institution: true,
      accountNumber: true,
    });

    if (
      !amount ||
      !currency ||
      !institution ||
      !accountNumber ||
      !accountName ||
      amountError ||
      verifyError
    ) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        amount,
        currency,
        institution,
        accountIdentifier: accountNumber,
        accountName,
        feeMethod,
        bankMode,
        routingNumber: routingNumber || undefined,
        iban: iban || undefined,
        quote,
        insurance: {
          enabled: insuranceEnabled,
          quote: insuranceQuote,
        },
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isInitialLoading) {
    return <FormCardSkeleton />;
  }

  const ctaState: CtaState = isConnecting
    ? "connecting"
    : !isConnected
    ? "disconnected"
    : isSubmitting
    ? "submitting"
    : "ready";

  const ctaDisabled =
    ctaState === "connecting" ||
    ctaState === "submitting" ||
    (ctaState === "ready" &&
      (!amount ||
        !!amountError ||
        !currency ||
        !institution ||
        !accountNumber ||
        !accountName ||
        !!verifyError));

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !ctaDisabled) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const handleSubmitForm = () => {
    void handleSubmit();
  };

  const getCtaDisabled = (_state: CtaState) => ctaDisabled;

  return (
    <section className="flex flex-col gap-6" onKeyDown={handleKeyDown}>
      <div className="bg-[#111111] border border-[#333333] p-6 flex flex-col gap-6">
        <InputField
          label="Amount (USDC)"
          id="amount"
          value={amount}
          onChange={handleAmountChange}
          onBlur={() => touchField("amount")}
          type="number"
          placeholder="0.00"
          suffix={isQuoteLoading ? "..." : "USDC"}
          error={amountError || quoteError}
          success={validateAmount(amount) && parseFloat(amount) >= 0.7 ? "Valid amount" : undefined}
          touched={touchedFields["amount"]}
          disabled={!isConnected || isSubmitting}
        />

      {/* Fee method */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] tracking-[0.18em] text-[#777777] uppercase">
          Gas Fee Method
        </span>
        {isGasFeesLoading ? (
          <div className="flex gap-2">
            <Skeleton width="50%" height={44} aria-label="Loading fee option…" />
            <Skeleton width="50%" height={44} aria-label="Loading fee option…" />
          </div>
        ) : (
          <div className="flex gap-2">
            {(["USDC", "XLM"] as FeeMethod[]).map((m) => {
              const fee = m === "USDC" ? gasFees?.usdcFee : gasFees?.xlmFee;
              const active = feeMethod === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleFeeMethodChange(m)}
                  disabled={!isConnected || isSubmitting}
                  className={cn(
                    "flex-1 py-2.5 px-3 min-h-[44px] text-xs tracking-widest border transition-colors duration-150",
                    "focus:outline-none focus-visible:ring-1 focus-visible:ring-[#c9a962]",
                    "disabled:opacity-40 disabled:cursor-not-allowed",
                    active
                      ? "border-[#c9a962] bg-[#c9a962]/10 text-[#c9a962]"
                      : "border-[#333333] bg-[#0a0a0a] text-[#777777] hover:border-[#c9a962]/50",
                  )}
                >
                  <span className="block font-semibold">{m}</span>
                  {fee && <span className="block text-[10px] mt-0.5 opacity-80">{fee}</span>}
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-[#666666] leading-relaxed">
          {feeMethod === "XLM"
            ? "XLM will be used to cover Stellar network fees."
            : "A small USDC amount will be deducted to cover network fees."}
        </p>
      </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SelectField
            label="Currency"
            id="currency"
            value={currency}
            options={currencies.map((c) => {
              const flag = getCurrencyFlag(c.code);
              return { value: c.code, label: flag ? `${flag} ${c.name} (${c.code})` : `${c.name} (${c.code})` };
            })}
            onChange={handleCurrencyChange}
            onBlur={() => touchField("currency")}
            loading={isCurrenciesLoading}
            disabled={!isConnected || isSubmitting}
            error="Please select a currency"
            touched={touchedFields["currency"]}
          />
          <SelectField
            label="Bank / Institution"
            id="institution"
            value={institution}
            options={institutions.map((i) => ({ value: i.code, label: i.name }))}
            onChange={handleInstitutionChange}
            onBlur={() => touchField("institution")}
            loading={isInstitutionsLoading}
            disabled={!currency || !isConnected || isSubmitting}
            placeholder={currency ? "Select bank..." : "Select currency first"}
            error="Please select a bank"
            touched={touchedFields["institution"]}
          />
        </div>

        {/* Account number */}
        <BankAccountInput
        mode={bankMode}
        onModeChange={setBankMode}
        accountNumber={accountNumber}
        onAccountNumberChange={handleAccountNumberChange}
        routingNumber={routingNumber}
        onRoutingNumberChange={setRoutingNumber}
        iban={iban}
        onIbanChange={setIban}
        disabled={!institution || !isConnected || isSubmitting}
      />

      {verifyError && (
        <span role="alert" className="text-[10px] text-red-400 tracking-wide">
          {verifyError}
        </span>
      )}

      <ResolvedField
        label="Account Name"
        value={accountName}
        loading={isVerifyingAccount}
        placeholder={accountNumber ? "Verifying…" : "Enter account number to verify"}
      />

      {quote && (
        <PayoutBox quote={quote} currency={currency} liveRate={liveRate} flash={rateFlash} />
      )}

      <InsuranceOption
        amount={parseFloat(amount) || 0}
        currency="USDC"
        disabled={!isConnected || isSubmitting}
        onToggle={(enabled, selectedQuote) => {
          setInsuranceEnabled(enabled);
          setInsuranceQuote(selectedQuote);
        }}
      />

        <button
          onClick={ctaState === "disconnected" ? onConnect : handleSubmitForm}
          disabled={getCtaDisabled(ctaState)}
          aria-label={getCtaLabel(ctaState)}
          className={cn(
            "w-full py-4 min-h-[52px] text-xs font-bold tracking-[0.2em] transition-all duration-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a962] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111111]",
            ctaState === "ready"
              ? "bg-[#c9a962] text-black hover:bg-[#d4b982]"
              : "bg-[#222222] text-[#555555] cursor-not-allowed border border-[#333333]",
            (ctaState === "connecting" || ctaState === "submitting") && "animate-pulse"
          )}
        >
          {getCtaLabel(ctaState)}
        </button>
      </div>
    </section>
  );
}

export default FormCard;
