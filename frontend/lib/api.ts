import type { Idl } from "@coral-xyz/anchor";
import { BACKEND_URL } from "./env";

export type BatchStatus = "Active" | "Defaulted" | "Settled";

export interface CommittedTelemetry {
  sequence: string;
  observedAt: string;
  day: number;
  growthFactorBps: number;
  estYieldGrams: number;
  marketPricePerKg: string;
  remainingCost: string;
  riskPremium: string;
  waterTempCentiC: number;
  flowRateMlMin: number;
  ecMicroSCm: number;
  phCenti: number;
}

export interface BatchState {
  programs: { luma: string; hook: string };
  addresses: {
    batchId: string;
    batchVault: string;
    mint: string;
    usdcMint: string;
    settlementEscrow: string;
    escrowUsdc: string;
    reserveVault: string;
    reserveUsdc: string;
    extraAccountMetaList: string;
    config: string;
  };
  status: BatchStatus;
  lastOracleSource: "None" | "ChainlinkDon" | "AuthorityEd25519";
  unitPrice: string;
  maxSupply: string;
  circulatingSupply: string;
  mintSupply: string;
  fundingCloseDay: number;
  earlyExitDay: number;
  harvestDay: number;
  harvestFeeBps: number;
  fairValue: string;
  curvePrice: string;
  refundPrice: string;
  redemptionPrice: string;
  lastUpdateTs: string;
  escrowBalance: string;
  reserveBalance: string;
  requiredCollateral: string;
  telemetry: CommittedTelemetry;
}

export interface TelemetrySnapshot {
  sequence: string;
  day: number;
  observedAt: string;
  growthFactorBps: number;
  waterTempCentiC: number;
  flowRateMlMin: number;
  ecMicroSCm: number;
  phCenti: number;
  fairValue: string;
  curvePrice: string;
  source: "ChainlinkDon" | "AuthorityEd25519";
  signature: string;
}

export interface CurvePoint {
  day: number;
  growthBps: number;
  fairValue: string;
  price: string;
}

export interface TelemetryFeed {
  status: BatchStatus;
  committed: CommittedTelemetry;
  live: {
    day: number;
    growthFactorBps: number;
    waterTempCentiC: number;
    flowRateMlMin: number;
    ecMicroSCm: number;
    phCenti: number;
    observedAt: string;
  };
  history: TelemetrySnapshot[];
  curve: CurvePoint[];
}

export interface KycStatus {
  exists: boolean;
  approved: boolean;
  updatedAt: number | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Gövdesiz (GET) isteklerde Content-Type göndermeyiz: aksi halde tarayıcı her istekten önce
  // bir CORS ön isteği (OPTIONS) yapar ve HTTP trafiği ikiye katlanır.
  const headers = init?.body !== undefined ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers;
  const res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers, cache: "no-store" });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `İstek başarısız (${res.status})`);
  }
  return body;
}

const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  idl: (name: "luma_batch" | "luma_transfer_hook") => request<Idl>(`/api/idl/${name}`),
  /** `fresh`: backend önbelleğini atlar (kendi işleminizden hemen sonra). */
  batchState: (fresh = false) => request<BatchState>(`/api/batch/state${fresh ? "?fresh=1" : ""}`),
  /** Durum + telemetri tek istekte (yoklama bunu kullanır). */
  snapshot: (fresh = false) =>
    request<{ state: BatchState; feed: TelemetryFeed }>(`/api/snapshot${fresh ? "?fresh=1" : ""}`),
  telemetry: () => request<TelemetryFeed>("/api/telemetry/current"),
  kyc: (wallet: string) => request<KycStatus>(`/api/kyc/${wallet}`),
  verifyKyc: (wallet: string) => post<{ signature: string }>("/api/kyc/verify", { wallet }),
  faucet: (wallet: string) => post<{ minted: string; usdcAccount: string }>("/demo/faucet", { wallet }),
  advanceDays: (targetDay: number) => post<{ pushed: TelemetrySnapshot[] }>("/demo/advance-days", { targetDay }),
  triggerOutage: () => post<{ signature: string; refundPrice: string }>("/demo/trigger-outage"),
  settleHarvest: () => post<{ signature: string; otcAmount: string; redemptionPrice: string }>("/demo/settle-harvest"),
  reset: () => post<{ batchId: string }>("/demo/reset"),
};
