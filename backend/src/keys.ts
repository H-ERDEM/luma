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

function readKeypair(file: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadOrCreate(file: string): Keypair {
  if (fs.existsSync(file)) return readKeypair(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

export function loadProtocolKeys(): ProtocolKeys {
  if (!fs.existsSync(env.adminKeypairPath)) {
    throw new Error(
      `Admin anahtarı bulunamadı: ${env.adminKeypairPath}. 'solana-keygen new' ile oluşturun veya ADMIN_KEYPAIR_PATH ayarlayın.`,
    );
  }
  return {
    admin: readKeypair(env.adminKeypairPath),
    don: loadOrCreate(path.join(env.keysDir, "don-authority.json")),
    fallback: loadOrCreate(path.join(env.keysDir, "fallback-authority.json")),
  };
}
