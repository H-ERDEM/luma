"use client";

import { BotanicalCorner } from "@/components/icons";
import { SeedTray } from "@/components/SeedTray";
import { useLuma } from "@/hooks/useLuma";
import { integer, usdc } from "@/lib/format";

const STATUS = {
  Active: { label: "Growing", tone: "bg-brand-soft text-brand" },
  Defaulted: { label: "Insurance triggered", tone: "bg-risk-soft text-risk" },
  Settled: { label: "Harvested", tone: "bg-info-soft text-info" },
} as const;

/** `next dev` ile yerel geliştirme; üretim derlemesinde (Vercel) false. */
const IS_LOCAL_DEV = process.env.NODE_ENV === "development";

/** Güncel parti özeti. Veri yokken ya da backend'e ulaşılamazken ziyaretçiye ne olduğunu söyler. */
export function BatchSnapshot() {
  const { state, feed, backendError } = useLuma();

  if (!state || !feed) {
    return (
      <aside className="relative overflow-hidden rounded-card border border-line bg-surface p-6 shadow-float" aria-label="Current batch">
        <p className="text-[12.5px] text-muted">Current batch</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">Batch data</p>
        {backendError === null ? (
          <p className="mt-6 text-sm text-muted">Loading batch data…</p>
        ) : IS_LOCAL_DEV ? (
          <p role="alert" className="mt-5 rounded-xl bg-risk-soft p-4 text-sm text-risk">
            Cannot reach the backend: {backendError}. Make sure &apos;npm run dev&apos; is running in the backend directory.
          </p>
        ) : (
          // Canlı sitede ziyaretçi için: ücretsiz barındırma boştayken uyur, ilk istek onu uyandırır.
          <p role="status" className="mt-5 rounded-xl border border-line bg-inner p-4 text-sm leading-relaxed">
            The server may be waking up (free plan). This page will retry automatically; if it takes longer than a minute,
            reload the page.
            <span className="mt-1.5 block text-xs text-muted">Technical detail: {backendError}</span>
          </p>
        )}
      </aside>
    );
  }

  const day = state.telemetry.day;
  const status = STATUS[state.status];

  return (
    <aside className="relative overflow-hidden rounded-card border border-line bg-surface p-5 shadow-float sm:p-6" aria-label="Current batch">
      <BotanicalCorner className="pointer-events-none absolute -right-12 -top-14 h-[180px] w-[180px] opacity-90" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[12.5px] text-muted">Current batch</p>
          <p className="text-2xl font-semibold tracking-tight">Batch #{state.addresses.batchId}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${status.tone}`}>{status.label}</span>
      </div>
      <p className="relative mb-3.5 mt-[18px] flex items-center gap-3.5 text-sm text-muted">
        <span>
          Day <b className="text-ink">{day}</b> of {state.harvestDay}
        </span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track" aria-hidden>
          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (day / state.harvestDay) * 100)}%` }} />
        </span>
      </p>
      <SeedTray day={day} harvestDay={state.harvestDay} curve={feed.curve} failed={state.status === "Defaulted"} />
      <dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 border-t border-line pt-[18px] sm:grid-cols-3">
        <Stat label="Price per seedling" value={usdc(state.curvePrice)} unit="USDC" />
        <Stat label="Fair value" value={usdc(state.fairValue)} unit="USDC" />
        <Stat label="Seedlings backed" value={integer(state.circulatingSupply)} unit={`/ ${integer(state.maxSupply)}`} className="col-span-2 sm:col-span-1" />
      </dl>
    </aside>
  );
}

function Stat({ label, value, unit, className = "" }: { label: string; value: string; unit: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-tight">
        {value} <small className="text-xs font-medium text-muted">{unit}</small>
      </dd>
    </div>
  );
}
