const MICRO = 1_000_000;

export function usdc(micro: string | number | bigint, digits = 2): string {
  const n = Number(micro) / MICRO;
  return n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) });
}

export const pct = (bps: number): string => `%${(bps / 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
export const celsius = (centi: number): string =>
  `${(centi / 100).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
export const ph = (centi: number): string => (centi / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
export const shortKey = (k: string): string => `${k.slice(0, 4)}…${k.slice(-4)}`;
