import type { Metadata } from "next";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "LumaGrow · Back a harvest on Solana",
  description:
    "LumaGrow lets greenhouse growers raise pre-harvest capital from backers whose principal is protected on-chain. Hackathon demo on Solana Devnet — test funds only, no real USDC.",
};

// Clash Display (başlıklar) + Satoshi (gövde): Fontshare'in kendi CDN stilidir.
const FONTS_URL =
  "https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&f[]=satoshi@400,500,700&display=swap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href={FONTS_URL} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
