/** Cüzdanla imzalanan bir işlemin aşamaları. */
export type TxPhase = null | "preparing" | "signing" | "confirming";

export const PHANTOM_HINT =
  "If the approval window did not open, close Phantom's side panel and try again. If you still don't see it, click the Phantom icon in your browser toolbar.";

export const CLOSED_BATCH_MESSAGE = "This batch is closed. Start a new batch first.";

/** Düğmede gösterilen kısa durum metni. */
export function phaseLabel(phase: TxPhase, fallback = "Working…"): string {
  switch (phase) {
    case "preparing":
      return "Preparing transaction…";
    case "signing":
      return "Waiting for approval in Phantom…";
    case "confirming":
      return "Confirming on-chain…";
    default:
      return fallback;
  }
}
