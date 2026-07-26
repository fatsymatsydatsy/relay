import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#F5F7F7",
        surface: "#FFFFFF",
        mist: "#E7EEEE",
        ink: "#16242A",
        muted: "#586770",
        line: "#E0E4E6",
        teal: {
          DEFAULT: "#0D5257",
          deep: "#073C40",
          soft: "#3C8489",
        },
        coral: {
          DEFAULT: "#C24E2C",
          deep: "#8F3619",
          soft: "#F0E1D9",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "12px",
        pill: "999px",
      },
      maxWidth: {
        shell: "1120px",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-swap": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "ring-pulse": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "70%": { transform: "scale(1.9)", opacity: "0" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        "dot-bounce": {
          "0%, 80%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "40%": { transform: "translateY(-3px)", opacity: "1" },
        },
        "bar-flux": {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
        "check-in": {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "radar": {
          "to": { transform: "rotate(360deg)" },
        },
        "pin-drop": {
          "0%": { opacity: "0", transform: "translateY(-6px) scale(0.8)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(194, 78, 44, 0)", opacity: "0.9" },
          "50%": { boxShadow: "0 0 10px 1px rgba(194, 78, 44, 0.5)", opacity: "1" },
        },
        "marquee": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-swap": "fade-swap 0.45s ease both",
        "ring-pulse": "ring-pulse 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "dot-bounce": "dot-bounce 1.2s ease-in-out infinite",
        "bar-flux": "bar-flux 0.9s ease-in-out infinite",
        "check-in": "check-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
        "radar": "radar 4s linear infinite",
        "pin-drop": "pin-drop 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
        "glow": "glow 2.2s ease-in-out infinite",
        "marquee": "marquee 34s linear infinite",
        "float-slow": "float-slow 5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
