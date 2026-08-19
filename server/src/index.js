// שרת מטבח החסד - נקודת כניסה
import 'dotenv/config';
import dns from 'node:dns';
import express from 'express';
import cors from 'cors';

// מכריחים resolve ל-IPv4 תחילה בכל הרזולוציות של התהליך. בסביבת Render אין
// ניתוב IPv6 יוצא, וב-Node 24 סדר ברירת-המחדל של תוצאות ה-DNS ('verbatim')
// עלול להחזיר כתובת IPv6 קודם → שליחת SMTP ל-Gmail נכשלת ב-ENETUNREACH /
// Connection timeout. זה משלים את family:4 שב-smtpConfig ומבטיח יציבות.
dns.setDefaultResultOrder('ipv4first');

import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import shabbatotRoutes from './routes/shabbatot.js';
import ordersRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';
import shabbatFileRoutes from './routes/shabbatFile.js';
import eventsRoutes from './routes/events.js';
import salesRoutes from './routes/sales.js';
import volunteersRoutes from './routes/volunteers.js';
import inventoryRoutes from './routes/inventory.js';
import suppliersRoutes from './routes/suppliers.js';
import catalogAdminRoutes from './routes/catalogAdmin.js';
import paymentsRoutes from './routes/payments.js';
import financeRoutes from './routes/finance.js';
import pettyCashRoutes from './routes/pettyCash.js';
import recurringExpensesRoutes from './routes/recurringExpenses.js';
import cronRoutes from './routes/cron.js';
import emailRoutes from './routes/email.js';
import settingsRoutes from './routes/settings.js';
import feedbackRoutes from './routes/feedback.js';
import feedbackAdminRoutes from './routes/feedbackAdmin.js';
import { requireAdmin, blockViewerWrites } from './lib/auth.js';
import { startScheduler } from './services/scheduler.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

// בדיקת חיים
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'מטבח החסד' }));

// נתיבי CRON - מאובטחים במפתח סודי (CRON_SECRET), לא בלוגין מנהל. חייב להירשם לפני /api/admin.
app.use('/api/cron', cronRoutes);

// נתיבים
app.use('/api/auth', authRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/shabbatot', shabbatotRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/feedback', feedbackRoutes);
// אזור הניהול - כל הקריאות מאחורי אימות מנהל (סעיף 5).
// blockViewerWrites חוסם כתיבה למשתמש בתפקיד 'viewer' (הדגמה ללידים) בכל
// הנתיבים באחת, בלי תלות בכיסוי ידני של כל route.
const adminGuard = [requireAdmin, blockViewerWrites];
app.use('/api/admin/shabbat-files', ...adminGuard, shabbatFileRoutes);
app.use('/api/admin/events', ...adminGuard, eventsRoutes);
app.use('/api/admin/sales', ...adminGuard, salesRoutes);
app.use('/api/admin/volunteers', ...adminGuard, volunteersRoutes);
app.use('/api/admin/inventory', ...adminGuard, inventoryRoutes);
app.use('/api/admin/suppliers', ...adminGuard, suppliersRoutes);
app.use('/api/admin/catalog', ...adminGuard, catalogAdminRoutes);
app.use('/api/admin/payments', ...adminGuard, paymentsRoutes);
app.use('/api/admin/finance', ...adminGuard, financeRoutes);
app.use('/api/admin/petty-cash', ...adminGuard, pettyCashRoutes);
app.use('/api/admin/recurring-expenses', ...adminGuard, recurringExpensesRoutes);
app.use('/api/admin/email', ...adminGuard, emailRoutes);
app.use('/api/admin/feedback', ...adminGuard, feedbackAdminRoutes);
app.use('/api/admin', ...adminGuard, adminRoutes);

// טיפול שגיאות אחיד (עברית)
app.use((err, req, res, next) => {
  console.error('שגיאת שרת:', err.message);
  res.status(500).json({ error: 'אירעה שגיאה בשרת. נא לנסות שוב.' });
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`\n🍲 שרת מטבח החסד פועל על http://localhost:${PORT}\n`);
  // מתזמן פנימי - יצירת שבתות אוטומטית (מוצ״ש 22:00 + השלמה בעליית השרת).
  // Scheduled side effects are opt-in so local development cannot send
  // production emails merely by starting the API server.
  const schedulerEnabled = process.env.ENABLE_SCHEDULER == null
    ? String(process.env.RENDER).toLowerCase() === 'true'
    : String(process.env.ENABLE_SCHEDULER).toLowerCase() === 'true';
  if (schedulerEnabled) {
    startScheduler();
  } else {
    console.log('מתזמן השרת מושבת (ENABLE_SCHEDULER אינו true).');
  }
});
