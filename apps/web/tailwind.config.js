/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Halma brand palette (DESIGN.md / halma_brand_guide)
        ink: '#0F1117',
        canvas: '#1A1D26',
        panel: '#252A36',
        line: '#4A5263',
        text: '#E8EAF0',
        muted: '#A8B0C0',
        accent: '#7B8FFF',
        red: '#FF5C5C',
        blue: '#4F8FFF',
        green: '#3DD68C',
        yellow: '#FFD93D',
        purple: '#B985FF',
        orange: '#FF9F45',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
