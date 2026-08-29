import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import PriceInput from './PriceInput.jsx';
import { withVat } from '../lib/vat.js';
import {
  packageQuantityTotal,
  splitPackageQuantity,
  formatInventoryQuantity,
  inventoryMinimumQuantity,
  isBelowMinimum,
} from '../lib/inventoryPackages.js';

// ---------------------------------------------------------------------------
// עורך שורות הזמנת רכש (סעיף 27.2) - משותף ליצירת הזמנה חדשה ולעריכת טיוטה
// קיימת, כדי שהתנהגות בחירת המוצרים, המחירים והמע"מ תהיה זהה בשני המסכים.
// ---------------------------------------------------------------------------

export const emptyPurchaseOrderLine = () => ({
  inventory_item_id: '',
  quantity: '',
  package_quantity: '',
  loose_quantity: '',
  estimated_price: '',
});

// שורות שנשמרו בשרת → שורות טופס. estimated_price מאוחסן כמחיר ליחידת בסיס,
// ובטופס מזינים מחיר למארז, ולכן מכפילים חזרה בגודל המארז מה-snapshot.
export function purchaseOrderLinesFromServer(lines = []) {
  return lines.map((line) => {
    const size = Number(line.package_size_snapshot) || 0;
    const split = splitPackageQuantity(line.quantity, size);
    return {
      inventory_item_id: line.inventory_item_id,
      quantity: size > 0 ? '' : String(line.quantity ?? ''),
      package_quantity: size > 0 ? String(split.packages) : '',
      loose_quantity: size > 0 ? String(split.loose) : '',
      estimated_price: line.estimated_price == null
        ? ''
        : Number(line.estimated_price) * (size || 1),
    };
  });
}

// הכמות בשורה ביחידות הבסיס - null כשהקלט אינו תקין.
function lineBaseQuantity(line, item) {
  return item?.package_size
    ? packageQuantityTotal(line.package_quantity, line.loose_quantity, item.package_size)
    : Number(line.quantity);
}

// סה"כ כולל מע"מ: מחושב פר-שורה כי כל פריט יכול להיות חייב או פטור בנפרד.
// estimated_price בטופס הוא מחיר בסיס (לפני מע"מ), למארז או ליחידה.
export function purchaseOrderLinesTotal(lines, allItems) {
  return lines.reduce((sum, l) => {
    const item = allItems?.find((i) => i.id === l.inventory_item_id);
    const baseQuantity = lineBaseQuantity(l, item);
    const pricedQuantity = item?.package_size
      ? Number(baseQuantity || 0) / Number(item.package_size)
      : baseQuantity;
    const base = Number(l.estimated_price);
    if (!Number.isFinite(pricedQuantity) || !Number.isFinite(base) || l.estimated_price === '') return sum;
    const withVatPrice = withVat(base, { exempt: item?.vat_exempt || false });
    return sum + pricedQuantity * (withVatPrice ?? base);
  }, 0);
}

// השורות התקינות בלבד (מוצר שנבחר + כמות חיובית).
export function validPurchaseOrderLines(lines, allItems) {
  return lines.filter((l) => {
    const item = allItems?.find((i) => i.id === l.inventory_item_id);
    return l.inventory_item_id && lineBaseQuantity(l, item) > 0;
  });
}

// שורות הטופס → גוף הבקשה לשרת (מארז או יחידה, לפי הגדרת המוצר).
export function buildPurchaseOrderLinesPayload(lines, allItems) {
  return lines.map((l) => {
    const item = allItems.find((i) => i.id === l.inventory_item_id);
    return item?.package_size ? {
      inventory_item_id: l.inventory_item_id,
      package_quantity: Number(l.package_quantity || 0),
      loose_quantity: Number(l.loose_quantity || 0),
      estimated_package_price: l.estimated_price === '' ? null : Number(l.estimated_price),
    } : {
      inventory_item_id: l.inventory_item_id,
      quantity: Number(l.quantity),
      estimated_price: l.estimated_price === '' ? null : Number(l.estimated_price),
    };
  });
}

// האם יש בשורות מוצר ברכש ישיר (מחייב שיוך לאירוע).
export function hasDirectEventLine(lines, allItems) {
  return lines.some((line) =>
    allItems?.find((item) => item.id === line.inventory_item_id)?.procurement_type === 'direct_event');
}

