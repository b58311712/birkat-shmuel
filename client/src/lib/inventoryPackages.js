export function roundInventoryQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

export function splitPackageQuantity(quantity, packageSize) {
  const total = Number(quantity);
  const size = Number(packageSize);
  if (!Number.isFinite(total) || !(size > 0) || total < 0) {
    return { packages: 0, loose: Number.isFinite(total) ? total : 0 };
  }
  const packages = Math.floor((total + 1e-9) / size);
  const loose = roundInventoryQuantity(total - packages * size);
  return { packages, loose: Math.abs(loose) < 0.0001 ? 0 : loose };
}

export function packageQuantityTotal(packages, loose, packageSize) {
  const count = Number(packages || 0);
  const remainder = Number(loose || 0);
  const size = Number(packageSize);
  if (!Number.isInteger(count) || count < 0 || remainder < 0 || !(size > 0)) return null;
  return roundInventoryQuantity(count * size + remainder);
}

export function formatInventoryQuantity(quantity, item = {}, options = {}) {
  const number = Number(quantity);
  const unit = options.unit ?? item.unit ?? '';
  const label = options.packageLabel ?? item.package_label;
  const size = Number(options.packageSize ?? item.package_size);
  const signed = !!options.signed;
  const prefix = signed && number > 0 ? '+' : '';

  if (!Number.isFinite(number)) return String(quantity ?? '');
  if (number < 0) return `חוסר ${formatNumber(Math.abs(number))} ${unit}`.trim();
  if (!(size > 0) || !label) return `${prefix}${formatNumber(number)} ${unit}`.trim();

  const { packages, loose } = splitPackageQuantity(number, size);
  const parts = [`${packages} ${label}`];
  if (loose > 0) parts.push(`${formatNumber(loose)} ${unit}`.trim());
  return `${prefix}${parts.join(' + ')}`;
}

// מלאי המינימום האפקטיבי של פריט (סעיף 30.3): פריט עם אריזה מגדיר מינימום
// במארזים שלמים, פריט ללא אריזה ביחידות. null = לא הוגדר מינימום.
export function inventoryMinimumQuantity(item = {}) {
  if (Number(item.package_size) > 0 && item.min_alert_packages != null)
    return roundInventoryQuantity(Number(item.package_size) * Number(item.min_alert_packages));
  return item.min_alert_quantity == null ? null : Number(item.min_alert_quantity);
}

// אזהרת חוסר: הכמות במלאי ירדה מתחת למינימום. פריטי רכש ישיר אינם מנוהלים
// במלאי ולכן לעולם אינם בחוסר.
export function isBelowMinimum(item = {}) {
  const minimum = inventoryMinimumQuantity(item);
  return item.procurement_type !== 'direct_event'
    && minimum != null
    && Number(item.quantity_on_hand) < minimum;
}

export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  return String(Number(number.toFixed(4)));
}
