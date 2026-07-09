import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { Badge, ORDER_STATUS, PAYMENT_STATUS } from '../lib/status.jsx';

// רשימת הזמנות לניהול + פעולות (סעיף 9.3, 11)
export default function AdminOrders({ onAuthError, currentAdmin }) {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const statusFilter = sp.get('status') || '';
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const canDelete = currentAdmin?.role === 'developer';

  // טוקן פג באמצע שימוש — מפנה לכניסת מנהל
  function handleErr(e) {
    if (e.name === 'AdminAuthError') { onAuthError?.(); return true; }
    return false;
  }

  function load() {
    setLoading(true);
    const q = statusFilter ? `?status=${statusFilter}` : '';
    api.adminOrders(q).then(setOrders).catch(handleErr).finally(() => setLoading(false));
  }
  useEffect(load, [statusFilter]);

  async function doAction(fn, id, ...args) {
    setBusy(id);
    try { await fn(id, ...args); load(); }
    catch (e) { if (!handleErr(e)) alert(e.message); }
    finally { setBusy(''); }
  }

  async function markPaid(id) {
    const amount = prompt('סכום ששולם (₪):');
    if (amount == null) return;
    await doAction((oid) => api.updatePayment(oid, { payment_status: 'paid', amount, payment_method: 'bank_transfer' }), id);
  }

  async function deleteOrder(order) {
    if (!confirm(`למחוק לצמיתות את הזמנה ${order.order_number}?`)) return;
    await doAction(api.deleteOrder, order.id);
  }

  const filters = [
    { key: '', label: 'הכל' },
    { key: 'pending_approval', label: 'ממתינות' },
    { key: 'approved', label: 'מאושרות' },
    { key: 'cancelled', label: 'מבוטלות' },
  ];

  return (
    <Page title="ניהול הזמנות">
      <div className="flex gap-2 mb-4 flex-wrap">
        {filters.map((f) => (
          <button key={f.key} onClick={() => setSp(f.key ? { status: f.key } : {})}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              statusFilter === f.key ? 'bg-brand-burgundy text-brand-cream' : 'bg-white border border-brand-cream-dark hover:border-brand-gold'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? <p>טוען...</p> : orders.length === 0 ? (
        <div className="card text-center py-8 text-brand-burgundy/60">אין הזמנות בקטגוריה זו.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
            <thead className="bg-brand-burgundy text-brand-cream text-sm">
              <tr>
                <th className="p-3 text-right">מס׳</th>
                <th className="p-3 text-right">לקוח</th>
                <th className="p-3 text-right">שבת</th>
                <th className="p-3 text-right">סכום</th>
                <th className="p-3 text-right">סטטוס</th>
                <th className="p-3 text-right">תשלום</th>
                <th className="p-3 text-right">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} onClick={() => nav(`/admin/orders/${o.id}`)}
                  className="border-b border-brand-cream-dark hover:bg-brand-cream/30 cursor-pointer">
                  <td className="p-3 font-mono text-sm">{o.order_number}</td>
                  <td className="p-3">
                    <div className="font-medium">{o.customers?.full_name}</div>
                    <div className="text-xs text-brand-burgundy/50">{o.customers?.phone}</div>
                  </td>
                  <td className="p-3 text-sm">{o.shabbatot?.parasha}</td>
                  <td className="p-3 font-bold">{Number(o.final_amount).toFixed(0)}₪</td>
                  <td className="p-3"><Badge map={ORDER_STATUS} value={o.order_status} /></td>
                  <td className="p-3"><Badge map={PAYMENT_STATUS} value={o.payment_status} /></td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1 flex-wrap">
                      {o.order_status === 'pending_approval' && (
                        <button disabled={busy === o.id} onClick={() => doAction(api.approveOrder, o.id)}
                          className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700">אישור</button>
                      )}
                      {o.order_status === 'approved' && o.payment_status !== 'paid' && (
                        <button disabled={busy === o.id} onClick={() => markPaid(o.id)}
                          className="text-xs px-2 py-1 rounded bg-brand-gold-dark text-white hover:opacity-90">סמן שולם</button>
                      )}
                      {o.order_status !== 'cancelled' && (
                        <button disabled={busy === o.id}
                          onClick={() => confirm('לבטל את ההזמנה?') && doAction((id) => api.cancelOrder(id, ''), o.id)}
                          className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700">ביטול</button>
                      )}
                      {canDelete && (
                        <button disabled={busy === o.id}
                          onClick={() => deleteOrder(o)}
                          className="text-xs px-2 py-1 rounded bg-red-700 text-white hover:bg-red-800">מחיקה</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
