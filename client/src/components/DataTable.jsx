import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { DragHandle } from './DragHandle.jsx';

// טבלה גנרית עם סינון פר-עמודה לפי טיפוס השדה. הסינון בזיכרון על השורות שנטענו.
//
// columns: מערך של הגדרות עמודה -
//   { key, label, type, ... }
//   type: 'text' | 'number' | 'date' | 'boolean' | 'enum' (ברירת מחדל: 'text')
//   render(row)   - תוכן מותאם לתא (ברירת מחדל: הערך הגולמי). לא משפיע על הסינון.
//   value(row)    - חילוץ הערך לסינון/מיון (ברירת מחדל: row[key]).
//   accessor      - שם שדה חלופי לחילוץ (row[accessor]) כשאין value.
//   dir           - 'ltr' לתאי טלפון/מייל/מספרים.
//   map           - עבור type 'enum': מיפוי ערך→{label} (כמו CUSTOMER_STATUS). מזין את אפשרויות הסינון והתצוגה.
//   options       - עבור type 'enum' ללא map: [{ value, label }] ידני.
//   filterable    - false כדי לבטל סינון לעמודה (ברירת מחדל: true, למעט עמודות בלי key).
//   className, headerClassName - מחלקות נוספות לתא/לכותרת.
//   rawCell       - true: render(row) מחזיר <td> שלם משלו (הרכיב לא עוטף). לעריכה תוך-שורתית.
//
// actions(row)  - פונקציה שמחזירה JSX של כפתורי פעולה בעמודה אחרונה (אופציונלי).
// renderExpanded(row) - שורה מורחבת מתחת לשורה (למשל טופס עריכה-בשורה). מוצגת כאשר expandedId === rowKey(row).
// rowKey(row)   - מזהה ייחודי לשורה (ברירת מחדל: row.id).
// expandedId    - מזהה השורה שמורחבת כרגע.
// rowClassName(row) - מחלקות נוספות לשורה.
// empty, loading - טקסטים למצב ריק/טעינה. rows=null => טעינה.
//
// גרירה-לסידור (אופציונלי):
//   reorderable   - true מוסיף עמודת ידית-גרירה בהתחלה ומאפשר גרירת שורות.
//   onReorder(orderedRows) - נקרא עם השורות בסדר החדש לאחר שחרור. באחריות הקורא לשמור.
//   reorderHint / reorderDisabledHint - טקסטי עזר (עם/בלי סינון פעיל).
//   הגרירה מושבתת אוטומטית כשסינון פעיל (כי אי-אפשר לגזור סדר גלובלי מרשימה מסוננת),
//   וגם כשיש שורה מורחבת בעריכה או מיון פעיל.
//
// מיון בלחיצה על כותרת עמודה:
//   לחיצה ממיינת בסדר עולה, לחיצה נוספת יורד, ולחיצה שלישית מבטלת את המיון.
//   ההשוואה לפי type: number/date מספרית, enum לפי התווית המוצגת, אחרת טקסט עברי
//   (localeCompare עם numeric). ערכים ריקים תמיד בסוף. המיון בזיכרון, אחרי הסינון.
//   sortable: false מבטל מיון לעמודה (ברירת מחדל: כל עמודה עם key ניתנת למיון).

function getValue(col, row) {
  if (col.value) return col.value(row);
  if (col.accessor) return row[col.accessor];
  return col.key ? row[col.key] : undefined;
}

function enumOptions(col) {
  if (col.options) return col.options;
  if (col.map) return Object.entries(col.map).map(([value, def]) => ({ value, label: def?.label ?? value }));
  return [];
}

function isFilterable(col) {
  return col.filterable !== false && !!col.key && col.type !== 'actions';
}

function isSortable(col) {
  return col.sortable !== false && !!col.key && col.type !== 'actions';
}

function enumLabel(col, v) {
  if (col.map) return col.map[v]?.label ?? String(v ?? '');
  const opt = (col.options || []).find((o) => String(o.value) === String(v));
  return opt?.label ?? String(v ?? '');
}

// השוואת שני ערכים לא-ריקים לפי טיפוס העמודה (ריקים מסוננים לפני הקריאה)
function compareCells(col, a, b) {
  switch (col.type) {
    case 'number': {
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      break;
    }
    case 'date': {
      const ta = new Date(a).getTime();
      const tb = new Date(b).getTime();
      if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
      break;
    }
    case 'boolean':
      return (a ? 1 : 0) - (b ? 1 : 0);
    case 'enum':
      return enumLabel(col, a).localeCompare(enumLabel(col, b), 'he', { numeric: true });
    default:
      break;
  }
  return String(a).localeCompare(String(b), 'he', { numeric: true, sensitivity: 'base' });
}

