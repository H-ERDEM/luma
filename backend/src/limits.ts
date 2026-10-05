/**
 * Demo uç noktalarının kötüye kullanıma karşı sınırları. Burada zincir ya da Express bağımlılığı
 * yoktur (zaman enjekte edilebilir), böylece davranış hızlı birim testleriyle doğrulanabilir.
 * Sayaçlar bellektedir: sunucu yeniden başlarsa sıfırlanır (durumsuz mimariyle uyumlu, hackathon için yeterli).
 */
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

type Clock = () => number;

/** Anahtar başına kayan pencere sayacı. */
export class WindowCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: Clock = Date.now) {}

  private prune(key: string, windowMs: number): number[] {
    const cutoff = this.now() - windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  count(key: string, windowMs: number): number {
    return this.prune(key, windowMs).length;
  }

  /** Pencerede yer varsa kaydeder; yoksa penceredeki en eski kayıt düşene kadar kalan saniyeyi döndürür. */
  tryHit(key: string, max: number, windowMs: number): { ok: true } | { ok: false; retryAfterSec: number } {
    const list = this.prune(key, windowMs);
    if (list.length >= max) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((list[0] + windowMs - this.now()) / 1000)) };
    }
    list.push(this.now());
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.sweep(windowMs);
    return { ok: true };
  }

  /** Son kaydı geri alır (işlem başarısız olduysa hak yanmasın). */
  undo(key: string): void {
    const list = this.hits.get(key);
    if (list === undefined) return;
    list.pop();
    if (list.length === 0) this.hits.delete(key);
  }

  private sweep(windowMs: number): void {
    for (const key of [...this.hits.keys()]) this.prune(key, windowMs);
  }
}

/** UTC gün sınırında sıfırlanan toplam bütçe (mikro birimler güvenli tamsayı aralığındadır). */
export class DailyBudget {
  private day = "";
  private used = 0;

  constructor(
    readonly limit: number,
    private readonly now: Clock = Date.now,
  ) {}

  private roll(): void {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
  }

  tryConsume(amount: number): boolean {
    this.roll();
    if (this.used + amount > this.limit) return false;
    this.used += amount;
    return true;
  }

  refund(amount: number): void {
    this.roll();
    this.used = Math.max(0, this.used - amount);
  }

  secondsUntilReset(): number {
    const next = new Date(this.now());
    next.setUTCHours(24, 0, 0, 0);
    return Math.max(1, Math.ceil((next.getTime() - this.now()) / 1000));
  }
}

/** Limit aşımı; HTTP katmanı status ve Retry-After'e çevirir. */
export class LimitError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function humanDuration(sec: number): string {
  if (sec < 90) return `${sec} s`;
  if (sec < 5_400) return `${Math.ceil(sec / 60)} min`;
  return `${Math.ceil(sec / 3600)} h`;
}

export interface FaucetGuardConfig {
  walletMaxPerDay: number;
  /** mikro-USDC */
  dailyBudgetUsdc: number;
  dailyBudgetLamports: number;
}

/**
 * Faucet için cüzdan başına bekleme ve küresel günlük bütçe. `reserve*` önce hakkı ayırır, işlem
 * başarısız olursa dönen `rollback` ile geri verilir.
 */
export class FaucetGuard {
  private readonly perWallet: WindowCounter;
  private readonly usdc: DailyBudget;
  private readonly sol: DailyBudget;

  constructor(
    private readonly cfg: FaucetGuardConfig,
    private readonly now: Clock = Date.now,
  ) {
    this.perWallet = new WindowCounter(now);
    this.usdc = new DailyBudget(cfg.dailyBudgetUsdc, now);
    this.sol = new DailyBudget(cfg.dailyBudgetLamports, now);
  }

  reserveUsdc(wallet: string, amount: bigint): () => void {
    const hit = this.perWallet.tryHit(wallet, this.cfg.walletMaxPerDay, DAY_MS);
    if (!hit.ok) {
      throw new LimitError(
        429,
        `This wallet can receive test USDC at most ${this.cfg.walletMaxPerDay} times in 24 hours. Try again in ${humanDuration(hit.retryAfterSec)}.`,
        hit.retryAfterSec,
      );
    }
    const micro = Number(amount);
    if (!this.usdc.tryConsume(micro)) {
      this.perWallet.undo(wallet);
      const wait = this.usdc.secondsUntilReset();
      throw new LimitError(503, `The daily test USDC budget is used up. Try again in ${humanDuration(wait)} (when the UTC day changes).`, wait);
    }
    return () => {
      this.perWallet.undo(wallet);
      this.usdc.refund(micro);
    };
  }

  reserveSol(lamports: number): () => void {
    if (!this.sol.tryConsume(lamports)) {
      const wait = this.sol.secondsUntilReset();
      throw new LimitError(503, `The daily test SOL budget is used up. Try again in ${humanDuration(wait)} (when the UTC day changes).`, wait);
    }
    return () => this.sol.refund(lamports);
  }
}

/** IP başına istek sınırı (Express ara katmanı). Mesaj "429" kelimesini içermez: arayüz o kelimeyi RPC hız sınırı sayar. */
export function ipRateLimit(counter: WindowCounter, max: number, windowSec: number, scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const hit = counter.tryHit(`${scope}:${req.ip ?? "bilinmiyor"}`, max, windowSec * 1000);
    if (hit.ok) return next();
    res.set("Retry-After", String(hit.retryAfterSec));
    res.status(429).json({ error: `You are sending requests too quickly. Try again in ${humanDuration(hit.retryAfterSec)}.` });
  };
}

/** Beklenen token doluysa `x-demo-token` başlığını sabit zamanlı karşılaştırır; boşsa herkese açıktır. */
export function requireDemoToken(expected: string, message: string) {
  const want = Buffer.from(expected);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (expected === "") return next();
    const got = Buffer.from(String(req.header("x-demo-token") ?? ""));
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) return next();
    res.status(401).json({ error: message });
  };
}
