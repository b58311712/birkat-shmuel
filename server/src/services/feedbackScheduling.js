const JERUSALEM_TZ = 'Asia/Jerusalem';

function jerusalemParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JERUSALEM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    weekday: value('weekday'),
    hour: Number(value('hour')),
  };
}

function isoDateUtc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function feedbackTargetDate(now = new Date()) {
  const p = jerusalemParts(now);
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  if (weekdayIndex < 0) return null;

  // Sunday-Friday target the immediately preceding Saturday. On Saturday, target
  // the previous week so feedback is never requested before the current Shabbat ends.
  const daysBack = weekdayIndex === 6 ? 7 : weekdayIndex + 1;
  const target = isoDateUtc(p.year, p.month, p.day);
  target.setUTCDate(target.getUTCDate() - daysBack);
  return target.toISOString().slice(0, 10);
}

export function isFeedbackRunDue(now = new Date()) {
  const p = jerusalemParts(now);
  if (p.weekday === 'Sat') return false;
  if (p.weekday === 'Sun' && p.hour < 10) return false;
  return true;
}

export { JERUSALEM_TZ };
