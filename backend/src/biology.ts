/**
 * Deterministik büyüme modeli (marul, 40 günlük hidroponik döngü).
 *
 * B(t) = (1 − e^(−t/τ)) / (1 − e^(−40/τ)), τ öyle seçilir ki B(20) = 0.85.
 * Ekonomik girdiler: Q_est = 250 g, P_market = 3.20 USDC/kg, toplam maliyet 0.40 USDC/fide
 * (doğrusal tükenir), RP = 0.04 USDC. Sonuç: FV(20) = 0.61, FV(40) = 0.76 USDC.
 */
import { Telemetry } from "./protocol";

export const CROP = {
  cycleDays: 40,
  estYieldGrams: 250,
  marketPricePerKg: 3_200_000n,
  totalCostPerSeedling: 400_000n,
  riskPremium: 40_000n,
  nominalWaterTempCentiC: 2_050,
  nominalFlowMlMin: 1_800,
  outageWaterTempCentiC: 3_350,
} as const;

const TARGET_B_AT_DAY_20 = 0.85;
const TAU = 20 / Math.log(TARGET_B_AT_DAY_20 / (1 - TARGET_B_AT_DAY_20));
const BPS = 10_000n;

export function growthFactor(day: number): number {
  if (day <= 0) return 0;
  if (day >= CROP.cycleDays) return 1;
  return (1 - Math.exp(-day / TAU)) / (1 - Math.exp(-CROP.cycleDays / TAU));
}

export const growthBps = (day: number): number => Math.round(growthFactor(day) * 10_000);

export function remainingCost(day: number): bigint {
  const left = BigInt(Math.max(0, CROP.cycleDays - day));
  return (CROP.totalCostPerSeedling * left) / BigInt(CROP.cycleDays);
}

/** Zincir üstü `compute_fair_value` ile aynı tamsayı aritmetiği. */
export function fairValue(t: Pick<Telemetry, "estYieldGrams" | "marketPricePerKg" | "growthFactorBps" | "remainingCost" | "riskPremium">): bigint {
  const b = BigInt(t.growthFactorBps);
  const gross = (BigInt(t.estYieldGrams) * t.marketPricePerKg * b) / (1_000n * BPS);
  const drag = (t.remainingCost * (BPS - b)) / BPS;
  return gross - drag - t.riskPremium;
}

export const curvePrice = (fv: bigint, unitPrice: bigint): bigint => (fv > unitPrice ? fv : unitPrice);

export interface SensorOptions {
  outage?: boolean;
  jitterSeed?: number;
}

/** Görselleştirme için hafif, deterministik dalgalanma (gerçek sensör gürültüsü taklidi). */
function jitter(seed: number, amplitude: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return Math.round((x - Math.floor(x) - 0.5) * 2 * amplitude);
}

export function buildTelemetry(
  day: number,
  sequence: bigint,
  observedAt: bigint,
  options: SensorOptions = {},
): Telemetry {
  const seed = options.jitterSeed ?? day;
  const outage = options.outage === true;
  return {
    sequence,
    observedAt,
    day,
    growthFactorBps: growthBps(day),
    estYieldGrams: CROP.estYieldGrams,
    marketPricePerKg: CROP.marketPricePerKg,
    remainingCost: remainingCost(day),
    riskPremium: CROP.riskPremium,
    waterTempCentiC: outage ? CROP.outageWaterTempCentiC : CROP.nominalWaterTempCentiC + jitter(seed, 40),
    flowRateMlMin: outage ? 0 : CROP.nominalFlowMlMin + jitter(seed + 1, 60),
    ecMicroSCm: 1_400 + day * 6 + jitter(seed + 2, 25),
    phCenti: 605 + jitter(seed + 3, 12),
  };
}

export interface CurvePoint {
  day: number;
  growthBps: number;
  fairValue: string;
  price: string;
}

export function theoreticalCurve(unitPrice: bigint): CurvePoint[] {
  return Array.from({ length: CROP.cycleDays + 1 }, (_, day) => {
    const t = buildTelemetry(day, 0n, 0n);
    const fv = fairValue(t);
    return { day, growthBps: t.growthFactorBps, fairValue: fv.toString(), price: curvePrice(fv, unitPrice).toString() };
  });
}
