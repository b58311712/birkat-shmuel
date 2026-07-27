import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { Badge, PO_STATUS } from '../lib/status.jsx';
import PriceInput from '../components/PriceInput.jsx';
import { withVat } from '../lib/vat.js';
import {
  packageQuantityTotal,
  formatInventoryQuantity,
  inventoryMinimumQuantity,
  isBelowMinimum,
} from '../lib/inventoryPackages.js';

// הזמנות רכש (סעיף 27.2-27.3): רשימה, סינון ויצירת הזמנה חדשה (טיוטה).
// פירוט/קבלת סחורה/תשלום נמצאים במסך הפירוט (/admin/purchase-orders/:id).

export default function AdminPurchaseOrders({ onAuthError, currentAdmin }) {
  const [list, setList] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [creating, setCreating] = useState(false);
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  // טוענים את כל הזמנות הרכש; הסינון (ספק/סטטוס) נעשה בזיכרון ב-DataTable.
  const load = useCallback(() => {
    api.purchaseOrders('').then(setList).catch(handleErr);
  }, [handleErr]);

  useEffect(() => {
    api.suppliers('?active=true').then(setSuppliers).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function onCreated() {
    setCreating(false);
    load();
  }

  async function deletePurchaseOrder(po) {
    if (!confirm(`למחוק לצמיתות את הזמנת הרכש ${po.po_number}?`)) return;
    try { await api.deletePurchaseOrder(po.id); load(); }
    catch (e) { handleErr(e); }
  }

  const columns = [
    {
      key: 'po_number',
      label: 'מס׳',
      type: 'text',
      className: 'font-medium',
      render: (po) => (
        <Link to={`/admin/purchase-orders/${po.id}`} className="text-brand-burgundy hover:underline">{po.po_number}</Link>
      ),
    },
    {
      key: 'supplier',
      label: 'ספק',
      type: 'enum',
      value: (po) => po.supplier_id || '',
      options: suppliers.map((s) => ({ value: s.id, label: s.name })),
      render: (po) => po.supplier?.name || '-',
    },
    {
      key: 'status',
      label: 'סטטוס',
      type: 'enum',
      map: PO_STATUS,
      render: (po) => <Badge map={PO_STATUS} value={po.status} />,
    },
    {
      key: 'shabbat',
      label: 'אירוע',
      type: 'text',
      render: (po) => po.shabbat
        ? `${po.shabbat.parasha} · ${po.shabbat.gregorian_date}`
        : '-',
    },
    { key: 'expected_delivery_date', label: 'אספקה צפויה', type: 'date', dir: 'ltr', render: (po) => po.expected_delivery_date || '-' },
    { key: 'estimated_amount', label: 'משוער (לפני מע"מ)', type: 'number', dir: 'ltr', render: (po) => (po.estimated_amount != null ? `₪${po.estimated_amount}` : '-') },
    { key: 'actual_amount', label: 'בפועל (לפני מע"מ)', type: 'number', dir: 'ltr', render: (po) => (po.actual_amount != null ? `₪${po.actual_amount}` : '-') },
    { key: 'created_at', label: 'נוצרה', type: 'date', dir: 'ltr', className: 'text-brand-burgundy/60', render: (po) => new Date(po.created_at).toLocaleDateString('he-IL') },
  ];

  return (
    <Page title="הזמנות רכש" subtitle="יצירת הזמנות לספקים, קבלת סחורה למלאי ותשלום">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button onClick={() => setCreating(true)} className="btn-primary">+ הזמנת רכש חדשה</button>
        <Link to="/admin/suppliers" className="btn-ghost">→ ניהול ספקים</Link>
      </div>

      {creating && (
        <CreatePurchaseOrder suppliers={suppliers} onCreated={onCreated} onCancel={() => setCreating(false)} onErr={handleErr} />
      )}

      <DataTable
        columns={columns}
        rows={list}
        empty="אין הזמנות רכש."
        actions={canDelete ? (po) => (
          <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deletePurchaseOrder(po)} />
        ) : undefined}
      />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// יצירת הזמנת רכש חדשה (טיוטה)
// ---------------------------------------------------------------------------
function CreatePurchaseOrder({ suppliers, onCreated, onCancel, onErr }) {
  const [supplierId, setSupplierId] = useState('');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [shabbatId, setShabbatId] = useState('');
  const [shabbatot, setShabbatot] = useState([]);
  const [allItems, setAllItems] = useState(null);
  const emptyLine = () => ({ inventory_item_id: '', quantity: '', package_quantity: '', loose_quantity: '', estimated_price: '' });
  const [lines, setLines] = useState([emptyLine()]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.invItems('?active=true').then(setAllItems).catch(onErr); }, [onErr]);
  useEffect(() => { api.allShabbatot().then(setShabbatot).catch(() => {}); }, []);

  // כשבוחרים ספק - טוענים את המוצרים שהוא מספק (לצמצום רשימת הבחירה), מחיר קנייה
  // אחרון פר מוצר (לברירת מחדל של מחיר משוער) וברירת המחדל של המתג "לפני/כולל מע"מ".
  const [supplierPrices, setSupplierPrices] = useState({}); // item_id -> price (בסיס)
  const [supplierIncludesVat, setSupplierIncludesVat] = useState(false);
  const [supplierItemIds, setSupplierItemIds] = useState(null); // Set של מזהי מוצרים; null = טרם נטען
  const [shortageOnly, setShortageOnly] = useState(false); // הצגת מוצרי הספק שבחוסר בלבד
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
  const shortageItems = useMemo(() => supplierItems.filter(isBelowMinimum), [supplierItems]);
  const visibleItems = shortageOnly ? shortageItems : supplierItems;

  function setLine(idx, patch) { setLines((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x))); }
  function addLine() { setLines((r) => [...r, emptyLine()]); }
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

  // סה"כ כולל מע"מ: מחשבים פר-שורה כי כל פריט יכול להיות חייב או פטור בנפרד.
  // estimated_price מאוחסן כמחיר בסיס (לפני מע"מ) → מוסיפים מע"מ אלא אם הפריט פטור.
  const total = lines.reduce((sum, l) => {
    const item = allItems?.find((i) => i.id === l.inventory_item_id);
    const baseQuantity = item?.package_size
      ? packageQuantityTotal(l.package_quantity, l.loose_quantity, item.package_size)
      : Number(l.quantity);
    const pricedQuantity = item?.package_size
      ? Number(baseQuantity || 0) / Number(item.package_size)
      : baseQuantity;
    const base = Number(l.estimated_price);
    if (!Number.isFinite(pricedQuantity) || !Number.isFinite(base) || l.estimated_price === '') return sum;
    const withVatPrice = withVat(base, { exempt: item?.vat_exempt || false });
    return sum + pricedQuantity * (withVatPrice ?? base);
  }, 0);

  async function submit(e) {
    e.preventDefault();
    if (!supplierId) return alert('חובה לבחור ספק.');
    const clean = lines.filter((l) => {
      const item = allItems?.find((i) => i.id === l.inventory_item_id);
      const quantity = item?.package_size
        ? packageQuantityTotal(l.package_quantity, l.loose_quantity, item.package_size)
        : Number(l.quantity);
      return l.inventory_item_id && quantity > 0;
    });
    if (clean.length === 0) return alert('חובה להוסיף לפחות פריט אחד עם כמות.');
    const hasDirectItem = clean.some((line) =>
      allItems?.find((item) => item.id === line.inventory_item_id)?.procurement_type === 'direct_event');
    if (hasDirectItem && !shabbatId)
      return alert('מוצר ברכש ישיר מחייב בחירת אירוע.');
    setBusy(true);
    try {
      await api.createPurchaseOrder({
        supplier_id: supplierId,
        shabbat_id: shabbatId || null,
        expected_delivery_date: expected || null,
        notes,
        lines: clean.map((l) => {
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
        }),
      });
      onCreated();
    } catch (err) { onErr(err); }
    finally { setBusy(false); }
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
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold mb-4">
      <h3 className="font-bold text-brand-burgundy">הזמנת רכש חדשה</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="ספק *">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
            <option value="">- בחר ספק -</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="תאריך אספקה צפוי">
          <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="אירוע">
          <select value={shabbatId} onChange={(e) => setShabbatId(e.target.value)} className={inputCls}>
            <option value="">- ללא שיוך -</option>
            {shabbatot.map((shabbat) => (
              <option key={shabbat.id} value={shabbat.id}>
                {shabbat.parasha} · {shabbat.gregorian_date}
              </option>
            ))}
          </select>
        </Field>
      </div>

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

      <Field label="הערות">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} rows={2} />
      </Field>

      <div className="flex items-center justify-between border-t border-brand-cream-dark pt-3">
        <div className="font-semibold text-brand-burgundy">מחיר משוער כולל (כולל מע"מ): ₪{total.toFixed(2)}</div>
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'יוצר...' : 'יצירת הזמנה'}</button>
          <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
const inputCls = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm text-brand-burgundy/70 block mb-1">{label}</span>
      {children}
    </label>
  );
}
