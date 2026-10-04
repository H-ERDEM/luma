/**
 * Uçtan uca entegrasyon testleri (`anchor test` yerel validator'ü başlatır ve iki programı yükler).
 * Senaryolar: KYC kapısı, transfer hook, çift katmanlı oracle, bonding curve + solvency,
 * hasat itfası ve parametrik sigorta.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createMint,
  createTransferCheckedWithTransferHookInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Ed25519Program,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  Telemetry,
  batchPda,
  configPda,
  escrowPda,
  extraMetasPda,
  kycPda,
  mintPda,
  reservePda,
  serializeTelemetry,
  telemetryMessage,
  toAnchorTelemetry,
} from "../backend/src/protocol";

const USDC = (n: number): bigint => BigInt(Math.round(n * 1_000_000));

async function expectFailure(p: Promise<unknown>, needle: string): Promise<void> {
  try {
    await p;
  } catch (err) {
    const e = err as { logs?: string[]; message?: string };
    const text = `${String(err)}\n${e.message ?? ""}\n${(e.logs ?? []).join("\n")}`;
    expect(text, `beklenen hata: ${needle}`).to.contain(needle);
    return;
  }
  expect.fail(`İşlem başarısız olmalıydı (${needle})`);
}

describe("luma", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const program = anchor.workspace.LumaBatch as Program;
  const hook = anchor.workspace.LumaTransferHook as Program;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const don = Keypair.generate();
  const fallback = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const mallory = Keypair.generate();
  const config = configPda(program.programId);
  let usdcMint: PublicKey;
  let sequence = 0n;

  const acc = (name: string) =>
    (program.account as unknown as Record<string, { fetch(a: PublicKey): Promise<any> }>)[name];

  interface Batch {
    id: bigint;
    vault: PublicKey;
    mint: PublicKey;
    escrow: PublicKey;
    escrowUsdc: PublicKey;
    reserve: PublicKey;
    reserveUsdc: PublicKey;
  }

  const usdcAta = (owner: PublicKey) => getAssociatedTokenAddressSync(usdcMint, owner, true, TOKEN_PROGRAM_ID);
  const assetAta = (b: Batch, owner: PublicKey) =>
    getAssociatedTokenAddressSync(b.mint, owner, false, TOKEN_2022_PROGRAM_ID);
  const balance = async (ata: PublicKey, programId = TOKEN_PROGRAM_ID) =>
    (await getAccount(connection, ata, "processed", programId)).amount;

  async function fundUsdc(owner: PublicKey, amount: bigint): Promise<PublicKey> {
    const ata = await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, owner, true);
    await mintTo(connection, admin, usdcMint, ata.address, admin, amount);
    return ata.address;
  }

  async function setKyc(wallet: PublicKey, approved: boolean) {
    await program.methods
      .setKycStatus(wallet, approved)
      .accountsStrict({
        kycAuthority: admin.publicKey,
        config,
        kycRegistry: kycPda(wallet, program.programId),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function createBatch(): Promise<Batch> {
    const cfg = await acc("protocolConfig").fetch(config);
    const id = BigInt(cfg.batchCount.toString());
    const vault = batchPda(id, program.programId);
    const b: Batch = {
      id,
      vault,
      mint: mintPda(vault, program.programId),
      escrow: escrowPda(vault, program.programId),
      escrowUsdc: PublicKey.default,
      reserve: reservePda(vault, program.programId),
      reserveUsdc: PublicKey.default,
    };
    b.escrowUsdc = usdcAta(b.escrow);
    b.reserveUsdc = usdcAta(b.reserve);

    const mintIx = await program.methods
      .initializeBatchMint()
      .accountsStrict({
        admin: admin.publicKey,
        config,
        batchVault: b.vault,
        mint: b.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    await program.methods
      .initializeBatch({
        unitPrice: new BN(450_000),
        maxSupply: new BN(10_000),
        fundingCloseDay: 3,
        earlyExitDay: 20,
        harvestDay: 40,
        harvestFeeBps: 625,
        maxTelemetryAgeSecs: new BN(3_600),
      })
      .accountsStrict({
        admin: admin.publicKey,
        config,
        batchVault: b.vault,
        mint: b.mint,
        usdcMint,
        settlementEscrow: b.escrow,
        escrowUsdc: b.escrowUsdc,
        reserveVault: b.reserve,
        reserveUsdc: b.reserveUsdc,
        usdcTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .postInstructions([mintIx])
      .rpc();

    await hook.methods
      .initializeExtraAccountMetaList()
      .accountsStrict({
        payer: admin.publicKey,
        extraAccountMetaList: extraMetasPda(b.mint, hook.programId),
        mint: b.mint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const funderUsdc = await fundUsdc(admin.publicKey, USDC(100));
    await program.methods
      .fundReserve(new BN(USDC(100).toString()))
      .accountsStrict({
        funder: admin.publicKey,
        batchVault: b.vault,
        reserveVault: b.reserve,
        reserveUsdc: b.reserveUsdc,
        funderUsdc,
        usdcMint,
        usdcTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    return b;
  }

  function fundAndMint(b: Batch, buyer: Keypair, qty: number) {
    return program.methods
      .fundAndMint(new BN(qty))
      .accountsStrict({
        buyer: buyer.publicKey,
        kycRegistry: kycPda(buyer.publicKey, program.programId),
        batchVault: b.vault,
        mint: b.mint,
        buyerToken: assetAta(b, buyer.publicKey),
        buyerUsdc: usdcAta(buyer.publicKey),
        settlementEscrow: b.escrow,
        escrowUsdc: b.escrowUsdc,
        usdcMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        usdcTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();
  }

  async function telemetry(day: number, b_bps: number, cRem: number, opts: { outage?: boolean } = {}): Promise<Telemetry> {
    sequence += 1n;
    const slot = await connection.getSlot("confirmed");
    const now = BigInt((await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000));
    return {
      sequence,
      observedAt: now,
      day,
      growthFactorBps: b_bps,
      estYieldGrams: 250,
      marketPricePerKg: 3_200_000n,
      remainingCost: BigInt(cRem),
      riskPremium: 40_000n,
      waterTempCentiC: opts.outage ? 3_350 : 2_050,
      flowRateMlMin: opts.outage ? 0 : 1_800,
      ecMicroSCm: 1_500,
      phCenti: 610,
    };
  }

  function pushViaDon(b: Batch, t: Telemetry, signer: Keypair = don) {
    return program.methods
      .updateTelemetry(toAnchorTelemetry(t))
      .accountsStrict({
        relayer: signer.publicKey,
        config,
        batchVault: b.vault,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .signers([signer])
      .rpc();
  }

  function pushViaEd25519(b: Batch, t: Telemetry, signingKey: Keypair = fallback) {
    return program.methods
      .updateTelemetry(toAnchorTelemetry(t))
      .accountsStrict({
        relayer: admin.publicKey,
        config,
        batchVault: b.vault,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .preInstructions([
        Ed25519Program.createInstructionWithPrivateKey({
          privateKey: signingKey.secretKey,
          message: telemetryMessage(b.vault, t),
        }),
      ])
      .rpc();
  }

  function holderAccounts(b: Batch, holder: Keypair) {
    return {
      batchVault: b.vault,
      mint: b.mint,
      holderToken: assetAta(b, holder.publicKey),
      holderUsdc: usdcAta(holder.publicKey),
      settlementEscrow: b.escrow,
      escrowUsdc: b.escrowUsdc,
      usdcMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      usdcTokenProgram: TOKEN_PROGRAM_ID,
    };
  }

  async function hookTransfer(b: Batch, from: Keypair, to: PublicKey, amount: bigint) {
    const destination = await createAssociatedTokenAccountIdempotent(
      connection, admin, b.mint, to, {}, TOKEN_2022_PROGRAM_ID,
    );
    const ix = await createTransferCheckedWithTransferHookInstruction(
      connection,
      assetAta(b, from.publicKey),
      b.mint,
      destination,
      from.publicKey,
      amount,
      0,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    return sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin, from]);
  }

  let batchA: Batch;
  let batchB: Batch;

  before(async () => {
    for (const kp of [alice, bob, mallory]) {
      const sig = await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
    }
    usdcMint = await createMint(connection, admin, admin.publicKey, null, 6);
    await fundUsdc(alice.publicKey, USDC(1_000));
    await fundUsdc(bob.publicKey, USDC(1_000));
    await fundUsdc(mallory.publicKey, USDC(1_000));
  });

  it("telemetri serileştirmesi Rust borsh düzeniyle aynı", () => {
    const hex = serializeTelemetry({
      sequence: 7n, observedAt: 1_700_000_000n, day: 20, growthFactorBps: 8_500, estYieldGrams: 250,
      marketPricePerKg: 3_200_000n, remainingCost: 200_000n, riskPremium: 40_000n,
      waterTempCentiC: -150, flowRateMlMin: 1_800, ecMicroSCm: 1_600, phCenti: 610,
    }).toString("hex");
    expect(hex).to.equal(
      "070000000000000000f153650000000014003421fa00000000d4300000000000400d030000000000409c0000000000006aff08070000400600006202",
    );
  });

  it("protokolü ve ilk partiyi kurar", async () => {
    await program.methods
      .initializeConfig({
        kycAuthority: admin.publicKey,
        donAuthority: don.publicKey,
        fallbackAuthority: fallback.publicKey,
        transferHookProgram: hook.programId,
      })
      .accountsStrict({
        admin: admin.publicKey,
        config,
        usdcMint,
        usdcTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await setKyc(alice.publicKey, true);
    await setKyc(bob.publicKey, true);
    await setKyc(mallory.publicKey, false);
    batchA = await createBatch();
    const vault = await acc("batchVault").fetch(batchA.vault);
    expect(vault.unitPrice.toNumber()).to.equal(450_000);
  });

  it("KYC onayı olmayan cüzdan fide satın alamaz", async () => {
    await expectFailure(fundAndMint(batchA, mallory, 10), "KycNotApproved");
  });

  it("KYC onaylı yatırımcı 0.45 USDC/adet ile token basar", async () => {
    await fundAndMint(batchA, alice, 100);
    expect(await balance(assetAta(batchA, alice.publicKey), TOKEN_2022_PROGRAM_ID)).to.equal(100n);
    expect(await balance(batchA.escrowUsdc)).to.equal(USDC(45));
  });

  it("transfer hook: onaylı → onaylı geçer, onaysız alıcıya transfer reddedilir", async () => {
    await hookTransfer(batchA, alice, bob.publicKey, 5n);
    expect(await balance(assetAta(batchA, bob.publicKey), TOKEN_2022_PROGRAM_ID)).to.equal(5n);
    await expectFailure(hookTransfer(batchA, alice, mallory.publicKey, 1n), "DestinationNotKycApproved");
  });

  it("oracle: DON yolu ve Ed25519 fallback kabul edilir, yetkisizler reddedilir", async () => {
    await pushViaDon(batchA, await telemetry(5, 3_632, 350_000));
    await pushViaEd25519(batchA, await telemetry(10, 5_986, 300_000));
    let vault = await acc("batchVault").fetch(batchA.vault);
    expect(Object.keys(vault.lastOracleSource)[0]).to.equal("authorityEd25519");

    await expectFailure(pushViaDon(batchA, await telemetry(11, 6_100, 290_000), Keypair.generate()), "UnauthorizedOracle");
    await expectFailure(pushViaEd25519(batchA, await telemetry(11, 6_100, 290_000), Keypair.generate()), "Ed25519AuthorityMismatch");

    const replay = await telemetry(12, 6_300, 280_000);
    await pushViaDon(batchA, replay);
    await expectFailure(pushViaDon(batchA, replay), "StaleSequence");
    await expectFailure(pushViaDon(batchA, await telemetry(13, 10_001, 0)), "InvalidGrowthFactor");
    vault = await acc("batchVault").fetch(batchA.vault);
    expect(vault.telemetry.day).to.equal(12);
  });

  it("20. gün: bonding curve 0.61 USDC; erken çıkış solvency invariantını korur", async () => {
    await pushViaDon(batchA, await telemetry(20, 8_500, 200_000));
    const vault = await acc("batchVault").fetch(batchA.vault);
    expect(vault.curvePrice.toNumber()).to.equal(610_000);

    const aliceUsdcBefore = await balance(usdcAta(alice.publicKey));
    await program.methods
      .sellToBondingCurve(new BN(50), new BN(USDC(30.5).toString()))
      .accountsStrict({
        seller: alice.publicKey,
        kycRegistry: kycPda(alice.publicKey, program.programId),
        batchVault: batchA.vault,
        mint: batchA.mint,
        sellerToken: assetAta(batchA, alice.publicKey),
        sellerUsdc: usdcAta(alice.publicKey),
        settlementEscrow: batchA.escrow,
        escrowUsdc: batchA.escrowUsdc,
        reserveVault: batchA.reserve,
        reserveUsdc: batchA.reserveUsdc,
        usdcMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        usdcTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    expect((await balance(usdcAta(alice.publicKey))) - aliceUsdcBefore).to.equal(USDC(30.5));
    // Kalan 50 token × 0.45 = 22.5 USDC escrow'da kilitli kalmalı; prim (8 USDC) rezervden ödendi.
    expect(await balance(batchA.escrowUsdc)).to.equal(USDC(22.5));
    expect(await balance(batchA.reserveUsdc)).to.equal(USDC(92));
  });

  it("hasat: 0.76 adil değer → 0.7125 USDC itfa ve yakım", async () => {
    await expectFailure(
      program.methods
        .settleHarvest(new BN(0))
        .accountsStrict({
          admin: admin.publicKey,
          batchVault: batchA.vault,
          settlementEscrow: batchA.escrow,
          escrowUsdc: batchA.escrowUsdc,
          otcSourceUsdc: usdcAta(admin.publicKey),
          usdcMint,
          usdcTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "HarvestNotReached",
    );

    await pushViaEd25519(batchA, await telemetry(40, 10_000, 0));
    const otcSource = await fundUsdc(admin.publicKey, USDC(40));
    await program.methods
      .settleHarvest(new BN(USDC(40).toString()))
      .accountsStrict({
        admin: admin.publicKey,
        batchVault: batchA.vault,
        settlementEscrow: batchA.escrow,
        escrowUsdc: batchA.escrowUsdc,
        otcSourceUsdc: otcSource,
        usdcMint,
        usdcTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    const vault = await acc("batchVault").fetch(batchA.vault);
    expect(vault.redemptionPrice.toNumber()).to.equal(712_500);

    const before = await balance(usdcAta(alice.publicKey));
    await program.methods
      .redeemAndBurn(new BN(45))
      .accountsStrict({ holder: alice.publicKey, ...holderAccounts(batchA, alice) })
      .signers([alice])
      .rpc();
    expect((await balance(usdcAta(alice.publicKey))) - before).to.equal(USDC(32.0625));
    expect(await balance(assetAta(batchA, alice.publicKey), TOKEN_2022_PROGRAM_ID)).to.equal(0n);
  });

  it("parametrik sigorta: >32 °C / akış yok → anapara iadesi", async () => {
    batchB = await createBatch();
    await fundAndMint(batchB, alice, 10);
    await pushViaDon(batchB, await telemetry(2, 1_600, 380_000));

    await expectFailure(
      program.methods
        .triggerParametricDefault()
        .accountsStrict({ caller: bob.publicKey, batchVault: batchB.vault, settlementEscrow: batchB.escrow, escrowUsdc: batchB.escrowUsdc })
        .signers([bob])
        .rpc(),
      "NoDefaultCondition",
    );

    await pushViaEd25519(batchB, await telemetry(3, 2_365, 370_000, { outage: true }));
    await program.methods
      .triggerParametricDefault()
      .accountsStrict({ caller: bob.publicKey, batchVault: batchB.vault, settlementEscrow: batchB.escrow, escrowUsdc: batchB.escrowUsdc })
      .signers([bob])
      .rpc();
    const vault = await acc("batchVault").fetch(batchB.vault);
    expect(Object.keys(vault.status)[0]).to.equal("defaulted");
    expect(vault.refundPrice.toNumber()).to.equal(450_000);

    const before = await balance(usdcAta(alice.publicKey));
    await program.methods
      .claimDefaultRefund(new BN(10))
      .accountsStrict({ holder: alice.publicKey, ...holderAccounts(batchB, alice) })
      .signers([alice])
      .rpc();
    expect((await balance(usdcAta(alice.publicKey))) - before).to.equal(USDC(4.5));
  });
});
