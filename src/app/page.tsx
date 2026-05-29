"use client";

import { useState, useCallback, useRef } from "react";
import FormCard, { type OfframpPayload } from "@/components/FormCard";
import type { QuoteResult } from "@/components/FormCard";
import RightPanel from "@/components/RightPanel";
import RecentOfframpsTable from "@/components/RecentOfframpsTable";
import ProgressSteps from "@/components/ProgressSteps";
import { Header } from "@/components/Header";
import { TransactionProgressModal } from "@/components/TransactionProgressModal";
import { Tutorial, useTutorial } from "@/components/Tutorial";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { HelpModal } from "@/components/HelpModal";
import { useKeyboardShortcuts, type Shortcut } from "@/hooks/useKeyboardShortcuts";
import { useStellarWallet } from "@/hooks/useStellarWallet";
import { usePollBridgeStatus } from "@/hooks/usePollBridgeStatus";
import { usePollPayoutStatus } from "@/hooks/usePollPayoutStatus";
import { TransactionStorage } from "@/lib/transaction-storage";
import { withTimeout } from "@/lib/offramp/utils/timeout";
import { HELP_TOPICS } from "@/lib/help-topics";
import type { OfframpStep } from "@/types/stellaramp";
import type { WalletType } from "@/lib/stellar/wallet-adapter";

