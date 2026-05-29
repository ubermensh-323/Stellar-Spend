"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Transaction } from "@/lib/transaction-storage";
import { TransactionStorage } from "@/lib/transaction-storage";
import { useStellarWallet } from "@/hooks/useStellarWallet";
import { Header } from "@/components/Header";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/cn";
import { getCurrencyFlag } from "@/lib/currency-flags";
import { TransactionTableSkeleton } from "@/components/skeletons";
import ExportControls from "@/components/ExportControls";
import { StatusBadge } from "@/components/StatusBadge";
import { InsuranceClaimForm } from "@/components/InsuranceClaimForm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function truncateTxHash(hash: string): string {
  if (!hash || hash.length <= 12) return hash || "—";
  return `${hash.slice(0, 6)}...${hash.slice(-6)}`;
}

function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    NGN: "₦",
    USD: "$",
    EUR: "€",
    GBP: "£",
    KES: "KSh",
    GHS: "₵",
    ZAR: "R",
  };
  return symbols[currency.toUpperCase()] || currency.toUpperCase();
}

function formatUsdc(amount: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function getInsuranceStatusLabel(status: NonNullable<Transaction["insurance"]>["status"]): string {
  const labels: Record<NonNullable<Transaction["insurance"]>["status"], string> = {
    pending: "Pending",
    active: "Active",
    claimed: "Claim filed",
    claim_approved: "Approved",
    claim_rejected: "Rejected",
    paid: "Paid",
  };
  return labels[status];
}

function canFileClaim(tx: Transaction): boolean {
  return !!tx.insurance && tx.insurance.status === "active";
}

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

type SortField = "timestamp" | "amount" | "status";
type SortDir = "asc" | "desc";

interface Filters {
  search: string;
  status: Transaction["status"] | "all";
  currency: string; // "" = all
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  sortField: SortField;
  sortDir: SortDir;
}

const DEFAULT_FILTERS: Filters = {
  search: "",
  status: "all",
  currency: "",
  dateFrom: "",
  dateTo: "",
  amountMin: "",
  amountMax: "",
  sortField: "timestamp",
  sortDir: "desc",
};

const FILTERS_STORAGE_KEY = "stellar_spend_history_filters";

function loadStoredFilters(): Filters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw);
    // Merge with defaults so older stored shapes don't drop new fields.
    return { ...DEFAULT_FILTERS, ...parsed };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function activeFilterCount(filters: Filters): number {
  let count = 0;
  if (filters.search.trim()) count++;
  if (filters.status !== "all") count++;
  if (filters.currency) count++;
  if (filters.dateFrom) count++;
  if (filters.dateTo) count++;
  if (filters.amountMin) count++;
  if (filters.amountMax) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HistoryPage() {
  const { wallet, isConnected, isConnecting, connect, disconnect } =
    useStellarWallet();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [claimingTransaction, setClaimingTransaction] = useState<Transaction | null>(null);

  // Hydrate filters from localStorage on mount (client-only).
  useEffect(() => {
    setFilters(loadStoredFilters());
    setFiltersLoaded(true);
  }, []);

  // Persist filters whenever they change (after initial hydration).
  useEffect(() => {
    if (!filtersLoaded) return;
    try {
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // localStorage may be unavailable (e.g. quota, private mode); fail silently.
    }
  }, [filters, filtersLoaded]);

  useEffect(() => {
    if (!wallet?.publicKey) {
      setTransactions([]);
      setError(null);
      return;
    }

    const address = wallet.publicKey;
    setIsLoading(true);
    setError(null);

    fetch(`/api/transactions?wallet=${encodeURIComponent(address)}`)
      .then((res) => {
        if (!res.ok) {
          return res.json().then(
            (body) => {
              throw new Error(body?.error ?? "Failed to load transactions");
            },
            () => {
              throw new Error("Failed to load transactions");
            },
          );
        }
        return res.json() as Promise<Transaction[]>;
      })
      .then((data) => {
        const localTransactions = TransactionStorage.getByUser(address);
        const merged = new Map<string, Transaction>();
        [...data, ...localTransactions].forEach((tx) => merged.set(tx.id, tx));
        setTransactions(Array.from(merged.values()));
      })
      .catch((err: unknown) => {
        const localTransactions = TransactionStorage.getByUser(address);
        setTransactions(localTransactions);
        setError(
          localTransactions.length > 0
            ? null
            : err instanceof Error
              ? err.message
              : "Failed to load transactions",
        );
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [wallet?.publicKey]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  // Optimistic note save: update UI + local storage immediately, persist to
  // the server, and rollback both layers if the request fails.
  const saveNote = async (id: string) => {
    const trimmed = noteInput.slice(0, 500);
    const previous = transactions.find((tx) => tx.id === id)?.note;

    setEditingNoteId(null);
    setNoteError(null);

    // Optimistic UI + local persistence.
    setTransactions((prev) =>
      prev.map((tx) => (tx.id === id ? { ...tx, note: trimmed } : tx)),
    );
    const rollbackLocal = TransactionStorage.applyOptimistic(id, { note: trimmed });

    try {
      const res = await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
    } catch (err) {
      // Rollback UI + local storage.
      setTransactions((prev) =>
        prev.map((tx) => (tx.id === id ? { ...tx, note: previous } : tx)),
      );
      rollbackLocal();
      setNoteError(err instanceof Error ? err.message : "Failed to save note");
    }
  };

  const toggleSort = (field: SortField) =>
    setFilters((prev) => ({
      ...prev,
      sortField: field,
      sortDir:
        prev.sortField === field && prev.sortDir === "desc" ? "asc" : "desc",
    }));

  // Distinct currencies present in the user's transactions, for the filter dropdown.
  const availableCurrencies = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => tx.currency && set.add(tx.currency));
    return Array.from(set).sort();
  }, [transactions]);

  const filtered = useMemo(() => {
    let result = [...transactions];

    // Search by ID, tx hash, or note
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      result = result.filter(
        (tx) =>
          tx.id.toLowerCase().includes(q) ||
          (tx.stellarTxHash?.toLowerCase().includes(q) ?? false) ||
          (tx.note?.toLowerCase().includes(q) ?? false),
      );
    }

    // Status filter
    if (filters.status !== "all") {
      result = result.filter((tx) => tx.status === filters.status);
    }

    // Currency filter
    if (filters.currency) {
      result = result.filter((tx) => tx.currency === filters.currency);
    }

    // Date range
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom).getTime();
      result = result.filter((tx) => tx.timestamp >= from);
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo).getTime() + 86_400_000 - 1;
      result = result.filter((tx) => tx.timestamp <= to);
    }

    // Amount range
    if (filters.amountMin !== "") {
      const min = parseFloat(filters.amountMin);
      if (!isNaN(min))
        result = result.filter((tx) => parseFloat(tx.amount) >= min);
    }
    if (filters.amountMax !== "") {
      const max = parseFloat(filters.amountMax);
      if (!isNaN(max))
        result = result.filter((tx) => parseFloat(tx.amount) <= max);
    }

    // Sort
    result.sort((a, b) => {
      let diff = 0;
      if (filters.sortField === "timestamp") diff = a.timestamp - b.timestamp;
      else if (filters.sortField === "amount")
        diff = parseFloat(a.amount) - parseFloat(b.amount);
      else if (filters.sortField === "status")
        diff = a.status.localeCompare(b.status);
      return filters.sortDir === "asc" ? diff : -diff;
    });

    return result;
  }, [transactions, filters]);

  const insuredTransactions = useMemo(
    () => transactions.filter((tx) => tx.insurance),
    [transactions],
  );

  const activeCoverage = insuredTransactions.reduce(
    (sum, tx) =>
      tx.insurance && ["pending", "active", "claimed", "claim_approved"].includes(tx.insurance.status)
        ? sum + tx.insurance.coverage
        : sum,
    0,
  );

  const handleClaimSuccess = (claimId: string) => {
    if (!claimingTransaction?.insurance) return;
    const updatedInsurance = {
      ...claimingTransaction.insurance,
      status: "claimed" as const,
      claimId,
    };
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.id === claimingTransaction.id ? { ...tx, insurance: updatedInsurance } : tx,
      ),
    );
    TransactionStorage.update(claimingTransaction.id, { insurance: updatedInsurance });
    setClaimingTransaction(null);
  };

  const filterCount = activeFilterCount(filters);
  const hasActiveFilters = filterCount > 0;

  const SortIcon = ({ field }: { field: SortField }) => {
    if (filters.sortField !== field)
      return <span className="ml-1 opacity-30">↕</span>;
    return (
      <span className="ml-1">{filters.sortDir === "asc" ? "↑" : "↓"}</span>
    );
  };

  return (
    <main className="min-h-screen p-4 bg-[#0a0a0a]">
      <Header
        subtitle="View your transaction history"
        isConnected={isConnected}
        isConnecting={isConnecting}
        walletAddress={wallet?.publicKey}
        onConnect={(walletType) => connect(walletType)}
        onDisconnect={disconnect}
      />

      <section className="border border-[#333333] px-[2.6rem] py-8 max-[1100px]:p-4 mt-6">
        {/* Page header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-wider mb-1">
              Transaction History
            </h1>
            <p className="text-xs text-[#777777] tracking-wide">
              {isConnected
                ? `Showing ${filtered.length} of ${transactions.length} transaction${transactions.length !== 1 ? "s" : ""}`
                : "Connect your wallet to view transaction history"}
            </p>
          </div>
          <Link
            href="/"
            className={cn(
              "self-start sm:self-auto text-[10px] tracking-widest uppercase text-[#c9a962] border border-[#c9a962] px-4 py-2 min-h-[44px] flex items-center",
              "hover:bg-[#c9a962] hover:text-[#0a0a0a] transition-colors duration-150",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-[#c9a962]",
            )}
          >
            ← Back to Dashboard
          </Link>
        </div>

        {!isConnected ? (
          <div className="border border-[#333333] bg-[#111111] p-12 text-center">
            <p className="text-sm text-[#777777] mb-4">
              Please connect your wallet to view transaction history
            </p>
            <button
              onClick={() => connect()}
              className={cn(
                "px-6 py-3 min-h-[44px] text-xs tracking-widest border border-[#c9a962]",
                "text-[#c9a962] bg-transparent transition-colors duration-150",
                "hover:bg-[#c9a962] hover:text-[#0a0a0a]",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a962]",
              )}
            >
              CONNECT WALLET
            </button>
          </div>
        ) : isLoading ? (
          <TransactionTableSkeleton rows={5} />
        ) : error ? (
          <div
            role="alert"
            className="border border-red-500/30 bg-red-500/10 p-6 text-center"
          >
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : (
          <>
            <ExportControls
              transactions={transactions}
              walletAddress={wallet?.publicKey}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
              <div className="border border-[#333333] bg-[#111111] p-4">
                <p className="text-[10px] tracking-widest uppercase text-[#777777]">Insured Transactions</p>
                <p className="mt-2 text-2xl font-semibold text-white tabular-nums">
                  {insuredTransactions.length}
                </p>
              </div>
              <div className="border border-[#333333] bg-[#111111] p-4">
                <p className="text-[10px] tracking-widest uppercase text-[#777777]">Active Coverage</p>
                <p className="mt-2 text-2xl font-semibold text-[#4ade80] tabular-nums">
                  {formatUsdc(activeCoverage)} USDC
                </p>
              </div>
              <div className="border border-[#333333] bg-[#111111] p-4">
                <p className="text-[10px] tracking-widest uppercase text-[#777777]">Claims Filed</p>
                <p className="mt-2 text-2xl font-semibold text-[#c9a962] tabular-nums">
                  {insuredTransactions.filter((tx) => tx.insurance?.claimId).length}
                </p>
              </div>
            </div>

            {/* ── Filters ── */}
            <div className="border border-[#333333] bg-[#111111] p-4 mt-4">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-[10px] tracking-widest uppercase text-[#aaaaaa]">
                  Filters
                </h2>
                {hasActiveFilters && (
                  <span
                    aria-label={`${filterCount} active filter${filterCount === 1 ? "" : "s"}`}
                    className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 text-[10px] font-bold rounded-full bg-[#c9a962] text-[#0a0a0a]"
                  >
                    {filterCount}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-3 items-end">
                {/* Search */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[#777777] uppercase tracking-widest">
                    Search
                  </label>
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => set("search", e.target.value)}
                    placeholder="TX hash, ID, or note"
                    aria-label="Search transactions"
                    className={cn(
                      "w-48 bg-[#0a0a0a] border border-[#333333] px-3 py-2",
                      "text-xs text-white placeholder-[#555555]",
                      "focus:outline-none focus:border-[#c9a962]",
                    )}
                  />
                </div>

                {/* Status */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[#777777] uppercase tracking-widest">
                    Status
                  </label>
                  <select
                    value={filters.status}
                    onChange={(e) =>
                      set("status", e.target.value as Filters["status"])
                    }
                    aria-label="Filter by status"
                    className={cn(
                      "bg-[#0a0a0a] border border-[#333333] px-3 py-2",
                      "text-xs text-white",
                      "focus:outline-none focus:border-[#c9a962]",
                    )}
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                    <option value="reversed">Reversed</option>
                    <option value="partially_reversed">Partially reversed</option>
                  </select>
                </div>

                {/* Currency */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[#777777] uppercase tracking-widest">
                    Currency
                  </label>
                  <select
                    value={filters.currency}
                    onChange={(e) => set("currency", e.target.value)}
                    aria-label="Filter by currency"
                    disabled={availableCurrencies.length === 0}
                    className={cn(
                      "bg-[#0a0a0a] border border-[#333333] px-3 py-2",
                      "text-xs text-white",
                      "focus:outline-none focus:border-[#c9a962]",
                      "disabled:opacity-50 disabled:cursor-not-allowed",
                    )}
                  >
                    <option value="">All</option>
                    {availableCurrencies.map((c) => (
                      <option key={c} value={c}>
                        {getCurrencyFlag(c) ? `${getCurrencyFlag(c)} ${c}` : c}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date from */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[#777777] uppercase tracking-widest">
                    From
                  </label>
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => set("dateFrom", e.target.value)}
                    aria-label="Filter from date"
                    className={cn(
                      "bg-[#0a0a0a] border border-[#333333] px-3 py-2",
                      "text-xs text-white [color-scheme:dark]",
                      "focus:outline-none focus:border-[#c9a962]",
                    )}
                  />
                </div>

                {/* Date to */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[#777777] uppercase tracking-widest">
                    To
                  </label>
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => set("dateTo", e.target.value)}
                    aria-label="Filter to date"
                    className={cn(
                      "bg-[#0a0a0a] border border-[#333333] px-3 py-2",
                      "text-xs text-white [color-scheme:dark]",
                      "focus:outline-none focus:border-[#c9a962]",
                    )}
                  />
                </div>

                {/* Amount min */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[#777777] uppercase tracking-widest">
                    Min USDC
                  </label>
                  <input
                    type="number"
                    value={filters.amountMin}
                    onChange={(e) => set("amountMin", e.target.value)}
                    placeholder="0"
                    aria-label="Minimum amount"
                    className={cn(
                      "w-24 bg-[#0a0a0a] border border-[#333333] px-3 py-2",
                      "text-xs text-white placeholder-[#555555]",
                      "focus:outline-none focus:border-[#c9a962]",
                    )}
                  />
                </div>

                {/* Amount max */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[#777777] uppercase tracking-widest">
                    Max USDC
                  </label>
                  <input
                    type="number"
                    value={filters.amountMax}
                    onChange={(e) => set("amountMax", e.target.value)}
                    placeholder="∞"
                    aria-label="Maximum amount"
                    className={cn(
                      "w-24 bg-[#0a0a0a] border border-[#333333] px-3 py-2",
                      "text-xs text-white placeholder-[#555555]",
                      "focus:outline-none focus:border-[#c9a962]",
                    )}
                  />
                </div>

                {hasActiveFilters && (
                  <button
                    onClick={() => setFilters(DEFAULT_FILTERS)}
                    className={cn(
                      "ml-auto text-[10px] tracking-widest uppercase px-3 py-2",
                      "border border-[#555555] text-[#777777]",
                      "hover:border-[#c9a962] hover:text-[#c9a962] transition-colors duration-150",
                    )}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            {noteError && (
              <div role="alert" className="mt-3 border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">
                {noteError}
              </div>
            )}

            {/* ── Table ── */}
            {filtered.length === 0 ? (
              <div className="border border-[#333333] bg-[#111111] p-12 text-center mt-4">
                <p className="text-sm text-[#777777]">
                  {transactions.length === 0
                    ? "No transactions found"
                    : "No transactions match the current filters"}
                </p>
              </div>
            ) : (
              <div className="border border-[#333333] bg-[#111111] overflow-x-auto mt-4">
                <table
                  className="w-full min-w-[800px] border-collapse"
                  aria-label="Transaction history"
                >
                  <thead>
                    <tr className="bg-[#c9a962]">
                      <th
                        className="px-5 py-2.5 text-left text-[10px] tracking-[0.18em] font-semibold text-[#0a0a0a] uppercase whitespace-nowrap cursor-pointer select-none"
                        onClick={() => toggleSort("timestamp")}
                        aria-sort={
                          filters.sortField === "timestamp"
                            ? filters.sortDir === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        DATE <SortIcon field="timestamp" />
                      </th>
                      <th className="px-5 py-2.5 text-left text-[10px] tracking-[0.18em] font-semibold text-[#0a0a0a] uppercase whitespace-nowrap">
                        TX HASH
                      </th>
                      <th
                        className="px-5 py-2.5 text-left text-[10px] tracking-[0.18em] font-semibold text-[#0a0a0a] uppercase whitespace-nowrap cursor-pointer select-none"
                        onClick={() => toggleSort("amount")}
                        aria-sort={
                          filters.sortField === "amount"
                            ? filters.sortDir === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        AMOUNT <SortIcon field="amount" />
                      </th>
                      <th className="px-5 py-2.5 text-left text-[10px] tracking-[0.18em] font-semibold text-[#0a0a0a] uppercase whitespace-nowrap">
                        CURRENCY
                      </th>
                      <th className="px-5 py-2.5 text-left text-[10px] tracking-[0.18em] font-semibold text-[#0a0a0a] uppercase whitespace-nowrap">
                        BANK
                      </th>
                      <th
                        className="px-5 py-2.5 text-left text-[10px] tracking-[0.18em] font-semibold text-[#0a0a0a] uppercase whitespace-nowrap cursor-pointer select-none"
                        onClick={() => toggleSort("status")}
                        aria-sort={
                          filters.sortField === "status"
                            ? filters.sortDir === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        STATUS <SortIcon field="status" />
                      </th>
                      <th className="px-5 py-2.5 text-left text-[10px] tracking-[0.18em] font-semibold text-[#0a0a0a] uppercase whitespace-nowrap">
                        NOTE
                      </th>
                      <th className="px-5 py-2.5 text-left text-[10px] tracking-[0.18em] font-semibold text-[#0a0a0a] uppercase whitespace-nowrap">
                        INSURANCE
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((tx, i) => (
                      <tr
                        key={tx.id}
                        className={cn(
                          "border-b border-[#222222] transition-colors duration-100",
                          i % 2 === 0 ? "bg-[#111111]" : "bg-[#0f0f0f]",
                          "hover:bg-[#1a1a1a]",
                        )}
                      >
                        <td className="px-5 py-3 text-xs text-[#aaaaaa] whitespace-nowrap">
                          {formatDate(tx.timestamp)}
                        </td>
                        <td className="px-5 py-3 text-xs text-[#777777] font-mono whitespace-nowrap">
                          {tx.stellarTxHash ? (
                            <div className="flex items-center gap-2">
                              <a
                                href={`https://stellar.expert/explorer/public/tx/${tx.stellarTxHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-[#c9a962] transition-colors duration-150 underline decoration-dotted"
                              >
                                {truncateTxHash(tx.stellarTxHash)}
                              </a>
                              <CopyButton
                                text={tx.stellarTxHash}
                                label=""
                                className="text-[10px]"
                              />
                            </div>
                          ) : (
                            <span className="text-[#555555]">Pending</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs text-white tabular-nums whitespace-nowrap">
                          {tx.amount} USDC
                        </td>
                        <td className="px-5 py-3 text-xs text-white whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            {getCurrencyFlag(tx.currency) && (
                              <span
                                aria-hidden="true"
                                className="text-base leading-none"
                              >
                                {getCurrencyFlag(tx.currency)}
                              </span>
                            )}
                            {getCurrencySymbol(tx.currency)} {tx.currency}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-[#aaaaaa] whitespace-nowrap">
                          {tx.beneficiary.institution}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <StatusBadge status={tx.status} />
                        </td>
                        <td className="px-5 py-3 text-xs max-w-[200px]">
                          {editingNoteId === tx.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                maxLength={500}
                                value={noteInput}
                                onChange={(e) => setNoteInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveNote(tx.id);
                                  if (e.key === "Escape") setEditingNoteId(null);
                                }}
                                className="flex-1 bg-[#0a0a0a] border border-[#c9a962] px-2 py-1 text-xs text-white focus:outline-none"
                                aria-label="Edit note"
                              />
                              <button
                                onClick={() => saveNote(tx.id)}
                                className="text-[#c9a962] hover:text-white text-[10px] px-1"
                                aria-label="Save note"
                              >✓</button>
                              <button
                                onClick={() => setEditingNoteId(null)}
                                className="text-[#777777] hover:text-white text-[10px] px-1"
                                aria-label="Cancel"
                              >✕</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingNoteId(tx.id);
                                setNoteInput(tx.note ?? "");
                              }}
                              className="text-left text-[#777777] hover:text-[#c9a962] transition-colors duration-150 truncate max-w-[180px] block"
                              title={tx.note || "Add note"}
                              aria-label={tx.note ? `Edit note: ${tx.note}` : "Add note"}
                            >
                              {tx.note || <span className="text-[#444444] italic">+ add note</span>}
                            </button>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs whitespace-nowrap">
                          {tx.insurance ? (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <span className="border border-[#c9a962]/40 bg-[#c9a962]/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-[#c9a962]">
                                  {getInsuranceStatusLabel(tx.insurance.status)}
                                </span>
                                <span className="text-[#777777]">
                                  {formatUsdc(tx.insurance.premium)} USDC premium
                                </span>
                              </div>
                              <span className="text-[#4ade80]">
                                {formatUsdc(tx.insurance.coverage)} USDC coverage
                              </span>
                              {tx.insurance.claimId && (
                                <span className="font-mono text-[10px] text-[#777777]">
                                  {tx.insurance.claimId}
                                </span>
                              )}
                              {canFileClaim(tx) && (
                                <button
                                  onClick={() => setClaimingTransaction(tx)}
                                  className="w-fit text-[10px] tracking-widest uppercase text-[#c9a962] hover:text-white transition-colors duration-150"
                                >
                                  File claim
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-[#555555]">Not insured</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {claimingTransaction?.insurance?.id && (
        <InsuranceClaimForm
          transactionId={claimingTransaction.id}
          insuranceId={claimingTransaction.insurance.id}
          coverage={claimingTransaction.insurance.coverage}
          onSuccess={handleClaimSuccess}
          onCancel={() => setClaimingTransaction(null)}
        />
      )}
    </main>
  );
}
