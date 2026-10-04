"use client";

import dynamic from "next/dynamic";
import { KycBadge } from "@/components/KycBadge";
import { Launchpad } from "@/components/Launchpad";
import { LivePoAPanel } from "@/components/LivePoAPanel";
import { JuryAdminDrawer } from "@/components/JuryAdminDrawer";
import { SeedTray } from "@/components/SeedTray";
import { useLuma } from "@/hooks/useLuma";
import { usdc } from "@/lib/format";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

const STATUS_COPY = {
  Active: { label: "Büyüyor", tone: "text-leaf-deep" },
  Defaulted: { label: "Sigorta tetiklendi", tone: "text-heat" },
  Settled: { label: "Hasat edildi", tone: "text-solution" },
} as const;

export default function Home() {
  const { state, feed, backendError } = useLuma();

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-2xl font-bold tracking-tight">luma</p>
        <div className="flex flex-wrap items-center gap-3">
          <KycBadge />
          <WalletMultiButton />
        </div>
      </header>

      {backendError && (
        <p role="alert" className="mt-6 rounded-xl bg-heat-soft p-4 text-sm text-heat">
          Backend'e ulaşılamıyor: {backendError}. backend dizininde 'npm run dev' çalıştığından emin olun.
        </p>
      )}

      {state && feed ? (
        <>
          <section className="mt-10 grid items-end gap-8 md:grid-cols-[1.1fr_1fr]">
            <div>
              <h1 className="font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-7xl">
                Gün {state.telemetry.day}
                <span className="block text-3xl font-semibold text-muted sm:text-4xl">/ {state.harvestDay} günlük marul döngüsü</span>
              </h1>
              <p className="mt-4 max-w-prose text-lg">
                Parti #{state.addresses.batchId}: {state.circulatingSupply} fide, su sensörleri ve yaprak örtüsü ölçümleriyle
                zincirde izleniyor. Fiyat bitki büyüdükçe artar; arızada anapara sigortalıdır.
              </p>
              <dl className="mt-6 grid max-w-md grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-muted">Durum</dt>
                  <dd className={`font-medium ${STATUS_COPY[state.status].tone}`}>{STATUS_COPY[state.status].label}</dd>
                </div>
                <div>
                  <dt className="text-muted">Fide fiyatı</dt>
                  <dd className="font-medium tabular-nums">{usdc(state.curvePrice)} USDC</dd>
                </div>
                <div>
                  <dt className="text-muted">Adil değer</dt>
                  <dd className="font-medium tabular-nums">{usdc(state.fairValue)} USDC</dd>
                </div>
              </dl>
            </div>
            <SeedTray
              day={state.telemetry.day}
              harvestDay={state.harvestDay}
              curve={feed.curve}
              failed={state.status === "Defaulted"}
            />
          </section>

          <div className="mt-10 grid gap-6 lg:grid-cols-[360px_1fr]">
            <Launchpad />
            <LivePoAPanel />
          </div>
        </>
      ) : (
        !backendError && <p className="mt-16 text-muted">Parti verisi yükleniyor…</p>
      )}

      <JuryAdminDrawer />
    </main>
  );
}
