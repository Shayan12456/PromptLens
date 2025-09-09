/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      keyframes: {
        glow: {
          '0%, 100%': { opacity: 0.7, 'box-shadow': '0 0 10px #a78bfa, 0 0 20px #a78bfa' },
          '50%': { opacity: 1, 'box-shadow': '0 0 20px #a78bfa, 0 0 40px #a78bfa' },
        },
      },
      animation: {
        glow: 'glow 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} 