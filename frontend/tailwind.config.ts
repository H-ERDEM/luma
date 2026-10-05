import type { Config } from "tailwindcss";

// Koyu tema: neredeyse siyah zemin, tek imza rengi (marul yeşili), gerisi beyaz/gri.
// Kırmızı (risk) yalnızca gerçek hatalar içindir (başarısız işlem, bağlantı yok).
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#060606",
        surface: "#0E0E0E",
        inner: "#161616",
        track: "#2A2A2A",
        ink: "#FFFFFF",
        muted: "#A6A6A6",
        line: { DEFAULT: "rgba(255,255,255,0.12)", strong: "rgba(255,255,255,0.22)" },
        brand: { DEFAULT: "#8EE05A", soft: "rgba(142,224,90,0.12)", deep: "#7AC94A" },
        plant: "#8EE05A",
        info: { DEFAULT: "#FFFFFF", soft: "#1C1C1C" },
        risk: { DEFAULT: "#FF8A80", soft: "rgba(255,138,128,0.1)" },
      },
      fontFamily: {
        sans: ["Satoshi", "system-ui", "sans-serif"],
        display: ["Clash Display", "Satoshi", "system-ui", "sans-serif"],
      },
      borderRadius: { card: "28px" },
      keyframes: {
        grow: { from: { transform: "scale(0)", opacity: "0" }, to: { transform: "scale(1)" } },
      },
      animation: { grow: "grow 1s cubic-bezier(.2,.8,.2,1) both" },
    },
  },
  plugins: [],
};
export default config;
