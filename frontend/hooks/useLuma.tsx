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
const POLL_MS = 3_000;

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

  const refresh = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([api.batchState(), api.telemetry()]);
      setState(s);
      setFeed(f);
      setBackendError(null);
      if (wallet) {
        const [k, h, u] = await Promise.all([
          api.kyc(wallet.publicKey.toBase58()),
          tokenBalance(connection, assetAta(s, wallet.publicKey)),
          tokenBalance(connection, usdcAta(s, wallet.publicKey)),
        ]);
        setKyc(k);
        setHoldings(h);
        setUsdcBalance(u);
      } else {
        setKyc(null);
        setHoldings(0n);
        setUsdcBalance(0n);
      }
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : String(err));
    }
  }, [connection, wallet]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const withProgram = useCallback(
    async (task: (args: { program: Awaited<ReturnType<typeof loadProgram>>; state: BatchState }) => Promise<string>) => {
      if (!wallet) throw new Error("Önce cüzdanınızı bağlayın.");
      const fresh = await api.batchState();
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
