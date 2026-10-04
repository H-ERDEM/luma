"use client";

import { useState } from "react";
import { errorText, useLuma } from "@/hooks/useLuma";
import { PhantomHint } from "@/components/PhantomHint";
import { withTimeout } from "@/lib/async";
import { usdc } from "@/lib/format";
import { exitQuote } from "@/lib/luma";
import { phaseLabel } from "@/lib/txPhase";

/** Phantom onayı + zincir onayı bu sürede bitmezse düğme tekrar açılır. */
const ACTION_TIMEOUT_MS = 120_000;

/** Yatırımcı paneli: fonlama penceresinde fide satın alma, sonra döneme göre çıkış/itfa. */
export function Launchpad() {
  const { publicKey, state, kyc, holdings, usdcBalance, fund, sell, claimRefund, redeem, pushLog, txPhase } = useLuma();
  const [quantity, setQuantity] = useState(10);
  const [pending, setPending] = useState<string | null>(null);

  if (state === null) return null;

  const day = state.telemetry.day;
  const owned = Number(holdings);
  const fundingOpen = state.status === "Active" && day <= state.fundingCloseDay;
  const exitOpen = state.status === "Active" && day >= state.earlyExitDay && day < state.harvestDay;
  const cost = BigInt(Math.max(0, quantity)) * BigInt(state.unitPrice);
  const kycOk = kyc?.approved === true;
  // Bekleme sırasında düğmede gerçek aşama görünür (başarı metni değil).
  const busyText = pending === null ? null : phaseLabel(txPhase, "İşlem hazırlanıyor…");

  async function run(label: string, task: () => Promise<string>) {
    setPending(label);
    try {
      const signature = await withTimeout(
        task(),
        ACTION_TIMEOUT_MS,
        "İşlem 2 dakikada tamamlanmadı. Phantom'da bekleyen bir istek varsa reddedin; onay penceresi açılmadıysa Phantom yan panelini kapatıp tekrar deneyin.",
      );
      pushLog({ text: label, tone: "ok", signature });
    } catch (err) {
      pushLog({ text: `${label} başarısız: ${errorText(err)}`, tone: "error" });
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby="launchpad-title" className="rounded-2xl border border-line bg-white p-6">
      <h2 id="launchpad-title" className="font-display text-2xl font-semibold">
        Fide satın al
      </h2>
      <p className="mt-1 text-sm text-muted">
        Her token tepsideki bir marul fidesidir. Ödediğiniz USDC'nin tamamı teminat kasasında kilitli kalır.
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted">Fide fiyatı</dt>
        <dd className="text-right tabular-nums font-medium">{usdc(state.unitPrice)} USDC</dd>
        <dt className="text-muted">Satılan / azami</dt>
        <dd className="text-right tabular-nums">
          {state.circulatingSupply} / {state.maxSupply}
        </dd>
        <dt className="text-muted">Sizin fideleriniz</dt>
        <dd className="text-right tabular-nums font-medium">{owned}</dd>
        <dt className="text-muted">USDC bakiyeniz</dt>
        <dd className="text-right tabular-nums">{usdc(usdcBalance)}</dd>
      </dl>

      {fundingOpen && (
        <div className="mt-6">
          <label htmlFor="qty" className="text-sm font-medium">
            Fide adedi
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="qty"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className="w-24 rounded-lg border border-line px-3 py-2 tabular-nums focus:border-ink focus:outline-none"
            />
            <button
              type="button"
              disabled={!publicKey || !kycOk || pending !== null}
              onClick={() => run(`${quantity} fide satın alındı`, () => fund(quantity))}
              className="flex-1 rounded-lg bg-leaf px-4 py-2 font-medium text-white hover:bg-leaf-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyText ?? `${usdc(cost)} USDC öde ve fide al`}
            </button>
          </div>
          {!publicKey && <p className="mt-2 text-sm text-muted">Satın almak için cüzdanınızı bağlayın.</p>}
          {publicKey && !kycOk && <p className="mt-2 text-sm text-heat">Satın almadan önce kimliğinizi doğrulayın.</p>}
        </div>
      )}

      {txPhase === "signing" && <PhantomHint />}

      {state.status !== "Active" && owned === 0 && (
        <p className="mt-6 rounded-lg bg-paper p-3 text-sm">
          Bu parti kapandı. Yeni bir parti için jüri konsolunda "Yeni parti başlat"a basın.
        </p>
      )}

      {state.status === "Active" && !fundingOpen && !exitOpen && day < state.harvestDay && (
        <p className="mt-6 rounded-lg bg-paper p-3 text-sm">
          Fonlama {state.fundingCloseDay}. günde kapandı. Erken çıkış {state.earlyExitDay}. günde açılır.
        </p>
      )}

      {exitOpen && owned > 0 && (
        <ActionBlock
          title="Erken çıkış"
          body={`Bonding curve şu an fide başına ${usdc(state.curvePrice)} USDC ödüyor. Tümünü satarsanız ${usdc(exitQuote(state, owned))} USDC alırsınız.`}
          cta={`${owned} fideyi sat`}
          pending={busyText}
          onClick={() => run(`${owned} fide bonding curve'e satıldı`, () => sell(owned))}
        />
      )}

      {state.status === "Defaulted" && owned > 0 && (
        <ActionBlock
          title="Sigorta iadesi"
          body={`Parametrik sigorta tetiklendi. Fide başına ${usdc(state.refundPrice)} USDC anapara iadesi alabilirsiniz.`}
          cta={`${owned} fide için iadeyi al`}
          tone="heat"
          pending={busyText}
          onClick={() => run("Anapara iadesi alındı", () => claimRefund(owned))}
        />
      )}

      {state.status === "Settled" && owned > 0 && (
        <ActionBlock
          title="Hasat itfası"
          body={`Hasat OTC alıcısına satıldı. Fide başına ${usdc(state.redemptionPrice, 4)} USDC ödenir ve token'lar yakılır.`}
          cta={`${owned} fideyi itfa et`}
          pending={busyText}
          onClick={() => run("Token'lar yakıldı ve itfa edildi", () => redeem(owned))}
        />
      )}
    </section>
  );
}

function ActionBlock(props: {
  title: string;
  body: string;
  cta: string;
  pending: string | null;
  tone?: "leaf" | "heat";
  onClick: () => void;
}) {
  const heat = props.tone === "heat";
  return (
    <div className={`mt-6 rounded-xl p-4 ${heat ? "bg-heat-soft" : "bg-leaf-soft"}`}>
      <h3 className="font-display text-lg font-semibold">{props.title}</h3>
      <p className="mt-1 text-sm">{props.body}</p>
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.pending !== null}
        className={`mt-3 w-full rounded-lg px-4 py-2 font-medium text-white disabled:opacity-40 ${
          heat ? "bg-heat hover:brightness-90" : "bg-leaf hover:bg-leaf-deep"
        }`}
      >
        {props.pending ?? props.cta}
      </button>
    </div>
  );
}
