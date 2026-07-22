/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    /* שפת "חדר מצב": סולם רדיוסים מוקטן גלובלית - שדות/כפתורים 6-7px,
       כרטיסים 9px, דיאלוגים 12-14px. דריסת הסולם (ולא extend) מעדכנת את כל
       המסכים הקיימים שמשתמשים ב-rounded-xl/2xl בלי לגעת בהם. */
    borderRadius: {
      none: '0',
      sm: '4px',
      DEFAULT: '6px',
      md: '6px',
      lg: '7px',
      xl: '8px',
      '2xl': '10px',
      '3xl': '14px',
      full: '9999px',
    },
    extend: {
      colors: {
        // צבעי מותג — מהלוגו "ברכת שמואל / מטבח החסד"
        brand: {
          burgundy: '#6D2137',      // בורדו — צבע פעולה (כפתור ראשי, ניווט פעיל)
          'burgundy-light': '#7d2940',
          'burgundy-dark': '#5C1A2E',
          gold: '#C79A4B',           // זהב — טקסי בלבד: שבת, תאריך עברי
          'gold-light': '#D4AF6A',
          'gold-dark': '#9C7433',
          cream: '#F5EFE0',          // קרם — נשמר לזהות המותג (לוגו, מסכי לקוח)
          'cream-dark': '#EAdfc8',
        },
        // נייטרלים חמים (נטייה קלה לכיוון הבורדו) — שפת הקונסולה
        ink: '#2A1E23',
        surface: {
          canvas: '#F6F5F4',
          line: '#E7E2E0',
          'line-strong': '#D8D1CE',
          muted: '#8B7F83',
          body: '#4A3E43',
        },
      },
      /* זוג פונטים: Noto Sans Hebrew לטקסט רץ ונתונים (קריאות מרבית בגדלים קטנים),
         IBM Plex Sans Hebrew לכותרות בלבד (האופי ה"מהונדס" של השפה) */
      fontFamily: {
        sans: ['"Noto Sans Hebrew"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        display: ['"IBM Plex Sans Hebrew"', '"Noto Sans Hebrew"', '"Segoe UI"', 'sans-serif'],
      },
      /* צל קיים רק בשכבות שבאמת מעל הדף: תפריטים ודיאלוגים.
         shadow-card נשאר כשם — אבל הערך הופך לקו-מתאר עדין במקום צל צף. */
      boxShadow: {
        card: '0 1px 2px rgba(42, 30, 35, 0.05)',
        'card-hover': '0 1px 3px rgba(42, 30, 35, 0.09)',
        menu: '0 4px 12px rgba(42, 30, 35, 0.08), 0 12px 32px rgba(42, 30, 35, 0.12)',
        dialog: '0 8px 24px rgba(42, 30, 35, 0.12), 0 24px 64px rgba(42, 30, 35, 0.18)',
      },
    },
  },
  plugins: [],
};
