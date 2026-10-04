/**
 * Zincir üstü programla birebir eşleşen PDA türetimleri ve telemetri serileştirmesi.
 * `serializeTelemetry` çıktısı Rust tarafındaki `telemetry_borsh_layout_is_stable`
 * testiyle bayt bayt doğrulanmıştır.
 */
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export const SEEDS = {
  config: Buffer.from("config"),
  kyc: Buffer.from("kyc"),
  batch: Buffer.from("batch"),
  mint: Buffer.from("mint"),
  escrow: Buffer.from("escrow"),
  reserve: Buffer.from("reserve"),
  extraAccountMetas: Buffer.from("extra-account-metas"),
} as const;

export const TELEMETRY_DOMAIN = Buffer.from("LUMA_TELEMETRY_V1");
export const TELEMETRY_PAYLOAD_LEN = 60;

export interface Telemetry {
  sequence: bigint;
  observedAt: bigint;
  day: number;
  growthFactorBps: number;
  estYieldGrams: number;
  marketPricePerKg: bigint;
  remainingCost: bigint;
  riskPremium: bigint;
  waterTempCentiC: number;
  flowRateMlMin: number;
  ecMicroSCm: number;
  phCenti: number;
}

export interface BatchAddresses {
  batchId: bigint;
  batchVault: PublicKey;
  mint: PublicKey;
  settlementEscrow: PublicKey;
  escrowUsdc: PublicKey;
  reserveVault: PublicKey;
  reserveUsdc: PublicKey;
  extraAccountMetaList: PublicKey;
}

const pda = (seeds: Buffer[], programId: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

export const u64Le = (value: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
};

export const configPda = (programId: PublicKey) => pda([SEEDS.config], programId);
export const kycPda = (wallet: PublicKey, programId: PublicKey) =>
  pda([SEEDS.kyc, wallet.toBuffer()], programId);
export const batchPda = (batchId: bigint, programId: PublicKey) =>
  pda([SEEDS.batch, u64Le(batchId)], programId);
export const mintPda = (batchVault: PublicKey, programId: PublicKey) =>
  pda([SEEDS.mint, batchVault.toBuffer()], programId);
export const escrowPda = (batchVault: PublicKey, programId: PublicKey) =>
  pda([SEEDS.escrow, batchVault.toBuffer()], programId);
export const reservePda = (batchVault: PublicKey, programId: PublicKey) =>
  pda([SEEDS.reserve, batchVault.toBuffer()], programId);
export const extraMetasPda = (mint: PublicKey, hookProgramId: PublicKey) =>
  pda([SEEDS.extraAccountMetas, mint.toBuffer()], hookProgramId);

export function serializeTelemetry(t: Telemetry): Buffer {
  const b = Buffer.alloc(TELEMETRY_PAYLOAD_LEN);
  let o = 0;
  o = b.writeBigUInt64LE(t.sequence, o);
  o = b.writeBigInt64LE(t.observedAt, o);
  o = b.writeUInt16LE(t.day, o);
  o = b.writeUInt16LE(t.growthFactorBps, o);
  o = b.writeUInt32LE(t.estYieldGrams, o);
  o = b.writeBigUInt64LE(t.marketPricePerKg, o);
  o = b.writeBigUInt64LE(t.remainingCost, o);
  o = b.writeBigUInt64LE(t.riskPremium, o);
  o = b.writeInt16LE(t.waterTempCentiC, o);
  o = b.writeUInt32LE(t.flowRateMlMin, o);
  o = b.writeUInt32LE(t.ecMicroSCm, o);
  o = b.writeUInt16LE(t.phCenti, o);
  if (o !== TELEMETRY_PAYLOAD_LEN) {
    throw new Error(`Telemetri serileştirme uzunluğu ${o}, beklenen ${TELEMETRY_PAYLOAD_LEN}`);
  }
  return b;
}

/** Ed25519 fallback yolunda imzalanan mesaj: DOMAIN || batch_vault || borsh(payload). */
export function telemetryMessage(batchVault: PublicKey, t: Telemetry): Buffer {
  return Buffer.concat([TELEMETRY_DOMAIN, batchVault.toBuffer(), serializeTelemetry(t)]);
}

/** Anchor istemcisinin beklediği argüman biçimi (u64/i64 → BN). */
export function toAnchorTelemetry(t: Telemetry) {
  return {
    sequence: new BN(t.sequence.toString()),
    observedAt: new BN(t.observedAt.toString()),
    day: t.day,
    growthFactorBps: t.growthFactorBps,
    estYieldGrams: t.estYieldGrams,
    marketPricePerKg: new BN(t.marketPricePerKg.toString()),
    remainingCost: new BN(t.remainingCost.toString()),
    riskPremium: new BN(t.riskPremium.toString()),
    waterTempCentiC: t.waterTempCentiC,
    flowRateMlMin: t.flowRateMlMin,
    ecMicroSCm: t.ecMicroSCm,
    phCenti: t.phCenti,
  };
}

export function deriveBatchAddresses(
  batchId: bigint,
  batchProgramId: PublicKey,
  hookProgramId: PublicKey,
  escrowUsdc: PublicKey,
  reserveUsdc: PublicKey,
): BatchAddresses {
  const batchVault = batchPda(batchId, batchProgramId);
  const mint = mintPda(batchVault, batchProgramId);
  return {
    batchId,
    batchVault,
    mint,
    settlementEscrow: escrowPda(batchVault, batchProgramId),
    escrowUsdc,
    reserveVault: reservePda(batchVault, batchProgramId),
    reserveUsdc,
    extraAccountMetaList: extraMetasPda(mint, hookProgramId),
  };
}
