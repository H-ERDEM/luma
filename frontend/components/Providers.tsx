"use client";

import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { UnsafeBurnerWalletAdapter } from "@solana/wallet-adapter-wallets";
import { CLUSTER, RPC_URL } from "@/lib/env";
import { LumaProvider } from "@/hooks/useLuma";

/** Localnet'te test için UnsafeBurnerWalletAdapter; devnet'te yalnızca standart cüzdanlar. */
export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => (CLUSTER === "localnet" ? [new UnsafeBurnerWalletAdapter()] : []), []);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <LumaProvider>{children}</LumaProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
