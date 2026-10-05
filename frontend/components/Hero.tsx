"use client";

import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { BatchSnapshot } from "@/components/BatchSnapshot";
import { LockIcon, ShieldIcon, WaveIcon } from "@/components/icons";
import { useLuma } from "@/hooks/useLuma";

const TRUST = [
  { icon: LockIcon, label: "Principal escrowed on-chain" },
  { icon: WaveIcon, label: "Sensor-verified growth" },
  { icon: ShieldIcon, label: "Automatic refund on critical failure" },
];

/** İlk ekran: tek cümlelik değer önermesi, güven satırı ve güncel partinin özeti. */
export function Hero() {
  const { publicKey } = useLuma();
  const { setVisible } = useWalletModal();

  return (
    <section className="mx-auto grid max-w-[1160px] items-center gap-10 px-5 pb-12 pt-10 sm:px-7 lg:grid-cols-[1.12fr_.88fr] lg:gap-14 lg:pb-[72px] lg:pt-[72px]">
      <div>
        <p className="mb-3.5 flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.09em] text-brand">
          <span className="h-0.5 w-[18px] bg-brand" aria-hidden />
          <span className="whitespace-nowrap">Pre-harvest</span> capital, protected <span className="whitespace-nowrap">on-chain</span>
        </p>
        <h1 className="max-w-[19ch] text-balance text-[31px] font-semibold leading-[1.1] tracking-[-0.022em] sm:text-[40px] lg:text-[46px]">
          LUMA lets greenhouse growers raise <span className="whitespace-nowrap">pre-harvest</span> capital from backers whose principal is protected{" "}
          <span className="whitespace-nowrap">on-chain.</span>
        </h1>
        <p className="mt-5 max-w-[52ch] text-[16.5px] leading-relaxed text-muted sm:text-lg">
          Each seedling is a token. Your USDC stays locked in an on-chain vault while live sensor data prices the crop as it grows.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          {publicKey === null ? (
            <button
              type="button"
              onClick={() => setVisible(true)}
              className="inline-flex w-full items-center justify-center rounded-[10px] bg-ink px-6 py-3.5 text-[15px] font-semibold text-white hover:brightness-110 sm:w-auto"
            >
              Connect wallet
            </button>
          ) : (
            <a
              href="#start"
              className="inline-flex w-full items-center justify-center rounded-[10px] bg-ink px-6 py-3.5 text-[15px] font-semibold text-white hover:brightness-110 sm:w-auto"
            >
              Back a harvest
            </a>
          )}
          <a
            href="#how"
            className="inline-flex w-full items-center justify-center rounded-[10px] border border-line-strong px-6 py-3.5 text-[15px] font-semibold hover:bg-white sm:w-auto"
          >
            See how it works
          </a>
        </div>
        <ul className="mt-7 flex flex-wrap gap-x-[22px] gap-y-2.5 text-[13.5px] text-muted">
          {TRUST.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2">
              <Icon className="h-[18px] w-[18px] text-brand" />
              {label}
            </li>
          ))}
        </ul>
      </div>
      <BatchSnapshot />
    </section>
  );
}
