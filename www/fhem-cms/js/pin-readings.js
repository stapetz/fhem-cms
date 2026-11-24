import { formatDateDisplay } from './date-display.js';

export const PIN_READING_FIELDS = Object.freeze({
  thermostat: ['actual', 'target', 'valve', 'mode', 'battery'],
  'fhem-solarflow': ['pv', 'home', 'grid', 'battery', 'soc'],
  'fhem-solar-energy': ['pv', 'home', 'grid', 'battery', 'soc', 'status', 'hour', 'day', 'month', 'year', 'total'],
});
export const PIN_YIELD_FIELDS = ['total', 'hour', 'day', 'month', 'previousMonth', 'year'];
const SINGLE = new Set(['fhem-value', 'fhem-switch', 'fhem-icon', 'fhem-slider', 'fhem-select']);

export function pinReadingFields(widget) {
  const {type} = widget;
  if (SINGLE.has(type)) return widget.reading ? [{key: 'reading', device: widget.device,
    reading: widget.reading, unit: widget.unit || '', selected: type === 'fhem-value'}] : [];
  if (type === 'fhem-table') return (widget.rows || []).map((row, index) =>
    ({...row, key: `rows.${index}`, selected: false}));
  const fields = PIN_READING_FIELDS[type];
  if (!fields) return [];
  const source = (key, entry, prefix = 'readings') => typeof entry === 'string'
    ? {key: `${prefix}.${key}`, device: widget.device, reading: entry}
    : {key: `${prefix}.${key}`, ...entry};
  const result = fields.filter(key => widget.readings?.[key]).map(key =>
    ({...source(key, widget.readings[key]), selected: type === 'thermostat' && key === 'actual'}));
  if (type === 'fhem-solar-energy') (widget.sections || []).forEach((section, index) => {
    for (const key of PIN_YIELD_FIELDS) {
      if (section.readings?.[key]) result.push({...source(key, section.readings[key], `sections.${index}`),
        label: section.label, selected: false});
    }
  });
  return result;
}

export function validatePinReadings(widget) {
  if (!Object.hasOwn(widget, 'showOnPin')) return;
  const choices = widget.showOnPin;
  const fields = new Set(pinReadingFields(widget).map(field => field.key));
  if (!choices || typeof choices !== 'object' || Array.isArray(choices)
    || Object.entries(choices).some(([key, value]) => !fields.has(key) || typeof value !== 'boolean')) {
    throw new Error('showOnPin muss konfigurierte Werte auf echte Booleans abbilden');
  }
}

export function preservePinReadings(candidate, original) {
  if (!Object.hasOwn(candidate, 'showOnPin') && Object.hasOwn(original, 'showOnPin')) {
    const keys = new Set(pinReadingFields(candidate).map(field => field.key));
    candidate.showOnPin = Object.fromEntries(Object.entries(original.showOnPin).filter(([key]) => keys.has(key)));
  }
  return candidate;
}

export function pinReadingRaw(field, snapshots, mainOnly = false) {
  const group = snapshots.get(field.device);
  const item = mainOnly ? group?.find(item => item.name === field.device)
    : group?.find(item => Object.hasOwn(item.readings || {}, field.reading));
  const raw = item?.readings?.[field.reading];
  return typeof raw === 'string' || typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : null;
}

function pinReadingValue(widget, field, snapshots) {
  const raw = pinReadingRaw(field, snapshots, widget.type === 'fhem-select');
  if (raw === null || raw === '') return {value: '–', unit: ''};
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 256);
  if (!text) return {value: '–', unit: ''};
  if (widget.type === 'thermostat' && ['readings.actual', 'readings.target'].includes(field.key)
    && /^-?[0-9]+(\.[0-9]+)?$/.test(text.trim()) && Number.isFinite(Number(text))) {
    return {value: Number(text).toFixed(1), unit: '°C'};
  }
  if (widget.type === 'thermostat' && field.key === 'readings.valve') {
    const number = text.replace('%', '').trim();
    return /^-?[0-9]+(\.[0-9]+)?$/.test(number) && Number.isFinite(Number(number))
      ? {value: String(Math.max(0, Math.min(100, Number(number)))), unit: '%'} : {value: '–', unit: ''};
  }
  if (widget.type === 'fhem-slider') {
    const match = /^([-+]?(?:\d+(?:[.,]\d*)?|\.\d+))\s*%?$/.exec(text.trim());
    if (match && Number.isFinite(Number(match[1].replace(',', '.')))) {
      return {value: String(Number(match[1].replace(',', '.'))), unit: ''};
    }
  }
  if (widget.type === 'fhem-select' && Object.hasOwn(widget.labels || {}, text)) {
    return {value: formatDateDisplay(widget.labels[text]), unit: ''};
  }
  if (widget.type === 'fhem-solarflow' || widget.type === 'fhem-solar-energy') {
    if (field.key === 'readings.status') return {value: formatDateDisplay(text), unit: ''};
    const normalized = text.trim().replace(',', '.');
    const number = widget.type === 'fhem-solarflow' ? Number.parseFloat(normalized)
      : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized) ? Number(normalized) : NaN;
    if (!Number.isFinite(number)) return {value: '–', unit: ''};
    if (field.key === 'readings.soc') return {value: widget.type === 'fhem-solarflow'
      ? String(Math.round(Math.max(0, Math.min(100, number))))
      : Math.max(0, Math.min(100, number)).toLocaleString('de-DE', {maximumFractionDigits: 0}), unit: '%'};
    if (/^readings\.(pv|home|grid|battery)$/.test(field.key)) {
      const factor = (widget.type === 'fhem-solarflow' ? widget.unit : widget.powerUnit) === 'kW' ? 1000 : 1;
      const power = number * factor;
      if (!Number.isFinite(power)) return {value: '–', unit: ''};
      const value = /^readings\.(pv|home)$/.test(field.key) ? Math.max(0, power) : power;
      const digits = widget.type === 'fhem-solar-energy' && /^readings\.(pv|home)$/.test(field.key) ? 1 : 0;
      return {value: value.toFixed(digits), unit: 'W'};
    }
    const key = field.key.split('.').at(-1);
    const digits = field.key.startsWith('sections.') ? ['hour', 'day'].includes(key) ? 2 : key === 'year' || key === 'total' ? 0 : 1
      : key === 'day' || key === 'hour' ? 2 : key === 'month' ? 1 : 0;
    return {value: number.toFixed(digits), unit: widget.energyUnit || 'kWh'};
  }
  return {value: formatDateDisplay(text), unit: field.unit || ''};
}

export function pinReadingValues(widget, snapshots) {
  validatePinReadings(widget);
  if (widget.type === 'fhem-switch' && widget.showLabel !== true) return [];
  return pinReadingFields(widget)
    .filter(field => widget.showOnPin?.[field.key] ?? field.selected ?? false)
    .map(field => pinReadingValue(widget, field, snapshots));
}
