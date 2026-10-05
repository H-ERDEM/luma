"use client";

import type { CurvePoint } from "@/lib/api";

interface Props {
  day: number;
  harvestDay: number;
  curve: CurvePoint[];
  failed: boolean;
}

/** Hidroponik tepsi: her hücre döngünün bir günü; bitkinin boyu o günkü B_t'yi gösterir. Açılışta fideler sırayla büyür. */
export function SeedTray({ day, harvestDay, curve, failed }: Props) {
  const cells = Array.from({ length: harvestDay }, (_, i) => i + 1);
  return (
    <div
      className="grid grid-cols-8 gap-2"
      role="img"
      aria-label={`Growth tray: day ${day} of ${harvestDay}${failed ? ", insurance triggered" : ""}`}
    >
      {cells.map((d) => {
        const grown = d <= day;
        const isToday = d === day;
        const b = (curve[d]?.growthBps ?? 0) / 10_000;
        const size = 26 + b * 62;
        const tone = failed && grown && !isToday ? "bg-white/30" : "bg-plant";
        return (
          <div
            key={d}
            className={`relative grid aspect-square place-items-center rounded-xl border ${
              grown ? "border-white/10 bg-[#121212]" : "border-white/[0.04] bg-inner"
            } ${isToday ? "ring-2 ring-white" : ""}`}
          >
            {grown && (
              <span
                className={`block animate-grow rounded-full motion-reduce:animate-none ${tone}`}
                style={{ width: `${size}%`, height: `${size}%`, opacity: 0.55 + b * 0.45, animationDelay: `${d * 36}ms` }}
              />
            )}
            <span className="sr-only">Day {d}</span>
          </div>
        );
      })}
    </div>
  );
}
