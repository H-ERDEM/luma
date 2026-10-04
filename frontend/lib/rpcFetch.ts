/**
 * (backend/src/rpcFetch.ts ile aynı mantık; iki paket arasında ortak modül olmadığı için kopyadır.)
 * RPC için yeniden denemeli `fetch`. Yalnızca 429 (Too Many Requests) ve 503 yanıtlarını yeniden
 * dener: bu yanıtlarda istek işlenmemiştir, bu yüzden tekrar göndermek güvenlidir. Ağ hatası ya da
 * zaman aşımı yeniden DENENMEZ (istek işlenmiş olabilir; çift işlem riski).
 */
const RETRY_STATUS = new Set([429, 503]);
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;
/** Sunucu daha uzun bir Retry-After isterse bile en fazla bu kadar bekleriz. */
const MAX_RETRY_AFTER_MS = 15_000;

export interface RetryInfo {
  status: number;
  attempt: number;
  maxRetries: number;
  delayMs: number;
}

export interface RetryingFetchOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: RetryInfo) => void;
}

/** `Retry-After`: saniye sayısı ya da HTTP tarihi. Geçersizse `null`. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.min(Math.max(at - now, 0), MAX_RETRY_AFTER_MS);
}

export function createRetryingFetch(options: RetryingFetchOptions = {}): typeof fetch {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;

  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(input, init);
      if (!RETRY_STATUS.has(res.status) || attempt >= MAX_RETRIES) return res;

      const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
      // Sunucunun Retry-After değeri varsa ona uyarız; yoksa üstel bekleme + rastgelelik (50–100%).
      const delayMs = parseRetryAfter(res.headers.get("retry-after")) ?? Math.round(backoff * (0.5 + random() * 0.5));
      await res.body?.cancel().catch(() => undefined);
      options.onRetry?.({ status: res.status, attempt: attempt + 1, maxRetries: MAX_RETRIES, delayMs });
      await sleep(delayMs);
    }
  };
}
