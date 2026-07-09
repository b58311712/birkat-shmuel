import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { formatGregorianDate, formatShabbatHebrewDate, formatShabbatTitle } from '../lib/dates.js';

const SHABBAT_STATUS = {
  open: { label: 'פתוחה', cls: 'bg-green-100 text-green-800' },
  closed: { label: 'סגורה', cls: 'bg-amber-100 text-amber-800' },
  completed: { label: 'הושלמה', cls: 'bg-blue-100 text-blue-800' },
  cancelled: { label: 'מבוטלת', cls: 'bg-gray-200 text-gray-600' },
};

export default function ShabbatFiles({ onAuthError, currentAdmin }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState('');
  const canDelete = currentAdmin?.role === 'developer';

  function handleErr(e) {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }

  function load() {
    setLoading(true);
    return api.shabbatFiles()
      .then(setFiles)
      .catch(handleErr)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [onAuthError]);

  async function deleteShabbat(file) {
    const ok = confirm(`למחוק את תיק השבת "${file.parasha}"? הפעולה תמחק גם את ההזמנות והשיבוצים של השבת הזו.`);
    if (!ok) return;

    setDeletingId(file.id);
    try {
      await api.deleteShabbat(file.id);
      await load();
    } catch (e) {
      handleErr(e);
    } finally {
      setDeletingId('');
    }
  }

  return (
    <Page title="תיקי שבת" subtitle="מסך העבודה המרכזי לכל שבת: כמויות, אריזה, שינוע">
      {loading ? <p>טוען...</p> : files.length === 0 ? (
        <div className="card text-center py-8 text-brand-burgundy/60">אין שבתות במערכת.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.map((f) => {
            const st = SHABBAT_STATUS[f.status] || { label: f.status, cls: 'bg-gray-100' };
            return (
              <div key={f.id} className="card hover:shadow-card-hover transition-shadow">
                <Link to={`/admin/shabbat/${f.id}`} className="block">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="font-bold text-brand-burgundy text-lg">{formatShabbatTitle(f)}</div>
                    <span className={`badge ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="text-sm font-medium text-brand-gold-dark/90">{formatShabbatHebrewDate(f)}</div>
                  <div className="text-sm text-brand-burgundy/50">{formatGregorianDate(f.gregorian_date)}</div>
                  <div className="mt-3 text-sm">
                    <span className="font-bold text-brand-gold-dark">{f.order_count}</span>
                    <span className="text-brand-burgundy/60"> הזמנות</span>
                  </div>
                </Link>
                {canDelete && (
                  <div className="mt-4 pt-3 border-t border-brand-cream-dark">
                    <button
                      type="button"
                      disabled={deletingId === f.id}
                      onClick={() => deleteShabbat(f)}
                      className="text-sm text-red-700 hover:underline disabled:opacity-50"
                    >
                      {deletingId === f.id ? 'מוחק...' : 'מחיקה'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}
