"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "@/components/LogoMark";

const SEEN_KEY = "lumagrow.splashSeen";
const SHOW_MS = 900;

/**
 * Açılış animasyonu: logo kısa süre belirir ve söner. İçeriğin üstünde durur ama tıklamayı engellemez,
 * yüklemeyi beklemez. Oturum başına bir kez gösterilir; azaltılmış hareket tercihinde hiç gösterilmez.
 */
export function Splash() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (sessionStorage.getItem(SEEN_KEY) === "1") return;
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Depolama kapalıysa animasyon yine de bir kez oynar.
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), SHOW_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return (
    <div className="splash pointer-events-none fixed inset-0 z-[100] grid place-items-center bg-canvas" aria-hidden>
      <div className="flex flex-col items-center gap-5">
        <LogoMark className="splash-mark h-20 w-20" />
        <span className="splash-word font-display text-[28px] font-bold tracking-[0.02em]">LumaGrow</span>
      </div>
    </div>
  );
}
