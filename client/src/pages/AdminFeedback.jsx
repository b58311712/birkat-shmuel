import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';

const STATUS = {
  pending: ['טרם נשלח', 'bg-gray-100 text-gray-700'],
  sent: ['נשלח', 'bg-blue-100 text-blue-800'],
  completed: ['מולא', 'bg-green-100 text-green-800'],
  failed: ['נכשל', 'bg-red-100 text-red-700'],
  no_email: ['אין מייל', 'bg-amber-100 text-amber-800'],
};

export default function AdminFeedback({ onAuthError }) {
  const [rows, setRows] = useState([]);
  const [shabbatot, setShabbatot] = useState([]);
  const [filters, setFilters] = useState({ shabbat_id: '', status: '', rating: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.allShabbatot().then(setShabbatot).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    setLoading(true);
    api.adminFeedback(params.size ? `?${params}` : '')
      .then((data) => setRows(data.rows || []))
      .catch((err) => {
        if (err.name === 'AdminAuthError') onAuthError?.();
        else setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [filters, onAuthError]);

  return (
    <Page title="משובי לקוחות" subtitle="מעקב אחר בקשות המשוב והתשובות שהתקבלו לאחר השבת.">
      <section className="card mb-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Filter label="שבת" value={filters.shabbat_id} onChange={(value) => setFilters((f) => ({ ...f, shabbat_id: value }))}>
            <option value="">כל השבתות</option>
            {shabbatot.map((s) => <option key={s.id} value={s.id}>{s.parasha} · {s.gregorian_date}</option>)}
          </Filter>
          <Filter label="סטטוס" value={filters.status} onChange={(value) => setFilters((f) => ({ ...f, status: value }))}>
            <option value="">כל הסטטוסים</option>
            {Object.entries(STATUS).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}
          </Filter>
          <Filter label="ציון כללי" value={filters.rating} onChange={(value) => setFilters((f) => ({ ...f, rating: value }))}>
            <option value="">כל הציונים</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} מתוך 5</option>)}
          </Filter>
        </div>
      </section>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}
      {loading ? <p>טוען משובים...</p> : rows.length === 0 ? (
        <div className="card py-10 text-center text-brand-burgundy/60">לא נמצאו משובים התואמים לסינון.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => <FeedbackRow key={row.id} row={row} />)}
        </div>
      )}
    </Page>
  );
}

function Filter({ label, value, onChange, children }) {
  return (
    <label>
      <span className="mb-1 block text-xs font-bold text-brand-burgundy/70">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  );
}

function FeedbackRow({ row }) {
  const [statusLabel, statusClass] = STATUS[row.feedback_status] || STATUS.pending;
  const feedback = row.feedback;
  const low = Number(feedback?.overall_rating) <= 2;
  return (
    <article className={`card ${low ? 'border-red-300 bg-red-50/30' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/admin/orders/${row.id}`} className="font-extrabold text-brand-burgundy hover:underline">
            הזמנה {row.order_number} · {row.customers?.full_name || 'לקוח'}
          </Link>
          <div className="mt-1 text-sm text-brand-burgundy/60">
            פרשת {row.shabbatot?.parasha} · {row.shabbatot?.gregorian_date}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {low && <span className="badge bg-red-100 text-red-800">דורש טיפול</span>}
          <span className={`badge ${statusClass}`}>{statusLabel}</span>
        </div>
      </div>

      {feedback?.completed_at && (
        <div className="mt-4 border-t border-brand-cream-dark pt-4">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Score label="כללי" value={feedback.overall_rating} />
            <Score label="אוכל" value={feedback.food_rating} />
            <Score label="כמויות" value={feedback.quantity_rating} />
            <Score label="אריזה ואספקה" value={feedback.delivery_rating} />
          </div>
          {feedback.comment && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-brand-burgundy">{feedback.comment}</p>}
          <p className="mt-2 text-xs text-brand-burgundy/50">מולא ב־{new Date(feedback.completed_at).toLocaleString('he-IL')}</p>
        </div>
      )}
      {row.feedback_status === 'failed' && <p className="mt-3 text-sm text-red-700">השליחה נכשלה ותנוסה שוב בהרצה הבאה.</p>}
    </article>
  );
}

function Score({ label, value }) {
  return <div className="rounded-lg bg-brand-cream/50 p-2"><span className="text-brand-burgundy/60">{label}</span><strong className="mr-2 text-brand-burgundy">{value}/5</strong></div>;
}