function matchesText(cell, term) {
  return String(cell ?? '').toLowerCase().includes(term.toLowerCase());
}

function matchesNumber(cell, { min, max }) {
  if (cell == null || cell === '') return false;
  const n = Number(cell);
  if (Number.isNaN(n)) return false;
  if (min !== '' && n < Number(min)) return false;
  if (max !== '' && n > Number(max)) return false;
  return true;
}

function matchesDate(cell, { from, to }) {
  if (!cell) return false;
  const t = new Date(cell).getTime();
  if (Number.isNaN(t)) return false;
  if (from && t < new Date(from).getTime()) return false;
  // 'to' כולל את כל היום שנבחר
  if (to && t > new Date(`${to}T23:59:59.999`).getTime()) return false;
  return true;
}

export function DataTable({
  columns,
  rows,
  actions,
  actionsLabel = '',
  renderExpanded,
  rowKey = (row) => row.id,
  expandedId,
  rowClassName,
  empty = 'לא נמצאו רשומות.',
  loading = 'טוען...',
  reorderable = false,
  onReorder,
  reorderHint = 'אפשר לגרור שורות כדי לשנות את הסדר',
  reorderDisabledHint = 'כדי לשנות סדר יש לנקות את הסינון',
  initialFilters,
  onRowClick,          // לחיצה על שורה (מחוץ לפקדים אינטראקטיביים) - פותחת רשומה
  onVisibleRowsChange, // נקרא עם השורות הגלויות (אחרי סינון+מיון) - לדפדוף בפאנל
}) {
  const [filters, setFilters] = useState(initialFilters || {});
  const [showFilters, setShowFilters] = useState(!!initialFilters && Object.keys(initialFilters).length > 0);
  const [draggingId, setDraggingId] = useState(null);
  const [sort, setSort] = useState(null); // { key, dir: 'asc' | 'desc' } או null

  const leadCols = reorderable ? 1 : 0;
  const colSpan = leadCols + columns.length + (actions ? 1 : 0);

  const setFilter = (key, patch) =>
    setFilters((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
  const clearFilters = () => setFilters({});

  // עולה -> יורד -> ביטול
  const toggleSort = (col) =>
    setSort((s) => {
      if (!s || s.key !== col.key) return { key: col.key, dir: 'asc' };
      return s.dir === 'asc' ? { key: col.key, dir: 'desc' } : null;
    });

  const activeFilterCount = useMemo(() => {
    let count = 0;
    for (const col of columns) {
      const f = filters[col.key];
      if (!f) continue;
      if (col.type === 'number' && ((f.min ?? '') !== '' || (f.max ?? '') !== '')) count += 1;
      else if (col.type === 'date' && (f.from || f.to)) count += 1;
      else if (col.type === 'boolean' && f.value != null && f.value !== '') count += 1;
      else if (col.type === 'enum' && f.value != null && f.value !== '') count += 1;
      else if ((col.type === 'text' || !col.type) && f.term) count += 1;
    }
    return count;
  }, [filters, columns]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const result = rows.filter((row) =>
      columns.every((col) => {
        if (!isFilterable(col)) return true;
        const f = filters[col.key];
        if (!f) return true;
        const cell = getValue(col, row);
        switch (col.type) {
          case 'number':
            if ((f.min ?? '') === '' && (f.max ?? '') === '') return true;
            return matchesNumber(cell, { min: f.min ?? '', max: f.max ?? '' });
          case 'date':
            if (!f.from && !f.to) return true;
            return matchesDate(cell, { from: f.from, to: f.to });
          case 'boolean':
            if (f.value == null || f.value === '') return true;
            return String(!!cell) === f.value;
          case 'enum':
            if (f.value == null || f.value === '') return true;
            return String(cell ?? '') === f.value;
          default:
            if (!f.term) return true;
            return matchesText(cell, f.term);
        }
      }),
    );
    return result;
  }, [rows, columns, filters]);

  // מיון בזיכרון על השורות המסוננות. ריקים תמיד בסוף, בשני הכיוונים.
  const sorted = useMemo(() => {
    if (!filtered || !sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const mul = sort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((ra, rb) => {
      const a = getValue(col, ra);
      const b = getValue(col, rb);
      const aEmpty = a == null || a === '';
      const bEmpty = b == null || b === '';
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
      return compareCells(col, a, b) * mul;
    });
  }, [filtered, sort, columns]);

  // חשיפת השורות הגלויות (אחרי סינון+מיון) לצורך דפדוף בין רשומות בפאנל.
  // columns מוגדר אינליין בכל עמוד ולכן sorted מקבל reference חדש בכל רינדור;
  // חתימה לפי מזהי-השורות מונעת קריאה מיותרת (ולולאת עדכון) כשהתוכן לא השתנה.
  const visibleSigRef = useRef('');
  useEffect(() => {
    if (!onVisibleRowsChange) return;
    const out = sorted || [];
    const sig = out.map((r) => rowKey(r)).join(',');
    if (sig !== visibleSigRef.current) {
      visibleSigRef.current = sig;
      onVisibleRowsChange(out);
    }
  });

  // לחיצה על שורה פותחת רשומה, אך לא כשלוחצים על פקד אינטראקטיבי בתוך התא.
  const handleRowClick = (row) => (e) => {
    if (!onRowClick) return;
    if (e.target.closest('button, a, input, select, textarea, label, [data-no-row-click]')) return;
    onRowClick(row);
  };

  // גרירה זמינה רק כשאין סינון או מיון פעילים ואין שורה בעריכה - אחרת אי-אפשר לגזור סדר גלובלי אמין.
  const canReorder = reorderable && !!onReorder && activeFilterCount === 0 && sort == null && expandedId == null;

  function handleDrop(targetKey) {
    if (!canReorder || draggingId == null || draggingId === targetKey) return;
    const fromIndex = sorted.findIndex((r) => rowKey(r) === draggingId);
    const toIndex = sorted.findIndex((r) => rowKey(r) === targetKey);
    setDraggingId(null);
    if (fromIndex < 0 || toIndex < 0) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    onReorder(reordered);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          className="text-sm text-brand-burgundy/70 hover:text-brand-burgundy inline-flex items-center gap-1.5"
        >
          <FilterIcon />
          {showFilters ? 'הסתרת סינון' : 'סינון'}
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-brand-gold text-brand-burgundy-dark text-xs font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>
        {activeFilterCount > 0 && (
          <button type="button" onClick={clearFilters} className="text-sm text-brand-burgundy/50 hover:underline">
            ניקוי סינון
          </button>
        )}
        {sort && (
          <button type="button" onClick={() => setSort(null)} className="text-sm text-brand-burgundy/50 hover:underline">
            ביטול מיון
          </button>
        )}
        {reorderable && (
          <span className="text-xs text-brand-burgundy/50">
            {canReorder
              ? reorderHint
              : activeFilterCount === 0 && sort
                ? 'כדי לשנות סדר יש לבטל את המיון'
                : reorderDisabledHint}
          </span>
        )}
        {rows && (
          <span className="text-sm text-brand-burgundy/40 mr-auto">
            {filtered.length}
            {filtered.length !== rows.length ? ` מתוך ${rows.length}` : ''} רשומות
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
          <thead className="bg-brand-burgundy text-brand-cream text-sm">
            <tr>
              {reorderable && <th className="p-3 text-right w-10" aria-label="סדר" />}
              {columns.map((col, i) => {
                const sortable = isSortable(col);
                const active = sortable && sort?.key === col.key;
                return (
                  <th
                    key={col.key || `col-${i}`}
                    className={`p-3 text-right ${col.headerClassName || ''}`}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        title={active ? (sort.dir === 'asc' ? 'מיון יורד' : 'ביטול המיון') : 'מיון לפי עמודה זו'}
                        className="group inline-flex items-center gap-1 text-right hover:text-brand-gold"
                      >
                        {col.label}
                        <SortIcon dir={active ? sort.dir : null} />
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
              {actions && <th className="p-3 text-right">{actionsLabel}</th>}
            </tr>
            {showFilters && (
              <tr className="bg-brand-burgundy/90">
                {reorderable && <th className="p-2" />}
                {columns.map((col, i) => (
                  <th key={col.key || `f-${i}`} className="p-2 align-top">
                    <FilterControl col={col} value={filters[col.key]} onChange={(patch) => setFilter(col.key, patch)} />
                  </th>
                ))}
                {actions && <th className="p-2" />}
              </tr>
            )}
          </thead>
          <tbody>
            {!rows ? (
              <tr><td colSpan={colSpan} className="p-6 text-center text-brand-burgundy/50">{loading}</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={colSpan} className="p-6 text-center text-brand-burgundy/50">{empty}</td></tr>
            ) : (
              sorted.map((row) => {
                const key = rowKey(row);
                const dragging = draggingId === key;
                return (
                  <Fragment key={key}>
                    <tr
                      draggable={canReorder}
                      onDragStart={canReorder ? (e) => {
                        setDraggingId(key);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(key));
                      } : undefined}
                      onDragOver={canReorder ? (e) => {
                        if (draggingId != null && draggingId !== key) {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }
                      } : undefined}
                      onDrop={canReorder ? (e) => { e.preventDefault(); handleDrop(key); } : undefined}
                      onDragEnd={canReorder ? () => setDraggingId(null) : undefined}
                      onClick={onRowClick ? handleRowClick(row) : undefined}
                      className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${canReorder ? 'cursor-grab active:cursor-grabbing' : onRowClick ? 'cursor-pointer' : ''} ${dragging ? 'opacity-40' : ''} ${rowClassName ? rowClassName(row) : ''}`}
                    >
                      {reorderable && (
                        <td className="p-3 text-brand-burgundy/45">
                          {canReorder ? <DragHandle label="גרירה לשינוי סדר" /> : <span className="text-brand-burgundy/20">⋮⋮</span>}
                        </td>
                      )}
                      {columns.map((col, i) => (
                        col.rawCell
                          ? <Fragment key={col.key || `c-${i}`}>{col.render(row)}</Fragment>
                          : (
                            <td key={col.key || `c-${i}`} className={`p-3 text-sm ${col.className || ''}`} dir={col.dir}>
                              {col.render ? col.render(row) : cellDefault(col, row)}
                            </td>
                          )
                      ))}
                      {actions && (
                        <td className="p-3 text-sm whitespace-nowrap">
                          <div className="flex flex-wrap gap-1">{actions(row)}</div>
                        </td>
                      )}
                    </tr>
                    {renderExpanded && expandedId === key && (
                      <tr className="border-b border-brand-cream-dark bg-brand-cream/20">
                        <td colSpan={colSpan} className="p-3 sm:p-4">{renderExpanded(row)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// תצוגת ברירת מחדל לתא כשאין render מותאם
function cellDefault(col, row) {
  const v = getValue(col, row);
  if (col.type === 'boolean') return v ? '✓' : '-';
  if (col.type === 'enum' && col.map) return col.map[v]?.label ?? v ?? '-';
  if (v == null || v === '') return '-';
  return String(v);
}

const filterInputCls =
  'w-full min-w-[6rem] border border-brand-cream-dark rounded-lg px-2 py-1 text-sm text-brand-burgundy bg-white focus:border-brand-gold outline-none';

function FilterControl({ col, value = {}, onChange }) {
  if (!isFilterable(col)) return null;

  switch (col.type) {
    case 'number':
      return (
        <div className="flex gap-1" dir="ltr">
          <input type="number" step="any" placeholder="מ־" value={value.min ?? ''}
            onChange={(e) => onChange({ min: e.target.value })} className={filterInputCls} />
          <input type="number" step="any" placeholder="עד" value={value.max ?? ''}
            onChange={(e) => onChange({ max: e.target.value })} className={filterInputCls} />
        </div>
      );
    case 'date':
      return (
        <div className="flex flex-col gap-1" dir="ltr">
          <input type="date" value={value.from ?? ''}
            onChange={(e) => onChange({ from: e.target.value })} className={filterInputCls} />
          <input type="date" value={value.to ?? ''}
            onChange={(e) => onChange({ to: e.target.value })} className={filterInputCls} />
        </div>
      );
    case 'boolean':
      return (
        <select value={value.value ?? ''} onChange={(e) => onChange({ value: e.target.value })} className={filterInputCls}>
          <option value="">הכל</option>
          <option value="true">{col.trueLabel || 'כן'}</option>
          <option value="false">{col.falseLabel || 'לא'}</option>
        </select>
      );
    case 'enum': {
      const opts = enumOptions(col);
      return (
        <select value={value.value ?? ''} onChange={(e) => onChange({ value: e.target.value })} className={filterInputCls}>
          <option value="">הכל</option>
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    default:
      return (
        <input value={value.term ?? ''} onChange={(e) => onChange({ term: e.target.value })}
          placeholder="חיפוש" className={filterInputCls} dir={col.dir} />
      );
  }
}

// אינדיקציית מיון: חץ כפול עמום כשלא פעיל (מתחזק ב-hover), חץ יחיד כשפעיל
function SortIcon({ dir }) {
  if (dir) {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 text-brand-gold" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {dir === 'asc' ? <path d="m6 15 6-6 6 6" /> : <path d="m6 9 6 6 6-6" />}
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 opacity-30 group-hover:opacity-70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 9 5-5 5 5" />
      <path d="m7 15 5 5 5-5" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18l-7 8v6l-4-2v-4Z" />
    </svg>
  );
}