// ---------------------------------------------------------------------------
// useSupplierCatalog - כל מה שתלוי בספק שנבחר: המוצרים שהוא מספק, מחירי הקנייה
// האחרונים ממנו, וברירת המחדל של המתג "לפני/כולל מע"מ".
// ---------------------------------------------------------------------------
export function useSupplierCatalog(supplierId, onErr) {
  const [allItems, setAllItems] = useState(null);
  const [supplierPrices, setSupplierPrices] = useState({}); // item_id -> מחיר בסיס
  const [supplierIncludesVat, setSupplierIncludesVat] = useState(false);
  const [supplierItemIds, setSupplierItemIds] = useState(null); // Set; null = טרם נטען

  useEffect(() => { api.invItems('?active=true').then(setAllItems).catch(onErr); }, [onErr]);

  useEffect(() => {
    if (!supplierId) { setSupplierPrices({}); setSupplierIncludesVat(false); setSupplierItemIds(null); return; }
    let cancelled = false; // מונע דריסה בתשובה מאוחרת של ספק קודם
    setSupplierItemIds(null);
    api.supplier(supplierId).then((d) => {
      if (cancelled) return;
      const map = {};
      const ids = new Set();
      for (const it of d.items || []) {
        ids.add(it.item_id);
        if (it.last_purchase_price != null) map[it.item_id] = it.last_purchase_price;
      }
      setSupplierPrices(map);
      setSupplierItemIds(ids);
      setSupplierIncludesVat(d.supplier?.default_price_includes_vat || false);
    }).catch(() => { if (!cancelled) setSupplierItemIds(new Set()); });
    return () => { cancelled = true; };
  }, [supplierId]);

  // מוצרי הספק (סעיף 25.3, 27.1): שיוך מפורש בכרטיס הספק, או ספק ברירת מחדל בכרטיס המוצר.
  const supplierItems = useMemo(() => {
    if (!allItems || !supplierId || !supplierItemIds) return [];
    return allItems.filter((i) => supplierItemIds.has(i.id) || i.default_supplier_id === supplierId);
  }, [allItems, supplierId, supplierItemIds]);

  return { allItems, supplierItems, supplierItemIds, supplierPrices, supplierIncludesVat };
}

