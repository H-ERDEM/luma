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

/** İlk ekran: tek cümlelik değer önermesi (en çok 3 satır), güven satırı ve güncel partinin özeti. */
export function Hero() {
  const { publicKey } = useLuma();
  const { setVisible } = useWalletModal();

  return (
    <section className="mx-auto max-w-[1200px] px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20">
      <p className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-line px-4 py-2 text-[13.5px] text-muted sm:mb-10 sm:text-[14px]">
        <span className="h-[7px] w-[7px] rounded-full bg-brand" aria-hidden />
        <span><span className="whitespace-nowrap">Pre-harvest</span> capital, protected <span className="whitespace-nowrap">on-chain</span></span>
      </p>
      <h1 className="text-balance text-[33px] font-semibold leading-[1.04] tracking-[-0.015em] sm:text-[50px] lg:text-[58px]">
        LumaGrow lets greenhouse growers raise <span className="whitespace-nowrap">pre-harvest</span> capital from backers whose principal is protected{" "}
        <span className="whitespace-nowrap text-brand">on-chain.</span>
      </h1>

      <div className="mt-12 grid items-start gap-12 lg:mt-16 lg:grid-cols-[1fr_.95fr] lg:gap-16">
        <div>
          <p className="max-w-[48ch] text-[18px] leading-relaxed text-muted sm:text-[20px]">
            Each seedling is a token. Your USDC stays locked in an on-chain vault while live sensor data prices the crop as it grows.
          </p>
          <div className="mt-9 flex flex-wrap gap-3.5">
            {publicKey === null ? (
              <button type="button" onClick={() => setVisible(true)} className="btn btn-lg w-full sm:w-auto">
                Connect wallet
              </button>
            ) : (
              <a href="#start" className="btn btn-lg w-full sm:w-auto">
                Back a harvest
              </a>
            )}
            <a href="#how" className="btn btn-lg btn-ghost w-full sm:w-auto">
              See how it works
            </a>
          </div>
          <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-[14.5px] text-muted">
            {TRUST.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2.5">
                <Icon className="h-5 w-5 text-brand" />
                {label}
              </li>
            ))}
          </ul>
        </div>
        <BatchSnapshot />
      </div>
    </section>
  );
}
