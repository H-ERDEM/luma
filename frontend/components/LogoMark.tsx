/** LumaGrow logosu: yeşil daire içinde iki yapraklı fide (app/icon.svg ile aynı çizim). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className}>
      <circle cx="32" cy="32" r="32" fill="#8EE05A" />
      <path d="M32 50V34" stroke="#060606" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M32 36C32 24 38 17 50 16c0 12-6 19-18 20z" fill="#060606" />
      <path d="M32 40c0-9-5-14-16-14 0 9 5 14 16 14z" fill="#060606" />
    </svg>
  );
}
