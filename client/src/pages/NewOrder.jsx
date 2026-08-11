import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { OrderBuilderForm } from '../components/OrderBuilderForm.jsx';
import { formatGregorianDate, formatShabbatHebrewDate, formatShabbatTitle } from '../lib/dates.js';

export default function NewOrder({ customer }) {
  const nav = useNavigate();
  const [catalog, setCatalog] = useState(null);
  const [shabbatot, setShabbatot] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [shabbatId, setShabbatId] = useState('');

  useEffect(() => {
    Promise.all([api.catalog(), api.openShabbatot()])
      .then(([cat, shab]) => { setCatalog(cat); setShabbatot(shab); })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const selectedShabbat = useMemo(
    () => shabbatot.find((s) => s.id === shabbatId),
    [shabbatId, shabbatot]
  );

  if (loading) return <Page title="הזמנה חדשה"><p>טוען...</p></Page>;

  return (
    <Page title="הזמנה חדשה">
      {loadError && <div className="bg-red-50 text-red-700 rounded-xl p-3 mb-4">{loadError}</div>}

      <section className="card mb-5">
        <h2 className="font-bold text-brand-burgundy mb-3">1. בחירת שבת</h2>
        {shabbatot.length === 0 ? (
          <p className="text-brand-burgundy/60">אין שבתות פתוחות להזמנה כרגע.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {shabbatot.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setShabbatId(s.id)}
                className={`p-3 rounded-xl border text-center transition-colors ${
                  shabbatId === s.id
                    ? 'bg-brand-gold border-brand-gold-dark text-brand-burgundy-dark font-bold'
                    : 'bg-white border-brand-cream-dark hover:border-brand-gold'
                }`}
              >
                <div className="font-bold">{formatShabbatTitle(s)}</div>
                <div className="text-sm font-medium text-brand-gold-dark/90">{formatShabbatHebrewDate(s)}</div>
                <div className="text-xs opacity-70">{formatGregorianDate(s.gregorian_date)}</div>
              </button>
            ))}
          </div>
        )}
      </section>

      {catalog && (
        <OrderBuilderForm
          catalog={catalog}
          shabbatId={shabbatId}
          shabbat={selectedShabbat}
          customer={customer}
          initialContactName={customer?.full_name || ''}
          initialContactPhone={customer?.phone || ''}
          onSubmit={async (payload) => {
            const res = await api.createOrder({
              customer_id: customer.id,
              shabbat_id: shabbatId,
              ...payload,
            });
            nav(`/order/${res.order.id}?created=1`);
          }}
        />
      )}
    </Page>
  );
}
