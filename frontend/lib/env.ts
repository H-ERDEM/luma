export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
export const CLUSTER = (process.env.NEXT_PUBLIC_CLUSTER ?? "localnet") as "localnet" | "devnet";

export function explorerTx(signature: string): string {
  const query =
    CLUSTER === "devnet"
      ? "?cluster=devnet"
      : `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  return `https://explorer.solana.com/tx/${signature}${query}`;
}
