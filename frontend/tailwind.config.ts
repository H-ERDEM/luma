import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F3F5F1",
        ink: "#17231D",
        muted: "#5B6B61",
        line: "#CBD5CB",
        leaf: { DEFAULT: "#4C8C3F", soft: "#DCEBD3", deep: "#2F5E27" },
        solution: { DEFAULT: "#2C6E8A", soft: "#D6E7EE" },
        heat: { DEFAULT: "#C4471D", soft: "#F6DDD2" },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
