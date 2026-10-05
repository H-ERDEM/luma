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
    <section id="how" aria-labelledby="how-title" className="mx-auto max-w-[1160px] scroll-mt-20 px-5 py-10 sm:px-7">
      <SectionHead eyebrow="How it works" title="Three steps from seedling to harvest" id="how-title" />
      <ol className="grid gap-5 md:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="relative rounded-card border border-line border-t-[3px] border-t-brand bg-surface p-6 shadow-card sm:p-7">
            <span className="absolute right-6 top-5 text-sm text-muted">{i + 1}</span>
            <div className="mb-[18px] grid h-[46px] w-[46px] place-items-center rounded-xl bg-brand-soft text-brand">
              <Icon className="h-6 w-6" />
            </div>
            <h3 className="text-[19px] font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SectionHead({ eyebrow, title, id, children }: { eyebrow: string; title: string; id: string; children?: React.ReactNode }) {
  return (
    <div className="mb-7">
      <p className="mb-3 flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.09em] text-brand">
        <span className="h-0.5 w-[18px] bg-brand" aria-hidden />
        {eyebrow}
      </p>
      <h2 id={id} className="max-w-[24ch] text-balance text-[25px] font-semibold leading-tight tracking-[-0.022em] sm:text-[32px]">
        {title}
      </h2>
      {children}
    </div>
  );
}
