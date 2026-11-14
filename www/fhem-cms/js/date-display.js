const dateOptions = { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' };
const dateFormatter = new Intl.DateTimeFormat('de-DE', dateOptions);
const timestampFormatter = new Intl.DateTimeFormat('de-DE', {
  ...dateOptions, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function formatDateDisplay(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? dateFormatter.format(value) : String(value);
  }
  if (typeof value !== 'string') return value;
  const german = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}:\d{2}(?::\d{2})?))?$/.exec(value);
  if (german) {
    const [, day, month, year, time] = german;
    const iso = `${year}-${month}-${day}${time ? ` ${time}` : ''}`;
    const formatted = formatDateDisplay(iso);
    return formatted === iso ? value : formatted;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute, second, zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (y < 1 || m < 1 || m > 12 || d < 1
    || d > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    || (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || Number(second || 0) > 59))) return value;
  if (!zone) return `${day}.${month}.${year}${hour === undefined ? '' : ` ${hour}:${minute}:${second || '00'}`}`;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(-2)) > 59)) return value;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second || '00'}${zone}`);
  return Number.isFinite(date.getTime()) ? timestampFormatter.format(date).replace(', ', ' ') : value;
}
