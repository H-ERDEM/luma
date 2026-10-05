/** Zincirden yeniden kurulabilen bir telemetri kaydı (arayüzdeki "Oracle kayıtları"). */
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

/** Telemetri sıra numaralarının yarışmasını önlemek için demo işlemlerini sıraya koyar. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
