"use client";

import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { UnsafeBurnerWalletAdapter } from "@solana/wallet-adapter-wallets";
import { CLUSTER, RPC_URL } from "@/lib/env";
import { LumaProvider } from "@/hooks/useLuma";
import { createRetryingFetch } from "@/lib/rpcFetch";

// 429/503'te üstel geri çekilmeyle yeniden dener; web3.js'in yerleşik yeniden denemesi kapatılır.
// Modül düzeyinde tanımlı: her render'da yeni Connection oluşmasın.
const CONNECTION_CONFIG = {
  commitment: "confirmed" as const,
  fetch: createRetryingFetch({
    onRetry: ({ status, attempt, maxRetries, delayMs }) =>
      console.warn(`RPC ${status}, ${delayMs} ms sonra yeniden deneniyor (${attempt}/${maxRetries})`),
  }),
  disableRetryOnRateLimit: true,
};

/** Localnet'te test için UnsafeBurnerWalletAdapter; devnet'te yalnızca standart cüzdanlar. */
export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => (CLUSTER === "localnet" ? [new UnsafeBurnerWalletAdapter()] : []), []);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={CONNECTION_CONFIG}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <LumaProvider>{children}</LumaProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
