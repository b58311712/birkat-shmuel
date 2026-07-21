import { useCallback, useEffect, useRef, useState } from 'react';

/* מערכת טוסטים גלובלית - מחליפה את חלונות ה-alert של הדפדפן.
   בעלייה היא דורסת את window.alert כך שכל 88 הקריאות הקיימות במסכים
   הופכות לטוסטים בלי לגעת בהן; window.toast זמין לקוד חדש.
   הטון (הצלחה/שגיאה/מידע) נגזר מניסוח ההודעה בעברית. */

const DANGER_RE = /שגיאה|נכשל|כשל|לא ניתן|אין אפשרות|חסר|פג תוקף/;
const SUCCESS_RE = /נשמר|נשמרה|עודכן|עודכנה|נשלח|נשלחה|נוסף|נוספה|נמחק|נמחקה|הופק|בוצע|בוצעה|הושלם|הצלחה|✓/;

function toneOf(message) {
  if (DANGER_RE.test(message)) return 'danger';
  if (SUCCESS_RE.test(message)) return 'success';
  return 'info';
}

let nextId = 1;

export default function Toaster() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback((message, tone) => {
    const text = String(message ?? '').trim();
    if (!text) return;
    const id = nextId++;
    const resolved = tone || toneOf(text);
    setToasts((list) => [...list.slice(-4), { id, text, tone: resolved }]);
    timers.current.set(id, window.setTimeout(() => dismiss(id), resolved === 'danger' ? 8000 : 5500));
  }, [dismiss]);

  useEffect(() => {
    const nativeAlert = window.alert;
    window.alert = (message) => push(message);
    window.toast = push;
    return () => {
      window.alert = nativeAlert;
      delete window.toast;
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, [push]);

  if (toasts.length === 0) return null;

  return (
    <div
      dir="rtl"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-[90] flex w-[min(92vw,360px)] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="toast-enter flex items-start gap-2.5 rounded-xl border border-surface-line bg-white px-3.5 py-3 shadow-menu"
        >
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[toast.tone]}`} aria-hidden="true" />
          <p className="min-w-0 flex-1 whitespace-pre-line text-[13.5px] leading-snug text-surface-body">{toast.text}</p>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="סגירת ההודעה"
            className="shrink-0 rounded p-0.5 text-surface-muted transition-colors hover:bg-surface-canvas hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}

const TONE_DOT = {
  success: 'bg-emerald-600',
  danger: 'bg-red-600',
  info: 'bg-brand-burgundy',
};
