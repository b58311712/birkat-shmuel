import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconButton, ActionIconLink } from '../components/ActionIcon.jsx';
import { formatGregorianDate, formatShabbatHebrewDate, formatShabbatTitle } from '../lib/dates.js';

const SHABBAT_STATUS = {
  open: { label: 'פתוחה', cls: 'bg-green-100 text-green-800' },
  closed: { label: 'סגורה', cls: 'bg-amber-100 text-amber-800' },
  completed: { label: 'הושלמה', cls: 'bg-blue-100 text-blue-800' },
  cancelled: { label: 'מבוטלת', cls: 'bg-gray-200 text-gray-600' },
};

const SHABBAT_STATUS_OPTIONS = [
  { value: 'open', label: 'פתוחה להזמנות' },
  { value: 'closed', label: 'סגורה להזמנות' },
  { value: 'completed', label: 'הושלמה' },
  { value: 'cancelled', label: 'מבוטלת / המטבח לא פעיל' },
];

export default function ShabbatFiles({ onAuthError, currentAdmin }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState('');
  const [updatingStatusId, setUpdatingStatusId] = useState('');
  const [viewMode, setViewMode] = useState('cards');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('date-desc');
  const canDelete = currentAdmin?.role === 'developer';

  const visibleFiles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('he');
    const filtered = files.filter((file) => {
      const matchesStatus = !statusFilter || file.status === statusFilter;
      const searchableText = [
        formatShabbatTitle(file),
        formatShabbatHebrewDate(file),
        formatGregorianDate(file.gregorian_date),
      ].join(' ').toLocaleLowerCase('he');
      return matchesStatus && (!query || searchableText.includes(query));
    });

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'date-asc':
          return String(a.gregorian_date || '').localeCompare(String(b.gregorian_date || ''));
        case 'parasha-asc':
          return formatShabbatTitle(a).localeCompare(formatShabbatTitle(b), 'he');
        case 'parasha-desc':
          return formatShabbatTitle(b).localeCompare(formatShabbatTitle(a), 'he');
        case 'orders-desc':
          return Number(b.order_count || 0) - Number(a.order_count || 0);
        case 'orders-asc':
          return Number(a.order_count || 0) - Number(b.order_count || 0);
        case 'status':
          return String(a.status || '').localeCompare(String(b.status || ''), 'he');
        case 'date-desc':
        default:
          return String(b.gregorian_date || '').localeCompare(String(a.gregorian_date || ''));
      }
    });
  }, [files, search, sortBy, statusFilter]);

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

  async function updateStatus(file, status) {
    if (status === file.status) return;
    setUpdatingStatusId(file.id);
    try {
      const result = await api.shabbatStatus(file.id, status);
      setFiles((current) => current.map((item) => (
        item.id === file.id ? { ...item, status: result.shabbat.status } : item
      )));
    } catch (e) {
      handleErr(e);
    } finally {
      setUpdatingStatusId('');
    }
  }

  return (
    <Page title="תיקי שבת" subtitle="מסך העבודה המרכזי לכל שבת: כמויות, אריזה, שינוע">
      <div className="card mb-4 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_180px_220px_auto] gap-3 items-end">
          <label className="block">
            <span className="block text-xs font-bold text-brand-burgundy/60 mb-1">חיפוש</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי פרשה או תאריך..."
              className="input w-full"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-brand-burgundy/60 mb-1">סטטוס</span>
            <select className="input w-full" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">כל הסטטוסים</option>
              {SHABBAT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-brand-burgundy/60 mb-1">מיון</span>
            <select className="input w-full" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="date-desc">תאריך — מהחדש לישן</option>
              <option value="date-asc">תאריך — מהישן לחדש</option>
              <option value="parasha-asc">פרשה — א׳ עד ת׳</option>
              <option value="parasha-desc">פרשה — ת׳ עד א׳</option>
              <option value="orders-desc">הזמנות — מהגבוה לנמוך</option>
              <option value="orders-asc">הזמנות — מהנמוך לגבוה</option>
              <option value="status">סטטוס</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => { setSearch(''); setStatusFilter(''); setSortBy('date-desc'); }}
            disabled={!search && !statusFilter && sortBy === 'date-desc'}
            className="btn-secondary whitespace-nowrap disabled:opacity-50"
          >
            ניקוי פילטרים
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="text-sm text-brand-burgundy/60">
          {loading ? '' : `מוצגים ${visibleFiles.length} מתוך ${files.length} תיקים`}
        </span>
        <div className="inline-flex rounded-xl border border-brand-cream-dark bg-white p-1 shadow-sm" role="group" aria-label="בחירת תצוגה">
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            aria-pressed={viewMode === 'cards'}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'cards' ? 'bg-brand-burgundy text-brand-cream' : 'text-brand-burgundy hover:bg-brand-cream/60'
            }`}
          >
            כרטיסים
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            aria-pressed={viewMode === 'table'}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'table' ? 'bg-brand-burgundy text-brand-cream' : 'text-brand-burgundy hover:bg-brand-cream/60'
            }`}
          >
            טבלה
          </button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-cream-dark bg-white px-5 py-4 text-brand-burgundy/70 shadow-card">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand-gold" />
          <span className="font-medium">טוען תיקי שבת…</span>
        </div>
      ) : files.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-cream-dark bg-white/60 px-6 py-12 text-center text-brand-burgundy/60">אין שבתות במערכת.</div>
      ) : visibleFiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-cream-dark bg-white/60 px-6 py-12 text-center text-brand-burgundy/60">לא נמצאו תיקי שבת התואמים לחיפוש ולפילטרים.</div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleFiles.map((f) => {
            const st = SHABBAT_STATUS[f.status] || { label: f.status, cls: 'bg-gray-100' };
            return (
              <div key={f.id} className="card card-hover flex flex-col">
                <Link
                  to={`/admin/shabbat/${f.id}`}
                  className="group block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="text-lg font-bold text-brand-burgundy transition-colors group-hover:text-brand-burgundy-dark">{formatShabbatTitle(f)}</div>
                    <span className={`badge shrink-0 ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="text-sm font-medium text-brand-gold-dark/90">{formatShabbatHebrewDate(f)}</div>
                  <div className="text-sm text-brand-burgundy/50">{formatGregorianDate(f.gregorian_date)}</div>
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-cream/70 px-3 py-1 text-sm ring-1 ring-brand-cream-dark">
                    <span className="font-extrabold text-brand-gold-dark tabular-nums">{f.order_count}</span>
                    <span className="text-brand-burgundy/60">הזמנות</span>
                  </div>
                </Link>
                <div className="mt-4 pt-3 border-t border-brand-cream-dark">
                  <label className="block text-xs font-bold text-brand-burgundy/60 mb-1">סטטוס שבת</label>
                  <select
                    value={f.status}
                    disabled={updatingStatusId === f.id}
                    onChange={(e) => updateStatus(f, e.target.value)}
                    className="w-full rounded-lg border border-brand-cream-dark bg-white px-3 py-2 text-sm text-brand-burgundy outline-none focus:border-brand-gold disabled:opacity-60"
                  >
                    {SHABBAT_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                {canDelete && (
                  <div className="mt-4 pt-3 border-t border-brand-cream-dark">
                    <ActionIconButton
                      icon="delete"
                      label={deletingId === f.id ? 'מוחק...' : 'מחיקה'}
                      tone="danger"
                      disabled={deletingId === f.id}
                      onClick={() => deleteShabbat(f)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-brand-cream-dark shadow-card">
          <table className="w-full overflow-hidden rounded-2xl bg-white">
            <thead className="bg-brand-burgundy text-sm">
              <tr>
                <th className="p-3 text-right">פרשת השבוע</th>
                <th className="p-3 text-right">תאריך עברי</th>
                <th className="p-3 text-right">תאריך לועזי</th>
                <th className="p-3 text-right">הזמנות</th>
                <th className="p-3 text-right">סטטוס</th>
                <th className="p-3 text-right">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {visibleFiles.map((f) => {
                const st = SHABBAT_STATUS[f.status] || { label: f.status, cls: 'bg-gray-100' };
                return (
                  <tr key={f.id} className="hover:bg-brand-cream/40">
                    <td className="p-3 font-bold text-brand-burgundy">
                      <Link to={`/admin/shabbat/${f.id}`} className="rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold">
                        {formatShabbatTitle(f)}
                      </Link>
                    </td>
                    <td className="p-3 text-sm font-medium text-brand-gold-dark">{formatShabbatHebrewDate(f)}</td>
                    <td className="p-3 text-sm text-brand-burgundy/60">{formatGregorianDate(f.gregorian_date)}</td>
                    <td className="p-3 font-bold text-brand-gold-dark tabular-nums">{f.order_count}</td>
                    <td className="p-3 min-w-48">
                      <div className="flex items-center gap-2">
                        <span className={`badge shrink-0 ${st.cls}`}>{st.label}</span>
                        <select
                          value={f.status}
                          disabled={updatingStatusId === f.id}
                          onChange={(e) => updateStatus(f, e.target.value)}
                          aria-label={`שינוי סטטוס עבור ${formatShabbatTitle(f)}`}
                          className="min-w-36 rounded-lg border border-brand-cream-dark bg-white px-2 py-1.5 text-sm text-brand-burgundy outline-none focus:border-brand-gold disabled:opacity-60"
                        >
                          {SHABBAT_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <ActionIconLink
                          as={Link}
                          icon="open"
                          label="פתיחת תיק"
                          to={`/admin/shabbat/${f.id}`}
                        />
                        {canDelete && (
                          <ActionIconButton
                            icon="delete"
                            label={deletingId === f.id ? 'מוחק...' : 'מחיקה'}
                            tone="danger"
                            disabled={deletingId === f.id}
                            onClick={() => deleteShabbat(f)}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
