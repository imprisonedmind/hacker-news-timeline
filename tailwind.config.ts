import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        hn: {
          orange: "#ff6600",
          cream: "#f6f6ef",
          ink: "#111111",
          muted: "#828282",
        },
      },
      fontFamily: {
        hn: ["Verdana", "Geneva", "sans-serif"],
      },
      boxShadow: {
        tweet: "0 1px 0 rgba(0,0,0,0.07)",
      },
    },
  },
  plugins: [],
} satisfies Config;
