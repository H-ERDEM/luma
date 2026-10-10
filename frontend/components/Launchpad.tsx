"use client";

import { useState } from "react";
import { errorText, useLuma } from "@/hooks/useLuma";
import { ShieldIcon } from "@/components/icons";
import { PhantomHint } from "@/components/PhantomHint";
import { withTimeout } from "@/lib/async";
import { integer, usdc } from "@/lib/format";
import { exitQuote } from "@/lib/luma";
import { phaseLabel } from "@/lib/txPhase";

/** Phantom onayı + zincir onayı bu sürede bitmezse düğme tekrar açılır. */
const ACTION_TIMEOUT_MS = 120_000;

/** Yatırımcı paneli ("Back a harvest"): fonlama penceresinde fide satın alma, sonra döneme göre çıkış/itfa. */
export function Launchpad() {
  const { publicKey, state, kyc, holdings, usdcBalance, fund, sell, claimRefund, redeem, pushLog, txPhase } = useLuma();
  const [quantity, setQuantity] = useState(10);
  const [pending, setPending] = useState<string | null>(null);

  if (state === null) {
    return (
      <div className="rounded-card border border-line bg-surface p-7 sm:p-9">
        <h3 className="text-[24px] font-semibold tracking-[-0.02em]">Back a harvest</h3>
        <p className="mt-2 text-sm text-muted">Loading batch data…</p>
      </div>
    );
  }

  const day = state.telemetry.day;
  const owned = Number(holdings);
  const fundingOpen = state.status === "Active" && day <= state.fundingCloseDay;
  const exitOpen = state.status === "Active" && day >= state.earlyExitDay && day < state.harvestDay;
  const cost = BigInt(Math.max(0, quantity)) * BigInt(state.unitPrice);
  const kycOk = kyc?.approved === true;
  // Bekleme sırasında düğmede gerçek aşama görünür (başarı metni değil).
  const busyText = pending === null ? null : phaseLabel(txPhase, "Preparing transaction…");

  async function run(action: string, success: string, task: () => Promise<string>) {
    setPending(action);
    try {
      const signature = await withTimeout(
        task(),
        ACTION_TIMEOUT_MS,
        "This took longer than 2 minutes. If an approval request is pending in Phantom, reject it; if no approval window opened, close Phantom's side panel and try again.",
      );
      pushLog({ text: success, tone: "ok", signature });
    } catch (err) {
      pushLog({ text: `Could not ${action}: ${errorText(err)}`, tone: "error" });
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby="launchpad-title" className="rounded-card border border-line bg-surface p-7 sm:p-9">
      <h3 id="launchpad-title" className="text-[24px] font-semibold tracking-[-0.02em]">
        Back a harvest
      </h3>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">
        Each token is one lettuce seedling. Every USDC you pay stays locked in the collateral vault.
      </p>

      <dl className="mt-4 text-[14.5px]">
        <Row label="Price per seedling" value={`${usdc(state.unitPrice)} USDC`} />
        <Row label="Seedlings backed" value={`${integer(state.circulatingSupply)} / ${integer(state.maxSupply)}`} />
        <Row label="Your seedlings" value={integer(owned)} />
        <Row label="Your USDC balance" value={usdc(usdcBalance)} last />
      </dl>

      {fundingOpen && (
        <div className="mt-5">
          <label htmlFor="qty" className="block text-[13px] font-semibold text-muted">
            Number of seedlings
          </label>
          <input
            id="qty"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="mt-1.5 w-[110px] rounded-2xl border border-line-strong bg-canvas px-4 py-3 text-base tabular-nums focus:border-brand focus:outline-none"
          />
          <button
            type="button"
            disabled={!publicKey || !kycOk || pending !== null}
            onClick={() => run("buy seedlings", `Purchased ${quantity} seedlings`, () => fund(quantity))}
            className="btn mt-4 w-full"
          >
            {busyText ?? `Pay ${usdc(cost)} USDC and get ${integer(quantity)} ${quantity === 1 ? "seedling" : "seedlings"}`}
          </button>
          {pending !== null && txPhase === "signing" && <PhantomHint />}
          {!publicKey && <p className="mt-2.5 text-center text-[13px] text-muted">Connect your wallet to continue.</p>}
          {publicKey && !kycOk && (
            <p className="mt-3 text-center text-[13px] text-muted">Verify your wallet first: use &ldquo;Get test funds&rdquo; in step 2.</p>
          )}
        </div>
      )}

      {state.status === "Active" && !fundingOpen && !exitOpen && day < state.harvestDay && (
        <p className="mt-5 rounded-2xl bg-inner p-4 text-sm leading-relaxed">
          Funding closed on day {state.fundingCloseDay}. Early exit opens on day {state.earlyExitDay}.
        </p>
      )}

      {state.status === "Active" && !fundingOpen && exitOpen && owned === 0 && (
        <p className="mt-5 rounded-2xl bg-inner p-4 text-sm leading-relaxed">
          Funding closed on day {state.fundingCloseDay} and early exit is open for existing backers. Since you don&apos;t own seedlings in this batch, open the Demo console to start a fresh batch at day 0.
        </p>
      )}

      {state.status === "Active" && day >= state.harvestDay && owned === 0 && (
        <p className="mt-5 rounded-2xl bg-inner p-4 text-sm leading-relaxed">
          The cycle reached harvest (day {state.harvestDay}). Since you don&apos;t own seedlings in this batch, open the Demo console to start a fresh batch at day 0.
        </p>
      )}

      {state.status !== "Active" && owned === 0 && (
        <p className="mt-5 rounded-2xl bg-inner p-4 text-sm leading-relaxed">
          This batch is closed. To replay the demo, open the Demo console and press &ldquo;Start new batch&rdquo;.
        </p>
      )}

      {exitOpen && owned > 0 && (
        <ActionBlock
          title="Exit early"
          body={`The bonding curve currently pays ${usdc(state.curvePrice)} USDC per seedling. Selling all ${integer(owned)} returns ${usdc(exitQuote(state, owned))} USDC.`}
          cta={`Sell ${integer(owned)} ${owned === 1 ? "seedling" : "seedlings"}`}
          pending={busyText}
          onClick={() => run("sell seedlings", `Sold ${owned} seedlings on the bonding curve`, () => sell(owned))}
        />
      )}

      {state.status === "Defaulted" && owned > 0 && (
        <ActionBlock
          title="Insurance refund"
          shield
          body={`Parametric insurance was triggered. You can reclaim ${usdc(state.refundPrice)} USDC of principal per seedling.`}
          cta={`Claim refund for ${integer(owned)} ${owned === 1 ? "seedling" : "seedlings"}`}
          pending={busyText}
          onClick={() => run("claim the refund", "Principal refund claimed", () => claimRefund(owned))}
        />
      )}

      {state.status === "Settled" && owned > 0 && (
        <ActionBlock
          title="Harvest redemption"
          body={`The harvest was sold to the OTC buyer. Each seedling redeems for ${usdc(state.redemptionPrice, 4)} USDC and the tokens are burned.`}
          cta={`Redeem ${integer(owned)} ${owned === 1 ? "seedling" : "seedlings"}`}
          pending={busyText}
          onClick={() => run("redeem seedlings", "Tokens burned and redeemed", () => redeem(owned))}
        />
      )}
      {pending !== null && !fundingOpen && txPhase === "signing" && <PhantomHint />}
    </section>
  );
}

function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-3 ${last ? "" : "border-b border-line"}`}>
      <dt className="text-muted">{label}</dt>
      <dd className="font-display text-[17px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ActionBlock(props: {
  title: string;
  body: string;
  cta: string;
  pending: string | null;
  shield?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="mt-6 rounded-3xl border border-brand/30 bg-brand-soft p-5">
      <h4 className="flex items-center gap-2.5 text-[20px] font-semibold tracking-[-0.02em]">
        {props.shield && <ShieldIcon className="h-6 w-6 text-brand" />}
        {props.title}
      </h4>
      <p className="mt-1 text-sm leading-relaxed">{props.body}</p>
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.pending !== null}
        className="btn mt-4 w-full"
      >
        {props.pending ?? props.cta}
      </button>
    </div>
  );
}
