"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { explorerTx } from "@/lib/env";
import { usdc } from "@/lib/format";
import { errorText, useLuma } from "@/hooks/useLuma";
import { withTimeout } from "@/lib/async";
import { CLOSED_BATCH_MESSAGE, phaseLabel } from "@/lib/txPhase";
import { PhantomHint } from "@/components/PhantomHint";

const DEMO_QUANTITY = 10;
/** Bir adım (backend + Phantom onayı + zincir) bu sürede bitmezse arayüz kilidi açılır. */
const STEP_TIMEOUT_MS = 180_000;

interface Step {
  title: string;
  detail: string;
  run: () => Promise<void>;
}

/**
 * Jüri konsolu: 40 günlük döngüyü dört adımda oynatır. Backend zaman makinesi oracle
 * güncellemelerini zincire yazar; yatırımcı adımları bağlı cüzdanla imzalanır.
 */
export function JuryAdminDrawer() {
  const { publicKey, state, fetchHoldings, fund, sell, claimRefund, redeem, refresh, pushLog, log, txPhase } = useLuma();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  // Kapalı parti (Settled/Defaulted) 1-4. adımları çalıştıramaz; önce yeni parti gerekir.
  const closed = state !== null && state.status !== "Active";
  const unavailable = state === null;

  const requireWallet = () => {
    if (!publicKey) throw new Error("Önce cüzdanınızı bağlayın.");
    return publicKey.toBase58();
  };

  /** Faucet/imza gibi masraflı işlerden önce partinin hâlâ aktif olduğunu zincirden doğrular. */
  const requireActiveBatch = async () => {
    const fresh = await api.batchState(true);
    if (fresh.status !== "Active") throw new Error(CLOSED_BATCH_MESSAGE);
  };

  const steps: Step[] = [
    {
      title: "Fide fonla",
      detail: `Cüzdanı KYC'den geçirir, 100 test USDC yükler ve ${DEMO_QUANTITY} fide satın alır.`,
      run: async () => {
        const wallet = requireWallet();
        await requireActiveBatch();
        setStage("KYC ve test USDC hazırlanıyor…");
        const kyc = await api.verifyKyc(wallet);
        pushLog({ text: "KYC onaylandı", tone: "ok", signature: kyc.signature });
        await api.faucet(wallet);
        pushLog({ text: "100 test USDC yüklendi", tone: "info" });
        const sig = await fund(DEMO_QUANTITY);
        pushLog({ text: `${DEMO_QUANTITY} fide satın alındı`, tone: "ok", signature: sig });
      },
    },
    {
      title: "Günü 20'ye ilerlet ve erken çık",
      detail: "Oracle 5, 10, 15 ve 20. gün ölçümlerini DON ve Ed25519 yollarından yazar; ardından fidelerin yarısı curve'e satılır.",
      run: async () => {
        await requireActiveBatch();
        setStage("Oracle ölçümleri zincire yazılıyor…");
        await api.advanceDays(20);
        pushLog({ text: "20. güne gelindi, curve fiyatı güncellendi", tone: "info" });
        const half = Math.floor(Number(await fetchHoldings()) / 2);
        if (half < 1) {
          pushLog({ text: "Satılacak fide yok; önce 1. adımı çalıştırın.", tone: "info" });
          return;
        }
        const sig = await sell(half);
        pushLog({ text: `${half} fide erken çıkışla satıldı`, tone: "ok", signature: sig });
      },
    },
    {
      title: "Arıza yarat ve sigortayı incele",
      detail: "Su 33,5 °C'ye çıkar, pompa durur. Parametrik sigorta tetiklenir ve kalan fideler için anapara iadesi alınır.",
      run: async () => {
        await requireActiveBatch();
        setStage("Arıza simüle ediliyor…");
        const res = await api.triggerOutage();
        pushLog({ text: `Sigorta tetiklendi, iade ${usdc(res.refundPrice)} USDC/fide`, tone: "ok", signature: res.signature });
        const owned = Number(await fetchHoldings());
        if (owned < 1) return;
        const sig = await claimRefund(owned);
        pushLog({ text: `${owned} fide için anapara iade edildi`, tone: "ok", signature: sig });
      },
    },
    {
      title: "Hasadı bitir, token yak ve itfa et",
      detail: "40. gün ölçümü yazılır, OTC alıcısının USDC'si kasaya yatar ve kalan fideler 0,7125 USDC'den itfa edilip yakılır.",
      run: async () => {
        await requireActiveBatch();
        setStage("Hasat uzlaştırılıyor…");
        const res = await api.settleHarvest();
        pushLog({ text: `Hasat uzlaştı, itfa ${usdc(res.redemptionPrice, 4)} USDC/fide`, tone: "ok", signature: res.signature });
        const owned = Number(await fetchHoldings());
        if (owned < 1) return;
        const sig = await redeem(owned);
        pushLog({ text: `${owned} fide yakıldı ve itfa edildi`, tone: "ok", signature: sig });
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
        "Adım 3 dakikada tamamlanmadı. Phantom'da onay bekleyen bir istek varsa reddedin; onay penceresi açılmadıysa Phantom yan panelini kapatıp tekrar deneyin.",
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
        className="fixed bottom-5 right-5 z-30 rounded-full bg-ink px-5 py-3 font-medium text-paper shadow-lg hover:bg-leaf-deep"
        aria-expanded={open}
        aria-controls="jury-drawer"
      >
        Jüri konsolu
      </button>

      {open && <div className="fixed inset-0 z-40 bg-ink/30" onClick={() => setOpen(false)} aria-hidden />}

      <aside
        id="jury-drawer"
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-paper shadow-2xl transition-transform duration-300 motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
        aria-label="Jüri demo konsolu"
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Jüri konsolu</h2>
            <p className="text-sm text-muted">
              Parti #{state?.addresses.batchId ?? "-"}, {state?.telemetry.day ?? 0}. gün
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-sm hover:bg-line">
            Kapat
          </button>
        </header>

        <ol className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {(closed || unavailable) && (
            <li role="alert" className="rounded-xl bg-heat-soft p-4 text-sm font-medium">
              {closed ? CLOSED_BATCH_MESSAGE : "Backend'e ulaşılamıyor; durum okunamadı."}
            </li>
          )}
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-xl border border-line bg-white p-4">
              <div className="flex gap-3">
                <span className="font-display text-2xl font-semibold text-leaf" aria-hidden>
                  {i + 1}
                </span>
                <div className="flex-1">
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="mt-0.5 text-sm text-muted">{step.detail}</p>
                  <button
                    type="button"
                    disabled={running !== null || closed || unavailable}
                    onClick={() => execute(i, step.run)}
                    className="mt-3 rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-paper hover:bg-leaf-deep disabled:opacity-40"
                  >
                    {running === i ? phaseLabel(txPhase, stage ?? "Çalışıyor…") : "Çalıştır"}
                  </button>
                  {running === i && txPhase === "signing" && <PhantomHint />}
                </div>
              </div>
            </li>
          ))}

          <li className="rounded-xl border border-dashed border-line p-4 text-sm">
            <p className="text-muted">3. ve 4. adımlar partiyi kapatır. Diğer senaryo için yeni bir parti başlatın.</p>
            <button
              type="button"
              disabled={running !== null}
              onClick={() =>
                execute(-1, async () => {
                  const res = await api.reset();
                  pushLog({ text: `Parti #${res.batchId} başlatıldı`, tone: "info" });
                })
              }
              className="mt-2 rounded-lg border border-ink px-4 py-1.5 font-medium hover:bg-ink hover:text-paper disabled:opacity-40"
            >
              {running === -1 ? "Kuruluyor…" : "Yeni parti başlat"}
            </button>
          </li>
        </ol>

        <section className="max-h-56 overflow-y-auto border-t border-line px-6 py-4" aria-live="polite" aria-label="İşlem günlüğü">
          {log.length === 0 ? (
            <p className="text-sm text-muted">İşlemler burada görünecek.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {log.map((entry) => (
                <li key={entry.id} className={entry.tone === "error" ? "text-heat" : entry.tone === "ok" ? "text-ink" : "text-muted"}>
                  {entry.text}
                  {entry.signature && (
                    <>
                      {" "}
                      <a href={explorerTx(entry.signature)} target="_blank" rel="noreferrer" className="text-solution underline">
                        işlem
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
