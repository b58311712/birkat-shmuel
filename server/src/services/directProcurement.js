import { roundQuantity } from '../lib/inventoryPackages.js';

export const STOCK_PROCUREMENT = 'stock';
export const DIRECT_EVENT_PROCUREMENT = 'direct_event';

export function isDirectEventProcurement(value) {
  return value === DIRECT_EVENT_PROCUREMENT;
}

export function purchaseReceiptAffectsStock(procurementType) {
  return !isDirectEventProcurement(procurementType);
}

export function directProcurementMetrics({
  required,
  ordered = 0,
  received = 0,
  packageSize = null,
}) {
  const need = Math.max(0, Number(required) || 0);
  const alreadyOrdered = Math.max(0, Number(ordered) || 0);
  const alreadyReceived = Math.max(0, Number(received) || 0);
  const uncovered = Math.max(0, need - alreadyOrdered);
  const size = Number(packageSize);
  const remaining = size > 0 && uncovered > 0
    ? Math.ceil((uncovered - 1e-9) / size) * size
    : uncovered;

  return {
    required: roundQuantity(need),
    ordered: roundQuantity(alreadyOrdered),
    received: roundQuantity(alreadyReceived),
    remaining_to_order: roundQuantity(remaining),
    over_ordered: roundQuantity(Math.max(0, alreadyOrdered - need)),
    procurement_status: alreadyOrdered > need
      ? 'over_ordered'
      : (remaining > 0 ? 'needs_order' : (alreadyReceived >= need ? 'received' : 'ordered')),
  };
}
