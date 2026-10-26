/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#0b0d12", panel: "#11141c", line: "#242936", muted: "#9299aa", accent: "#9b8cff" }, boxShadow: { glow: "0 0 40px rgba(155,140,255,.12)" } } },
  plugins: []
};