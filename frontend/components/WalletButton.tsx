"use client";

import dynamic from "next/dynamic";

const BaseWalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).BaseWalletMultiButton,
  { ssr: false },
);

const LABELS = {
  "change-wallet": "Change wallet",
  connecting: "Connecting…",
  "copy-address": "Copy address",
  copied: "Copied",
  disconnect: "Disconnect",
  "has-wallet": "Connect",
  "no-wallet": "Connect wallet",
} as const;

/** Kütüphanenin cüzdan düğmesi, İngilizce etiketlerle (davranışı değişmez). */
export function WalletButton() {
  return <BaseWalletMultiButton labels={LABELS} />;
}
