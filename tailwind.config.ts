import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'JetBrains Mono'", "monospace"],
      },
      colors: {
        radar: {
          bg:     "#0a0e1a",
          panel:  "#0f1629",
          border: "#1e2d4a",
          accent: "#00d4ff",
          green:  "#00ff88",
          red:    "#ff4466",
          yellow: "#ffcc00",
          muted:  "#4a6080",
        },
      },
      animation: {
        "pulse-dot": "pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "slide-in":  "slideIn 0.3s ease-out",
      },
      keyframes: {
        slideIn: {
          "0%":   { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
};
export default config;
