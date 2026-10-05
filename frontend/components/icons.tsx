const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

interface Props {
  className?: string;
}

export const SproutIcon = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M12 21v-9" />
    <path d="M12 13c0-4 3-6 7-6 0 4-3 6-7 6z" />
    <path d="M12 15c0-3-2-5-6-5 0 3 2 5 6 5z" />
  </svg>
);

export const LockIcon = ({ className }: Props) => (
  <svg {...base} className={className}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export const ShieldIcon = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

export const WaveIcon = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M3 12h4l3-7 4 14 3-7h4" />
  </svg>
);

export const CheckIcon = ({ className }: Props) => (
  <svg {...base} strokeWidth={2.2} className={className}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);

export const CopyIcon = ({ className }: Props) => (
  <svg {...base} className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
);
