import { PHANTOM_HINT } from "@/lib/txPhase";

/** Phantom imza penceresi beklenirken görünür; yan panel açıkken pencere açılmayabilir. */
export function PhantomHint() {
  return (
    <p role="status" className="mt-3 rounded-lg bg-inner p-3 text-sm leading-relaxed">
      <strong className="font-semibold">Waiting for approval in Phantom.</strong> {PHANTOM_HINT}
    </p>
  );
}
