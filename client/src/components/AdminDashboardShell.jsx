import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { AdminAccountMenu, AdminNotificationsBell, adminMenuGroups } from './Layout.jsx';

export default function AdminDashboardShell({ admin, onAdminLogout, children }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
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

  const displayName = admin?.full_name || admin?.email || 'מנהל';

  return (
    <div className="admin-pilot min-h-screen bg-[#f1f2f4] text-[#2b2024]" dir="rtl">
      <a href="#admin-main-content" className="sr-only focus:not-sr-only focus:fixed focus:right-4 focus:top-4 focus:z-[80] focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg">
        דילוג לתוכן
      </a>

      <header className="fixed inset-x-0 top-0 z-50 h-[72px] border-b border-black/[0.06] bg-white/90 backdrop-blur-xl lg:right-[92px]">
        <div className="flex h-full items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
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
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold tracking-wide text-brand-gold-dark">מרכז הניהול</p>
              <p className="truncate text-sm font-extrabold text-brand-burgundy sm:text-base">שלום, {displayName}</p>
            </div>
          </div>

          <NextShabbatSummary dashboard={dashboard} />

          <div ref={controlsRef} className="flex items-center gap-1.5 sm:gap-2">
            <Link to="/admin/orders" className="hidden rounded-xl border border-black/[0.06] bg-white px-4 py-2.5 text-sm font-bold text-brand-burgundy shadow-[0_4px_16px_rgba(42,31,36,0.05)] transition hover:border-brand-gold/40 hover:bg-brand-cream/35 xl:inline-flex">
              כל ההזמנות
            </Link>
            <Link to="/admin/orders?status=pending_approval" className="hidden rounded-xl bg-brand-burgundy px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_18px_rgba(92,26,46,0.18)] transition hover:bg-brand-burgundy-light xl:inline-flex">
              טיפול בהזמנות
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

      <DesktopSidebar />

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="תפריט ניווט">
          <button type="button" className="absolute inset-0 bg-[#2b2024]/35 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="סגירת התפריט" />
          <aside className="absolute inset-y-0 right-0 w-[min(86vw,320px)] overflow-y-auto rounded-l-[28px] bg-white p-4 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <BrandMark expanded />
              <button type="button" className="pilot-icon-button" onClick={() => setMobileOpen(false)} aria-label="סגירת התפריט"><CloseIcon /></button>
            </div>
            <MobileNavigation onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div id="admin-main-content" className="pt-[72px] lg:pr-[92px]">
        {children}
      </div>
    </div>
  );
}

