import { usdc } from "@/lib/format";

/** Faucet yanıtını kullanıcıya anlatan tek cümle (Get test funds düğmesi ve Demo console ortak kullanır). */
export function describeFaucet(f: { minted: string; balance: string; cap: string }): string {
  return f.minted === "0"
    ? `Your USDC balance is already at the ${usdc(f.cap)} test limit; nothing was added.`
    : `${usdc(f.minted)} test USDC added (balance ${usdc(f.balance)}).`;
}

export const SOL_SKIPPED_MESSAGE =
  "The SOL top-up is switched off right now (the admin wallet is low), so you may not have enough SOL for transaction fees.";
