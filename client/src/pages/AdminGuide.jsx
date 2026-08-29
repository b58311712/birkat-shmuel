import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Layout.jsx';
import { GUIDE_SECTIONS, STATUS_DICTIONARY } from '../lib/guideContent.js';
import {
  Badge,
  ORDER_STATUS,
  PAYMENT_STATUS,
  REFUND_STATUS,
  PO_STATUS,
  SUPPLIER_PAYMENT_STATUS,
  CUSTOMER_STATUS,
} from '../lib/status.jsx';

/* הוראות שימוש במערכת (סעיף עזרה). מסך קריאה בלבד: התוכן מגיע כמבנה נתונים
   מ-lib/guideContent.js, וכאן רק הצגה. שלושה דברים הופכים אותו לשמיש:
   תוכן עניינים דביק עם סימון הסעיף הנוכחי, חיפוש חופשי שמצמצם לסעיפים
   הרלוונטיים, והדפסה שמוציאה את המדריך המלא כמסמך. */

const STATUS_MAPS = {
  order: ORDER_STATUS,
  payment: PAYMENT_STATUS,
  refund: REFUND_STATUS,
  po: PO_STATUS,
  supplierPayment: SUPPLIER_PAYMENT_STATUS,
  customer: CUSTOMER_STATUS,
};

// סימון מינימלי בתוך טקסט: *הדגשה*, `קוד`, [[תווית|/admin/יעד]]
const INLINE_PATTERN = /(\*[^*]+\*|`[^`]+`|\[\[[^\]]+\]\])/g;

function renderInline(text, keyPrefix) {
  return String(text)
    .split(INLINE_PATTERN)
    .filter(Boolean)
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
        return <strong key={key} className="font-bold text-ink">{part.slice(1, -1)}</strong>;
      }
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={key} className="rounded border border-surface-line bg-surface-canvas px-1.5 py-0.5 text-[12.5px] font-semibold text-surface-body" dir="ltr">
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const [label, to] = part.slice(2, -2).split('|');
        return (
          <Link
            key={key}
            to={to}
            className="font-semibold text-brand-burgundy underline decoration-brand-burgundy/25 underline-offset-[3px] transition-colors hover:decoration-brand-burgundy"
          >
            {label}
          </Link>
        );
      }
      return <span key={key}>{part}</span>;
    });
}

// טקסט נקי מסימון - לצורכי חיפוש בלבד
function plainText(value) {
  return String(value)
    .replace(/\[\[([^\]|]+)\|[^\]]*\]\]/g, '$1')
    .replace(/[*`]/g, '');
}

function blockText(block) {
  switch (block.type) {
    case 'p':
      return block.text;
    case 'list':
      return block.items.join(' ');
    case 'steps':
      return block.items.map((item) => `${item.title} ${item.text}`).join(' ');
    case 'table':
      return [...block.head, ...block.rows.flat()].join(' ');
    case 'note':
      return `${block.title} ${block.text}`;
    case 'statuses':
      return STATUS_DICTIONARY
        .map((group) => `${group.title} ${Object.values(STATUS_MAPS[group.key]).map((s) => s.label).join(' ')}`)
        .join(' ');
    default:
      return '';
  }
}

function sectionText(section) {
  return plainText([section.title, section.summary || '', ...section.blocks.map(blockText)].join(' '))
    .toLocaleLowerCase('he-IL');
}

