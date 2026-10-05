"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { errorText, useLuma } from "@/hooks/useLuma";
import { CopyIcon } from "@/components/icons";

/** Bağlı cüzdanın zincir üstü KycRegistry durumunu gösterir. */
export function KycBadge() {
  const { publicKey, kyc, refresh, pushLog } = useLuma();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!publicKey) return null;

  const base58 = publicKey.toBase58();

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(base58);
    } catch {
      const el = document.createElement("textarea");
      el.value = base58;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const approved = kyc?.approved === true;

  async function verify() {
    if (!publicKey) return;
    setPending(true);
    try {
      const { signature, alreadyApproved } = await api.verifyKyc(publicKey.toBase58());
      pushLog({
        text: alreadyApproved ? "Your KYC record is already approved" : "KYC record approved on-chain",
        tone: "ok",
        signature: signature ?? undefined,
      });
      await refresh();
    } catch (err) {
      pushLog({ text: `Could not verify KYC: ${errorText(err)}`, tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="hidden items-center gap-2 md:flex" aria-live="polite">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ${
          approved ? "bg-brand-soft text-brand" : "bg-inner text-muted"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${approved ? "bg-brand" : "bg-muted"}`} aria-hidden />
        {kyc === null ? "Checking KYC…" : approved ? "KYC approved" : "KYC required"}
      </span>
      {kyc !== null && !approved && (
        <button
          type="button"
          onClick={verify}
          disabled={pending}
          className="rounded-full border border-line-strong px-4 py-1.5 text-[13px] font-semibold hover:bg-white/10 disabled:opacity-50"
        >
          {pending ? "Verifying…" : "Verify identity"}
        </button>
      )}
      <button
        type="button"
        onClick={copyAddress}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] text-muted hover:bg-white/10 hover:text-white"
        title="Copy wallet address"
        aria-label="Copy wallet address"
      >
        <CopyIcon className="h-4 w-4" />
        {copied ? "Copied" : null}
      </button>
    </div>
  );
}
