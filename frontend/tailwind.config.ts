import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F6F7F4",
        surface: "#FFFFFF",
        inner: "#F3F5F1",
        track: "#E8ECE6",
        ink: "#0D1B2A",
        muted: "#5B6877",
        line: { DEFAULT: "#E4E8E2", strong: "#CBD3CA" },
        brand: { DEFAULT: "#0F6B4F", soft: "#E3F1EA", deep: "#0B5540" },
        plant: "#2F8F63",
        info: { DEFAULT: "#1D5FA6", soft: "#E3EDF8" },
        risk: { DEFAULT: "#B3421D", soft: "#FBE9E2" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: { card: "14px" },
      boxShadow: {
        card: "0 1px 2px rgba(13,27,42,.04), 0 6px 20px rgba(13,27,42,.04)",
        float: "0 1px 2px rgba(13,27,42,.05), 0 18px 40px rgba(13,27,42,.07)",
      },
    },
  },
  plugins: [],
};
export default config;
