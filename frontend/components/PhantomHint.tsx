import { PHANTOM_HINT } from "@/lib/txPhase";

/** Phantom imza penceresi beklenirken görünür; yan panel açıkken pencere açılmayabilir. */
export function PhantomHint() {
  return (
    <p role="status" className="mt-2 rounded-lg bg-paper p-3 text-sm">
      <strong className="font-medium">Phantom'da onay bekleniyor.</strong> {PHANTOM_HINT}
    </p>
  );
}
