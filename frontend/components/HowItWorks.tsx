import { LockIcon, ShieldIcon, SproutIcon } from "@/components/icons";

const STEPS = [
  {
    icon: SproutIcon,
    title: "Growers list a batch",
    body: "A 40-day hydroponic lettuce batch is split into seedling tokens priced at 0.45 USDC each.",
  },
  {
    icon: LockIcon,
    title: "Backers fund seedlings",
    body: "Every USDC goes into an on-chain vault. Sensors and an oracle write the crop's progress to the chain.",
  },
  {
    icon: ShieldIcon,
    title: "Harvest, exit, or get refunded",
    body: "Redeem at harvest, sell early on the price curve, or reclaim your principal if sensors report a critical failure.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-16 sm:px-8 sm:py-24">
      <SectionHead eyebrow="How it works" title="Three steps from seedling to harvest" id="how-title" />
      <ol className="grid gap-5 md:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="relative rounded-card border border-line bg-surface p-7 sm:p-9">
            <span className="absolute right-7 top-6 font-display text-[44px] font-semibold leading-none text-white/15">{i + 1}</span>
            <div className="mb-8 grid h-[52px] w-[52px] place-items-center rounded-full bg-brand text-black">
              <Icon className="h-6 w-6" />
            </div>
            <h3 className="text-[24px] font-semibold tracking-[-0.02em]">{title}</h3>
            <p className="mt-3 text-[16px] leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SectionHead({ eyebrow, title, id, children }: { eyebrow: string; title: string; id: string; children?: React.ReactNode }) {
  return (
    <div className="mb-12">
      <p className="kicker">{eyebrow}</p>
      <h2 id={id} className="max-w-[20ch] text-balance text-[34px] font-semibold leading-[1.04] tracking-[-0.02em] sm:text-[52px]">
        {title}
      </h2>
      {children}
    </div>
  );
}
