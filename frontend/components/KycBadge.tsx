"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { errorText, useLuma } from "@/hooks/useLuma";

/** Bağlı cüzdanın zincir üstü KycRegistry durumunu canlı gösterir. */
export function KycBadge() {
  const { publicKey, kyc, refresh, pushLog } = useLuma();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!publicKey) {
    return <span className="text-sm text-muted">Cüzdan bağlı değil</span>;
  }

  const base58 = publicKey.toBase58();
  const shortAddress = `${base58.slice(0, 4)}…${base58.slice(-4)}`;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(base58);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement("textarea");
      el.value = base58;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const approved = kyc?.approved === true;

  async function verify() {
    if (!publicKey) return;
    setPending(true);
    try {
      const { signature } = await api.verifyKyc(publicKey.toBase58());
      pushLog({ text: "KYC kaydı zincirde onaylandı", tone: "ok", signature });
      await refresh();
    } catch (err) {
      pushLog({ text: `KYC doğrulanamadı: ${errorText(err)}`, tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
          approved ? "bg-leaf-soft text-leaf-deep" : "bg-heat-soft text-heat"
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${approved ? "bg-leaf" : "bg-heat"}`} aria-hidden />
        {kyc === null ? "KYC kontrol ediliyor" : approved ? "KYC onaylı" : "KYC onayı yok"}
      </span>
      {kyc !== null && !approved && (
        <button
          type="button"
          onClick={verify}
          disabled={pending}
          className="rounded-full border border-ink px-3 py-1 text-sm font-medium hover:bg-ink hover:text-paper disabled:opacity-50"
        >
          {pending ? "Doğrulanıyor…" : "Kimliği doğrula"}
        </button>
      )}
      <div className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 text-xs font-mono text-ink">
        <span title={base58}>{shortAddress}</span>
        <button
          type="button"
          onClick={copyAddress}
          className="ml-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-line/50 hover:text-ink transition-colors"
          title="Cüzdan adresini kopyala"
        >
          {copied ? "Kopyalandı!" : "Kopyala"}
        </button>
      </div>
    </div>
  );
}
