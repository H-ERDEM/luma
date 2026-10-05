"use client";

import { ShieldIcon } from "@/components/icons";
import { SeedTray } from "@/components/SeedTray";
import { useLuma } from "@/hooks/useLuma";
import { integer, usdc } from "@/lib/format";

const STATUS = {
  Active: { label: "Growing", tone: "bg-brand-soft text-brand", shield: false },
  // Sigorta tetiklenmesi bir hata değil: anapara korunduğu andır.
  Defaulted: { label: "Insurance triggered", tone: "bg-brand text-black", shield: true },
  Settled: { label: "Harvested", tone: "bg-white/10 text-white", shield: false },
} as const;

/** `next dev` ile yerel geliştirme; üretim derlemesinde (Vercel) false. */
const IS_LOCAL_DEV = process.env.NODE_ENV === "development";

/** Güncel parti özeti. Veri yokken ya da backend'e ulaşılamazken ziyaretçiye ne olduğunu söyler. */
export function BatchSnapshot() {
  const { state, feed, backendError } = useLuma();

  if (!state || !feed) {
    return (
      <aside className="rounded-card border border-line bg-surface p-7 sm:p-9" aria-label="Current batch">
        <p className="text-[14px] text-muted">Current batch</p>
        <p className="mt-1 font-display text-3xl font-semibold tracking-tight">Batch data</p>
        {backendError === null ? (
          <p className="mt-6 text-sm text-muted">Loading batch data…</p>
        ) : IS_LOCAL_DEV ? (
          <p role="alert" className="mt-5 rounded-2xl bg-risk-soft p-4 text-sm text-risk">
            Cannot reach the backend: {backendError}. Make sure &apos;npm run dev&apos; is running in the backend directory.
          </p>
        ) : (
          // Canlı sitede ziyaretçi için: ücretsiz barındırma boştayken uyur, ilk istek onu uyandırır.
          <p role="status" className="mt-5 rounded-2xl border border-line bg-inner p-4 text-sm leading-relaxed">
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
    <aside className="rounded-card border border-line bg-surface p-6 sm:p-9" aria-label="Current batch">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] text-muted">Current batch</p>
          <p className="font-display text-[28px] font-semibold tracking-[-0.02em] sm:text-[32px]">Batch #{state.addresses.batchId}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${status.tone}`}>
          {status.shield && <ShieldIcon className="h-4 w-4" />}
          {status.label}
        </span>
      </div>
      <p className="mb-5 mt-6 flex items-center gap-4 text-[15px] text-muted">
        <span className="whitespace-nowrap">
          Day <b className="text-white">{day}</b> of {state.harvestDay}
        </span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track" aria-hidden>
          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (day / state.harvestDay) * 100)}%` }} />
        </span>
      </p>
      <SeedTray day={day} harvestDay={state.harvestDay} curve={feed.curve} failed={state.status === "Defaulted"} />
      <dl className="mt-7 grid grid-cols-2 gap-x-4 gap-y-6 border-t border-line pt-7">
        <Stat label="Price per seedling" value={usdc(state.curvePrice)} unit="USDC" />
        <Stat label="Seedlings backed" value={integer(state.circulatingSupply)} unit={`/ ${integer(state.maxSupply)}`} />
      </dl>
    </aside>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <dd className="order-2 font-display text-[34px] font-semibold leading-none tabular-nums tracking-[-0.03em] sm:text-[40px]">
        {value} <small className="font-sans text-[14px] font-medium tracking-normal text-muted">{unit}</small>
      </dd>
      <dt className="mt-2 text-[13.5px] text-muted">{label}</dt>
    </div>
  );
}
