/** @type {import("tailwindcss").Config} */
const defaultTheme = require("tailwindcss/defaultTheme");

module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        oai: [
          "'OpenAI Sans'",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "Roboto",
          "Oxygen",
          "Ubuntu",
          "sans-serif",
        ],
        mono: [
          "'SF Mono'",
          "SFMono-Regular",
          "ui-monospace",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        // Display sizes - for hero metrics
        display: [
          "72px",
          {
            lineHeight: "1",
            fontWeight: "700",
            letterSpacing: "-0.03em",
          },
        ],
        "display-sm": [
          "56px",
          {
            lineHeight: "1.05",
            fontWeight: "700",
            letterSpacing: "-0.02em",
          },
        ],
        hero: [
          "48px",
          {
            lineHeight: "1.1",
            fontWeight: "600",
            letterSpacing: "-0.02em",
          },
        ],
        h1: [
          "36px",
          {
            lineHeight: "1.2",
            fontWeight: "600",
            letterSpacing: "-0.02em",
          },
        ],
        h2: [
          "28px",
          {
            lineHeight: "1.25",
            fontWeight: "600",
            letterSpacing: "-0.01em",
          },
        ],
        h3: [
          "22px",
          {
            lineHeight: "1.3",
            fontWeight: "600",
            letterSpacing: "-0.01em",
          },
        ],
        h4: [
          "18px",
          {
            lineHeight: "1.4",
            fontWeight: "600",
          },
        ],
        body: [
          "16px",
          {
            lineHeight: "1.5",
            fontWeight: "400",
          },
        ],
        "body-sm": [
          "14px",
          {
            lineHeight: "1.5",
            fontWeight: "400",
          },
        ],
        caption: [
          "12px",
          {
            lineHeight: "1.4",
            fontWeight: "500",
            letterSpacing: "0.01em",
          },
        ],
        label: [
          "11px",
          {
            lineHeight: "1.3",
            fontWeight: "600",
            letterSpacing: "0.02em",
          },
        ],
      },
      colors: {
        oai: {
          black: "#0c1118",
          white: "#f4f6fa",
          gray: {
            50: "#f4f6fa",
            100: "#eef1f7",
            200: "#dce1ec",
            300: "#c3cad9",
            400: "#8f9bb0",
            500: "#66738c",
            600: "#48546b",
            700: "#333d51",
            800: "#1f2735",
            900: "#141b26",
            950: "#0c1118",
          },
          // Brand Color - Muted Forest Green (适合白色背景)
          brand: {
            DEFAULT: "#d9861a",
            dark: "#bf7015",
            light: "#eca02f",
            50: "#fdf6e9",
            100: "#fbe8c4",
            200: "#f7d08a",
            300: "#f2b757",
            400: "#eca02f",
            500: "#d9861a",
            600: "#bf7015",
            700: "#9c5a12",
            800: "#7a4711",
            900: "#633a12",
            950: "#3a2109",
          },
          // Supporting accent - Emerald (30%)
          forest: {
            DEFAULT: "#eca02f",
            dark: "#d9861a",
            light: "#f2b757",
            50: "#fdf6e9",
          },
          // Secondary accents (10%)
          amber: {
            DEFAULT: "#f2a93b",
            dark: "#d9861a",
            light: "#f7c877",
            50: "#fdf6e9",
          },
          // Semantic colors
          success: "#10b981",
          warning: "#f59e0b",
          error: "#ef4444",
          info: "#d9861a",
          // Legacy blue - mapped to brand green for consistency
          blue: {
            DEFAULT: "#d9861a",
            dark: "#bf7015",
            light: "#eca02f",
            50: "#fdf6e9",
          },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.5s ease-out",
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "star-movement-bottom": "star-movement-bottom linear infinite alternate",
        "star-movement-top": "star-movement-top linear infinite alternate",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "star-movement-bottom": {
          "0%": { transform: "translate(0%, 0%)", opacity: "1" },
          "100%": { transform: "translate(-100%, 0%)", opacity: "0" },
        },
        "star-movement-top": {
          "0%": { transform: "translate(0%, 0%)", opacity: "1" },
          "100%": { transform: "translate(100%, 0%)", opacity: "0" },
        },
      },
      boxShadow: {
        "oai-sm": "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        "oai": "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)",
        "oai-md": "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
        "oai-lg": "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      spacing: {
        0: "0",
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        8: "32px",
        10: "40px",
        12: "48px",
        16: "64px",
        20: "80px",
      },
    },
  },
  plugins: [],
};
