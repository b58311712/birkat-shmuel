import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { AdminAccountMenu, AdminNotificationsBell, adminMenuGroups } from './Layout.jsx';
import CommandPalette from './CommandPalette.jsx';

export default function AdminDashboardShell({ admin, onAdminLogout, children }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifications, setNotifications] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const controlsRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let timer;

    function loadNotifications() {
      api.adminNotifications()
        .then((result) => { if (!cancelled) setNotifications(result); })
        .catch((err) => { if (err.name === 'AdminAuthError') onAdminLogout?.(); });
    }

    loadNotifications();
    timer = window.setInterval(loadNotifications, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onAdminLogout]);

  useEffect(() => {
    let cancelled = false;
    api.adminDashboard()
      .then((result) => { if (!cancelled) setDashboard(result); })
      .catch((err) => { if (err.name === 'AdminAuthError') onAdminLogout?.(); });
    return () => { cancelled = true; };
  }, [onAdminLogout]);

  useEffect(() => {
    function closeMenus(event) {
      if (controlsRef.current && !controlsRef.current.contains(event.target)) {
        setNotificationsOpen(false);
        setAccountOpen(false);
      }
    }
    document.addEventListener('mousedown', closeMenus);
    return () => document.removeEventListener('mousedown', closeMenus);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMobileOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);

  // Ctrl+K / Cmd+K פותח את החיפוש הגלובלי מכל מקום באזור הניהול
  useEffect(() => {
    function onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // מונים חיים ליד פריטי ניווט - נמשכים מנתוני הדשבורד
  const navCounts = {
    '/admin/orders': dashboard?.orders?.pending_approval || 0,
    '/admin/registrations': dashboard?.registrations?.pending || 0,
  };

  return (
    <div className="admin-pilot min-h-screen bg-surface-canvas text-ink" dir="rtl">
      <a href="#admin-main-content" className="sr-only focus:not-sr-only focus:fixed focus:right-4 focus:top-4 focus:z-[80] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-menu">
        דילוג לתוכן
      </a>

      <header className="fixed inset-x-0 top-0 z-50 h-[60px] border-b border-surface-line bg-white/95 backdrop-blur-sm lg:right-[236px]">
        <div className="flex h-full items-center justify-between gap-3 px-4 sm:px-6 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="pilot-icon-button lg:hidden"
              aria-label="פתיחת תפריט ניווט"
              aria-expanded={mobileOpen}
            >
              <MenuIcon />
            </button>
            <Breadcrumb pathname={location.pathname} />
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-surface-line bg-surface-canvas px-2.5 py-1.5 text-[13px] text-surface-muted transition-colors hover:border-surface-line-strong hover:text-surface-body"
            aria-label="חיפוש גלובלי (Ctrl+K)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <span className="hidden md:inline">חיפוש</span>
            <kbd className="hidden rounded border border-surface-line bg-white px-1.5 font-sans text-[10px] font-semibold md:inline" dir="ltr">Ctrl K</kbd>
          </button>

          <NextShabbatSummary dashboard={dashboard} />

          <div ref={controlsRef} className="flex items-center gap-1.5 sm:gap-2">
            <Link to="/admin/orders?status=pending_approval" className="btn-primary hidden !min-h-[2.25rem] whitespace-nowrap !px-3.5 !text-[13px] xl:inline-flex">
              טיפול בהזמנות
              {navCounts['/admin/orders'] > 0 && (
                <span className="rounded bg-white/15 px-1.5 text-[11px] font-bold tabular-nums">{navCounts['/admin/orders']}</span>
              )}
            </Link>
            <AdminNotificationsBell
              notifications={notifications}
              open={notificationsOpen}
              onRead={(id) => setNotifications((current) => current ? ({ ...current, items: current.items?.filter((item) => item.id !== id), total: Math.max(0, (current.total || 1) - 1) }) : current)}
              onToggle={() => { setNotificationsOpen((value) => !value); setAccountOpen(false); }}
              onClose={() => setNotificationsOpen(false)}
            />
            <AdminAccountMenu
              admin={admin}
              open={accountOpen}
              onToggle={() => { setAccountOpen((value) => !value); setNotificationsOpen(false); }}
              onLogout={onAdminLogout}
            />
          </div>
        </div>
      </header>

      <DesktopSidebar admin={admin} navCounts={navCounts} />

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="תפריט ניווט">
          <button type="button" className="absolute inset-0 bg-ink/35 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="סגירת התפריט" />
          <aside className="absolute inset-y-0 right-0 w-[min(86vw,300px)] overflow-y-auto rounded-l-2xl bg-white p-4 shadow-dialog">
            <div className="mb-4 flex items-center justify-between border-b border-surface-line pb-4">
              <BrandMark />
              <button type="button" className="pilot-icon-button" onClick={() => setMobileOpen(false)} aria-label="סגירת התפריט"><CloseIcon /></button>
            </div>
            <SidebarNavigation navCounts={navCounts} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <div id="admin-main-content" className="pt-[60px] lg:pr-[236px]">
        {children}
      </div>
    </div>
  );
}

/* פירורי לחם: ראשי / קבוצה / מסך נוכחי - נגזרים מתפריט האדמין */
function Breadcrumb({ pathname }) {
  let group = null;
  let label = pathname === '/admin' ? 'דשבורד' : null;

  if (!label) {
    for (const menuGroup of adminMenuGroups) {
      const item = menuGroup.items.find((entry) => pathname === entry.to || pathname.startsWith(`${entry.to}/`));
      if (item) {
        group = menuGroup.label;
        label = item.label;
        break;
      }
    }
  }

  return (
    <nav aria-label="מיקום במערכת" className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <Link to="/admin" className="shrink-0 text-surface-muted transition-colors hover:text-brand-burgundy">ראשי</Link>
      {group && (
        <>
          <span aria-hidden="true" className="text-surface-line-strong">/</span>
          <span className="hidden shrink-0 text-surface-muted sm:inline">{group}</span>
        </>
      )}
      {label && (
        <>
          <span aria-hidden="true" className="text-surface-line-strong">/</span>
          <span className="truncate font-bold text-ink">{label}</span>
        </>
      )}
    </nav>
  );
}

function NextShabbatSummary({ dashboard }) {
  const shabbat = dashboard?.next_shabbat;
  const to = shabbat ? `/admin/shabbat/${shabbat.id}` : '/admin/shabbat';
  const hebrewDate = formatHebrewDate(shabbat?.gregorian_date);

  return (
    <Link
      to={to}
      className="group hidden min-w-0 items-center gap-2 rounded-lg border border-brand-gold/25 bg-white px-3 py-1.5 text-[13px] transition-colors hover:border-brand-gold/50 hover:bg-brand-cream/25 md:flex"
      aria-label="השבת הקרובה"
    >
      <span className="shrink-0 text-brand-gold-dark"><CandleIcon /></span>
      {dashboard === null ? (
        <span className="h-4 w-48 animate-pulse rounded bg-brand-gold/10" />
      ) : shabbat ? (
        <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          <strong className="font-bold text-ink">פרשת {shabbat.parasha}</strong>
          {hebrewDate && <span className="text-brand-gold-dark">{hebrewDate}</span>}
          {shabbat.gregorian_date && <span className="hidden tabular-nums text-surface-muted xl:inline" dir="ltr">{shabbat.gregorian_date}</span>}
          <span className="rounded bg-surface-canvas px-1.5 py-0.5 text-[12px] font-bold text-surface-body">
            <span className="ml-1 tabular-nums text-brand-burgundy">{dashboard.orders?.next_shabbat ?? 0}</span>
            הזמנות
          </span>
        </span>
      ) : (
        <strong className="font-bold text-ink">תיקי שבת</strong>
      )}
      <span className="text-brand-gold-dark transition-transform group-hover:-translate-x-0.5" aria-hidden="true">←</span>
    </Link>
  );
}

function formatHebrewDate(gregorianDate) {
  if (!gregorianDate) return '';
  const date = new Date(`${gregorianDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  const day = Number(value('day'));
  const year = Number(value('year')) % 1000;
  const month = value('month');
  if (!day || !year || !month) return '';
  return `${toHebrewNumeral(day)} ${month} ${toHebrewNumeral(year)}`;
}

function toHebrewNumeral(number) {
  const values = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
  let remaining = number;
  let result = '';
  while (remaining > 0) {
    if (remaining === 15) { result += 'טו'; break; }
    if (remaining === 16) { result += 'טז'; break; }
    const [value, letter] = values.find(([value]) => value <= remaining);
    result += letter;
    remaining -= value;
  }
  return result.length === 1 ? `${result}׳` : `${result.slice(0, -1)}״${result.slice(-1)}`;
}

function DesktopSidebar({ admin, navCounts }) {
  const displayName = admin?.full_name || admin?.email || 'מנהל';

  return (
    <aside className="fixed inset-y-0 right-0 z-[55] hidden w-[236px] flex-col border-l border-surface-line bg-white lg:flex">
      <div className="border-b border-surface-line px-4 py-3.5">
        <BrandMark />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <SidebarNavigation navCounts={navCounts} />
      </div>
      <div className="flex items-center gap-2.5 border-t border-surface-line px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F7EEF1] text-[13px] font-bold text-brand-burgundy" aria-hidden="true">
          {displayName.trim().charAt(0)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold text-ink">{displayName}</span>
          {admin?.email && <span className="block truncate text-[11px] text-surface-muted" dir="ltr">{admin.email}</span>}
        </span>
      </div>
    </aside>
  );
}

/* ניווט משותף לסרגל הצד ולמגירה במובייל: תוויות מלאות, קבוצות ומונים */
function SidebarNavigation({ navCounts, onNavigate }) {
  const location = useLocation();

  return (
    <nav aria-label="ניווט ראשי">
      <NavItem
        to="/admin"
        label="דשבורד"
        active={location.pathname === '/admin'}
        onClick={onNavigate}
      />
      {adminMenuGroups.map((group) => (
        <div key={group.id}>
          <p className="side-nav-group">{group.label}</p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavItem
                key={item.to}
                to={item.to}
                label={item.label}
                count={navCounts?.[item.to] || 0}
                active={location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)}
                onClick={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function NavItem({ to, label, count = 0, active, onClick }) {
  return (
    <Link to={to} onClick={onClick} className={`side-nav-item ${active ? 'side-nav-item-active' : ''}`} aria-current={active ? 'page' : undefined}>
      <span className={active ? 'text-brand-burgundy' : 'text-surface-muted'}><NavIcon route={to} /></span>
      {label}
      {count > 0 && <span className="side-nav-count">{count}</span>}
    </Link>
  );
}

function BrandMark() {
  return (
    <Link to="/admin" className="flex items-center gap-2.5" aria-label="מטבח החסד - דשבורד">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-surface-line bg-white">
        <img src="/logo.png" alt="" className="h-8 w-8 object-contain" />
      </span>
      <span className="min-w-0 leading-tight">
        <strong className="block truncate text-[14px] font-bold text-ink">מטבח החסד</strong>
        <small className="text-[11px] font-semibold text-brand-gold-dark">ברכת שמואל</small>
      </span>
    </Link>
  );
}

/* אייקון פר-מסך: קו אחיד 1.8, בלי מילוי - סט עקבי אחד לכל הניווט */
function NavIcon({ route }) {
  const paths = {
    '/admin': <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    '/admin/customers': <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-3-5.2" /></>,
    '/admin/registrations': <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" /></>,
    '/admin/volunteers': <path d="M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10z" />,
    '/admin/orders': <><path d="M9 5H7a2 2 0 0 0-2 2v12h14V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></>,
    '/admin/shabbat': <><path d="M12 3c1.2 1 1.2 2.2.4 3.2M9 9h6v9a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM8 22h8" /></>,
    '/admin/print-form': <><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="1.5" /><path d="M7 17v4h10v-4" /></>,
    '/admin/catalog': <><path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h13" /><path d="M9 7h6" /></>,
    '/admin/inventory': <><path d="M21 8V6l-9-4-9 4v12l9 4 9-4v-2" /><path d="M3 7l9 4 9-4M12 22V11" /></>,
    '/admin/suppliers': <><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>,
    '/admin/purchase-orders': <><circle cx="9" cy="20" r="1.5" /><circle cx="17" cy="20" r="1.5" /><path d="M3 4h2l2.5 12h11L21 8H6" /></>,
    '/admin/finance': <path d="M4 18V8M9 18V4M14 18v-7M19 18V7" />,
    '/admin/petty-cash': <><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M3 11h18M16 15h2" /></>,
    '/admin/recurring-expenses': <><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v5h-5" /></>,
    '/admin/email': <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    '/admin/users': <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-1a7 7 0 0 1 14 0v1" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden="true">
      {paths[route] || paths['/admin']}
    </svg>
  );
}

function MenuIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>; }
function CandleIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]" aria-hidden="true"><path d="M12 3c1.2 1 1.2 2.2.4 3.2M9 9h6v9a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM8 22h8" /></svg>; }
