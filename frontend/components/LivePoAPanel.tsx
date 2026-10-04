"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLuma } from "@/hooks/useLuma";
import { celsius, pct, ph, usdc } from "@/lib/format";
import { explorerTx } from "@/lib/env";

const MAX_TEMP_CENTI = 3_200;

/** Canlı varlık kanıtı: sensörler, yaprak örtüsü, bonding curve ve kasa sağlığı. */
export function LivePoAPanel() {
  const { state, feed } = useLuma();
  if (state === null || feed === null) return null;

  const day = state.telemetry.day;
  const unit = Number(state.unitPrice) / 1e6;
  const chart = feed.curve.map((p) => ({
    day: p.day,
    price: Number(p.price) / 1e6,
    fairValue: Number(p.fairValue) / 1e6,
  }));
  const live = feed.live;
  const tempAlarm = live.waterTempCentiC > MAX_TEMP_CENTI;
  const flowAlarm = live.flowRateMlMin === 0;
  const escrow = Number(state.escrowBalance);
  const required = Number(state.requiredCollateral);
  const coverage = required === 0 ? 1 : escrow / required;

  return (
    <section aria-labelledby="poa-title" className="rounded-2xl border border-line bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="poa-title" className="font-display text-2xl font-semibold">
          Tepsiden canlı veri
        </h2>
        <p className="text-sm text-muted">
          Zincirdeki son kayıt #{state.telemetry.sequence}, kaynak{" "}
          {state.lastOracleSource === "ChainlinkDon"
            ? "Chainlink DON"
            : state.lastOracleSource === "AuthorityEd25519"
              ? "Ed25519 yedek imzacı"
              : "henüz yok"}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Sensor label="Su sıcaklığı" value={celsius(live.waterTempCentiC)} hint="Sınır 32,0 °C" alarm={tempAlarm} />
        <Sensor label="Çözelti akışı" value={`${live.flowRateMlMin} ml/dk`} hint={flowAlarm ? "Akış yok" : "Pompa çalışıyor"} alarm={flowAlarm} />
        <Sensor label="İletkenlik (EC)" value={`${live.ecMicroSCm} µS/cm`} />
        <Sensor label="pH" value={ph(live.phCenti)} />
        <Sensor label="Yaprak örtüsü" value={pct(live.growthFactorBps)} hint="B_t katsayısı" />
      </div>

      <div className="mt-8">
        <h3 className="font-display text-lg font-semibold">Fide başına değer eğrisi</h3>
        <p className="text-sm text-muted">
          Çizgi bonding curve fiyatıdır; kesikli çizgi FV_t adil değeridir. Fiyat hiçbir zaman {usdc(state.unitPrice)} USDC
          anapara tabanının altına inmez.
        </p>
        <div className="mt-3 h-64 w-full">
          <ResponsiveContainer>
            <LineChart data={chart} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#E3E9E3" vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} ticks={[0, 10, 20, 30, 40]} tickFormatter={(d: number) => `${d}. gün`} fontSize={12} />
              <YAxis domain={[0.3, 0.8]} tickLine={false} axisLine={false} width={44} fontSize={12} tickFormatter={(v: number) => v.toFixed(2)} />
              <Tooltip
                formatter={(v: number, name: string) => [`${v.toFixed(4)} USDC`, name === "price" ? "Curve fiyatı" : "Adil değer"]}
                labelFormatter={(d: number) => `${d}. gün`}
              />
              <ReferenceLine y={unit} stroke="#2C6E8A" strokeDasharray="2 4" label={{ value: "anapara tabanı", position: "insideBottomRight", fontSize: 11, fill: "#2C6E8A" }} />
              <ReferenceLine x={state.earlyExitDay} stroke="#CBD5CB" />
              <ReferenceLine x={state.harvestDay} stroke="#CBD5CB" />
              <Line type="monotone" dataKey="fairValue" stroke="#5B6B61" strokeDasharray="4 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line type="monotone" dataKey="price" stroke="#4C8C3F" dot={false} strokeWidth={2.5} isAnimationActive={false} />
              <ReferenceDot x={day} y={Number(state.curvePrice) / 1e6} r={6} fill="#17231D" stroke="#fff" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="font-display text-lg font-semibold">Teminat kasası</h3>
          <p className="text-sm text-muted">Escrow her an dolaşımdaki fide × {usdc(state.unitPrice)} USDC'yi karşılamalı.</p>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-paper" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(coverage, 2) * 50)} aria-label="Teminat oranı">
            <div className={`h-full ${coverage >= 1 ? "bg-solution" : "bg-heat"}`} style={{ width: `${Math.min(coverage, 2) * 50}%` }} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Escrow bakiyesi</dt>
            <dd className="text-right tabular-nums">{usdc(state.escrowBalance)} USDC</dd>
            <dt className="text-muted">Gereken teminat</dt>
            <dd className="text-right tabular-nums">{usdc(state.requiredCollateral)} USDC</dd>
            <dt className="text-muted">Erken çıkış rezervi</dt>
            <dd className="text-right tabular-nums">{usdc(state.reserveBalance)} USDC</dd>
          </dl>
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold">Oracle kayıtları</h3>
          {feed.history.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Henüz oracle güncellemesi yok.</p>
          ) : (
            <ol className="mt-2 space-y-1.5 text-sm">
              {[...feed.history].reverse().slice(0, 6).map((h) => (
                <li key={h.sequence} className="flex items-center justify-between gap-3">
                  <span className="tabular-nums">
                    {h.day}. gün, {usdc(h.curvePrice)} USDC
                  </span>
                  <a href={explorerTx(h.signature)} target="_blank" rel="noreferrer" className="text-solution underline-offset-2 hover:underline">
                    {h.source === "ChainlinkDon" ? "DON" : "Ed25519"} işlemi
                  </a>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

function Sensor({ label, value, hint, alarm = false }: { label: string; value: string; hint?: string; alarm?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${alarm ? "bg-heat-soft text-heat" : "bg-paper"}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className={`text-xs ${alarm ? "font-medium" : "text-muted"}`}>{hint}</p>}
    </div>
  );
}
