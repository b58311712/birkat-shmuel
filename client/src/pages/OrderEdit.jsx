import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { OrderBuilderForm } from '../components/OrderBuilderForm.jsx';
import { formatGregorianDate, formatShabbatTitle } from '../lib/dates.js';

// עריכה עצמית של הזמנה קיימת, מוגנת בקוד עריכה בן 6 ספרות (עד שבועיים לפני
// מועד השבת). אם הגענו מכפתור "ערוך הזמנה" ב-OrderView, הקוד וההזמנה כבר
// אומתו ומועברים ב-location.state - לא נדרשת הקלדה חוזרת. גישה ישירה לכתובת
// (רענון/קישור) מציגה קודם טופס הזנת קוד.
export default function OrderEdit() {
  const { id } = useParams();
  const location = useLocation();
  const nav = useNavigate();

  const [order, setOrder] = useState(location.state?.order || null);
  const [code, setCode] = useState(location.state?.code || '');
  const [codeInput, setCodeInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  const [catalog, setCatalog] = useState(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState('');

  useEffect(() => {
    if (!order) return;
    setLoadingCatalog(true);
    api.catalog()
      .then(setCatalog)
      .catch((e) => setCatalogError(e.message))
      .finally(() => setLoadingCatalog(false));
  }, [order]);

  async function verifyCode(e) {
    e.preventDefault();
    setVerifying(true);
    setVerifyError('');
    try {
      const data = await api.verifyOrderEditCode(id, codeInput.trim());
      setOrder(data);
      setCode(codeInput.trim());
    } catch (err) {
      setVerifyError(err.message);
    } finally {
      setVerifying(false);
    }
  }

  if (!order) {
    return (
      <Page title="עריכת הזמנה">
        <div className="card max-w-sm mx-auto">
          <h2 className="font-bold text-brand-burgundy mb-2">קוד עריכה</h2>
          <p className="text-sm text-brand-burgundy/60 mb-4">
            נא להזין את קוד העריכה בן 6 הספרות שנשלח במייל בעת יצירת ההזמנה.
          </p>
          {verifyError && <div className="bg-red-50 text-red-700 rounded-xl p-3 mb-4">{verifyError}</div>}
          <form onSubmit={verifyCode} className="space-y-3">
            <input
              className="input w-full text-center text-2xl tracking-[0.5em]"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoFocus
            />
            <button type="submit" className="btn-primary w-full" disabled={verifying || codeInput.length !== 6}>
              {verifying ? 'בודק...' : 'המשך לעריכה'}
            </button>
          </form>
          <div className="mt-4 text-center">
            <Link to={`/order/${id}`} className="btn-ghost">← חזרה להזמנה</Link>
          </div>
        </div>
      </Page>
    );
  }

  if (loadingCatalog || !catalog) {
    return (
      <Page title="עריכת הזמנה">
        {catalogError ? <div className="bg-red-50 text-red-700 rounded-xl p-3">{catalogError}</div> : <p>טוען...</p>}
      </Page>
    );
  }

  const initialSlots = Object.fromEntries((order.slots || []).map((s) => [s.meal_slot_id, String(s.portions)]));
  const initialExtras = Object.fromEntries((order.extras || []).map((e) => [e.extra_id, String(e.actual_quantity)]));
  const initialMeals = Object.fromEntries((order.meals || []).map((m) => {
    const meal = catalog.meals.find((cm) => cm.id === m.meal_id);
    const category = catalog.categories.find((c) => c.id === meal?.category_id);
    const mode = category?.split_mode || (category?.requires_portion_split ? 'equal' : 'none');
    const value = mode === 'equal' ? Number(m.portions) : true;
    return [`${m.meal_slot_id}:${m.meal_id}`, value];
  }));

  return (
    <Page title="עריכת הזמנה">
      <section className="card mb-5">
        <h2 className="font-bold text-brand-burgundy mb-1">עריכת הזמנה {order.order_number}</h2>
        <p className="text-sm text-brand-burgundy/60">
          {formatShabbatTitle(order.shabbatot)} · {formatGregorianDate(order.shabbatot?.gregorian_date)}
        </p>
        <p className="text-xs text-brand-burgundy/45 mt-1">לא ניתן לשנות את מועד ההזמנה - לשינוי מועד יש לפנות למשרד.</p>
      </section>

      <OrderBuilderForm
        catalog={catalog}
        shabbatId={order.shabbat_id}
        shabbat={order.shabbatot}
        customer={{ full_name: order.customers?.full_name }}
        initialSlots={initialSlots}
        initialMeals={initialMeals}
        initialExtras={initialExtras}
        initialContactName={order.contact_name || ''}
        initialContactPhone={order.contact_phone || ''}
        initialVenueName={order.venue_name || ''}
        initialVenueAddress={order.venue_address || ''}
        initialNotes={order.notes || ''}
        initialPayMethod={order.preferred_payment_method || ''}
        submitLabel="הצגת השינויים לפני שמירה"
        confirmLabel="שמירת השינויים"
        confirmingLabel="שומר..."
        onSubmit={async (payload) => {
          await api.editOrder(id, { code, ...payload });
          nav(`/order/${id}`);
        }}
      />
    </Page>
  );
}
