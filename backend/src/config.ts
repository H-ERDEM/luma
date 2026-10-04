import "dotenv/config";
import os from "os";
import path from "path";

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

const backendRoot = path.resolve(__dirname, "..");

export const env = {
  rpcUrl: required("RPC_URL", "http://127.0.0.1:8899"),
  adminKeypairPath: expandHome(required("ADMIN_KEYPAIR_PATH", "~/.config/solana/id.json")),
  idlDir: path.resolve(backendRoot, required("IDL_DIR", "../target/idl")),
  keysDir: path.resolve(backendRoot, required("KEYS_DIR", "./.keys")),
  dataDir: path.resolve(backendRoot, required("DATA_DIR", "./.data")),
  port: Number(required("PORT", "4000")),
  frontendOrigin: required("FRONTEND_ORIGIN", "http://localhost:3000"),
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
  faucetUsdc: 100_000_000n,
  faucetMinLamports: 50_000_000,
  telemetryStepDays: 5,
  usdcDecimals: 6,
} as const;
