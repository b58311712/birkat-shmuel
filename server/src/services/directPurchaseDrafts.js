import { supabase } from '../lib/supabase.js';
import { packageSnapshot } from '../lib/inventoryPackages.js';
import { buildInventoryReport } from './shabbatFile.js';
import { directProcurementMetrics } from './directProcurement.js';

async function allocatePurchaseOrderNumber() {
  const { data, error } = await supabase.rpc('allocate_po_number', {
    p_year: new Date().getFullYear(),
  });
  if (error) throw error;
  return data;
}

function sumOrderedByItem(orders, excludedOrderId = null) {
  const result = {};
  for (const order of orders) {
    if (order.id === excludedOrderId || order.status === 'cancelled') continue;
    for (const line of order.purchase_order_lines || []) {
      result[line.inventory_item_id] =
        (result[line.inventory_item_id] || 0) + Number(line.quantity || 0);
    }
  }
  return result;
}

export async function synchronizeDirectPurchaseDrafts(shabbatId, createdBy = null) {
  const report = await buildInventoryReport(shabbatId);
  if (!report) return null;

  const { data: shabbat, error: shabbatError } = await supabase
    .from('shabbatot')
    .select('id, parasha, gregorian_date')
    .eq('id', shabbatId)
    .maybeSingle();
  if (shabbatError) throw shabbatError;
  if (!shabbat) return null;

  const { data: existingOrders, error: ordersError } = await supabase
    .from('purchase_orders')
    .select('id, supplier_id, status, is_direct_event_generated, purchase_order_lines(inventory_item_id, quantity)')
    .eq('shabbat_id', shabbatId);
  if (ordersError) throw ordersError;
  const allOrders = existingOrders || [];

  const results = [];
  const processedSuppliers = new Set();
  for (const group of report.direct_suppliers || []) {
    if (!group.supplier_id) continue;
    processedSuppliers.add(group.supplier_id);

    const generatedDrafts = allOrders.filter((order) =>
      order.supplier_id === group.supplier_id
      && order.status === 'draft'
      && order.is_direct_event_generated);
    const targetDraft = generatedDrafts[0] || null;

    // A historical duplicate generated draft must not be counted or edited alongside
    // the canonical draft. Cancel it so the operation converges to one draft per supplier.
    for (const duplicate of generatedDrafts.slice(1)) {
      const { error } = await supabase.from('purchase_orders')
        .update({ status: 'cancelled' }).eq('id', duplicate.id);
      if (error) throw error;
      duplicate.status = 'cancelled';
    }

    const orderedElsewhere = sumOrderedByItem(allOrders, targetDraft?.id || null);
    const lines = group.items.map((item) => {
      const quantity = directProcurementMetrics({
        required: item.required,
        ordered: orderedElsewhere[item.item_id] || 0,
        packageSize: item.package_size,
      }).remaining_to_order;
      if (!(quantity > 0)) return null;
      return {
        inventory_item_id: item.item_id,
        quantity,
        estimated_price: item.last_purchase_price,
        procurement_type_snapshot: 'direct_event',
        ...packageSnapshot(item),
      };
    }).filter(Boolean);

    if (lines.length === 0) {
      if (targetDraft) {
        const { error } = await supabase.from('purchase_orders')
          .update({ status: 'cancelled' }).eq('id', targetDraft.id);
        if (error) throw error;
        targetDraft.status = 'cancelled';
        results.push({ supplier_id: group.supplier_id, action: 'cancelled', purchase_order_id: targetDraft.id });
      }
      continue;
    }

    const estimatedAmount = lines.reduce(
      (sum, line) => sum + Number(line.estimated_price || 0) * Number(line.quantity), 0);

    if (targetDraft) {
      const { error: deleteError } = await supabase.from('purchase_order_lines')
        .delete().eq('purchase_order_id', targetDraft.id);
      if (deleteError) throw deleteError;
      const { error: insertError } = await supabase.from('purchase_order_lines')
        .insert(lines.map((line) => ({ ...line, purchase_order_id: targetDraft.id })));
      if (insertError) throw insertError;
      const { error: updateError } = await supabase.from('purchase_orders')
        .update({
          expected_delivery_date: shabbat.gregorian_date,
          estimated_amount: estimatedAmount || null,
        })
        .eq('id', targetDraft.id);
      if (updateError) throw updateError;
      results.push({ supplier_id: group.supplier_id, action: 'updated', purchase_order_id: targetDraft.id });
      continue;
    }

    const poNumber = await allocatePurchaseOrderNumber();
    const { data: purchaseOrder, error: createError } = await supabase.from('purchase_orders')
      .insert({
        po_number: poNumber,
        supplier_id: group.supplier_id,
        shabbat_id: shabbatId,
        status: 'draft',
        is_direct_event_generated: true,
        expected_delivery_date: shabbat.gregorian_date,
        estimated_amount: estimatedAmount || null,
        notes: `רכש ישיר לתיק שבת ${shabbat.parasha}`,
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (createError) throw createError;
    const { error: lineError } = await supabase.from('purchase_order_lines')
      .insert(lines.map((line) => ({ ...line, purchase_order_id: purchaseOrder.id })));
    if (lineError) throw lineError;
    allOrders.push({
      id: purchaseOrder.id,
      supplier_id: group.supplier_id,
      status: 'draft',
      is_direct_event_generated: true,
      purchase_order_lines: lines,
    });
    results.push({ supplier_id: group.supplier_id, action: 'created', purchase_order_id: purchaseOrder.id });
  }

  for (const staleDraft of allOrders.filter((order) =>
    order.is_direct_event_generated
    && order.status === 'draft'
    && !processedSuppliers.has(order.supplier_id))) {
    const { error } = await supabase.from('purchase_orders')
      .update({ status: 'cancelled' }).eq('id', staleDraft.id);
    if (error) throw error;
    staleDraft.status = 'cancelled';
    results.push({
      supplier_id: staleDraft.supplier_id,
      action: 'cancelled',
      purchase_order_id: staleDraft.id,
    });
  }

  return {
    shabbat_id: shabbatId,
    orders: results,
    unresolved_items: (report.direct_suppliers || [])
      .filter((group) => !group.supplier_id)
      .flatMap((group) => group.items)
      .filter((item) => item.remaining_to_order > 0)
      .map((item) => ({ item_id: item.item_id, name: item.name, quantity: item.remaining_to_order })),
  };
}
