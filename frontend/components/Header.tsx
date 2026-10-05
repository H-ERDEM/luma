"use client";

import { KycBadge } from "@/components/KycBadge";
import { LogoMark } from "@/components/LogoMark";
import { WalletButton } from "@/components/WalletButton";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#start", label: "Get started" },
  { href: "#live", label: "Live batch" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-[64px] max-w-[1200px] items-center gap-4 px-5 sm:h-[76px] sm:gap-6 sm:px-8">
        <a href="#top" className="flex items-center gap-2.5" aria-label="LumaGrow home">
          <LogoMark className="h-[32px] w-[32px]" />
          <span className="font-display text-[22px] font-bold tracking-[0.02em]">LumaGrow</span>
        </a>
        <nav className="ml-4 hidden gap-8 text-[15px] text-muted md:flex" aria-label="Sections">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="hover:text-white">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[13px] text-muted lg:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
            Solana Devnet
          </span>
          <KycBadge />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
