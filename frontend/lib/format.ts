const MICRO = 1_000_000;

/** Sayılar İngilizce biçimde: 0.45, 1,000.00 */
const NUMBER_LOCALE = "en-US";

export function usdc(micro: string | number | bigint, digits = 2): string {
  const n = Number(micro) / MICRO;
  return n.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) });
}

export const integer = (n: string | number | bigint): string => Number(n).toLocaleString(NUMBER_LOCALE);

export const pct = (bps: number): string =>
  `${(bps / 100).toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const celsius = (centi: number): string =>
  `${(centi / 100).toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
export const ph = (centi: number): string => (centi / 100).toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2 });
export const shortKey = (k: string): string => `${k.slice(0, 4)}…${k.slice(-4)}`;
