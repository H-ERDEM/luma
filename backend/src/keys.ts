import fs from "fs";
import path from "path";
import { Keypair } from "@solana/web3.js";
import { env } from "./config";

export interface ProtocolKeys {
  /** Admin + KYC yetkisi + işlem ücreti ödeyicisi. */
  admin: Keypair;
  /** Chainlink DON raporlarını zincire yazan imzacının demo karşılığı. */
  don: Keypair;
  /** Ed25519 fallback telemetri imzacısı. */
  fallback: Keypair;
}

/**
 * `solana-keygen` formatı: 64 sayılık JSON dizisi. Hata mesajları yalnızca değişken adını söyler,
 * anahtar içeriğini asla göstermez.
 */
export function parseKeypair(name: string, raw: string): Keypair {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} geçerli bir JSON olmalı (solana-keygen biçimi: 64 sayılık dizi).`);
  }
  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    throw new Error(`${name} 64 baytlık bir anahtar dizisi olmalı (solana-keygen biçimi).`);
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  } catch {
    throw new Error(`${name} geçerli bir Ed25519 anahtarı değil.`);
  }
}

function readKeypairFile(name: string, file: string): Keypair {
  return parseKeypair(`${name} (${path.basename(file)})`, fs.readFileSync(file, "utf8"));
}

function loadOrCreate(file: string): Keypair {
  if (fs.existsSync(file)) return readKeypairFile("anahtar dosyası", file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

/**
 * Anahtarlar önce ortam değişkeninden okunur (`*_KEYPAIR_JSON`; Render gibi diski kalıcı olmayan
 * ortamlar için). Üretimde (NODE_ENV=production) dosyaya geri dönülmez ve hiçbir anahtar üretilmez:
 * her dağıtımda yeni DON/fallback anahtarı üretilirse zincirdeki ProtocolConfig ile uyuşmaz.
 */
export function loadProtocolKeys(): ProtocolKeys {
  const fromEnv = (name: string): Keypair | null => {
    const raw = process.env[name];
    return raw !== undefined && raw.trim() !== "" ? parseKeypair(name, raw) : null;
  };

  const admin = fromEnv("ADMIN_KEYPAIR_JSON");
  const don = fromEnv("DON_KEYPAIR_JSON");
  const fallback = fromEnv("FALLBACK_KEYPAIR_JSON");

  if (env.production) {
    const missing = [
      admin === null && "ADMIN_KEYPAIR_JSON",
      don === null && "DON_KEYPAIR_JSON",
      fallback === null && "FALLBACK_KEYPAIR_JSON",
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(
        `Üretim modunda (NODE_ENV=production) anahtarlar ortam değişkeninden gelmelidir; eksik: ${missing.join(", ")}. ` +
          "Anahtar üretilmez ve dosyadan okunmaz.",
      );
    }
    return { admin: admin!, don: don!, fallback: fallback! };
  }

  if (admin === null && !fs.existsSync(env.adminKeypairPath)) {
    throw new Error(
      `Admin anahtarı bulunamadı: ${env.adminKeypairPath}. 'solana-keygen new' ile oluşturun, ADMIN_KEYPAIR_PATH ya da ADMIN_KEYPAIR_JSON ayarlayın.`,
    );
  }
  return {
    admin: admin ?? readKeypairFile("ADMIN_KEYPAIR_PATH", env.adminKeypairPath),
    don: don ?? loadOrCreate(path.join(env.keysDir, "don-authority.json")),
    fallback: fallback ?? loadOrCreate(path.join(env.keysDir, "fallback-authority.json")),
  };
}
