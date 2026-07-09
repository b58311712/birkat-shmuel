import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';

// דשבורד ניהולי — דברים הדורשים טיפול (סעיף 30)
export default function AdminDashboard({ onAuthError }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.adminDashboard().then(setStats).catch((err) => {
      if (err.name === 'AdminAuthError') onAuthError?.();
    });
  }, [onAuthError]);

  const cards = [
    { key: 'pending_orders', label: 'הזמנות ממתינות לאישור', to: '/admin/orders?status=pending_approval', color: 'bg-amber-500' },
    { key: 'unpaid_approved', label: 'מאושרות שלא שולמו', to: '/admin/orders?status=approved', color: 'bg-red-500' },
    { key: 'pending_registrations', label: 'בקשות רישום ממתינות', to: '/admin/registrations', color: 'bg-brand-gold-dark' },
  ];

  return (
    <Page title="דשבורד ניהולי" subtitle="סקירה מהירה של הדברים הדורשים טיפול">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Link to={c.to} key={c.key} className="card hover:shadow-card-hover transition-shadow">
            <div className={`${c.color} w-12 h-12 rounded-xl flex items-center justify-center text-white text-2xl font-extrabold mb-3`}>
              {stats ? (stats[c.key] ?? 0) : '…'}
            </div>
            <div className="font-medium text-brand-burgundy">{c.label}</div>
          </Link>
        ))}
      </div>

      <div className="card mt-5">
        <h2 className="font-bold text-brand-burgundy mb-2">פעולות מהירות</h2>
        <div className="flex gap-2 flex-wrap">
          <Link to="/admin/orders" className="btn-secondary">כל ההזמנות</Link>
          <Link to="/admin/orders?status=pending_approval" className="btn-primary">אישור הזמנות ממתינות</Link>
          <Link to="/admin/registrations" className="btn-secondary">אישור רישום לקוחות</Link>
        </div>
      </div>
    </Page>
  );
}
