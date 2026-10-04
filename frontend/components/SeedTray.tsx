"use client";

import type { CurvePoint } from "@/lib/api";

interface Props {
  day: number;
  harvestDay: number;
  curve: CurvePoint[];
  failed: boolean;
}

/** Hidroponik tepsi: her hücre döngünün bir günü; bitkinin boyu o günkü B_t'yi gösterir. */
export function SeedTray({ day, harvestDay, curve, failed }: Props) {
  const cells = Array.from({ length: harvestDay }, (_, i) => i + 1);
  return (
    <div
      className="grid grid-cols-8 gap-1.5 rounded-xl border border-line bg-white/60 p-3"
      role="img"
      aria-label={`Büyüme tepsisi: ${harvestDay} günün ${day}. günü${failed ? ", kritik arıza" : ""}`}
    >
      {cells.map((d) => {
        const grown = d <= day;
        const isToday = d === day;
        const b = (curve[d]?.growthBps ?? 0) / 10_000;
        const size = 18 + b * 62;
        const tone = failed && isToday ? "bg-heat" : failed && grown ? "bg-muted/40" : "bg-leaf";
        return (
          <div
            key={d}
            className={`relative flex aspect-square items-center justify-center rounded-md ${
              isToday ? "ring-2 ring-ink" : ""
            } ${grown ? "bg-solution-soft" : "bg-paper"}`}
          >
            {grown && (
              <span
                className={`block rounded-full ${tone} transition-all duration-500 motion-reduce:transition-none`}
                style={{ width: `${size}%`, height: `${size}%`, opacity: 0.35 + b * 0.65 }}
              />
            )}
            <span className="sr-only">Gün {d}</span>
          </div>
        );
      })}
    </div>
  );
}
