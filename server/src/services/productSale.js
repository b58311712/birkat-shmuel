// מכירת מוצרים מהמלאי ללקוח (מיגרציה 55, סעיף 38).
//
// המכירה היא שורת orders עם order_kind='product_sale', בלי מועד ובלי סעודות,
// שכל תוכנה הוא order_inventory_lines. המחיר הוא מחיר העלות של הפריט כולל מע"מ,
// בלי רווח - אותו כלל תמחור של אירוע (lib/costMath.js).
//
// כללי התמחור של שורה בודדת (כולל החסימה על מחיר חסר) יושבים ב-lib/saleLine.js,
// כדי שיהיו ניתנים לבדיקה בלי מסד נתונים.
//
// הטעינה כאן מרוכזת ולא פר-שורה: inventoryLineUnitCost טוענת פריט אחד בכל
// קריאה - נוח לתצוגה מקדימה בממשק, יקר לשורה אחר שורה בשמירה.
import { supabase } from '../lib/supabase.js';
import { indexConversions } from './inventoryUnitConversion.js';
import { round2 } from '../lib/costMath.js';
import { priceSaleLine } from '../lib/saleLine.js';
import { roundQuantity } from '../lib/inventoryPackages.js';
import { fetchVatRate } from './costing.js';
import { calcFinal } from './pricing.js';

// ---------------------------------------------------------------------------
// בניית שורות המכירה
// ---------------------------------------------------------------------------
// מקבל את השורות הגולמיות מהממשק ומחזיר:
//   lineRows  - שורות מוכנות ל-insert ל-order_inventory_lines (עם מחיר קפוא)
//   baseLines - [{ item_id, qty_base }] ל-RPC של סנכרון המלאי
//   error     - הודעה בעברית לשגיאת ולידציה, או null
//
// המחיר תמיד מחושב כאן ולא מתקבל מהממשק: המחיר הוא העלות, ואין למנהל שיקול דעת
// עליו (בשונה מאירוע, שם unit_cost ניתן לדריסה).
export async function buildSaleLines(rawLines) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  if (lines.length === 0) {
    return { error: 'יש להוסיף לפחות מוצר אחד למכירה.' };
  }

  const itemIds = [...new Set(lines.map((l) => l.inventory_item_id).filter(Boolean))];
  if (itemIds.length === 0) {
    return { error: 'יש לבחור פריט מלאי בכל שורה.' };
  }

  const [itemsRes, convsRes, vatRate] = await Promise.all([
    supabase.from('inventory_items')
      .select('id, name, unit, unit_id, last_purchase_price, vat_exempt, is_active, procurement_type')
      .in('id', itemIds),
    supabase.from('inventory_unit_conversions')
      .select('inventory_item_id, from_unit_id, factor_to_base')
      .in('inventory_item_id', itemIds),
    fetchVatRate(),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (convsRes.error) throw convsRes.error;

  const itemById = Object.fromEntries((itemsRes.data || []).map((i) => [i.id, i]));
  const conversionsByItem = indexConversions(convsRes.data || []);

  const lineRows = [];
  const qtyBaseByItem = {};

  for (const l of lines) {
    const item = itemById[l.inventory_item_id];
    const priced = priceSaleLine(item, l, vatRate, conversionsByItem[l.inventory_item_id]);
    if (priced.error) return { error: priced.error };

    qtyBaseByItem[item.id] = (qtyBaseByItem[item.id] || 0) + priced.qtyBase;
    lineRows.push(priced.row);
  }

  const baseLines = Object.entries(qtyBaseByItem)
    .map(([itemId, qty]) => ({ item_id: itemId, qty_base: roundQuantity(qty) }))
    .filter((l) => l.qty_base > 0);

  return { lineRows, baseLines, error: null };
}

// ---------------------------------------------------------------------------
// סנכרון המלאי מול מצב היעד של המכירה
// ---------------------------------------------------------------------------
// עוטף את ה-RPC sync_sale_inventory וממפה את השגיאות שלו לעברית, בתבנית
// mapRpcError של services/inventoryDeduction.js. יעד ריק = החזרת הכל (ביטול).
//
// מחזיר { ok: true, moved } או { ok: false, status, message }.
export async function syncSaleInventory(orderId, baseLines, actorId) {
  const { data, error } = await supabase.rpc('sync_sale_inventory', {
    p_order_id: orderId,
    p_lines: baseLines || [],
    p_performed_by: actorId || null,
  });

  if (!error) return { ok: true, moved: data || [] };

  const raw = `${error.message || ''} ${error.hint || ''} ${error.details || ''}`;
  if (raw.includes('insufficient-inventory')) {
    // ההודעה מה-RPC כוללת את שם הפריט והכמויות, ולכן מועברת כלשונה.
    const detail = String(error.message || '').replace('insufficient-inventory: ', '');
    return { ok: false, status: 409, message: `אין מספיק מלאי: ${detail}` };
  }
  if (raw.includes('sale-not-found')) {
    return { ok: false, status: 404, message: 'המכירה לא נמצאה.' };
  }
  if (raw.includes('not-a-sale')) {
    return { ok: false, status: 409, message: 'הפעולה חלה על מכירת מוצרים בלבד.' };
  }
  if (raw.includes('item-not-found')) {
    return { ok: false, status: 400, message: 'אחד הפריטים בשורות אינו קיים במלאי.' };
  }
  throw error;
}

// ---------------------------------------------------------------------------
// חישוב מחדש של סכומי המכירה
// ---------------------------------------------------------------------------
// מכירה היא שורות מלאי בלבד: אין מחיר בסיס ואין תוספות בתשלום. ההנחות והחיובים
// הידניים עוברים בטבלאות הקיימות ולכן נכנסים לחישוב כמו בכל הזמנה.
//
// השורות מתומחרות לפי unit_cost הקפוא שנשמר בהן ולא מחושבות מחדש (עיקרון
// המחירים הקפואים, סעיף 15.3): שינוי מחיר קנייה אחרי המכירה לא מזיז אותה.
export async function recomputeSaleAmounts(orderId) {
  const [linesRes, discRes, chargeRes] = await Promise.all([
    supabase.from('order_inventory_lines').select('line_total').eq('order_id', orderId),
    supabase.from('order_discounts').select('discount_amount').eq('order_id', orderId),
    supabase.from('order_manual_charges').select('amount').eq('order_id', orderId),
  ]);
  for (const r of [linesRes, discRes, chargeRes]) if (r.error) throw r.error;

  const inventoryLines = round2((linesRes.data || [])
    .reduce((s, l) => s + Number(l.line_total || 0), 0));
  const discounts = round2((discRes.data || [])
    .reduce((s, d) => s + Number(d.discount_amount || 0), 0));
  const manualCharges = round2((chargeRes.data || [])
    .reduce((s, c) => s + Number(c.amount || 0), 0));

  const finalAmount = calcFinal({
    baseAmount: 0,
    extrasAmount: 0,
    inventoryLines,
    manualCharges,
    discounts,
  });

  const { error } = await supabase.from('orders').update({
    base_amount: 0,
    extras_amount: 0,
    inventory_lines_amount: inventoryLines,
    manual_charges_amount: manualCharges,
    discount_amount: discounts,
    final_amount: finalAmount,
  }).eq('id', orderId);
  if (error) throw error;

  return {
    inventory_lines_amount: inventoryLines,
    manual_charges_amount: manualCharges,
    discount_amount: discounts,
    final_amount: finalAmount,
  };
}
