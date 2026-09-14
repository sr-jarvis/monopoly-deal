/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        monopoly: {
          dark: '#0f172a',
          board: '#1e293b',
          accent: '#38bdf8',
          card: '#334155',
          brown: '#78350f',
          lightblue: '#0284c7',
          purple: '#7e22ce',
          orange: '#ea580c',
          red: '#dc2626',
          yellow: '#ca8a04',
          green: '#16a34a',
          darkblue: '#1e3a8a',
          railroad: '#1f2937',
          utility: '#475569'
        }
      }
    },
  },
  plugins: [],
}
