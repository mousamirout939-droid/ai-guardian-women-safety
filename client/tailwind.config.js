/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        night: {
          950: "#070B14",
          900: "#0B1120",
          800: "#111827",
          700: "#1A2333",
        },
        beacon: {
          400: "#F7C567",
          500: "#F5B942",
          600: "#DE9F2B",
        },
        signal: {
          400: "#4FE0D0",
          500: "#2DD4BF",
          600: "#1FAE9C",
        },
        alarm: {
          400: "#FB6A87",
          500: "#E11D48",
          600: "#BE123C",
        },
        ink: {
          100: "#E8EAF0",
          300: "#B7BECF",
          400: "#8B93A7",
          500: "#5B6376",
        },
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      backgroundImage: {
        "aurora-mesh":
          "radial-gradient(60% 50% at 15% 10%, rgba(45,212,191,0.14) 0%, rgba(45,212,191,0) 60%), radial-gradient(50% 45% at 85% 20%, rgba(245,185,66,0.12) 0%, rgba(245,185,66,0) 60%), radial-gradient(70% 60% at 50% 100%, rgba(225,29,72,0.08) 0%, rgba(225,29,72,0) 60%)",
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        beacon: "0 0 40px 0 rgba(245, 185, 66, 0.35)",
      },
      animation: {
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "pulse-ring-delay": "pulse-ring 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite 0.8s",
        float: "float 8s ease-in-out infinite",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-14px)" },
        },
      },
    },
  },
  plugins: [],
};
