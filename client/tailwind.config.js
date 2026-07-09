/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // צבעי מותג — מהלוגו "ברכת שמואל / מטבח החסד"
        brand: {
          burgundy: '#5C1A2E',      // בורדו עמוק — גוף הסיר, צבע ראשי
          'burgundy-light': '#6B1E2D',
          'burgundy-dark': '#42121F',
          gold: '#C79A4B',           // זהב — מסגרות ומבטאים
          'gold-light': '#D4AF6A',
          'gold-dark': '#A67C34',
          cream: '#F5EFE0',          // קרם — טקסט על כהה, רקעים
          'cream-dark': '#EAdfc8',
        },
      },
      fontFamily: {
        sans: ['"Heebo"', '"Assistant"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 2px 12px rgba(66, 18, 31, 0.08)',
        'card-hover': '0 6px 20px rgba(66, 18, 31, 0.15)',
      },
    },
  },
  plugins: [],
};
