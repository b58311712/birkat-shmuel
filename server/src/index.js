// שרת מטבח החסד — נקודת כניסה
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import shabbatotRoutes from './routes/shabbatot.js';
import ordersRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';
import shabbatFileRoutes from './routes/shabbatFile.js';
import volunteersRoutes from './routes/volunteers.js';
import inventoryRoutes from './routes/inventory.js';
import suppliersRoutes from './routes/suppliers.js';
import catalogAdminRoutes from './routes/catalogAdmin.js';
import paymentsRoutes from './routes/payments.js';
import { requireAdmin } from './lib/auth.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

// בדיקת חיים
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'מטבח החסד' }));

// נתיבים
app.use('/api/auth', authRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/shabbatot', shabbatotRoutes);
app.use('/api/orders', ordersRoutes);
// אזור הניהול — כל הקריאות מאחורי אימות מנהל (סעיף 5)
app.use('/api/admin/shabbat-files', requireAdmin, shabbatFileRoutes);
app.use('/api/admin/volunteers', requireAdmin, volunteersRoutes);
app.use('/api/admin/inventory', requireAdmin, inventoryRoutes);
app.use('/api/admin/suppliers', requireAdmin, suppliersRoutes);
app.use('/api/admin/catalog', requireAdmin, catalogAdminRoutes);
app.use('/api/admin/payments', requireAdmin, paymentsRoutes);
app.use('/api/admin', requireAdmin, adminRoutes);

// טיפול שגיאות אחיד (עברית)
app.use((err, req, res, next) => {
  console.error('שגיאת שרת:', err.message);
  res.status(500).json({ error: 'אירעה שגיאה בשרת. נא לנסות שוב.' });
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`\n🍲 שרת מטבח החסד פועל על http://localhost:${PORT}\n`);
});
