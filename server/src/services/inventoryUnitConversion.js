import { roundQuantity } from '../lib/inventoryPackages.js';

// ממיר צריכה שנצברה לפי (פריט, יחידת מתכון) ליחידת הבסיס של כל פריט.
// byItem: item_id -> unit_key -> { unit_id, unit_name, qty }
export function convertRequirementsToBase(byItem, itemById, conversionsByItem) {
  const lines = [];
  const missing = [];

  for (const [itemId, perUnit] of Object.entries(byItem || {})) {
    const item = itemById[itemId];
    if (!item) continue;
    const factorByUnitId = conversionsByItem[itemId] || {};
    let quantity = 0;

    for (const requirement of Object.values(perUnit || {})) {
      const factor = requirement.unit_id && requirement.unit_id === item.unit_id
        ? 1
        : factorByUnitId[requirement.unit_id];
      if (factor == null) {
        missing.push({
          item_id: itemId,
          item_name: item.name,
          from_unit: requirement.unit_name,
          base_unit: item.unit,
        });
        continue;
      }
      quantity += Number(requirement.qty) * Number(factor);
    }

    if (quantity > 0) lines.push({ item_id: itemId, qty_base: roundQuantity(quantity) });
  }
  return { lines, missing };
}

export function indexConversions(conversions = []) {
  const indexed = {};
  for (const conversion of conversions) {
    if (!conversion.from_unit_id) continue;
    (indexed[conversion.inventory_item_id] ||= {})[conversion.from_unit_id] =
      Number(conversion.factor_to_base);
  }
  return indexed;
}