function NextShabbatSummary({ dashboard }) {
  const shabbat = dashboard?.next_shabbat;
  const to = shabbat ? `/admin/shabbat/${shabbat.id}` : '/admin/shabbat';
  const hebrewDate = formatHebrewDate(shabbat?.gregorian_date);

  return (
    <Link
      to={to}
      className="group hidden min-w-0 items-center gap-2 rounded-xl border border-brand-gold/20 bg-brand-cream/30 px-3 py-2 text-sm transition hover:border-brand-gold/45 hover:bg-brand-cream/50 md:flex"
      aria-label="השבת הקרובה"
    >
      <span className="shrink-0 text-brand-gold-dark"><CandleIcon /></span>
      {dashboard === null ? (
        <span className="h-4 w-48 animate-pulse rounded bg-brand-gold/10" />
      ) : shabbat ? (
        <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          <strong className="text-brand-burgundy">פרשת {shabbat.parasha}</strong>
          {hebrewDate && <span className="text-[#756a6e]">{hebrewDate}</span>}
          {shabbat.gregorian_date && <span className="hidden tabular-nums text-[#91868a] xl:inline" dir="ltr">{shabbat.gregorian_date}</span>}
          <span className="rounded-lg bg-white/80 px-2 py-0.5 font-bold text-brand-burgundy shadow-sm">
            <span className="ml-1 tabular-nums text-brand-gold-dark">{dashboard.orders?.next_shabbat ?? 0}</span>
            הזמנות
          </span>
        </span>
      ) : (
        <strong className="text-brand-burgundy">תיקי שבת</strong>
      )}
      <span className="text-brand-gold-dark transition group-hover:-translate-x-0.5" aria-hidden="true">←</span>
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

function DesktopSidebar() {
  const location = useLocation();
  return (
    <aside className="fixed inset-y-0 right-0 z-[55] hidden w-[92px] flex-col items-center border-l border-black/[0.06] bg-white px-3 py-3 lg:flex">
      <BrandMark />
      <nav className="mt-7 flex w-full flex-1 flex-col items-center gap-2 overflow-visible" aria-label="ניווט ראשי">
        <SideLink to="/admin" label="דשבורד" icon="dashboard" active={location.pathname === '/admin'} />
        {adminMenuGroups.map((group) => (
          <DesktopNavGroup key={group.id} group={group} pathname={location.pathname} />
        ))}
      </nav>
    </aside>
  );
}

function DesktopNavGroup({ group, pathname }) {
  const active = group.items.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));

  return (
    <div className="group/nav relative flex w-full justify-center">
      <button
        type="button"
        className={`pilot-side-link ${active ? 'pilot-side-link-active' : ''}`}
        aria-label={group.label}
        aria-haspopup="menu"
      >
        <NavIcon name={group.id} />
      </button>
      <div className="pointer-events-none invisible absolute right-full top-0 z-[70] w-64 pr-3 opacity-0 transition-all duration-150 group-hover/nav:pointer-events-auto group-hover/nav:visible group-hover/nav:opacity-100 group-focus-within/nav:pointer-events-auto group-focus-within/nav:visible group-focus-within/nav:opacity-100">
        <div className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white p-2 shadow-[0_18px_50px_rgba(42,31,36,0.14)]" role="menu">
          <div className="border-b border-black/[0.055] px-3 pb-2.5 pt-1.5">
            <p className="text-xs font-bold text-brand-gold-dark">{group.label}</p>
          </div>
          <div className="mt-1 space-y-1">
            {group.items.map((item) => {
              const itemActive = pathname === item.to || pathname.startsWith(`${item.to}/`);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  role="menuitem"
                  className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition ${itemActive ? 'bg-brand-burgundy text-white' : 'text-[#655a5e] hover:bg-[#f8f6f4] hover:text-brand-burgundy'}`}
                >
                  <span>{item.label}</span>
                  <span aria-hidden="true" className={itemActive ? 'text-brand-gold-light' : 'text-[#b1a8aa]'}>←</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileNavigation({ onNavigate }) {
  const location = useLocation();
  return (
    <nav aria-label="ניווט ראשי" className="space-y-5">
      <div>
        <p className="mb-2 px-3 text-xs font-bold text-brand-gold-dark">ראשי</p>
        <MobileLink to="/admin" label="דשבורד" icon="dashboard" onClick={onNavigate} active={location.pathname === '/admin'} />
      </div>
      {adminMenuGroups.map((group) => (
        <div key={group.id}>
          <p className="mb-2 px-3 text-xs font-bold text-brand-gold-dark">{group.label}</p>
          <div className="space-y-1">
            {group.items.map((item) => <MobileLink key={item.to} {...item} icon={group.id} onClick={onNavigate} active={location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)} />)}
          </div>
        </div>
      ))}
    </nav>
  );
}

function BrandMark({ expanded = false }) {
  return (
    <Link to="/admin" className={`flex items-center ${expanded ? 'gap-3' : ''}`} aria-label="מטבח החסד — דשבורד">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-brand-gold/20 bg-brand-cream/45 shadow-[0_7px_20px_rgba(66,18,31,0.08)]">
        <img src="/logo.png" alt="" className="h-11 w-11 object-contain" />
      </span>
      {expanded && <span><strong className="block text-brand-burgundy">מטבח החסד</strong><small className="text-brand-gold-dark">ברכת שמואל</small></span>}
    </Link>
  );
}

function SideLink({ to, label, icon, active }) {
  return <Link to={to} className={`pilot-side-link ${active ? 'pilot-side-link-active' : ''}`} aria-label={label} title={label}><NavIcon name={icon} /></Link>;
}

function MobileLink({ to, label, icon, active, onClick }) {
  return (
    <Link to={to} onClick={onClick} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? 'bg-brand-burgundy text-white' : 'text-brand-burgundy/75 hover:bg-brand-cream/60 hover:text-brand-burgundy'}`}>
      <span className={active ? 'text-brand-gold-light' : 'text-brand-gold-dark'}><NavIcon name={icon} /></span>{label}
    </Link>
  );
}

function NavIcon({ name }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    orders: <><path d="M9 5H7a2 2 0 0 0-2 2v12h14V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></>,
    community: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-3-5.2" /></>,
    operations: <><path d="M21 8V6l-9-5-9 5v10l9 5 4-2.2" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /><circle cx="19" cy="17" r="3" /></>,
    system: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.1A1.7 1.7 0 0 0 15 4.6" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">{paths[name] || paths.dashboard}</svg>;
}

function MenuIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>; }
function CandleIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true"><path d="M12 3c1.2 1 1.2 2.2.4 3.2M9 9h6v9a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM8 22h8" /></svg>; }