export default function AdminGuide() {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(GUIDE_SECTIONS[0].id);
  const sectionRefs = useRef({});

  const term = query.trim().toLocaleLowerCase('he-IL');

  const searchIndex = useMemo(
    () => GUIDE_SECTIONS.map((section) => ({ id: section.id, text: sectionText(section) })),
    [],
  );

  const visibleSections = useMemo(() => {
    if (!term) return GUIDE_SECTIONS;
    const matched = new Set(searchIndex.filter((entry) => entry.text.includes(term)).map((entry) => entry.id));
    return GUIDE_SECTIONS.filter((section) => matched.has(section.id));
  }, [term, searchIndex]);

  // סימון הסעיף שנקרא כרגע. הרצועה נקבעת מתחת לכותרת הקבועה (60px) כדי
  // שהסעיף ייחשב "פעיל" בדיוק כשהוא מגיע לראש אזור התוכן.
  useEffect(() => {
    const elements = visibleSections
      .map((section) => sectionRefs.current[section.id])
      .filter(Boolean);
    if (elements.length === 0) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.dataset.sectionId);
      },
      { rootMargin: '-70px 0px -65% 0px', threshold: 0 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [visibleSections]);

  function goToSection(id) {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  }

  return (
    <Page
      title="הוראות שימוש"
      subtitle="מדריך העבודה במערכת: זרימת העבודה השבועית, מה עושים בכל מסך, ומה לבדוק כשמשהו לא מסתדר."
    >
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-muted" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="חיפוש במדריך..."
            aria-label="חיפוש במדריך"
            className="input !py-2 pr-9 text-[14px]"
          />
        </div>

        {term && (
          <span className="text-[13px] text-surface-muted">
            {visibleSections.length > 0
              ? `${visibleSections.length} מתוך ${GUIDE_SECTIONS.length} סעיפים`
              : 'אין סעיף תואם'}
          </span>
        )}

        <button type="button" onClick={() => window.print()} className="btn-secondary mr-auto">
          <PrintIcon />
          הדפסת המדריך
        </button>
      </div>

      {/* ניווט מהיר במובייל - שורת שבבים נגללת במקום תוכן עניינים דביק */}
      <nav aria-label="סעיפי המדריך" className="no-print -mx-4 mb-5 overflow-x-auto px-4 lg:hidden">
        <div className="flex w-max gap-1.5">
          {visibleSections.map((section, index) => (
            <button
              key={section.id}
              type="button"
              onClick={() => goToSection(section.id)}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                activeId === section.id
                  ? 'border-brand-burgundy bg-[#F7EEF1] text-brand-burgundy'
                  : 'border-surface-line bg-white text-surface-body'
              }`}
            >
              <span className="ml-1.5 tabular-nums text-surface-muted">{index + 1}</span>
              {section.title}
            </button>
          ))}
        </div>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_232px]">
        <div className="print-area space-y-4">
          {/* כותרת שמופיעה רק בהדפסה, כדי שהמסמך יעמוד בפני עצמו */}
          <div className="hidden print:mb-6 print:block">
            <h1 className="font-display text-2xl font-extrabold text-ink">מטבח החסד - מדריך למשתמש במערכת הניהול</h1>
            <p className="mt-1 text-sm text-surface-muted">הודפס בתאריך {new Date().toLocaleDateString('he-IL')}</p>
          </div>

          {visibleSections.length === 0 && (
            <div className="card text-center text-surface-muted">
              לא נמצא סעיף שמכיל "{query.trim()}". נסו מונח אחר, למשל: מלאי, תשלום, מתנדבים.
            </div>
          )}

          {visibleSections.map((section) => {
            const number = GUIDE_SECTIONS.findIndex((entry) => entry.id === section.id) + 1;
            return (
              <section
                key={section.id}
                data-section-id={section.id}
                ref={(element) => { sectionRefs.current[section.id] = element; }}
                aria-labelledby={`guide-${section.id}`}
                className="card print-avoid scroll-mt-[76px] p-5 sm:p-6"
              >
                <header className="mb-4 border-b border-surface-line pb-3">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded text-[12px] font-bold tabular-nums ${
                        section.highlight ? 'bg-brand-burgundy text-white' : 'bg-surface-canvas text-surface-muted'
                      }`}
                      aria-hidden="true"
                    >
                      {number}
                    </span>
                    <div className="min-w-0">
                      <h2 id={`guide-${section.id}`} className="font-display text-[17px] font-extrabold tracking-tight text-ink">
                        {section.title}
                      </h2>
                      {section.summary && (
                        <p className="mt-0.5 text-[13px] text-surface-muted">{section.summary}</p>
                      )}
                    </div>
                  </div>
                </header>

                <div className="space-y-4">
                  {section.blocks.map((block, index) => (
                    <GuideBlock key={`${section.id}-${index}`} block={block} idPrefix={`${section.id}-${index}`} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/* תוכן עניינים דביק - שומר על אותה שפה של סרגל הניווט הראשי */}
        <aside className="no-print hidden lg:block">
          <nav aria-label="תוכן עניינים" className="sticky top-[76px] rounded-2xl border border-surface-line bg-white p-3 shadow-card">
            <p className="section-title px-2 pb-2">תוכן עניינים</p>
            <div className="space-y-0.5">
              {visibleSections.map((section, index) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => goToSection(section.id)}
                  className={`side-nav-item text-right ${activeId === section.id ? 'side-nav-item-active' : ''}`}
                >
                  <span className="w-4 shrink-0 text-[11px] tabular-nums text-surface-muted">{index + 1}</span>
                  <span className="truncate">{section.title}</span>
                </button>
              ))}
            </div>
          </nav>
        </aside>
      </div>
    </Page>
  );
}

function GuideBlock({ block, idPrefix }) {
  switch (block.type) {
    case 'p':
      return (
        <p className="text-[14.5px] leading-relaxed text-surface-body">
          {renderInline(block.text, idPrefix)}
        </p>
      );

    case 'list':
      return (
        <ul className="space-y-2">
          {block.items.map((item, index) => (
            <li key={`${idPrefix}-${index}`} className="flex gap-2.5 text-[14.5px] leading-relaxed text-surface-body">
              <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" aria-hidden="true" />
              <span>{renderInline(item, `${idPrefix}-${index}`)}</span>
            </li>
          ))}
        </ul>
      );

    case 'steps':
      return (
        <ol className="space-y-3">
          {block.items.map((item, index) => (
            <li key={`${idPrefix}-${index}`} className="print-avoid flex gap-3">
              <span
                className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-brand-burgundy/20 bg-[#F7EEF1] text-[12px] font-bold tabular-nums text-brand-burgundy"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-[14.5px] font-bold text-ink">{item.title}</p>
                <p className="mt-1 text-[14.5px] leading-relaxed text-surface-body">
                  {renderInline(item.text, `${idPrefix}-${index}`)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      );

    case 'table':
      return (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-card">
          <table className="w-full text-right">
            <thead className="bg-brand-burgundy text-sm text-brand-cream">
              <tr>
                {block.head.map((cell, index) => (
                  <th key={`${idPrefix}-h-${index}`} className="p-3 text-right font-semibold">{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-[14px]">
              {block.rows.map((row, rowIndex) => (
                <tr key={`${idPrefix}-r-${rowIndex}`} className="border-b border-surface-line last:border-0">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${idPrefix}-r-${rowIndex}-${cellIndex}`}
                      className={`p-3 align-top leading-relaxed ${cellIndex === 0 ? 'font-semibold text-ink' : 'text-surface-body'}`}
                    >
                      {renderInline(cell, `${idPrefix}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'note': {
      const warn = block.tone === 'warn';
      return (
        <div
          className={`print-avoid rounded-2xl border p-4 ${
            warn ? 'border-brand-gold/35 bg-brand-gold/[0.07]' : 'border-surface-line bg-surface-canvas'
          }`}
        >
          <p className={`text-[13px] font-bold ${warn ? 'text-brand-gold-dark' : 'text-surface-muted'}`}>
            {block.title}
          </p>
          <p className="mt-1 text-[14.5px] leading-relaxed text-surface-body">
            {renderInline(block.text, idPrefix)}
          </p>
        </div>
      );
    }

    case 'statuses':
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {STATUS_DICTIONARY.map((group) => {
            const map = STATUS_MAPS[group.key];
            return (
              <div key={group.key} className="print-avoid rounded-2xl border border-surface-line bg-surface-canvas/60 p-3.5">
                <p className="mb-2.5 text-[13px] font-bold text-ink">{group.title}</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(map).map((value) => (
                    <Badge key={value} map={map} value={value} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );

    default:
      return null;
  }
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path d="M6 9V4h12v5" />
      <rect x="4" y="9" width="16" height="7" rx="2" />
      <path d="M8 16h8v4H8z" />
    </svg>
  );
}
