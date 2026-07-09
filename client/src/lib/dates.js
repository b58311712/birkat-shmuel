const HEBREW_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const HEBREW_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HEBREW_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

function dateFromIso(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0);
}

function addHebrewPunctuation(value) {
  if (!value) return '';
  if (value.length === 1) return `${value}'`;
  return `${value.slice(0, -1)}"${value.slice(-1)}`;
}

function hebrewNumber(value) {
  const parts = [];
  let n = Number(value);

  while (n >= 400) {
    parts.push('ת');
    n -= 400;
  }

  const hundreds = Math.floor(n / 100);
  if (hundreds) parts.push(HEBREW_HUNDREDS[hundreds]);
  n %= 100;

  if (n === 15) parts.push('טו');
  else if (n === 16) parts.push('טז');
  else {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    if (tens) parts.push(HEBREW_TENS[tens]);
    if (ones) parts.push(HEBREW_ONES[ones]);
  }

  return addHebrewPunctuation(parts.join(''));
}

export function formatGregorianDate(value) {
  const date = dateFromIso(value);
  if (!date) return value || '';
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatHebrewDate(value) {
  const date = dateFromIso(value);
  if (!date) return '';

  const parts = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(date);

  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value?.replace(/^ב/, '');
  const year = parts.find((part) => part.type === 'year')?.value;
  if (!day || !month || !year) return '';

  return `${hebrewNumber(day)} ${month} ${hebrewNumber(Number(year) % 1000)}`;
}

export function formatShabbatTitle(shabbat) {
  if (!shabbat) return '';
  return shabbat.parasha || '';
}

export function formatShabbatHebrewDate(shabbat) {
  if (!shabbat) return '';
  return formatHebrewDate(shabbat.gregorian_date) || shabbat.hebrew_date || '';
}
