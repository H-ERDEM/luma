import fs from "fs";
import path from "path";
import { env } from "./config";

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

interface PersistedState {
  usdcMint: string | null;
  activeBatchId: string | null;
  history: Record<string, TelemetrySnapshot[]>;
}

const EMPTY: PersistedState = { usdcMint: null, activeBatchId: null, history: {} };

/** Demo durumunu (aktif parti, mock USDC mint'i, telemetri geçmişi) diskte tutar. */
export class StateStore {
  private readonly file = path.join(env.dataDir, "state.json");
  private state: PersistedState;

  constructor() {
    this.state = fs.existsSync(this.file)
      ? { ...EMPTY, ...(JSON.parse(fs.readFileSync(this.file, "utf8")) as PersistedState) }
      : { ...EMPTY, history: {} };
  }

  get usdcMint(): string | null {
    return this.state.usdcMint;
  }

  get activeBatchId(): bigint | null {
    return this.state.activeBatchId === null ? null : BigInt(this.state.activeBatchId);
  }

  setUsdcMint(mint: string): void {
    this.state.usdcMint = mint;
    this.flush();
  }

  setActiveBatch(batchId: bigint): void {
    this.state.activeBatchId = batchId.toString();
    this.state.history[batchId.toString()] = [];
    this.flush();
  }

  appendHistory(batchId: bigint, snapshot: TelemetrySnapshot): void {
    const key = batchId.toString();
    this.state.history[key] = [...(this.state.history[key] ?? []), snapshot];
    this.flush();
  }

  history(batchId: bigint): TelemetrySnapshot[] {
    return this.state.history[batchId.toString()] ?? [];
  }

  private flush(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }
}

/** Telemetri sıra numaralarının yarışmasını önlemek için demo işlemlerini sıraya koyar. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