// ---------------------------------------------------------------------------
// PurchaseOrderLinesEditor - טבלת השורות עצמה.
// ---------------------------------------------------------------------------
export default function PurchaseOrderLinesEditor({
  supplierId,
  catalog,
  lines,
  setLines,
}) {
  const { allItems, supplierItems, supplierItemIds, supplierPrices, supplierIncludesVat } = catalog;
  const [shortageOnly, setShortageOnly] = useState(false); // הצגת מוצרי הספק שבחוסר בלבד

  const shortageItems = useMemo(() => supplierItems.filter(isBelowMinimum), [supplierItems]);
  const visibleItems = shortageOnly ? shortageItems : supplierItems;

  function setLine(idx, patch) { setLines((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x))); }
  function addLine() { setLines((r) => [...r, emptyPurchaseOrderLine()]); }
  function removeLine(idx) { setLines((r) => r.filter((_, i) => i !== idx)); }

  function onPickItem(idx, itemId) {
    const patch = { inventory_item_id: itemId, quantity: '', package_quantity: '', loose_quantity: '' };
    // ברירת מחדל למחיר משוער: מחיר לספק, אחרת מחיר קנייה אחרון בכרטיס
    const item = allItems?.find((i) => i.id === itemId);
    const normalizedPrice = supplierPrices[itemId] ?? item?.last_purchase_price;
    const price = normalizedPrice == null
      ? null
      : Number(normalizedPrice) * (Number(item?.package_size) || 1);
    if (price != null && lines[idx].estimated_price === '') patch.estimated_price = price;
    setLine(idx, patch);
  }

  const chosen = new Set(lines.map((l) => l.inventory_item_id));

  // אפשרויות הבחירה לשורה: מוצרי הספק שטרם נבחרו, ותמיד גם המוצר שכבר נבחר בשורה
  // (גם אם הוא מוסתר בגלל סינון חוסרים או החלפת ספק) כדי שלא ייעלם מהתצוגה.
  function itemOptions(line) {
    const options = visibleItems.filter((i) => i.id === line.inventory_item_id || !chosen.has(i.id));
    const selected = allItems?.find((i) => i.id === line.inventory_item_id);
    if (selected && !options.some((i) => i.id === selected.id)) return [selected, ...options];
    return options;
  }

  function itemLabel(item) {
    const direct = item.procurement_type === 'direct_event' ? ' · רכש ישיר' : '';
    const shortage = isBelowMinimum(item) ? ' · ⚠ מתחת למינימום' : '';
    return `${item.name} (${item.unit})${direct}${shortage}`;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <div className="text-sm text-brand-burgundy/70">פריטים</div>
        {supplierId && !supplierItemIds && <span className="text-xs text-brand-burgundy/50">טוען את מוצרי הספק...</span>}
        {supplierId && supplierItemIds && (
          <div className="flex rounded-lg border border-brand-cream-dark overflow-hidden text-xs">
            {[[false, `כל מוצרי הספק (${supplierItems.length})`], [true, `בחוסר בלבד (${shortageItems.length})`]].map(([value, label]) => (
              <button key={String(value)} type="button" onClick={() => setShortageOnly(value)}
                className={`px-3 py-1.5 transition-colors ${
                  shortageOnly === value ? 'bg-brand-gold/25 text-brand-burgundy font-medium' : 'text-brand-burgundy/55 hover:bg-brand-cream'
                }`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!supplierId && <p className="text-sm text-brand-burgundy/55">בחרו ספק כדי להציג את המוצרים שהוא מספק.</p>}
      {supplierId && supplierItemIds && supplierItems.length === 0 && (
        <p className="text-sm text-brand-burgundy/55">
          לא שויכו מוצרים לספק זה. אפשר לשייך אותם ב<Link to="/admin/suppliers" className="text-brand-burgundy underline">כרטיס הספק</Link>.
        </p>
      )}
      {supplierId && shortageOnly && supplierItems.length > 0 && shortageItems.length === 0 && (
        <p className="text-sm text-brand-burgundy/55">אין מוצרים של הספק מתחת לכמות המינימום.</p>
      )}
      {!allItems ? <p className="text-sm">טוען מוצרים...</p> : (
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-12 gap-2 text-xs text-brand-burgundy/50 px-1">
            <div className="col-span-5">מוצר</div><div className="col-span-3">כמות</div><div className="col-span-3">מחיר משוער</div><div className="col-span-1"></div>
          </div>
          <p className="text-xs text-brand-burgundy/50 px-1">הזינו את המחיר כפי שמופיע בחשבונית הספק; המתג "לפני/כולל מע"מ" קובע את הפרשנות. הערך נשמר תמיד כמחיר לפני מע"מ.</p>
          {lines.map((l, idx) => {
            const item = allItems.find((i) => i.id === l.inventory_item_id);
            return (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <select value={l.inventory_item_id} onChange={(e) => onPickItem(idx, e.target.value)}
                  disabled={!supplierId} className={`${inputCls} col-span-12 sm:col-span-5 disabled:bg-brand-cream disabled:text-brand-burgundy/40`}>
                  <option value="">{supplierId ? '- בחר מוצר -' : '- בחרו ספק תחילה -'}</option>
                  {itemOptions(l).map((i) => (
                    <option key={i.id} value={i.id}>{itemLabel(i)}</option>
                  ))}
                </select>
                {item?.package_size ? (
                  <div className="col-span-12 sm:col-span-3 grid grid-cols-2 gap-1">
                    <input type="number" step="1" min="0" placeholder={item.package_label} value={l.package_quantity}
                      onChange={(e) => setLine(idx, { package_quantity: e.target.value })} className={inputCls} dir="ltr" />
                    <input type="number" step="any" min="0" placeholder={item.unit} value={l.loose_quantity}
                      onChange={(e) => setLine(idx, { loose_quantity: e.target.value })} className={inputCls} dir="ltr" />
                  </div>
                ) : (
                  <input type="number" step="any" min="0" placeholder="כמות" value={l.quantity}
                    onChange={(e) => setLine(idx, { quantity: e.target.value })} className={`${inputCls} col-span-5 sm:col-span-3`} dir="ltr" />
                )}
                <div className="col-span-5 sm:col-span-3">
                  <PriceInput
                    value={l.estimated_price}
                    onChange={(base) => setLine(idx, { estimated_price: base ?? '' })}
                    exempt={item?.vat_exempt || false}
                    defaultIncludesVat={supplierIncludesVat}
                    className={inputCls}
                    placeholder={item?.package_size ? `מחיר ל${item.package_label}` : 'מחיר ליחידה'}
                  />
                </div>
                <button type="button" onClick={() => removeLine(idx)} className="col-span-2 sm:col-span-1 text-red-600 hover:underline text-sm">הסר</button>
                {item && <div className="col-span-12 text-xs text-brand-burgundy/50">
                  {item.package_size
                    ? `1 ${item.package_label} = ${item.package_size} ${item.unit} · המחיר הוא ל${item.package_label}`
                    : `יחידה: ${item.unit}`}
                  {isBelowMinimum(item) && (
                    <span className="text-red-600">
                      {' · ⚠ במלאי '}{formatInventoryQuantity(item.quantity_on_hand, item)}
                      {' מתוך מינימום '}{formatInventoryQuantity(inventoryMinimumQuantity(item), item)}
                    </span>
                  )}
                  {supplierId && supplierItemIds && !supplierItems.some((i) => i.id === item.id) && (
                    <span className="text-red-600">{' · המוצר אינו משויך לספק שנבחר'}</span>
                  )}
                </div>}
              </div>
            );
          })}
          <button type="button" onClick={addLine} className="btn-ghost text-sm">+ הוסף פריט</button>
        </div>
      )}
    </div>
  );
}

const inputCls = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none';
