"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { api, BatchState, KycStatus, TelemetryFeed } from "@/lib/api";
import {
  assetAta,
  claimDefaultRefund,
  fundAndMint,
  loadProgram,
  redeemAndBurn,
  sellToBondingCurve,
  tokenBalance,
  usdcAta,
} from "@/lib/luma";

export interface LogEntry {
  id: number;
  text: string;
  tone: "info" | "ok" | "error";
  signature?: string;
}

interface LumaContextValue {
  publicKey: PublicKey | null;
  connected: boolean;
  state: BatchState | null;
  feed: TelemetryFeed | null;
  backendError: string | null;
  kyc: KycStatus | null;
  holdings: bigint;
  usdcBalance: bigint;
  log: LogEntry[];
  pushLog: (entry: Omit<LogEntry, "id">) => void;
  refresh: () => Promise<void>;
  /** Bağlı cüzdanın güncel fide bakiyesini doğrudan zincirden okur (render kapanışından bağımsız). */
  fetchHoldings: () => Promise<bigint>;
  /** Cüzdanla imzalanan yatırımcı işlemleri; başarılıysa imza döner. */
  fund: (quantity: number) => Promise<string>;
  sell: (amount: number) => Promise<string>;
  claimRefund: (amount: number) => Promise<string>;
  redeem: (amount: number) => Promise<string>;
}

const LumaContext = createContext<LumaContextValue | null>(null);
const POLL_MS = 5_000;
/** Art arda hatalarda yoklama aralığı en fazla bu kadar uzar. */
const MAX_POLL_MS = 30_000;

export function LumaProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [state, setState] = useState<BatchState | null>(null);
  const [feed, setFeed] = useState<TelemetryFeed | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [kyc, setKyc] = useState<KycStatus | null>(null);
  const [holdings, setHoldings] = useState<bigint>(0n);
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);

  const pushLog = useCallback((entry: Omit<LogEntry, "id">) => {
    logId.current += 1;
    const id = logId.current;
    setLog((prev) => [{ ...entry, id }, ...prev].slice(0, 30));
  }, []);

  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const inFlight = useRef<Promise<void> | null>(null);
  const failures = useRef(0);

  /** Durum + telemetri (tek HTTP isteği) ve cüzdan bakiyeleri. KYC burada çekilmez. */
  const loadOnce = useCallback(
    async (fresh: boolean) => {
      try {
        const { state: s, feed: f } = await api.snapshot(fresh);
        setState(s);
        setFeed(f);
        setBackendError(null);
        failures.current = 0;
        const w = walletRef.current;
        if (w) {
          const [h, u] = await Promise.all([
            tokenBalance(connection, assetAta(s, w.publicKey)),
            tokenBalance(connection, usdcAta(s, w.publicKey)),
          ]);
          setHoldings(h);
          setUsdcBalance(u);
        } else {
          setHoldings(0n);
          setUsdcBalance(0n);
        }
      } catch (err) {
        failures.current += 1;
        setBackendError(err instanceof Error ? err.message : String(err));
      }
    },
    [connection],
  );

  /** KYC nadiren değişir: yalnızca cüzdan bağlanınca ve işlemlerden sonra okunur. */
  const refreshKyc = useCallback(async () => {
    const w = walletRef.current;
    if (!w) {
      setKyc(null);
      return;
    }
    try {
      setKyc(await api.kyc(w.publicKey.toBase58()));
    } catch {
      // Geçici hata: bir sonraki işlemde ya da cüzdan yeniden bağlanınca yeniden denenir.
    }
  }, []);

  /** Açık yenileme (işlemden sonra): çalışan turu bekler, önbelleği atlar, KYC'yi de okur. */
  const refresh = useCallback(async () => {
    while (inFlight.current) await inFlight.current;
    const task = (async () => {
      await loadOnce(true);
      await refreshKyc();
    })();
    inFlight.current = task;
    try {
      await task;
    } finally {
      if (inFlight.current === task) inFlight.current = null;
    }
  }, [loadOnce, refreshKyc]);

  // Yoklama: tek seferde bir istek; sekme gizliyken durur; hatada aralık uzar.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), Math.min(POLL_MS * 2 ** failures.current, MAX_POLL_MS));
    };
    const tick = async () => {
      if (!cancelled && !document.hidden && inFlight.current === null) {
        const task = loadOnce(false);
        inFlight.current = task;
        try {
          await task;
        } finally {
          if (inFlight.current === task) inFlight.current = null;
        }
      }
      if (!cancelled) schedule();
    };
    const onVisibility = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void tick();
      }
    };

    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadOnce]);

  // Cüzdan bağlanınca/değişince KYC ve bakiyeleri hemen oku.
  const walletKey = wallet?.publicKey.toBase58() ?? null;
  useEffect(() => {
    if (walletKey === null) {
      void refreshKyc(); // yalnızca KYC'yi temizler; durumu yoklama zaten yüklüyor
      return;
    }
    void (async () => {
      await refreshKyc();
      await loadOnce(false);
    })();
  }, [walletKey, refreshKyc, loadOnce]);

  const withProgram = useCallback(
    async (task: (args: { program: Awaited<ReturnType<typeof loadProgram>>; state: BatchState }) => Promise<string>) => {
      if (!wallet) throw new Error("Önce cüzdanınızı bağlayın.");
      const fresh = await api.batchState(true);
      const program = await loadProgram(connection, wallet);
      const signature = await task({ program, state: fresh });
      await refresh();
      return signature;
    },
    [connection, wallet, refresh],
  );

  const fetchHoldings = useCallback(async () => {
    if (!wallet) return 0n;
    const fresh = await api.batchState();
    return tokenBalance(connection, assetAta(fresh, wallet.publicKey));
  }, [connection, wallet]);

  const value = useMemo<LumaContextValue>(
    () => ({
      publicKey: wallet?.publicKey ?? null,
      connected: Boolean(wallet),
      state,
      feed,
      backendError,
      kyc,
      holdings,
      usdcBalance,
      log,
      pushLog,
      refresh,
      fetchHoldings,
      fund: (q) => withProgram(({ program, state: s }) => fundAndMint(program, s, wallet!.publicKey, q)),
      sell: (a) => withProgram(({ program, state: s }) => sellToBondingCurve(program, s, wallet!.publicKey, a)),
      claimRefund: (a) => withProgram(({ program, state: s }) => claimDefaultRefund(program, s, wallet!.publicKey, a)),
      redeem: (a) => withProgram(({ program, state: s }) => redeemAndBurn(program, s, wallet!.publicKey, a)),
    }),
    [wallet, state, feed, backendError, kyc, holdings, usdcBalance, log, pushLog, refresh, fetchHoldings, withProgram],
  );

  return <LumaContext.Provider value={value}>{children}</LumaContext.Provider>;
}

export function useLuma(): LumaContextValue {
  const ctx = useContext(LumaContext);
  if (ctx === null) throw new Error("useLuma, LumaProvider içinde kullanılmalı");
  return ctx;
}

export function errorText(err: unknown): string {
  const e = err as { error?: { errorMessage?: string }; message?: string };
  return e.error?.errorMessage ?? e.message ?? String(err);
}
