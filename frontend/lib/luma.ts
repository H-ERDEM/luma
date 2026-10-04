/**
 * Yatırımcı tarafı işlemler. Hesap adresleri backend'in döndürdüğü parti durumundan gelir,
 * kullanıcıya ait ATA'lar ve KYC PDA'sı burada türetilir; tüm talimatlar `accountsStrict` kullanır.
 */
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { api, BatchState } from "./api";

let idlPromise: ReturnType<typeof api.idl> | null = null;

export async function loadProgram(connection: Connection, wallet: AnchorWallet): Promise<Program> {
  idlPromise ??= api.idl("luma_batch");
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new Program(await idlPromise, provider);
}

export const kycPda = (wallet: PublicKey, programId: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from("kyc"), wallet.toBuffer()], programId)[0];

export const assetAta = (state: BatchState, owner: PublicKey): PublicKey =>
  getAssociatedTokenAddressSync(new PublicKey(state.addresses.mint), owner, false, TOKEN_2022_PROGRAM_ID);

export const usdcAta = (state: BatchState, owner: PublicKey): PublicKey =>
  getAssociatedTokenAddressSync(new PublicKey(state.addresses.usdcMint), owner, false, TOKEN_PROGRAM_ID);

function batchAccounts(state: BatchState) {
  return {
    batchVault: new PublicKey(state.addresses.batchVault),
    mint: new PublicKey(state.addresses.mint),
    settlementEscrow: new PublicKey(state.addresses.settlementEscrow),
    escrowUsdc: new PublicKey(state.addresses.escrowUsdc),
    usdcMint: new PublicKey(state.addresses.usdcMint),
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    usdcTokenProgram: TOKEN_PROGRAM_ID,
  };
}

export async function fundAndMint(program: Program, state: BatchState, buyer: PublicKey, quantity: number): Promise<string> {
  const tx = await program.methods
    .fundAndMint(new BN(quantity))
    .accountsStrict({
      buyer,
      kycRegistry: kycPda(buyer, program.programId),
      ...batchAccounts(state),
      buyerToken: assetAta(state, buyer),
      buyerUsdc: usdcAta(state, buyer),
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const provider = program.provider as AnchorProvider;
  const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = buyer;

  const signedTx = await provider.wallet.signTransaction(tx);
  const sig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const conf = await provider.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) {
    throw new Error(`İşlem zincirde başarısız oldu: ${JSON.stringify(conf.value.err)}`);
  }
  return sig;
}

/** Zincir üstündeki hesapla aynı: amount × curve_price. */
export const exitQuote = (state: BatchState, amount: number): bigint => BigInt(amount) * BigInt(state.curvePrice);

export async function sellToBondingCurve(program: Program, state: BatchState, seller: PublicKey, amount: number): Promise<string> {
  const minOut = (exitQuote(state, amount) * 99n) / 100n;
  return program.methods
    .sellToBondingCurve(new BN(amount), new BN(minOut.toString()))
    .accountsStrict({
      seller,
      kycRegistry: kycPda(seller, program.programId),
      ...batchAccounts(state),
      sellerToken: assetAta(state, seller),
      sellerUsdc: usdcAta(state, seller),
      reserveVault: new PublicKey(state.addresses.reserveVault),
      reserveUsdc: new PublicKey(state.addresses.reserveUsdc),
    })
    .rpc();
}

export async function claimDefaultRefund(program: Program, state: BatchState, holder: PublicKey, amount: number): Promise<string> {
  return program.methods
    .claimDefaultRefund(new BN(amount))
    .accountsStrict({
      holder,
      ...batchAccounts(state),
      holderToken: assetAta(state, holder),
      holderUsdc: usdcAta(state, holder),
    })
    .rpc();
}

export async function redeemAndBurn(program: Program, state: BatchState, holder: PublicKey, amount: number): Promise<string> {
  return program.methods
    .redeemAndBurn(new BN(amount))
    .accountsStrict({
      holder,
      ...batchAccounts(state),
      holderToken: assetAta(state, holder),
      holderUsdc: usdcAta(state, holder),
    })
    .rpc();
}

export async function tokenBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  const info = await connection.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  return info === null ? 0n : BigInt(info.value.amount);
}
