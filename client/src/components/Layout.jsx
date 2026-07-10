import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';

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
      { to: '/admin/finance', label: 'מודול כספי' },
      { to: '/admin/users', label: 'משתמשים' },
    ],
  },
];

// כותרת עליונה עם לוגו וניווט
export function Header({ customer, onLogout, admin, onAdminLogout }) {
  const loc = useLocation();
  const isAdmin = loc.pathname.startsWith('/admin');
  const [openMenu, setOpenMenu] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const navRef = useRef(null);

  useEffect(() => {
    setOpenMenu(null);
    setNotificationsOpen(false);
    setAccountOpen(false);
  }, [loc.pathname, loc.search]);

  useEffect(() => {
    if (!isAdmin || !admin) {
      setNotifications(null);
      return undefined;
    }

    let cancelled = false;
    let timer;

    function loadNotifications() {
      api.adminNotifications()
        .then((data) => {
          if (!cancelled) setNotifications(data);
        })
        .catch((err) => {
          if (err.name === 'AdminAuthError') onAdminLogout?.();
        });
    }

    loadNotifications();
    timer = window.setInterval(loadNotifications, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [admin, isAdmin, loc.pathname, loc.search, onAdminLogout]);

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setOpenMenu(null);
        setNotificationsOpen(false);
        setAccountOpen(false);
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  return (
    <header className="bg-brand-burgundy text-brand-cream shadow-lg">
      <div ref={navRef} className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        <Link to={isAdmin ? '/admin' : '/'} className="flex items-center gap-3 shrink-0">
          <img src="/logo.png" alt="מטבח החסד" className="h-14 w-14 object-contain" />
          <div>
            <div className="text-xl font-extrabold leading-tight">מטבח החסד</div>
            <div className="text-sm text-brand-gold-light">ברכת שמואל</div>
          </div>
        </Link>

        <nav className="flex flex-wrap items-center justify-end gap-1">
          {isAdmin ? (
            <>
              {admin && (
                <div className="order-[21] flex items-center gap-2 border-r border-brand-cream/20 pr-3 mr-2">
                  <AdminAccountMenu
                    admin={admin}
                    open={accountOpen}
                    onToggle={() => {
                      setAccountOpen((value) => !value);
                      setOpenMenu(null);
                      setNotificationsOpen(false);
                    }}
                    onLogout={onAdminLogout}
                  />
                </div>
              )}
              <AdminNotificationsBell
                className="order-[20]"
                notifications={notifications}
                open={notificationsOpen}
                onRead={(id) => {
                  setNotifications((current) => {
                    if (!current?.items) return current;
                    const items = current.items.filter((item) => item.id !== id);
                    return { ...current, total: items.length, items };
                  });
                }}
                onToggle={() => {
                  setNotificationsOpen((value) => !value);
                  setOpenMenu(null);
                  setAccountOpen(false);
                }}
                onClose={() => setNotificationsOpen(false)}
              />
              <NavLink to="/admin" label="דשבורד" exact />
              {adminMenuGroups.map((group) => (
                <NavMenu
                  key={group.id}
                  label={group.label}
                  items={group.items}
                  open={openMenu === group.id}
                  onToggle={() => {
                    setOpenMenu(openMenu === group.id ? null : group.id);
                    setNotificationsOpen(false);
                    setAccountOpen(false);
                  }}
                  onClose={() => setOpenMenu(null)}
                />
              ))}
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

function AdminAccountMenu({ admin, open, onToggle, onLogout }) {
  const displayName = admin.full_name || admin.email || 'מנהל';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`h-10 rounded-lg px-3 transition-colors inline-flex items-center gap-2 ${
          open ? 'bg-brand-gold text-brand-burgundy-dark' : 'text-brand-cream hover:bg-brand-burgundy-light'
        }`}
      >
        <span className="h-7 w-7 rounded-full bg-brand-cream/15 flex items-center justify-center">
          <UserIcon />
        </span>
        <span className="max-w-32 truncate text-sm font-semibold">{displayName}</span>
        <span aria-hidden="true" className={`text-xs leading-none transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 min-w-48 rounded-lg border border-brand-cream-dark bg-white py-2 text-brand-burgundy-dark shadow-card">
          <div className="px-4 pb-2 pt-1 border-b border-brand-cream-dark">
            <div className="text-sm font-bold truncate">{displayName}</div>
            {admin.role && <div className="text-xs text-brand-burgundy/55">{admin.role}</div>}
          </div>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="w-full px-4 py-2 text-right text-sm font-medium transition-colors hover:bg-brand-cream"
            >
              יציאה
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AdminNotificationsBell({ notifications, open, onToggle, onClose, onRead, className = '' }) {
  const items = notifications?.items || [];
  const total = notifications?.total ?? items.length;
  const hasNotifications = total > 0;

  function openNotification(item) {
    onRead?.(item.id);
    api.markNotificationRead(item.id).catch(() => {});
    onClose();
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-label="התראות"
        aria-expanded={open}
        className={`relative h-10 w-10 rounded-lg transition-colors flex items-center justify-center ${
          open ? 'bg-brand-gold text-brand-burgundy-dark' : 'text-brand-cream hover:bg-brand-burgundy-light'
        }`}
      >
        <BellIcon />
        {hasNotifications && (
          <span className="absolute -left-1 -top-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-extrabold leading-5 ring-2 ring-brand-burgundy text-center">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-brand-cream-dark bg-white py-2 text-brand-burgundy-dark shadow-card">
          <div className="px-4 pb-2 pt-1 border-b border-brand-cream-dark">
            <div className="font-bold">התראות</div>
            <div className="text-xs text-brand-burgundy/60">
              {hasNotifications ? `${total} פריטים ממתינים לטיפול` : 'אין כרגע התראות חדשות'}
            </div>
          </div>

          <div className="py-1">
            {items.length === 0 ? (
              <div className="px-4 py-5 text-sm text-brand-burgundy/60 text-center">
                אין התראות חדשות.
              </div>
            ) : items.map((item) => (
              <Link
                key={item.id}
                to={item.link_path}
                onClick={() => openNotification(item)}
                className="block px-4 py-3 text-sm transition-colors hover:bg-brand-cream"
              >
                <div className="font-bold leading-snug">{item.title}</div>
                {item.body && <div className="text-xs text-brand-burgundy/65 mt-0.5">{item.body}</div>}
                <div className="text-[11px] text-brand-burgundy/45 mt-1" dir="ltr">{formatNotificationTime(item.created_at)}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatNotificationTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d="M15 17H9" />
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
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
