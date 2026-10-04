/**
 * LUMA programlarıyla konuşan tek istemci sınıfı. Tüm talimatlar `accountsStrict` ile
 * eksiksiz hesap listesiyle gönderilir; hiçbir hesap çözümlemesi tahmine bırakılmaz.
 */
import fs from "fs";
import path from "path";
import { createRetryingFetch } from "./rpcFetch";
import { AnchorProvider, Idl, Program, Wallet } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { BATCH_ECONOMICS, env } from "./config";
import { ProtocolKeys } from "./keys";
import {
  BatchAddresses,
  Telemetry,
  configPda,
  deriveBatchAddresses,
  kycPda,
  telemetryMessage,
  toAnchorTelemetry,
} from "./protocol";

export type OracleMode = "don" | "ed25519";

type Decoded = Record<string, any>;

function loadIdl(name: string): Idl {
  const file = path.join(env.idlDir, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`IDL bulunamadı: ${file}. Önce kök dizinde 'anchor build' çalıştırın.`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as Idl;
}

const bn = (v: bigint | number): BN => new BN(v.toString());
const enumKey = (v: Decoded): string => Object.keys(v)[0];
const pascal = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export class LumaClient {
  readonly provider: AnchorProvider;
  readonly batchProgram: Program;
  readonly hookProgram: Program;
  readonly batchIdl: Idl;
  readonly hookIdl: Idl;

  constructor(
    readonly connection: Connection,
    readonly keys: ProtocolKeys,
  ) {
    this.provider = new AnchorProvider(connection, new Wallet(keys.admin), {
      commitment: "confirmed",
    });
    this.batchIdl = loadIdl("luma_batch");
    this.hookIdl = loadIdl("luma_transfer_hook");
    this.batchProgram = new Program(this.batchIdl, this.provider);
    this.hookProgram = new Program(this.hookIdl, this.provider);
  }

  static create(keys: ProtocolKeys): LumaClient {
    // 429/503'te kendi geri çekilmemiz devrede; web3.js'in yerleşik yeniden denemesi kapatılır (üst üste binmesin).
    const retryingFetch = createRetryingFetch({
      onRetry: ({ status, attempt, maxRetries, delayMs }) =>
        console.warn(`RPC ${status}, ${delayMs} ms sonra yeniden deneniyor (${attempt}/${maxRetries})`),
    });
    return new LumaClient(
      new Connection(env.rpcUrl, { commitment: "confirmed", fetch: retryingFetch, disableRetryOnRateLimit: true }),
      keys,
    );
  }

  get admin(): PublicKey {
    return this.keys.admin.publicKey;
  }

  get config(): PublicKey {
    return configPda(this.batchProgram.programId);
  }

  private account(name: string) {
    return (this.batchProgram.account as unknown as Record<string, { fetch(a: PublicKey): Promise<Decoded>; fetchNullable(a: PublicKey): Promise<Decoded | null> }>)[name];
  }

  // ---------------------------------------------------------------- kurulum

  async createMockUsdc(): Promise<PublicKey> {
    return createMint(this.connection, this.keys.admin, this.admin, null, 6, undefined, { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
  }

  async configExists(): Promise<boolean> {
    return (await this.account("protocolConfig").fetchNullable(this.config)) !== null;
  }

  async initializeConfig(usdcMint: PublicKey): Promise<string> {
    return this.batchProgram.methods
      .initializeConfig({
        kycAuthority: this.admin,
        donAuthority: this.keys.don.publicKey,
        fallbackAuthority: this.keys.fallback.publicKey,
        transferHookProgram: this.hookProgram.programId,
      })
      .accountsStrict({
        admin: this.admin,
        config: this.config,
        usdcMint,
        usdcTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async fetchConfig(): Promise<Decoded> {
    return this.account("protocolConfig").fetch(this.config);
  }

  batchAddresses(batchId: bigint, usdcMint: PublicKey): BatchAddresses {
    const programId = this.batchProgram.programId;
    const draft = deriveBatchAddresses(batchId, programId, this.hookProgram.programId, PublicKey.default, PublicKey.default);
    return {
      ...draft,
      escrowUsdc: getAssociatedTokenAddressSync(usdcMint, draft.settlementEscrow, true, TOKEN_PROGRAM_ID),
      reserveUsdc: getAssociatedTokenAddressSync(usdcMint, draft.reserveVault, true, TOKEN_PROGRAM_ID),
    };
  }

  /** Yeni parti + Token-2022 mint + escrow/rezerv kasaları + hook ExtraAccountMetaList + rezerv fonlaması. */
  async createBatch(usdcMint: PublicKey): Promise<BatchAddresses> {
    const config = await this.fetchConfig();
    const batchId = BigInt(config.batchCount.toString());
    const a = this.batchAddresses(batchId, usdcMint);

    // Mint, SBF stack sınırı nedeniyle ayrı bir talimatta oluşturulur; aynı işlemde gönderilir.
    const mintIx = await this.batchProgram.methods
      .initializeBatchMint()
      .accountsStrict({
        admin: this.admin,
        config: this.config,
        batchVault: a.batchVault,
        mint: a.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    await this.batchProgram.methods
      .initializeBatch({
        unitPrice: bn(BATCH_ECONOMICS.unitPrice),
        maxSupply: bn(BATCH_ECONOMICS.maxSupply),
        fundingCloseDay: BATCH_ECONOMICS.fundingCloseDay,
        earlyExitDay: BATCH_ECONOMICS.earlyExitDay,
        harvestDay: BATCH_ECONOMICS.harvestDay,
        harvestFeeBps: BATCH_ECONOMICS.harvestFeeBps,
        maxTelemetryAgeSecs: bn(BATCH_ECONOMICS.maxTelemetryAgeSecs),
      })
      .accountsStrict({
        admin: this.admin,
        config: this.config,
        batchVault: a.batchVault,
        mint: a.mint,
        usdcMint,
        settlementEscrow: a.settlementEscrow,
        escrowUsdc: a.escrowUsdc,
        reserveVault: a.reserveVault,
        reserveUsdc: a.reserveUsdc,
        usdcTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .postInstructions([mintIx])
      .rpc();

    await this.hookProgram.methods
      .initializeExtraAccountMetaList()
      .accountsStrict({
        payer: this.admin,
        extraAccountMetaList: a.extraAccountMetaList,
        mint: a.mint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await this.fundReserve(a, usdcMint, BATCH_ECONOMICS.reserveSeedUsdc);
    return a;
  }

  async fundReserve(a: BatchAddresses, usdcMint: PublicKey, amount: bigint): Promise<string> {
    const funderUsdc = await this.mintUsdc(this.admin, usdcMint, amount);
    return this.batchProgram.methods
      .fundReserve(bn(amount))
      .accountsStrict({
        funder: this.admin,
        batchVault: a.batchVault,
        reserveVault: a.reserveVault,
        reserveUsdc: a.reserveUsdc,
        funderUsdc,
        usdcMint,
        usdcTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // ---------------------------------------------------------------- KYC & faucet

  async setKyc(wallet: PublicKey, approved: boolean): Promise<string> {
    return this.batchProgram.methods
      .setKycStatus(wallet, approved)
      .accountsStrict({
        kycAuthority: this.admin,
        config: this.config,
        kycRegistry: kycPda(wallet, this.batchProgram.programId),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async kycStatus(wallet: PublicKey): Promise<{ exists: boolean; approved: boolean; updatedAt: number | null }> {
    const record = await this.account("kycRegistry").fetchNullable(kycPda(wallet, this.batchProgram.programId));
    if (record === null) return { exists: false, approved: false, updatedAt: null };
    return { exists: true, approved: Boolean(record.isApproved), updatedAt: Number(record.updatedAt.toString()) };
  }

  /** Mock USDC basar; alıcının ATA'sını gerekirse oluşturur ve ATA adresini döndürür. */
  async mintUsdc(owner: PublicKey, usdcMint: PublicKey, amount: bigint): Promise<PublicKey> {
    const ata = await getOrCreateAssociatedTokenAccount(this.connection, this.keys.admin, usdcMint, owner, true, "confirmed", undefined, TOKEN_PROGRAM_ID);
    await mintTo(this.connection, this.keys.admin, usdcMint, ata.address, this.keys.admin, amount, [], { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
    return ata.address;
  }

  async topUpSol(owner: PublicKey, minLamports: number): Promise<string | null> {
    const balance = await this.connection.getBalance(owner, "confirmed");
    if (balance >= minLamports) return null;
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: this.admin, toPubkey: owner, lamports: minLamports - balance }),
    );
    return sendAndConfirmTransaction(this.connection, tx, [this.keys.admin], { commitment: "confirmed" });
  }

  // ---------------------------------------------------------------- oracle

  async chainTime(): Promise<bigint> {
    const slot = await this.connection.getSlot("confirmed");
    const t = await this.connection.getBlockTime(slot);
    return BigInt(t ?? Math.floor(Date.now() / 1000));
  }

  async pushTelemetry(a: BatchAddresses, telemetry: Telemetry, mode: OracleMode): Promise<string> {
    const builder = this.batchProgram.methods.updateTelemetry(toAnchorTelemetry(telemetry));
    if (mode === "don") {
      return builder
        .accountsStrict({
          relayer: this.keys.don.publicKey,
          config: this.config,
          batchVault: a.batchVault,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([this.keys.don])
        .rpc();
    }
    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: this.keys.fallback.secretKey,
      message: telemetryMessage(a.batchVault, telemetry),
    });
    return builder
      .accountsStrict({
        relayer: this.admin,
        config: this.config,
        batchVault: a.batchVault,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .preInstructions([ed25519Ix])
      .rpc();
  }

  async triggerDefault(a: BatchAddresses): Promise<string> {
    return this.batchProgram.methods
      .triggerParametricDefault()
      .accountsStrict({
        caller: this.admin,
        batchVault: a.batchVault,
        settlementEscrow: a.settlementEscrow,
        escrowUsdc: a.escrowUsdc,
      })
      .rpc();
  }

  async settleHarvest(a: BatchAddresses, usdcMint: PublicKey, otcAmount: bigint): Promise<string> {
    const otcSourceUsdc = await this.mintUsdc(this.admin, usdcMint, otcAmount);
    return this.batchProgram.methods
      .settleHarvest(bn(otcAmount))
      .accountsStrict({
        admin: this.admin,
        batchVault: a.batchVault,
        settlementEscrow: a.settlementEscrow,
        escrowUsdc: a.escrowUsdc,
        otcSourceUsdc,
        usdcMint,
        usdcTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // ---------------------------------------------------------------- okuma

  async fetchBatch(a: BatchAddresses): Promise<Decoded> {
    return this.account("batchVault").fetch(a.batchVault);
  }

  async batchState(a: BatchAddresses, usdcMint: PublicKey) {
    const [batch, escrow, reserve, mint] = await Promise.all([
      this.fetchBatch(a),
      getAccount(this.connection, a.escrowUsdc, "confirmed", TOKEN_PROGRAM_ID),
      getAccount(this.connection, a.reserveUsdc, "confirmed", TOKEN_PROGRAM_ID),
      getMint(this.connection, a.mint, "confirmed", TOKEN_2022_PROGRAM_ID),
    ]);
    const t = batch.telemetry as Decoded;
    const circulating = BigInt(batch.totalMinted.toString()) - BigInt(batch.totalBurned.toString());
    const unitPrice = BigInt(batch.unitPrice.toString());
    return {
      programs: {
        luma: this.batchProgram.programId.toBase58(),
        hook: this.hookProgram.programId.toBase58(),
      },
      addresses: {
        batchId: a.batchId.toString(),
        batchVault: a.batchVault.toBase58(),
        mint: a.mint.toBase58(),
        usdcMint: usdcMint.toBase58(),
        settlementEscrow: a.settlementEscrow.toBase58(),
        escrowUsdc: a.escrowUsdc.toBase58(),
        reserveVault: a.reserveVault.toBase58(),
        reserveUsdc: a.reserveUsdc.toBase58(),
        extraAccountMetaList: a.extraAccountMetaList.toBase58(),
        config: this.config.toBase58(),
      },
      status: pascal(enumKey(batch.status)),
      lastOracleSource: pascal(enumKey(batch.lastOracleSource)),
      unitPrice: unitPrice.toString(),
      maxSupply: batch.maxSupply.toString(),
      circulatingSupply: circulating.toString(),
      mintSupply: mint.supply.toString(),
      fundingCloseDay: batch.fundingCloseDay,
      earlyExitDay: batch.earlyExitDay,
      harvestDay: batch.harvestDay,
      harvestFeeBps: batch.harvestFeeBps,
      fairValue: batch.fairValue.toString(),
      curvePrice: batch.curvePrice.toString(),
      refundPrice: batch.refundPrice.toString(),
      redemptionPrice: batch.redemptionPrice.toString(),
      lastUpdateTs: batch.lastUpdateTs.toString(),
      escrowBalance: escrow.amount.toString(),
      reserveBalance: reserve.amount.toString(),
      requiredCollateral: (circulating * unitPrice).toString(),
      telemetry: {
        sequence: t.sequence.toString(),
        observedAt: t.observedAt.toString(),
        day: t.day,
        growthFactorBps: t.growthFactorBps,
        estYieldGrams: t.estYieldGrams,
        marketPricePerKg: t.marketPricePerKg.toString(),
        remainingCost: t.remainingCost.toString(),
        riskPremium: t.riskPremium.toString(),
        waterTempCentiC: t.waterTempCentiC,
        flowRateMlMin: t.flowRateMlMin,
        ecMicroSCm: t.ecMicroSCm,
        phCenti: t.phCenti,
      },
    };
  }
}
