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
      className="grid grid-cols-8 gap-1.5"
      role="img"
      aria-label={`Growth tray: day ${day} of ${harvestDay}${failed ? ", critical failure" : ""}`}
    >
      {cells.map((d) => {
        const grown = d <= day;
        const isToday = d === day;
        const b = (curve[d]?.growthBps ?? 0) / 10_000;
        const size = 22 + b * 66;
        const tone = failed && isToday ? "bg-risk" : failed && grown ? "bg-muted/40" : "bg-plant";
        return (
          <div
            key={d}
            className={`relative grid aspect-square place-items-center rounded-[5px] ${grown ? "bg-brand-soft" : "bg-inner"} ${
              isToday ? "ring-2 ring-ink" : ""
            }`}
          >
            {grown && (
              <span
                className={`block rounded-full ${tone} transition-all duration-500 motion-reduce:transition-none`}
                style={{ width: `${size}%`, height: `${size}%`, opacity: 0.4 + b * 0.6 }}
              />
            )}
            <span className="sr-only">Day {d}</span>
          </div>
        );
      })}
    </div>
  );
}
