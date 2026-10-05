"use client";

import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckIcon } from "@/components/icons";
import { SectionHead } from "@/components/HowItWorks";
import { useLuma } from "@/hooks/useLuma";
import { celsius, integer, pct, ph, usdc } from "@/lib/format";
import { explorerTx } from "@/lib/env";

const MAX_TEMP_CENTI = 3_200;
/** Grafiğin değer ekseni: 0.30 altı (adil değerin negatif başlangıcı) gösterilmez, eksen anlamlı kalır. */
const CHART_MIN = 0.3;
const CHART_MAX = 0.8;
const CHART_TICKS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

const SOURCE_LABEL = {
  ChainlinkDon: "Chainlink DON",
  AuthorityEd25519: "Ed25519 fallback signer",
  None: "none yet",
} as const;

/** Canlı varlık kanıtı: sensörler, yaprak örtüsü, bonding curve ve kasa sağlığı. */
export function LivePoAPanel() {
  const { state, feed } = useLuma();

  const head = (subtitle: string) => (
    <SectionHead eyebrow="Live batch" title="Verified from the greenhouse" id="live-title">
      <p className="mt-5 max-w-[60ch] text-[16px] text-muted">{subtitle}</p>
    </SectionHead>
  );

  if (state === null || feed === null) {
    return (
      <section id="live" aria-labelledby="live-title" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-16 sm:px-8 sm:py-24">
        {head("Live sensor and on-chain data will appear as soon as the batch data loads.")}
      </section>
    );
  }

  const day = state.telemetry.day;
  const unit = Number(state.unitPrice) / 1e6;
  const chart = feed.curve.map((p) => {
    const fairValue = Number(p.fairValue) / 1e6;
    return { day: p.day, price: Number(p.price) / 1e6, fairValue: fairValue >= CHART_MIN ? fairValue : null };
  });
  const live = feed.live;
  const tempAlarm = live.waterTempCentiC > MAX_TEMP_CENTI;
  const flowAlarm = live.flowRateMlMin === 0;
  const escrow = Number(state.escrowBalance);
  const required = Number(state.requiredCollateral);
  const coverage = required === 0 ? 1 : escrow / required;
  const covered = coverage >= 1;
  const source = SOURCE_LABEL[state.lastOracleSource as keyof typeof SOURCE_LABEL] ?? SOURCE_LABEL.None;

  return (
    <section id="live" aria-labelledby="live-title" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-16 sm:px-8 sm:py-24">
      {head(`Latest on-chain record #${state.telemetry.sequence}, signed by the ${source}.`)}

      <dl className="mb-6 grid grid-cols-2 border-y border-line lg:grid-cols-4">
        <BigStat label="Day of the growth cycle" value={String(day)} unit={`/ ${state.harvestDay}`} />
        <BigStat label="Price per seedling" value={usdc(state.curvePrice)} unit="USDC" />
        <BigStat label="Locked in escrow" value={usdc(state.escrowBalance)} unit="USDC" />
        <BigStat label="Collateral coverage" value={String(Math.round(coverage * 100))} unit="%" />
      </dl>

      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-12" title="Sensors">
          <div className="mt-5 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
            <Sensor label="Water temperature" value={celsius(live.waterTempCentiC)} hint={`Limit ${celsius(MAX_TEMP_CENTI)}`} alarm={tempAlarm} />
            <Sensor label="Nutrient flow" value={`${integer(live.flowRateMlMin)} ml/min`} hint={flowAlarm ? "No flow" : "Pump running"} alarm={flowAlarm} />
            <Sensor label="Conductivity (EC)" value={`${integer(live.ecMicroSCm)} µS/cm`} />
            <Sensor label="pH" value={ph(live.phCenti)} />
            <Sensor label="Canopy cover" value={pct(live.growthFactorBps)} hint="Growth factor B_t" />
          </div>
        </Card>

        <Card className="lg:col-span-8" title="Value per seedling">
          <p className="mt-2 max-w-[60ch] text-[15.5px] text-muted">
            The solid line is the bonding-curve price; the dashed line is fair value. The price never falls below the {usdc(state.unitPrice)} USDC principal floor.
          </p>
          <div className="mt-3 h-[260px] w-full sm:h-[290px]">
            <ResponsiveContainer>
              <LineChart data={chart} margin={{ top: 10, right: 14, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} ticks={[0, 10, 20, 30, 40]} tickFormatter={(d: number) => `Day ${d}`} fontSize={12} stroke="#8C8C8C" />
                <YAxis domain={[CHART_MIN, CHART_MAX]} ticks={CHART_TICKS} allowDataOverflow tickLine={false} axisLine={false} width={40} fontSize={12} stroke="#8C8C8C" tickFormatter={(v: number) => v.toFixed(2)} />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toFixed(4)} USDC`, name === "price" ? "Curve price" : "Fair value"]}
                  labelFormatter={(d: number) => `Day ${d}`}
                  contentStyle={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.18)", background: "#161616", color: "#fff", fontSize: 13 }}
                  itemStyle={{ color: "#fff" }}
                  labelStyle={{ color: "#A6A6A6" }}
                />
                <ReferenceLine y={unit} stroke="rgba(255,255,255,0.6)" strokeDasharray="3 5" label={{ value: `Principal floor ${usdc(state.unitPrice)}`, position: "insideBottomRight", fontSize: 12, fill: "#FFFFFF", fontWeight: 600 }} />
                <ReferenceLine x={state.earlyExitDay} stroke="rgba(255,255,255,0.25)" label={{ value: "Early exit opens", position: "insideTopRight", fontSize: 12, fill: "#A6A6A6" }} />
                <ReferenceLine x={state.harvestDay} stroke="rgba(255,255,255,0.25)" />
                <Line type="monotone" dataKey="fairValue" stroke="#7A7A7A" strokeDasharray="5 6" dot={false} strokeWidth={1.8} isAnimationActive={false} connectNulls={false} />
                <Line type="monotone" dataKey="price" stroke="#8EE05A" dot={false} strokeWidth={3.5} isAnimationActive={false} />
                <ReferenceDot x={day} y={Number(state.curvePrice) / 1e6} r={6} fill="#FFFFFF" stroke="#060606" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-4" title="Collateral vault">
          <p className="mt-2 text-[15.5px] text-muted">Escrow must always cover circulating seedlings × {usdc(state.unitPrice)} USDC.</p>
          <div
            className="mt-5 h-2.5 w-full overflow-hidden rounded-full bg-track"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(coverage, 1) * 100)}
            aria-label="Collateral coverage"
          >
            <div className={`h-full ${covered ? "bg-brand" : "bg-risk"}`} style={{ width: `${Math.min(coverage, 1) * 100}%` }} />
          </div>
          <p className={`mt-2.5 flex items-center gap-1.5 text-sm font-semibold ${covered ? "text-brand" : "text-risk"}`}>
            {covered && <CheckIcon className="h-4 w-4" />}
            {covered ? "Fully collateralized" : "Under-collateralized"}
          </p>
          <dl className="mt-4 text-[15px]">
            <VaultRow label="Escrow balance" value={`${usdc(state.escrowBalance)} USDC`} />
            <VaultRow label="Required collateral" value={`${usdc(state.requiredCollateral)} USDC`} />
            <VaultRow label="Early-exit reserve" value={`${usdc(state.reserveBalance)} USDC`} last />
          </dl>
        </Card>

        <Card className="lg:col-span-12" title="Oracle records">
          {feed.history.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No oracle updates yet.</p>
          ) : (
            <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[...feed.history].reverse().slice(0, 5).map((h) => (
                <li key={h.sequence} className="flex flex-col gap-1.5 rounded-2xl bg-inner p-4 text-sm tabular-nums">
                  <span>
                    Day {h.day} · {usdc(h.curvePrice)} USDC
                  </span>
                  <a href={explorerTx(h.signature)} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-brand hover:underline">
                    {h.source === "ChainlinkDon" ? "DON" : "Ed25519"} tx ↗
                  </a>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </section>
  );
}

function Card({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-card border border-line bg-surface p-6 sm:p-9 ${className}`}>
      <h3 className="text-[24px] font-semibold tracking-[-0.02em]">{title}</h3>
      {children}
    </div>
  );
}

function VaultRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-3 ${last ? "" : "border-b border-line"}`}>
      <dt className="text-muted">{label}</dt>
      <dd className="font-display text-[17px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Sensor({ label, value, hint, alarm = false }: { label: string; value: string; hint?: string; alarm?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 ${alarm ? "border border-white/70 bg-white/10" : "bg-inner"}`}>
      <p className="text-[13.5px] text-muted">{label}</p>
      <p className="mt-2 font-display text-[26px] font-semibold tabular-nums tracking-[-0.02em]">{value}</p>
      {hint && <p className={`mt-0.5 text-[12.5px] ${alarm ? "font-semibold text-white" : "text-muted"}`}>{hint}</p>}
    </div>
  );
}

function BigStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="border-b border-line px-1 py-8 odd:pr-5 even:border-l even:pl-6 sm:py-10 lg:border-b-0 lg:border-l lg:px-8 lg:first:border-l-0 lg:first:pl-0">
      <dd className="flex flex-wrap items-baseline gap-x-2 font-display text-[44px] font-semibold leading-none tabular-nums tracking-[-0.03em] sm:text-[60px] lg:text-[52px]">
        {value}
        <small className="font-sans text-[15px] font-medium tracking-normal text-muted sm:text-[18px]">{unit}</small>
      </dd>
      <dt className="mt-4 text-[14.5px] text-muted">{label}</dt>
    </div>
  );
}
