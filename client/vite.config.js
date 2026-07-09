import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // לא לגלוש לפורט אחר - מונע התנגשות עם פרויקטים אחרים
    proxy: {
      // כל קריאה ל-/api מנותבת לשרת ה-Node
      '/api': 'http://localhost:3005',
    },
  },
});
