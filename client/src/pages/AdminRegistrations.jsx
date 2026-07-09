import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';

export default function AdminRegistrations({ onAuthError }) {
  const [requests, setRequests] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const handleErr = useCallback((err) => {
    if (err.name === 'AdminAuthError') onAuthError?.();
    else setError(err.message);
  }, [onAuthError]);

  const load = useCallback(() => {
    setError('');
    api.registrations().then(setRequests).catch(handleErr);
  }, [handleErr]);

  useEffect(() => { load(); }, [load]);

  async function approve(request) {
    setBusy(request.id);
    setError('');
    try {
      await api.approveRegistration(request.id);
      setRequests((list) => (list || []).filter((item) => item.id !== request.id));
    } catch (err) {
      handleErr(err);
    } finally {
      setBusy('');
    }
  }

  async function reject(request) {
    const reason = window.prompt(`סיבת דחיית הרישום עבור ${request.full_name}:`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError('חובה להזין סיבת דחייה.');
      return;
    }

    setBusy(request.id);
    setError('');
    try {
      await api.rejectRegistration(request.id, reason.trim());
      setRequests((list) => (list || []).filter((item) => item.id !== request.id));
    } catch (err) {
      handleErr(err);
    } finally {
      setBusy('');
    }
  }

  return (
    <Page title="אישור רישום לקוחות" subtitle="בקשות רישום חדשות שממתינות להפיכתן ללקוחות פעילים">
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
            <thead className="bg-brand-burgundy text-brand-cream text-sm">
              <tr>
                <th className="p-3 text-right">שם</th>
                <th className="p-3 text-right">טלפון</th>
                <th className="p-3 text-right">מייל</th>
                <th className="p-3 text-right">כתובת</th>
                <th className="p-3 text-right">נשלח</th>
                <th className="p-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {!requests ? (
                <tr><td colSpan={6} className="p-6 text-center text-brand-burgundy/50">טוען...</td></tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-brand-burgundy/60">
                    אין כרגע בקשות רישום ממתינות.
                  </td>
                </tr>
              ) : requests.map((request) => (
                <tr key={request.id} className="border-b border-brand-cream-dark hover:bg-brand-cream/30">
                  <td className="p-3 font-medium text-brand-burgundy">{request.full_name}</td>
                  <td className="p-3 text-sm" dir="ltr">{request.phone}</td>
                  <td className="p-3 text-sm" dir="ltr">{request.email || '-'}</td>
                  <td className="p-3 text-sm">{request.address || '-'}</td>
                  <td className="p-3 text-sm" dir="ltr">{formatDate(request.created_at)}</td>
                  <td className="p-3 text-sm whitespace-nowrap">
                    <button
                      onClick={() => approve(request)}
                      disabled={busy === request.id}
                      className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
                    >
                      {busy === request.id ? 'מאשר...' : 'אישור רישום'}
                    </button>
                    <button
                      onClick={() => reject(request)}
                      disabled={busy === request.id}
                      className="mr-2 text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      דחיית רישום
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost">רענון</button>
          <Link to="/admin/customers?status=active" className="btn-secondary">לקוחות פעילים</Link>
        </div>
      </div>
    </Page>
  );
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
