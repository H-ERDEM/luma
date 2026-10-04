import { PublicKey } from "@solana/web3.js";
import { BATCH_ECONOMICS, DEMO, env, limits, redactSecrets } from "./config";
import { FaucetGuard, LimitError } from "./limits";
import { LumaClient, OracleMode } from "./chain";
import { buildTelemetry } from "./biology";
import { loadProtocolKeys } from "./keys";
import { BatchAddresses } from "./protocol";
import { Mutex, TelemetrySnapshot } from "./store";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

export interface AdminStatus {
  lamports: number;
  sol: number;
  low: boolean;
  critical: boolean;
}

export type BatchStateSnapshot = Awaited<ReturnType<LumaClient["batchState"]>>;

/** Bellekte tutulan ve zincirden yeniden kurulan telemetri kaydı sayısı (arayüz son 6'yı gösterir). */
const HISTORY_LIMIT = 10;

/** Zincir durumu bu süre boyunca önbellekten verilir; tüm izleyiciler tek RPC turunu paylaşır. */
const STATE_TTL_MS = 2_500;

/** Sunucu ve simülatörün paylaştığı uygulama durumu. */
export class AppContext {
  readonly client = LumaClient.create(loadProtocolKeys());
  readonly mutex = new Mutex();

  // --- Zincirden çözülen durum: diskte hiçbir şey tutulmaz (sunucu yeniden başlayınca kaybolmaz). ---
  private usdcMintKey: PublicKey | null = null;
  private activeBatchId: bigint | null = null;
  private readonly history = new Map<string, TelemetrySnapshot[]>();
  private loaded = false;
  private loading: Promise<void> | null = null;

  /** Faucet için cüzdan başına bekleme ve küresel günlük bütçe (bellekte). */
  readonly faucetGuard = new FaucetGuard({
    walletMaxPerDay: limits.faucetWalletMaxPerDay,
    dailyBudgetUsdc: limits.faucetDailyBudgetUsdc,
    dailyBudgetLamports: limits.faucetDailyBudgetLamports,
  });

  private adminCache: { at: number; value: Promise<AdminStatus> } | null = null;

  /** Admin cüzdanının SOL durumu (15 sn önbellek). `low`: SOL desteği kapalı; `critical`: faucet tamamen kapalı. */
  adminStatus(opts: { fresh?: boolean } = {}): Promise<AdminStatus> {
    const now = Date.now();
    if (opts.fresh !== true && this.adminCache !== null && now - this.adminCache.at < 15_000) return this.adminCache.value;
    const value = this.client.lamportsOf(this.client.admin).then((lamports) => ({
      lamports,
      sol: lamports / 1_000_000_000,
      low: lamports < limits.adminMinLamports,
      critical: lamports < limits.adminHardMinLamports,
    }));
    const entry = { at: now, value };
    this.adminCache = entry;
    value.catch(() => {
      if (this.adminCache === entry) this.adminCache = null;
    });
    return value;
  }

  private stateCache: { key: string; at: number; promise: Promise<BatchStateSnapshot> } | null = null;

  /** Aktif partinin durumu: kısa süreli önbellek + eşzamanlı isteklerin birleştirilmesi. */
  batchState(opts: { fresh?: boolean } = {}): Promise<BatchStateSnapshot> {
    const a = this.activeBatch();
    const key = a.batchVault.toBase58();
    const now = Date.now();
    if (opts.fresh !== true && this.stateCache !== null && this.stateCache.key === key && now - this.stateCache.at < STATE_TTL_MS) {
      return this.stateCache.promise;
    }
    const entry = { key, at: now, promise: this.client.batchState(a, this.usdcMint()) };
    this.stateCache = entry;
    entry.promise.catch(() => {
      if (this.stateCache === entry) this.stateCache = null;
    });
    return entry.promise;
  }

  /** Zinciri değiştiren her işlemden sonra çağrılır. */
  invalidateState(): void {
    this.stateCache = null;
  }

