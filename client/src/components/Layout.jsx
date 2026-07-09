import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const adminMenuGroups = [
  {
    id: 'community',
    label: 'קהילה',
    items: [
      { to: '/admin/customers', label: 'לקוחות' },
      { to: '/admin/registrations', label: 'בקשות רישום' },
      { to: '/admin/volunteers', label: 'מתנדבים' },
    ],
  },
  {
    id: 'orders',
    label: 'הזמנות ושבת',
    items: [
      { to: '/admin/orders', label: 'הזמנות' },
      { to: '/admin/shabbat', label: 'תיקי שבת' },
    ],
  },
  {
    id: 'operations',
    label: 'תפעול ורכש',
    items: [
      { to: '/admin/catalog', label: 'מאכלים וקטגוריות' },
      { to: '/admin/inventory', label: 'מלאי' },
      { to: '/admin/suppliers', label: 'ספקים' },
      { to: '/admin/purchase-orders', label: 'רכש' },
    ],
  },
  {
    id: 'system',
    label: 'מערכת',
    items: [
      { to: '/admin/users', label: 'משתמשים' },
    ],
  },
];

// כותרת עליונה עם לוגו וניווט
export function Header({ customer, onLogout, admin, onAdminLogout }) {
  const loc = useLocation();
  const isAdmin = loc.pathname.startsWith('/admin');
  const [openMenu, setOpenMenu] = useState(null);
  const navRef = useRef(null);

  useEffect(() => {
    setOpenMenu(null);
  }, [loc.pathname]);

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setOpenMenu(null);
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  return (
    <header className="bg-brand-burgundy text-brand-cream shadow-lg">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        <Link to={isAdmin ? '/admin' : '/'} className="flex items-center gap-3 shrink-0">
          <img src="/logo.png" alt="מטבח החסד" className="h-14 w-14 object-contain" />
          <div>
            <div className="text-xl font-extrabold leading-tight">מטבח החסד</div>
            <div className="text-sm text-brand-gold-light">ברכת שמואל</div>
          </div>
        </Link>

        <nav ref={navRef} className="flex flex-wrap items-center justify-end gap-1">
          {isAdmin ? (
            <>
              {admin && <span className="text-brand-cream/80 text-sm px-2">{admin.full_name}</span>}
              <NavLink to="/admin" label="דשבורד" exact />
              {adminMenuGroups.map((group) => (
                <NavMenu
                  key={group.id}
                  label={group.label}
                  items={group.items}
                  open={openMenu === group.id}
                  onToggle={() => setOpenMenu(openMenu === group.id ? null : group.id)}
                  onClose={() => setOpenMenu(null)}
                />
              ))}
              {onAdminLogout && (
                <button onClick={onAdminLogout} className="btn-ghost text-brand-cream hover:bg-brand-burgundy-light">יציאה</button>
              )}
            </>
          ) : customer ? (
            <>
              <span className="text-brand-cream/80 text-sm px-2">שלום, {customer.full_name}</span>
              <NavLink to="/new-order" label="הזמנה חדשה" />
              <NavLink to="/my-orders" label="ההזמנות שלי" />
              <button onClick={onLogout} className="btn-ghost text-brand-cream hover:bg-brand-burgundy-light">יציאה</button>
            </>
          ) : (
            <NavLink to="/admin" label="כניסת מנהל" />
          )}
        </nav>
      </div>
    </header>
  );
}

function NavLink({ to, label, exact = false, onClick }) {
  const loc = useLocation();
  const active = isRouteActive(loc.pathname, to, exact);

  return (
    <Link
      to={to}
      onClick={onClick}
      className={`px-3 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
        active ? 'bg-brand-gold text-brand-burgundy-dark' : 'text-brand-cream hover:bg-brand-burgundy-light'
      }`}
    >
      {label}
    </Link>
  );
}

function NavMenu({ label, items, open, onToggle, onClose }) {
  const loc = useLocation();
  const active = items.some((item) => isRouteActive(loc.pathname, item.to));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`px-3 py-2 rounded-lg font-medium transition-colors whitespace-nowrap inline-flex items-center gap-1 ${
          active || open ? 'bg-brand-gold text-brand-burgundy-dark' : 'text-brand-cream hover:bg-brand-burgundy-light'
        }`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className={`text-xs leading-none transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 min-w-44 rounded-lg border border-brand-cream-dark bg-white py-2 text-brand-burgundy-dark shadow-card">
          {items.map((item) => {
            const itemActive = isRouteActive(loc.pathname, item.to);

            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={`block px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  itemActive ? 'bg-brand-cream-dark text-brand-burgundy-dark' : 'hover:bg-brand-cream'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isRouteActive(pathname, to, exact = false) {
  if (exact) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function Page({ title, children, subtitle }) {
  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      {title && (
        <div className="mb-5">
          <h1 className="text-2xl font-extrabold text-brand-burgundy">{title}</h1>
          {subtitle && <p className="text-brand-burgundy/70 mt-1">{subtitle}</p>}
        </div>
      )}
      {children}
    </main>
  );
}
