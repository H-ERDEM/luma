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
      <p className="mt-1.5 text-[14.5px] text-muted">{subtitle}</p>
    </SectionHead>
  );

  if (state === null || feed === null) {
    return (
      <section id="live" aria-labelledby="live-title" className="mx-auto max-w-[1160px] scroll-mt-20 px-5 py-10 sm:px-7">
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
    <section id="live" aria-labelledby="live-title" className="mx-auto max-w-[1160px] scroll-mt-20 px-5 py-10 sm:px-7">
      {head(`Latest on-chain record #${state.telemetry.sequence}, signed by the ${source}.`)}

      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-12" title="Sensors">
          <div className="mt-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
            <Sensor label="Water temperature" value={celsius(live.waterTempCentiC)} hint={`Limit ${celsius(MAX_TEMP_CENTI)}`} alarm={tempAlarm} />
            <Sensor label="Nutrient flow" value={`${integer(live.flowRateMlMin)} ml/min`} hint={flowAlarm ? "No flow" : "Pump running"} alarm={flowAlarm} />
            <Sensor label="Conductivity (EC)" value={`${integer(live.ecMicroSCm)} µS/cm`} />
            <Sensor label="pH" value={ph(live.phCenti)} />
            <Sensor label="Canopy cover" value={pct(live.growthFactorBps)} hint="Growth factor B_t" />
          </div>
        </Card>

        <Card className="lg:col-span-8" title="Value per seedling">
          <p className="mt-1.5 text-[14.5px] text-muted">
            The solid line is the bonding-curve price; the dashed line is fair value. The price never falls below the {usdc(state.unitPrice)} USDC principal floor.
          </p>
          <div className="mt-3 h-[260px] w-full sm:h-[290px]">
            <ResponsiveContainer>
              <LineChart data={chart} margin={{ top: 10, right: 14, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#E4E8E2" vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} ticks={[0, 10, 20, 30, 40]} tickFormatter={(d: number) => `Day ${d}`} fontSize={11.5} stroke="#5B6877" />
                <YAxis domain={[CHART_MIN, CHART_MAX]} ticks={CHART_TICKS} allowDataOverflow tickLine={false} axisLine={false} width={40} fontSize={11.5} stroke="#5B6877" tickFormatter={(v: number) => v.toFixed(2)} />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toFixed(4)} USDC`, name === "price" ? "Curve price" : "Fair value"]}
                  labelFormatter={(d: number) => `Day ${d}`}
                  contentStyle={{ borderRadius: 10, border: "1px solid #E4E8E2", fontSize: 13 }}
                />
                <ReferenceLine y={unit} stroke="#1D5FA6" strokeDasharray="3 4" label={{ value: `Principal floor ${usdc(state.unitPrice)}`, position: "insideBottomRight", fontSize: 11.5, fill: "#1D5FA6", fontWeight: 600 }} />
                <ReferenceLine x={state.earlyExitDay} stroke="#CBD3CA" label={{ value: "Early exit opens", position: "insideTopRight", fontSize: 11.5, fill: "#5B6877" }} />
                <ReferenceLine x={state.harvestDay} stroke="#CBD3CA" />
                <Line type="monotone" dataKey="fairValue" stroke="#8794A3" strokeDasharray="5 5" dot={false} strokeWidth={1.8} isAnimationActive={false} connectNulls={false} />
                <Line type="monotone" dataKey="price" stroke="#0F6B4F" dot={false} strokeWidth={3} isAnimationActive={false} />
                <ReferenceDot x={day} y={Number(state.curvePrice) / 1e6} r={6} fill="#0D1B2A" stroke="#fff" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-4" title="Collateral vault">
          <p className="mt-1.5 text-[14.5px] text-muted">Escrow must always cover circulating seedlings × {usdc(state.unitPrice)} USDC.</p>
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
          <dl className="mt-3 text-[14.5px]">
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
                <li key={h.sequence} className="flex flex-col gap-1 rounded-[10px] bg-inner p-3.5 text-sm tabular-nums">
                  <span>
                    Day {h.day} · {usdc(h.curvePrice)} USDC
                  </span>
                  <a href={explorerTx(h.signature)} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-info hover:underline">
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
    <div className={`rounded-card border border-line bg-surface p-5 shadow-card sm:p-6 ${className}`}>
      <h3 className="text-[19px] font-semibold tracking-tight">{title}</h3>
      {children}
    </div>
  );
}

function VaultRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-[9px] ${last ? "" : "border-b border-line"}`}>
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Sensor({ label, value, hint, alarm = false }: { label: string; value: string; hint?: string; alarm?: boolean }) {
  return (
    <div className={`rounded-[10px] p-4 ${alarm ? "bg-risk-soft text-risk" : "bg-inner"}`}>
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="mt-1.5 text-[22px] font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className={`mt-0.5 text-[12.5px] ${alarm ? "font-semibold" : "text-muted"}`}>{hint}</p>}
    </div>
  );
}