  /**
   * İlk istekten önce zincirden okunur: USDC mint'i `ProtocolConfig`'ten, aktif parti en yeni
   * "hazır" partiden, telemetri geçmişi son işlemlerden. Başarısız olursa (RPC hatası) sonraki
   * istek yeniden dener. Henüz bootstrap yapılmadıysa (config yok) yüklenmiş sayılmaz.
   */
  ensureReady(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loading === null) {
      const attempt = this.loadFromChain().finally(() => {
        if (this.loading === attempt) this.loading = null;
      });
      this.loading = attempt;
    }
    return this.loading;
  }

  private async loadFromChain(): Promise<void> {
    if (!(await this.client.configExists())) return; // bootstrap öncesi
    const config = await this.client.fetchConfig();
    this.usdcMintKey = config.usdcMint as PublicKey;
    this.activeBatchId = await this.resolveActiveBatch(Number(config.batchCount.toString()));
    if (this.activeBatchId !== null) {
      const a = this.client.batchAddresses(this.activeBatchId, this.usdcMintKey);
      this.history.set(this.activeBatchId.toString(), await this.client.recentTelemetry(a, HISTORY_LIMIT));
    }
    this.loaded = true;
  }

  /** En yeni "hazır" parti: sondan geriye bakılır, yarıda kalmış (yetim) partiler atlanır. */
  private async resolveActiveBatch(batchCount: number): Promise<bigint | null> {
    if (env.activeBatchOverride !== null) return BigInt(env.activeBatchOverride);
    for (let id = batchCount - 1; id >= Math.max(0, batchCount - 10); id--) {
      if (await this.client.isBatchReady(this.client.batchAddresses(BigInt(id), this.usdcMintKey!))) return BigInt(id);
    }
    return null;
  }

  /** Zinciri baştan okutur (bootstrap sonrası). */
  async reloadFromChain(): Promise<void> {
    this.loaded = false;
    this.loading = null;
    await this.ensureReady();
  }

  /**
   * Başlangıçta: yüklenen anahtarlar zincirdeki ProtocolConfig ile uyuşmuyorsa üretimde başlamayı
   * reddeder (her dağıtımda yeni anahtar üretilmesi gibi hatalar sessizce oracle'ı bozardı).
   * RPC okunamıyorsa başlamayı engellemez, uyarı verir.
   */
  async verifyKeys(): Promise<void> {
    let config: Record<string, PublicKey>;
    try {
      if (!(await this.client.configExists())) return;
      config = (await this.client.fetchConfig()) as Record<string, PublicKey>;
    } catch (err) {
      console.warn(`Anahtarlar zincirdeki config ile doğrulanamadı (RPC): ${describeError(err).message}`);
      return;
    }
    const problems = [
      !config.admin.equals(this.client.admin) && "ADMIN_KEYPAIR_JSON zincirdeki admin ile uyuşmuyor",
      !config.donAuthority.equals(this.client.keys.don.publicKey) && "DON_KEYPAIR_JSON zincirdeki donAuthority ile uyuşmuyor",
      !config.fallbackAuthority.equals(this.client.keys.fallback.publicKey) && "FALLBACK_KEYPAIR_JSON zincirdeki fallbackAuthority ile uyuşmuyor",
    ].filter((p): p is string => typeof p === "string");
    if (problems.length === 0) return;
    const text = `Anahtar uyuşmazlığı: ${problems.join("; ")}.`;
    if (env.production) throw new Error(text);
    console.warn(text);
  }

  usdcMint(): PublicKey {
    if (this.usdcMintKey === null) {
      throw new HttpError(503, "Protokol henüz kurulmamış. Yerel makinenizde 'npm run bootstrap' çalıştırın.");
    }
    return this.usdcMintKey;
  }

  activeBatch(): BatchAddresses {
    if (this.activeBatchId === null) {
      throw new HttpError(503, "Hazır parti yok. 'npm run bootstrap' veya POST /demo/reset çalıştırın.");
    }
    return this.client.batchAddresses(this.activeBatchId, this.usdcMint());
  }

  /** Aktif partinin son telemetri kayıtları (en eskiden yeniye). */
  telemetryHistory(batchId: bigint): TelemetrySnapshot[] {
    return this.history.get(batchId.toString()) ?? [];
  }

  /** Mock USDC + protokol yapılandırması + ilk parti; tekrar çalıştırılması güvenlidir. Durum zincirden okunur. */
  async bootstrap(): Promise<BatchAddresses> {
    if (!(await this.client.configExists())) {
      const mint = await this.client.createMockUsdc();
      await this.client.initializeConfig(mint);
    }
    await this.reloadFromChain();
    if (this.activeBatchId === null) return this.startNewBatch();
    return this.activeBatch();
  }

  async startNewBatch(): Promise<BatchAddresses> {
    const a = await this.client.createBatch(this.usdcMint());
    this.activeBatchId = a.batchId;
    this.history.set(a.batchId.toString(), []);
    await this.pushDay(a, 0, "don", false);
    return a;
  }

  /** Belirtilen gün için telemetri üretir, oracle yoluyla zincire yazar ve geçmişe ekler. */
  async pushDay(a: BatchAddresses, day: number, mode: OracleMode, outage: boolean): Promise<TelemetrySnapshot> {
    const before = await this.client.fetchBatch(a);
    const sequence = BigInt(before.telemetry.sequence.toString()) + 1n;
    const observedAt = await this.client.chainTime();
    const telemetry = buildTelemetry(day, sequence, observedAt, { outage, jitterSeed: Number(sequence) * 7 + day });
    const signature = await this.client.pushTelemetry(a, telemetry, mode);
    const after = await this.client.fetchBatch(a);
    const snapshot: TelemetrySnapshot = {
      sequence: sequence.toString(),
      day,
      observedAt: observedAt.toString(),
      growthFactorBps: telemetry.growthFactorBps,
      waterTempCentiC: telemetry.waterTempCentiC,
      flowRateMlMin: telemetry.flowRateMlMin,
      ecMicroSCm: telemetry.ecMicroSCm,
      phCenti: telemetry.phCenti,
      fairValue: after.fairValue.toString(),
      curvePrice: after.curvePrice.toString(),
      source: mode === "don" ? "ChainlinkDon" : "AuthorityEd25519",
      signature,
    };
    const key = a.batchId.toString();
    this.history.set(key, [...(this.history.get(key) ?? []), snapshot].slice(-HISTORY_LIMIT));
    return snapshot;
  }

  async requireActiveStatus(a: BatchAddresses): Promise<{ day: number }> {
    const batch = await this.client.fetchBatch(a);
    if (!("active" in batch.status)) {
      throw new HttpError(409, "Parti artık aktif değil. Yeni demo için POST /demo/reset kullanın.");
    }
    return { day: Number(batch.telemetry.day) };
  }

  /** Hedef güne kadar `telemetryStepDays` aralıklarla, DON ve Ed25519 yollarını dönüşümlü kullanarak ilerler. */
  async advanceTo(targetDay: number): Promise<TelemetrySnapshot[]> {
    const a = this.activeBatch();
    const { day } = await this.requireActiveStatus(a);
    if (targetDay <= day) {
      throw new HttpError(400, `Hedef gün (${targetDay}) mevcut günden (${day}) büyük olmalı.`);
    }
    if (targetDay > BATCH_ECONOMICS.harvestDay) {
      throw new HttpError(400, `Hedef gün hasat gününü (${BATCH_ECONOMICS.harvestDay}) aşamaz.`);
    }
    const step = DEMO.telemetryStepDays;
    const days: number[] = [];
    for (let d = Math.floor(day / step) * step + step; d < targetDay; d += step) days.push(d);
    days.push(targetDay);

    const pushed: TelemetrySnapshot[] = [];
    for (const [i, d] of days.entries()) {
      pushed.push(await this.pushDay(a, d, i % 2 === 0 ? "don" : "ed25519", false));
    }
    return pushed;
  }
}

export function describeError(err: unknown): { status: number; message: string; logs?: string[]; retryAfterSec?: number } {
  if (err instanceof HttpError || err instanceof LimitError) {
    return { status: err.status, message: redactSecrets(err.message), retryAfterSec: err.retryAfterSec };
  }
  const e = err as { error?: { errorMessage?: string }; message?: string; logs?: string[] };
  return {
    status: 500,
    message: redactSecrets(e.error?.errorMessage ?? e.message ?? "Bilinmeyen hata"),
    logs: e.logs?.map(redactSecrets),
  };
}
