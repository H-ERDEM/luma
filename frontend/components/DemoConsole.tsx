"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { explorerTx } from "@/lib/env";
import { usdc } from "@/lib/format";
import { errorText, useLuma } from "@/hooks/useLuma";
import { withTimeout } from "@/lib/async";
import { describeFaucet, SOL_SKIPPED_MESSAGE } from "@/lib/faucetMessages";
import { CLOSED_BATCH_MESSAGE, phaseLabel } from "@/lib/txPhase";
import { PhantomHint } from "@/components/PhantomHint";

const DEMO_QUANTITY = 10;
const TOKEN_STORAGE_KEY = "luma.resetToken";
/** Bir adım (backend + Phantom onayı + zincir) bu sürede bitmezse arayüz kilidi açılır. */
const STEP_TIMEOUT_MS = 180_000;

interface Step {
  title: string;
  detail: string;
  run: () => Promise<void>;
}

/**
 * Demo console: 40 günlük döngüyü dört adımda oynatır. Backend zaman makinesi oracle
 * güncellemelerini zincire yazar; yatırımcı adımları bağlı cüzdanla imzalanır.
 */
export function DemoConsole() {
  const { publicKey, state, fetchHoldings, fund, sell, claimRefund, redeem, refresh, pushLog, log, txPhase } = useLuma();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  // Yeni parti başlatmak backend'de yönetici anahtarıyla korunuyor olabilir; yalnızca bu oturumda tutulur.
  const [resetToken, setResetToken] = useState("");
  useEffect(() => {
    try {
      setResetToken(sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "");
    } catch {
      // Depolama kapalıysa anahtar yalnızca bu sayfa açıkken bellekte kalır.
    }
  }, []);
  const updateResetToken = (value: string) => {
    setResetToken(value);
    try {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, value);
    } catch {
      // yok sayılır
    }
  };
  // Kapalı parti (Settled/Defaulted) 1-4. adımları çalıştıramaz; önce yeni parti gerekir.
  const closed = state !== null && state.status !== "Active";
  const unavailable = state === null;

  const requireWallet = () => {
    if (!publicKey) throw new Error("Connect your wallet first.");
    return publicKey.toBase58();
  };

  /** Faucet/imza gibi masraflı işlerden önce partinin hâlâ aktif olduğunu zincirden doğrular. */
  const requireActiveBatch = async () => {
    const fresh = await api.batchState(true);
    if (fresh.status !== "Active") throw new Error(CLOSED_BATCH_MESSAGE);
  };

  const steps: Step[] = [
    {
      title: "Fund seedlings",
      detail: `Verifies your wallet, tops your test USDC up to the limit (100) and buys ${DEMO_QUANTITY} seedlings.`,
      run: async () => {
        const wallet = requireWallet();
        await requireActiveBatch();
        setStage("Preparing KYC and test USDC…");
        const kyc = await api.verifyKyc(wallet);
        pushLog({
          text: kyc.alreadyApproved ? "KYC already approved" : "KYC approved",
          tone: "ok",
          signature: kyc.signature ?? undefined,
        });
        const faucet = await api.faucet(wallet);
        pushLog({ text: describeFaucet(faucet), tone: "info" });
        if (faucet.solSkipped) {
          pushLog({ text: SOL_SKIPPED_MESSAGE, tone: "info" });
        }
        const sig = await fund(DEMO_QUANTITY);
        pushLog({ text: `Purchased ${DEMO_QUANTITY} seedlings`, tone: "ok", signature: sig });
      },
    },
    {
      title: "Advance to day 20 and exit early",
      detail: "The oracle writes readings for days 5, 10, 15 and 20 through the DON and Ed25519 paths, then half of your seedlings are sold to the curve.",
      run: async () => {
        await requireActiveBatch();
        setStage("Writing oracle readings on-chain…");
        await api.advanceDays(20);
        pushLog({ text: "Reached day 20, curve price updated", tone: "info" });
        const half = Math.floor(Number(await fetchHoldings()) / 2);
        if (half < 1) {
          pushLog({ text: "No seedlings to sell; run step 1 first.", tone: "info" });
          return;
        }
        const sig = await sell(half);
        pushLog({ text: `Sold ${half} seedlings through early exit`, tone: "ok", signature: sig });
      },
    },
    {
      title: "Trigger a failure and see the insurance",
      detail: "Water rises to 33.5 °C and the pump stops. Parametric insurance triggers and you reclaim the principal for your remaining seedlings.",
      run: async () => {
        await requireActiveBatch();
        setStage("Simulating the failure…");
        const res = await api.triggerOutage();
        pushLog({ text: `Insurance triggered, refund ${usdc(res.refundPrice)} USDC per seedling`, tone: "ok", signature: res.signature });
        const owned = Number(await fetchHoldings());
        if (owned < 1) return;
        const sig = await claimRefund(owned);
        pushLog({ text: `Principal refunded for ${owned} seedlings`, tone: "ok", signature: sig });
      },
    },
    {
      title: "Harvest, burn and redeem",
      detail: "The day-40 reading is written, the OTC buyer's USDC goes into the vault, and your remaining seedlings are redeemed at 0.7125 USDC and burned.",
      run: async () => {
        await requireActiveBatch();
        setStage("Settling the harvest…");
        const res = await api.settleHarvest();
        pushLog({ text: `Harvest settled, redemption ${usdc(res.redemptionPrice, 4)} USDC per seedling`, tone: "ok", signature: res.signature });
        const owned = Number(await fetchHoldings());
        if (owned < 1) return;
        const sig = await redeem(owned);
        pushLog({ text: `Burned and redeemed ${owned} seedlings`, tone: "ok", signature: sig });
      },
    },
  ];

  async function execute(index: number, task: () => Promise<void>) {
    setRunning(index);
    setStage(null);
    try {
      await withTimeout(
        task(),
        STEP_TIMEOUT_MS,
        "This step took longer than 3 minutes. If an approval request is pending in Phantom, reject it; if no approval window opened, close Phantom's side panel and try again.",
      );
    } catch (err) {
      pushLog({ text: errorText(err), tone: "error" });
    } finally {
      setStage(null);
      setRunning(null);
      await refresh();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 rounded-[10px] bg-ink px-5 py-3 text-sm font-semibold text-white shadow-lg hover:brightness-110"
        aria-expanded={open}
        aria-controls="demo-console"
      >
        Demo console
      </button>

      {open && <div className="fixed inset-0 z-40 bg-ink/30" onClick={() => setOpen(false)} aria-hidden />}

      <aside
        id="demo-console"
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-canvas transition-transform duration-300 motion-reduce:transition-none ${
          open ? "translate-x-0 shadow-2xl" : "translate-x-full shadow-none"
        }`}
        aria-hidden={!open}
        aria-label="Demo console"
      >
        <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Demo console</h2>
            <p className="text-sm text-muted">
              Batch #{state?.addresses.batchId ?? "-"}, day {state?.telemetry.day ?? 0}
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-inner">
            Close
          </button>
        </header>

        <ol className="flex-1 space-y-3 overflow-y-auto px-5 py-5 sm:px-6">
          {(closed || unavailable) && (
            <li role="alert" className="rounded-xl bg-risk-soft p-4 text-sm font-medium text-risk">
              {closed ? `${CLOSED_BATCH_MESSAGE} Use “Start new batch” below.` : "Cannot reach the backend, so the batch state is unknown."}
            </li>
          )}
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex gap-3">
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand" aria-hidden>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted">{step.detail}</p>
                  <button
                    type="button"
                    disabled={running !== null || closed || unavailable}
                    onClick={() => execute(i, step.run)}
                    className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
                  >
                    {running === i ? phaseLabel(txPhase, stage ?? "Working…") : "Run"}
                  </button>
                  {running === i && txPhase === "signing" && <PhantomHint />}
                </div>
              </div>
            </li>
          ))}

          <li className="rounded-xl border border-dashed border-line-strong p-4 text-sm">
            <p className="text-muted">Steps 3 and 4 close the batch. Start a new batch to play another scenario.</p>
            <label htmlFor="reset-token" className="mt-3 block text-xs font-semibold text-muted">
              Admin key (only if required)
            </label>
            <input
              id="reset-token"
              type="password"
              autoComplete="off"
              value={resetToken}
              onChange={(e) => updateResetToken(e.target.value)}
              placeholder="Key for starting a new batch"
              className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm focus:border-ink focus:outline-none"
            />
            <button
              type="button"
              disabled={running !== null}
              onClick={() =>
                execute(-1, async () => {
                  const res = await api.reset(resetToken.trim() || undefined);
                  pushLog({ text: `Batch #${res.batchId} started`, tone: "info" });
                })
              }
              className="mt-2 rounded-lg border border-ink px-4 py-2 font-semibold hover:bg-ink hover:text-white disabled:opacity-40"
            >
              {running === -1 ? "Starting…" : "Start new batch"}
            </button>
          </li>
        </ol>

        <section className="max-h-56 overflow-y-auto border-t border-line bg-surface px-6 py-4" aria-live="polite" aria-label="Activity log">
          {log.length === 0 ? (
            <p className="text-sm text-muted">Transactions will appear here.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {log.map((entry) => (
                <li key={entry.id} className={entry.tone === "error" ? "text-risk" : entry.tone === "ok" ? "text-ink" : "text-muted"}>
                  {entry.text}
                  {entry.signature && (
                    <>
                      {" "}
                      <a href={explorerTx(entry.signature)} target="_blank" rel="noreferrer" className="font-semibold text-info underline-offset-2 hover:underline">
                        tx ↗
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </>
  );
}
