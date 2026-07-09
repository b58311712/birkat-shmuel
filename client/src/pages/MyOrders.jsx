import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { Badge, ORDER_STATUS, PAYMENT_STATUS } from '../lib/status.jsx';

// היסטוריית ההזמנות של הלקוח (סעיף 5.4)
export default function MyOrders({ customer }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.customerOrders(customer.id).then(setOrders).finally(() => setLoading(false));
  }, [customer.id]);

  if (loading) return <Page title="ההזמנות שלי"><p>טוען...</p></Page>;

  return (
    <Page title="ההזמנות שלי">
      {orders.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-brand-burgundy/60 mb-4">עדיין אין לך הזמנות.</p>
          <Link to="/new-order" className="btn-primary inline-block">יצירת הזמנה חדשה</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Link to={`/order/${o.id}`} key={o.id}
              className="card flex items-center justify-between gap-4 hover:shadow-card-hover transition-shadow">
              <div>
                <div className="font-bold text-brand-burgundy">הזמנה {o.order_number}</div>
                <div className="text-sm text-brand-burgundy/60">
                  {o.shabbatot?.parasha} · {o.shabbatot?.gregorian_date}
                </div>
              </div>
              <div className="text-left">
                <div className="font-extrabold text-brand-burgundy mb-1">{Number(o.final_amount).toFixed(0)} ₪</div>
                <div className="flex gap-1">
                  <Badge map={ORDER_STATUS} value={o.order_status} />
                  <Badge map={PAYMENT_STATUS} value={o.payment_status} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
