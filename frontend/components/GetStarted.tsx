"use client";

import { useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { CheckIcon } from "@/components/icons";
import { Launchpad } from "@/components/Launchpad";
import { SectionHead } from "@/components/HowItWorks";
import { api } from "@/lib/api";
import { withTimeout } from "@/lib/async";
import { describeFaucet, SOL_SKIPPED_MESSAGE } from "@/lib/faucetMessages";
import { errorText, useLuma } from "@/hooks/useLuma";

/** Yeni kullanıcı yolu: Connect wallet → Get test funds → Back a harvest. */
export function GetStarted() {
  const { publicKey, kyc, usdcBalance, holdings } = useLuma();
  const connected = publicKey !== null;
  const funded = kyc?.approved === true && usdcBalance > 0n;
  const backed = holdings > 0n;
  // Şu an yapılacak adım (1-3); hepsi bittiyse 4.
  const current = !connected ? 1 : !funded ? 2 : !backed ? 3 : 4;

  return (
    <section id="start" aria-labelledby="start-title" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-16 sm:px-8 sm:py-24">
      <SectionHead eyebrow="Get started" title="Back your first harvest in three steps" id="start-title" />
      <div className="grid gap-5 lg:grid-cols-2">
        <ol className="rounded-card border border-line bg-surface px-6 py-3 sm:px-9">
          <Step n={1} current={current} title="Connect wallet" body="Use Phantom on Solana Devnet. No SOL needed.">
            <ConnectButton />
          </Step>
          <Step n={2} current={current} title="Get test funds" body="Verify your wallet and receive up to 100 test USDC.">
            <GetTestFunds enabled={connected} done={funded} />
          </Step>
          <Step n={3} current={current} title="Back a harvest" body="Choose how many seedlings to fund and sign once in Phantom." last>
            {current === 3 && <p className="mt-2 text-sm font-medium text-brand">Use the &ldquo;Back a harvest&rdquo; card to choose your seedlings.</p>}
          </Step>
        </ol>
        <Launchpad />
      </div>
    </section>
  );
}

function Step({
  n,
  current,
  title,
  body,
  children,
  last = false,
}: {
  n: number;
  current: number;
  title: string;
  body: string;
  children?: React.ReactNode;
  last?: boolean;
}) {
  const done = current > n;
  const now = current === n;
  return (
    <li className={`flex gap-[18px] py-7 ${last ? "" : "border-b border-line"}`} aria-current={now ? "step" : undefined}>
      <span
        className={`mt-0.5 grid h-[38px] w-[38px] flex-none place-items-center rounded-full border-[1.5px] text-sm font-bold ${
          done ? "border-brand bg-brand text-black" : now ? "border-brand text-brand" : "border-line-strong text-muted"
        }`}
      >
        {done ? <CheckIcon className="h-4 w-4" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h3>
        <p className="mt-0.5 text-[14.5px] text-muted">{body}</p>
        {(now || done) && children}
      </div>
    </li>
  );
}

function ConnectButton() {
  const { publicKey } = useLuma();
  const { setVisible } = useWalletModal();
  if (publicKey !== null) return <p className="mt-2 text-sm font-medium text-brand">Wallet connected.</p>;
  return (
    <button
      type="button"
      onClick={() => setVisible(true)}
      className="btn btn-sm mt-4"
    >
      Connect wallet
    </button>
  );
}

/** Mevcut iki backend çağrısı (KYC onayı, test USDC); Demo console'un 1. adımındakilerle aynıdır. */
function GetTestFunds({ enabled, done }: { enabled: boolean; done: boolean }) {
  const { publicKey, refresh, pushLog } = useLuma();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function getFunds() {
    if (!publicKey) return;
    const wallet = publicKey.toBase58();
    setPending(true);
    setError(null);
    setNote(null);
    try {
      await withTimeout(
        (async () => {
          const kyc = await api.verifyKyc(wallet);
          pushLog({ text: kyc.alreadyApproved ? "KYC already approved" : "KYC approved", tone: "ok", signature: kyc.signature ?? undefined });
          const faucet = await api.faucet(wallet);
          const text = describeFaucet(faucet);
          pushLog({ text, tone: "info" });
          if (faucet.solSkipped) pushLog({ text: SOL_SKIPPED_MESSAGE, tone: "info" });
          setNote(faucet.solSkipped ? `${text} ${SOL_SKIPPED_MESSAGE}` : text);
        })(),
        90_000,
        "This is taking longer than expected. The server may be waking up; try again in a moment.",
      );
      await refresh();
    } catch (err) {
      const message = errorText(err);
      setError(message);
      pushLog({ text: `Could not get test funds: ${message}`, tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={getFunds}
        disabled={!enabled || pending}
        className="btn btn-sm mt-4"
      >
        {pending ? "Getting test funds…" : done ? "Top up test funds" : "Get test funds"}
      </button>
      {done && note === null && <p className="mt-2 text-sm font-medium text-brand">Your wallet is verified and funded.</p>}
      {note !== null && <p role="status" className="mt-2 text-sm text-brand">{note}</p>}
      {error !== null && <p role="alert" className="mt-2 text-sm text-risk">{error}</p>}
    </div>
  );
}
