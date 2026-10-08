/** Site-wide banner: this is a hackathon demo, not a real investment product. */
export function DemoDisclaimer() {
  return (
    <div className="border-b border-amber-400/30 bg-amber-400/10 px-5 py-2 text-[13px] text-amber-200 sm:px-8">
      <p className="mx-auto max-w-[1200px]">
        <span className="font-semibold">Hackathon demo — not open for real investment.</span>{" "}
        Runs on Solana Devnet with test funds only. The USDC used here is a mock token with no
        real value; do not send real funds to any address on this site.
      </p>
    </div>
  );
}
