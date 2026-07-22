import { useEffect, useRef, useState } from 'react';

const navBtnCls =
  'inline-grid h-8 w-8 place-items-center rounded-lg border border-surface-line bg-white text-surface-body transition-colors hover:border-surface-line-strong hover:text-brand-burgundy focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-burgundy disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-surface-line disabled:hover:text-surface-body';

// פאנל צידי (Drawer) גנרי — נפתח מקצה המסך, שומר את הטבלה גלויה מאחוריו.
// שפת "חדר מצב": רקע מעומעם עם טשטוש, כותרת עם eyebrow + כפתור סגירה,
// גוף נגלל, ופוטר דביק אופציונלי לכפתורי פעולה.
//
// props:
//   open        — האם הפאנל פתוח (כשfalse לא מרונדר כלום).
//   onClose     — נקרא בלחיצה על הרקע, על ה-X או ב-Escape.
//   eyebrow     — תווית-על קטנה (זהב טקסי), למשל "כרטיס לקוח" / "עריכת לקוח".
//   title       — כותרת ראשית (שם הרשומה).
//   subtitle    — שורת משנה קטנה מתחת לכותרת (אופציונלי).
//   footer      — JSX לאזור פעולות דביק בתחתית (אופציונלי).
//   children    — גוף הפאנל (נגלל).
//   width       — 'sm' | 'md' | 'lg' | 'xl' | '2xl'..'7xl' (ברירת מחדל 'md').
//                 טפסים רחבים (טבלת מתכון) צריכים '6xl'/'7xl' כדי להימנע מגלילה צדדית.
//   side        — 'left' (ברירת מחדל, לא מכסה את סרגל הצד ב-RTL) | 'right'.
//   onPrev/onNext — דפדוף בין רשומות (null = מושבת). מציג חצים בכותרת.
//   position    — טקסט מיקום קצר ("3/20") שמוצג בין החצים.
//   contentKey  — key לגוף הפאנל. כשמשתנה, הגוף מתרונדר מחדש (remount). חובה
//                 בדפדוף בין רשומות כדי שטפסים עם state פנימי (useState(initial))
//                 יאותחלו לרשומה החדשה; גם מאפס גלילה לראש.
export function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  subtitle,
  footer,
  children,
  width = 'md',
  side = 'left',
  onPrev,
  onNext,
  position,
  contentKey,
}) {
  const panelRef = useRef(null);
  const lastFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    lastFocused.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => panelRef.current?.focus());

    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (lastFocused.current instanceof HTMLElement) lastFocused.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const widthCls = {
    sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl',
    '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl', '6xl': 'max-w-6xl', '7xl': 'max-w-7xl',
  }[width] || 'max-w-md';
  const sideCls = side === 'right' ? 'right-0 drawer-panel-right' : 'left-0 drawer-panel-left';

  return (
    <div
      className="fixed inset-0 z-[65]"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : 'פרטי רשומה'}
      dir="rtl"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="סגירה"
        className="drawer-backdrop absolute inset-0 bg-ink/35 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`absolute inset-y-0 ${sideCls} flex h-full w-full ${widthCls} flex-col bg-white shadow-dialog outline-none`}
      >
        <header className="flex items-start gap-3 border-b border-surface-line px-5 py-4">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="section-title mb-0.5">{eyebrow}</p>}
            {title && <h2 className="truncate text-lg font-bold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-surface-muted" dir="ltr">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {(onPrev || onNext) && (
              <>
                <button type="button" onClick={onPrev || undefined} disabled={!onPrev} aria-label="הרשומה הקודמת" title="הרשומה הקודמת" className={navBtnCls}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                    <path d="m6 15 6-6 6 6" />
                  </svg>
                </button>
                {position && <span className="px-0.5 text-xs tabular-nums text-surface-muted" dir="ltr">{position}</span>}
                <button type="button" onClick={onNext || undefined} disabled={!onNext} aria-label="הרשומה הבאה" title="הרשומה הבאה" className={navBtnCls}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                <span aria-hidden="true" className="mx-1 h-6 w-px bg-surface-line" />
              </>
            )}
            <button type="button" onClick={onClose} aria-label="סגירה" className="pilot-icon-button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </header>

        <div key={contentKey} className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="border-t border-surface-line bg-surface-canvas/60 px-5 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}

// עטיפה נוחה ל-Drawer עבור המקרה הנפוץ: טופס יצירה/עריכה של רשומה.
// editing: null (סגור) | {} (חדש) | record (עריכה). הכותרת ותווית-העל נגזרות
// מ-entity ומ-article ("חדש"/"חדשה"). אפשר לדרוס עם title (למשל שם הרשומה).
//
// props נוספים מועברים ל-Drawer (footer, side וכו').
export function FormDrawer({ editing, onClose, entity, article = 'חדש', title, width = 'lg', children, ...rest }) {
  const isEdit = !!(editing && editing.id);
  const fallback = isEdit ? `עריכת ${entity}` : `${entity} ${article}`;
  return (
    <Drawer
      open={!!editing}
      onClose={onClose}
      eyebrow={fallback}
      title={title || fallback}
      width={width}
      contentKey={editing?.id ?? 'new'}
      {...rest}
    >
      {children}
    </Drawer>
  );
}

// דפדוף בין רשומות בפאנל. שומר את הרשומות הגלויות בטבלה (אחרי סינון/מיון,
// דרך onVisibleRowsChange של DataTable) ומחשב הרשומה הקודמת/הבאה יחסית ל-currentId.
//   open      — callback לפתיחת רשומה נתונה בפאנל (setEditing / openDetail).
//   currentId — מזהה הרשומה הפתוחה כרגע (null => אין דפדוף, למשל ברשומה חדשה).
// מחזיר: setVisibleRows (להעברה ל-DataTable) + onPrev/onNext/position (ל-Drawer).
export function useRecordNav(open, currentId) {
  const [visibleRows, setVisibleRows] = useState([]);
  const index = currentId == null ? -1 : visibleRows.findIndex((r) => r.id === currentId);
  const onPrev = index > 0 ? () => open(visibleRows[index - 1]) : null;
  const onNext = index >= 0 && index < visibleRows.length - 1 ? () => open(visibleRows[index + 1]) : null;
  const position = index >= 0 ? `${index + 1}/${visibleRows.length}` : null;
  return { setVisibleRows, onPrev, onNext, position };
}
