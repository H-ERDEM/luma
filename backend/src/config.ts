import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";

/** ENV_FILE ile seçilen dosya (varsayılan .env); .env.localnet / .env.devnet arasında geçiş içindir. */
dotenv.config({ path: process.env.ENV_FILE ?? ".env" });

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

function required(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  if (value.trim().length === 0) {
    throw new Error(`Ortam değişkeni ${name} boş olamaz`);
  }
  return value;
}

/**
 * backend/ klasörü: package.json'u içeren ilk üst dizin. `__dirname` TS kaynağında `backend/src`,
 * derlenmiş çıktıda `backend/dist/src` olduğu için sabit bir `..` her iki durumda da doğru olmaz.
 */
function findBackendRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("backend klasörü bulunamadı (package.json yok)");
}

const backendRoot = findBackendRoot();

export const env = {
  rpcUrl: required("RPC_URL", "http://127.0.0.1:8899"),
  adminKeypairPath: path.resolve(backendRoot, expandHome(required("ADMIN_KEYPAIR_PATH", "~/.config/solana/id.json"))),
  /** NODE_ENV=production: anahtarlar yalnızca ortam değişkeninden gelir, dosyaya hiçbir şey yazılmaz/üretilmez. */
  production: process.env.NODE_ENV === "production",
  /** Depodaki IDL kopyaları (`npm run sync-idl`); geliştirmede IDL_DIR=../target/idl ile taze derlemeye yönlendirilebilir. */
  idlDir: path.resolve(backendRoot, required("IDL_DIR", "./idl")),
  /** Yalnızca geliştirme: DON/fallback anahtarlarının otomatik üretilip yazıldığı klasör. */
  keysDir: path.resolve(backendRoot, required("KEYS_DIR", "./.keys")),
  /** Elle belirlenirse aktif parti zincirden çözülmez, bu numara kullanılır. */
  activeBatchOverride: process.env.ACTIVE_BATCH_ID?.trim() ? process.env.ACTIVE_BATCH_ID.trim() : null,
  port: Number(required("PORT", "4000")),
  frontendOrigin: required("FRONTEND_ORIGIN", "http://localhost:3000"),
} as const;

/** RPC adresini yanıtlara/loglara koymadan önce gizler (anahtar yolda ya da sorguda olabilir). */
export function maskRpcUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return u.origin + (u.pathname !== "/" ? "/***" : "") + (u.search !== "" ? "?***" : "");
  } catch {
    return "***";
  }
}

/** Hata metinlerinden RPC adresini ve api-key benzeri değerleri temizler. */
export function redactSecrets(text: string): string {
  return text
    .split(env.rpcUrl)
    .join(maskRpcUrl(env.rpcUrl))
    .replace(/(api[-_]?key=)[^&\s"')]+/gi, "$1***");
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Ortam değişkeni ${name} geçerli bir sayı olmalı (>= 0): "${raw}"`);
  return value;
}

/** Demo uç noktalarının kötüye kullanıma karşı sınırları. Hepsi ortam değişkeniyle ayarlanır. */
export const limits = {
  /** Cüzdan başına test USDC üst sınırı: faucet yalnızca bu seviyeye kadar tamamlar. */
  faucetUsdcCap: BigInt(Math.round(numberEnv("FAUCET_USDC_CAP", 100) * 1_000_000)),
  /** Bir cüzdanın 24 saatte USDC alabileceği en fazla sayı (yalnızca gerçekten basılan çağrılar sayılır). */
  faucetWalletMaxPerDay: numberEnv("FAUCET_WALLET_MAX_PER_DAY", 5),
  /** Günlük (UTC) toplam dağıtım tavanları. */
  faucetDailyBudgetUsdc: Math.round(numberEnv("FAUCET_DAILY_BUDGET_USDC", 5_000) * 1_000_000),
  faucetDailyBudgetLamports: Math.round(numberEnv("FAUCET_DAILY_BUDGET_SOL", 2) * 1_000_000_000),
  /** Admin bakiyesi bunun altına inerse SOL desteği kapanır ve /api/health 503 döner. */
  adminMinLamports: Math.round(numberEnv("ADMIN_MIN_SOL", 3) * 1_000_000_000),
  /** Bunun altında faucet tamamen durur (işlem ücretlerini karşılayabilmek için). */
  adminHardMinLamports: 100_000_000,
  /** IP başına, pencere içinde en fazla istek (/api/kyc/verify ve /demo/*). */
  rateLimitMax: numberEnv("RATE_LIMIT_MAX", 60),
  rateLimitWindowSec: numberEnv("RATE_LIMIT_WINDOW_SEC", 60),
  /** Ters vekil (Render vb.) arkasındaki atlama sayısı; 0 = vekil yok, X-Forwarded-For'a güvenilmez. */
  trustProxy: numberEnv("TRUST_PROXY", 0),
  /** Doluysa /demo/reset için x-demo-token başlığı gerekir. */
  demoResetToken: (process.env.DEMO_RESET_TOKEN ?? "").trim(),
} as const;

/** Parti ekonomisi: tüm parasal değerler mikro-USDC (6 ondalık). */
export const BATCH_ECONOMICS = {
  unitPrice: 450_000n,
  maxSupply: 10_000n,
  fundingCloseDay: 3,
  earlyExitDay: 20,
  harvestDay: 40,
  harvestFeeBps: 625,
  maxTelemetryAgeSecs: 3_600n,
  reserveSeedUsdc: 1_000_000_000n,
} as const;

export const DEMO = {
  faucetMinLamports: 50_000_000,
  telemetryStepDays: 5,
  usdcDecimals: 6,
} as const;
