import type { Config } from "tailwindcss";

// OpenKey design system — dark-first, Linear/Vercel-grade density.
// One confident accent (emerald), used sparingly: primary actions, active
// nav, focus rings. Amber/red are reserved for budget states only.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#09090b",
        surface: {
          DEFAULT: "#111113",
          2: "#17171a",
          3: "#1e1e22",
        },
        line: {
          DEFAULT: "#232328",
          strong: "#2e2e35",
        },
        accent: {
          DEFAULT: "#34d399", // emerald-400
          strong: "#10b981", // emerald-500
          faint: "rgba(52, 211, 153, 0.1)",
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "2xs": ["11px", "16px"],
      },
      borderRadius: {
        DEFAULT: "6px",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 200ms ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
