import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { DataTable } from '../components/DataTable.jsx';

export default function AdminRegistrations({ onAuthError }) {
  const [searchParams] = useSearchParams();
  const highlightedId = searchParams.get('highlight');
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

  const columns = [
    { key: 'full_name', label: 'שם', type: 'text', className: 'font-medium text-brand-burgundy' },
    { key: 'phone', label: 'טלפון', type: 'text', dir: 'ltr' },
    { key: 'email', label: 'מייל', type: 'text', dir: 'ltr', render: (r) => r.email || '-' },
    { key: 'address', label: 'כתובת', type: 'text', render: (r) => r.address || '-' },
    { key: 'created_at', label: 'נשלח', type: 'date', dir: 'ltr', render: (r) => formatDate(r.created_at) },
  ];

  return (
    <Page title="אישור רישום לקוחות" subtitle="בקשות רישום חדשות שממתינות להפיכתן ללקוחות פעילים">
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <DataTable
          columns={columns}
          rows={requests}
          empty="אין כרגע בקשות רישום ממתינות."
          rowClassName={(request) => (highlightedId === request.id ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : '')}
          actions={(request) => (
            <>
              <ActionIconButton
                icon="approve"
                label={busy === request.id ? 'מאשר...' : 'אישור רישום'}
                tone="success"
                onClick={() => approve(request)}
                disabled={busy === request.id}
              />
              <ActionIconButton
                icon="cancel"
                label="דחיית רישום"
                tone="danger"
                onClick={() => reject(request)}
                disabled={busy === request.id}
              />
            </>
          )}
        />

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
