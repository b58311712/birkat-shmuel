import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  customerDisplayName, customerMatchesTerms, searchTerms, sortCustomersByLastName,
} from '../lib/customers.js';

// בורר לקוח: תיבת חיפוש עם רשימה נפתחת, במקום <select> ארוך.
// הרשימה תמיד ממוינת לפי א"ב עברי של שם המשפחה, והבחירה נעשית בהקלדת שם
// (שם משפחה, שם פרטי, טלפון או מייל) או בניווט מקלדת.
//
// props:
//   customers  - מערך לקוחות (null בזמן טעינה)
//   value      - מזהה הלקוח הנבחר ('' כשאין)
//   onChange   - (id) => void, מקבל '' כשמנקים
//   emptyLabel - תווית האפשרות הריקה בראש הרשימה (null מבטל אותה)
//   priority   - (customer) => number, קיבוץ לפני המיון (למשל ארגונים ראשונים)
//   meta       - (customer) => string, שורת משנה באפשרות (ברירת מחדל: טלפון)

export default function CustomerPicker({
  customers,
  value,
  onChange,
  emptyLabel = '- בחירה -',
  placeholder = 'חיפוש לפי שם משפחה, שם פרטי או טלפון...',
  priority,
  meta = (customer) => customer.phone || '',
  className = '',
  inputClassName = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none',
  disabled = false,
  ariaLabel,
}) {
  const listId = useId();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const optionRefs = useRef({});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const sorted = useMemo(() => sortCustomersByLastName(customers, priority), [customers, priority]);
  const selected = useMemo(
    () => sorted.find((customer) => String(customer.id) === String(value || '')) || null,
    [sorted, value],
  );

  const options = useMemo(() => {
    const terms = searchTerms(query);
    const matched = sorted.filter((customer) => customerMatchesTerms(customer, terms));
    return emptyLabel ? [null, ...matched] : matched;
  }, [sorted, query, emptyLabel]);

  // סגירה בלחיצה מחוץ לבורר - הטקסט חוזר להצגת הבחירה הנוכחית
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // האפשרות המסומנת נשארת בתוך תחום הגלילה של הרשימה
  useEffect(() => {
    if (!open) return;
    optionRefs.current[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  function openList() {
    if (disabled || open) return;
    setOpen(true);
    setQuery('');
    // הרשימה נפתחת נקייה מחיפוש, ולכן הסימון מחושב מול הרשימה המלאה
    const full = emptyLabel ? [null, ...sorted] : sorted;
    setHighlight(Math.max(0, full.findIndex((option) => option && String(option.id) === String(value || ''))));
  }

  function pick(customer) {
    onChange(customer ? customer.id : '');
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { openList(); return; }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => {
        if (options.length === 0) return 0;
        return (current + step + options.length) % options.length;
      });
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (options.length > 0) pick(options[Math.min(highlight, options.length - 1)]);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }

  const loading = customers == null;
  const inputValue = open ? query : customerDisplayName(selected);

  // יציאה במקלדת (Tab) סוגרת את הרשימה; לחיצה על אפשרות לא מוציאה את הפוקוס
  // מהבורר (preventDefault ב-mousedown) ולכן אינה נחשבת יציאה.
  function onBlur(event) {
    if (!rootRef.current?.contains(event.relatedTarget)) {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={rootRef} onBlur={onBlur} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options.length > 0 ? `${listId}-opt-${Math.min(highlight, options.length - 1)}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled || loading}
        className={inputClassName}
        value={inputValue}
        placeholder={loading ? 'טוען לקוחות...' : (selected ? customerDisplayName(selected) : placeholder)}
        onFocus={openList}
        onClick={openList}
        onChange={(event) => { setOpen(true); setQuery(event.target.value); setHighlight(0); }}
        onKeyDown={onKeyDown}
      />

      {selected && !open && !disabled && (
        <button
          type="button"
          onClick={() => { onChange(''); setQuery(''); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-brand-burgundy/40 hover:text-brand-burgundy"
          aria-label="ניקוי הבחירה"
        >
          ✕
        </button>
      )}

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-brand-cream-dark bg-white py-1 shadow-menu"
        >
          {options.length === 0 && (
            <li className="px-3 py-2 text-sm text-brand-burgundy/50">לא נמצאו לקוחות מתאימים</li>
          )}
          {options.map((customer, index) => {
            const isSelected = customer
              ? String(customer.id) === String(value || '')
              : !value;
            return (
              <li
                key={customer ? customer.id : '__empty__'}
                id={`${listId}-opt-${index}`}
                ref={(el) => { optionRefs.current[index] = el; }}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => { event.preventDefault(); pick(customer); }}
                className={`cursor-pointer px-3 py-1.5 text-sm ${
                  index === highlight ? 'bg-brand-cream' : ''
                } ${isSelected ? 'font-bold text-brand-burgundy' : 'text-brand-burgundy/85'}`}
              >
                {customer ? (
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{customerDisplayName(customer)}</span>
                    {meta(customer) && (
                      <span className="shrink-0 text-xs text-brand-burgundy/45" dir="ltr">{meta(customer)}</span>
                    )}
                  </span>
                ) : emptyLabel}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
