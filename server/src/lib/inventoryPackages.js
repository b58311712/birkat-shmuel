export function finiteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function roundQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

export function packageConfig(input = {}) {
  const rawLabel = input.package_label;
  const rawSize = input.package_size;
  const label = rawLabel == null ? null : String(rawLabel).trim();
  const size = finiteNumber(rawSize);
  const hasLabel = !!label;
  const hasSize = rawSize !== '' && rawSize !== null && rawSize !== undefined;

  if (hasLabel !== hasSize) {
    return { error: 'יש להגדיר יחד שם מארז וגודל מארז.' };
  }
  if (!hasLabel) return { package_label: null, package_size: null };
  if (size === null || size <= 0) return { error: 'גודל המארז חייב להיות מספר חיובי.' };
  return { package_label: label, package_size: size };
}

export function quantityFromPackageInput(input = {}, size, legacyField = 'quantity') {
  const hasPackageInput =
    Object.prototype.hasOwnProperty.call(input, 'package_quantity')
    || Object.prototype.hasOwnProperty.call(input, 'loose_quantity');

  if (!hasPackageInput) return finiteNumber(input[legacyField]);
  if (!(Number(size) > 0)) return null;

  const packages = finiteNumber(input.package_quantity) ?? 0;
  const loose = finiteNumber(input.loose_quantity) ?? 0;
  if (!Number.isInteger(packages) || packages < 0 || loose < 0) return null;
  return roundQuantity(packages * Number(size) + loose);
}

export function packageSnapshot(item) {
  return Number(item?.package_size) > 0 && item?.package_label
    ? {
        package_label_snapshot: item.package_label,
        package_size_snapshot: Number(item.package_size),
      }
    : {
        package_label_snapshot: null,
        package_size_snapshot: null,
      };
}

export function effectiveMinimum(item) {
  if (Number(item?.package_size) > 0 && item?.min_alert_packages != null) {
    return roundQuantity(Number(item.min_alert_packages) * Number(item.package_size));
  }
  return item?.min_alert_quantity == null ? null : Number(item.min_alert_quantity);
}

