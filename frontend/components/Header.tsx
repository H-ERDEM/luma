"use client";

import { KycBadge } from "@/components/KycBadge";
import { SproutIcon } from "@/components/icons";
import { WalletButton } from "@/components/WalletButton";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#start", label: "Get started" },
  { href: "#live", label: "Live batch" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-[60px] max-w-[1160px] items-center gap-4 px-5 sm:h-[68px] sm:gap-6 sm:px-7">
        <a href="#top" className="flex items-center gap-2.5" aria-label="LUMA home">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-brand text-white">
            <SproutIcon className="h-[18px] w-[18px]" />
          </span>
          <span className="text-[20px] font-bold tracking-[0.14em]">LUMA</span>
        </a>
        <nav className="ml-3 hidden gap-6 text-sm text-muted md:flex" aria-label="Sections">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="hover:text-ink">
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