export default function Home() {
  const { wallet, isConnected, isConnecting, error: walletError, connect, disconnect, signTransaction } =
    useStellarWallet();

  const { open: tutorialOpen, openTutorial, closeTutorial } = useTutorial();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [modalStep, setModalStep] = useState<OfframpStep>("idle");
  const [modalError, setModalError] = useState<string | undefined>(undefined);
  const [modalTxHash, setModalTxHash] = useState<string | undefined>(undefined);
  const [currentPayload, setCurrentPayload] = useState<OfframpPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [formResetKey, setFormResetKey] = useState(0);

  // Keep a ref to the current txId so polling callbacks can access it
  const txIdRef = useRef<string | null>(null);

  const { pollBridgeStatus } = usePollBridgeStatus();
  const { pollPayoutStatus } = usePollPayoutStatus();

  // ---------------------------------------------------------------------------
  // handleExecuteTrade — full offramp orchestration
  // ---------------------------------------------------------------------------
  const handleExecuteTrade = useCallback(
    async (payload: OfframpPayload) => {
      // 1. Validate wallet connected and quote available
      if (!isConnected || !wallet) {
        setModalError("Please connect your wallet before initiating a trade.");
        setModalStep("error");
        return;
      }
      if (!payload.quote) {
        setModalError("No quote available. Please refresh and try again.");
        setModalStep("error");
        return;
      }

      // 2. Generate txId and save initial transaction record
      const txId = TransactionStorage.generateId();
      txIdRef.current = txId;
      const selectedInsurance = payload.insurance.enabled && payload.insurance.quote
        ? {
            id: `ins_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            premium: payload.insurance.quote.premium,
            coverage: payload.insurance.quote.coverage,
            provider: payload.insurance.quote.provider,
            riskScore: payload.insurance.quote.riskScore,
            status: "active" as const,
            purchasedAt: Date.now(),
          }
        : undefined;

      TransactionStorage.save({
        id: txId,
        timestamp: Date.now(),
        userAddress: wallet.publicKey,
        amount: payload.amount,
        currency: payload.currency,
        beneficiary: {
          institution: payload.institution,
          accountIdentifier: payload.accountIdentifier,
          accountName: payload.accountName,
          currency: payload.currency,
        },
        status: "pending",
        insurance: selectedInsurance,
      });

      setModalError(undefined);
      setModalStep("initiating");

      try {
        // 3. Initialize Allbridge SDK and fetch tokens (15s timeout)
        const { sdk, tokens } = await withTimeout(
          (async () => {
            const mod = await import("@allbridge/bridge-core-sdk");
            const sdkInstance = new mod.AllbridgeCoreSdk(mod.nodeRpcUrlsDefault);
            const tokenList = await sdkInstance.tokens();
            return { sdk: sdkInstance, tokens: tokenList };
          })(),
          15_000,
          "Allbridge SDK init"
        );

        // Find Stellar USDC token
        const stellarUsdc = tokens.find(
          (t: { symbol: string; chainSymbol: string }) =>
            t.symbol === "USDC" && t.chainSymbol === "STELLAR"
        );
        if (!stellarUsdc) throw new Error("Stellar USDC token not found in Allbridge SDK");

        // 4. Get bridge quote to compute paycrestOrderAmount (15s timeout)
        const bridgeQuote = await withTimeout(
          sdk.getAmountToBeReceived(payload.amount, stellarUsdc, stellarUsdc),
          15_000,
          "Bridge quote"
        );

        // 5. Floor paycrestOrderAmount to 6 decimals (avoid rounding up)
        const rawAmount = parseFloat(String(bridgeQuote));
        const paycrestOrderAmount = Math.floor(rawAmount * 1_000_000) / 1_000_000;

        // 6. POST to /api/offramp/paycrest/order (20s timeout)
        const paycrestRes = await withTimeout(
          fetch("/api/offramp/paycrest/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: paycrestOrderAmount,
              currency: payload.currency,
              institution: payload.institution,
              accountIdentifier: payload.accountIdentifier,
              accountName: payload.accountName,
              returnAddress: wallet.publicKey,
            }),
          }).then((r) => r.json()),
          20_000,
          "Paycrest order creation"
        );

        if (paycrestRes.error) throw new Error(paycrestRes.error);

        const { payoutOrderId, settlementAddress } = paycrestRes as {
          payoutOrderId: string;
          settlementAddress: string;
        };

        TransactionStorage.update(txId, { payoutOrderId });

        // 7. POST to /api/offramp/bridge/build-tx (30s timeout)
        const buildTxRes = await withTimeout(
          fetch("/api/offramp/bridge/build-tx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: payload.amount,
              fromAddress: wallet.publicKey,
              toAddress: settlementAddress,
              currency: payload.currency,
              feeMethod: payload.feeMethod,
            }),
          }).then((r) => r.json()),
          30_000,
          "Bridge build-tx"
        );

        if (buildTxRes.error) throw new Error(buildTxRes.error);
        const { xdr } = buildTxRes as { xdr: string };

        // 8. Sign transaction — update modal to awaiting-signature
        setModalStep("awaiting-signature");
        const signedXdr = await signTransaction(xdr);

        // 9. Submit signed XDR to /api/offramp/bridge/submit-soroban (15s timeout)
        setModalStep("submitting");
        const submitRes = await withTimeout(
          fetch("/api/offramp/bridge/submit-soroban", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signedXdr }),
          }).then((r) => r.json()),
          15_000,
          "Bridge submit"
        );

        if (submitRes.error) throw new Error(submitRes.error);

        let txHash: string = submitRes.hash;

        // 10. If PENDING, poll tx-status until SUCCESS or FAILED
        if (submitRes.status === "PENDING" && txHash) {
          setModalStep("processing");
          let pollAttempts = 0;
          const maxPollAttempts = 30;

          while (pollAttempts < maxPollAttempts) {
            pollAttempts++;
            await new Promise<void>((r) => setTimeout(r, 3_000));

            const statusRes = await fetch(`/api/offramp/bridge/tx-status/${txHash}`, {
              cache: "no-store",
            }).then((r) => r.json());

            if (statusRes.status === "SUCCESS") break;
            if (statusRes.status === "FAILED") {
              throw new Error("Stellar transaction failed on-chain. Please try again.");
            }
          }
        }

        TransactionStorage.update(txId, { stellarTxHash: txHash });
        setModalTxHash(txHash);

        // 11. Start parallel polling: bridge (best-effort) + payout (critical path)
        setModalStep("processing");

        const bridgePolling = pollBridgeStatus(txHash, {
          transactionId: txId,
          onBridgeComplete: () => setModalStep("settling"),
        }).catch(() => {
          // Bridge polling is best-effort — swallow errors
        });

        const payoutPolling = pollPayoutStatus(payoutOrderId, {
          transactionId: txId,
          onStepChange: setModalStep,
        });

        await Promise.all([bridgePolling, payoutPolling]);

        // 12. Success
        setModalStep("success");
        TransactionStorage.update(txId, { status: "completed" });
        setFormResetKey((k) => k + 1);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred. Please try again.";
        setModalError(message);
        setModalStep("error");
        if (txIdRef.current) {
          TransactionStorage.update(txIdRef.current, { status: "failed", error: message });
        }
      }
    },
    [isConnected, wallet, signTransaction, pollBridgeStatus, pollPayoutStatus]
  );

  // ---------------------------------------------------------------------------
  // Wallet handlers
  // ---------------------------------------------------------------------------
  // openWalletModal is stored in a ref so FormCard can trigger it without re-renders
  const openWalletModalRef = useRef<(() => void) | null>(null);

  const handleConnect = useCallback(async (walletType?: WalletType) => {
    // If no wallet type specified and modal opener is available, open the modal
    if (!walletType && openWalletModalRef.current) {
      openWalletModalRef.current();
      return;
    }
    try {
      await connect(walletType);
    } catch {
      // error is surfaced via useStellarWallet's error state
    }
  }, [connect]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    setAmount("");
    setCurrency("");
    setQuote(null);
  }, [disconnect]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------
  const shortcuts: Shortcut[] = [
    {
      key: "w",
      ctrl: true,
      description: "Connect / disconnect wallet",
      action: () => (isConnected ? handleDisconnect() : handleConnect()),
    },
    {
      key: "h",
      description: "Show keyboard shortcuts",
      action: () => setShortcutsOpen(true),
    },
    {
      key: "?",
      description: "Open tutorial",
      action: openTutorial,
    },
    {
      key: "Shift+?",
      description: "Open help & documentation",
      action: () => setHelpOpen(true),
    },
    {
      key: "Escape",
      description: "Close modal / dialog",
      action: () => {
        setShortcutsOpen(false);
        setHelpOpen(false);
        if (modalStep !== "idle") {
          setModalStep("idle");
          setModalError(undefined);
          setModalTxHash(undefined);
        }
      },
    },
  ];

  useKeyboardShortcuts(shortcuts);

  return (
    <main className="min-h-screen p-4 bg-[#0a0a0a]">
      <Tutorial forceOpen={tutorialOpen} onClose={closeTutorial} />
      <KeyboardShortcutsModal
        open={shortcutsOpen}
        shortcuts={shortcuts}
        onClose={() => setShortcutsOpen(false)}
      />
      <HelpModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        topics={HELP_TOPICS}
      />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-bg focus:border focus:border-accent"
      >
        Skip to main content
      </a>

      <TransactionProgressModal 
        step={modalStep}
        errorMessage={modalError}
        txHash={modalTxHash}
        onClose={() => { setModalStep("idle"); setModalError(undefined); setModalTxHash(undefined); }}
      />

      <Header
        subtitle="Convert Stellar USDC to fiat"
        isConnected={isConnected}
        isConnecting={isConnecting}
        walletAddress={wallet?.publicKey}
        walletError={walletError}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onHelpOpen={() => setHelpOpen(true)}
        onModalRef={(openModal) => { openWalletModalRef.current = openModal; }}
      />

      <section id="main-content" className="border border-[#333333] px-4 py-6 sm:px-8 sm:py-8 overflow-hidden mt-6">
        <div className="grid grid-cols-1 min-[1100px]:grid-cols-[1fr_370px] gap-6 w-full">
          <div data-testid="FormCard">
            <FormCard
              isConnected={isConnected}
              isConnecting={isConnecting}
              resetKey={formResetKey}
              onConnect={handleConnect}
              onSubmit={handleExecuteTrade}
              onQuoteChange={setQuote}
              onAmountChange={setAmount}
              onCurrencyChange={setCurrency}
            />
          </div>

          <div
            data-testid="RightPanel"
            className="min-[1100px]:col-start-2 min-[1100px]:row-start-1 min-[1100px]:row-span-2"
          >
            <RightPanel
              isConnected={isConnected}
              isConnecting={isConnecting}
              amount={amount}
              quote={quote}
              isLoadingQuote={false}
              currency={currency}
              onConnect={handleConnect}
            />
          </div>

          <div>
            <RecentOfframpsTable />
          </div>

          <div className="min-[1100px]:col-span-2 mt-4">
            <ProgressSteps
              isConnected={isConnected}
              isConnecting={isConnecting}
              steps={[]}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
