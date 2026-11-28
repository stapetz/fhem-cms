import { isValidName } from './fhem-client.js';

const SYSTEM_READINGS = [
  ['FHEM-Laufzeit', 'fhemuptime_text'],
  ['Systemlaufzeit', 'uptime_text'],
  ['Load Average (1/5/15 Min.)', 'loadavg'],
  ['CPU-Auslastung', 'stat_cpu_text'],
  ['CPU-Temperatur', 'cpu_temp'],
  ['Arbeitsspeicher', 'ram'],
  ['Swap', 'swap'],
  ['Dateisystem /', 'fs_root', 'root'],
];

export function systemMonitorMetricKey(reading) {
  return reading === 'fs_root' ? 'root' : reading;
}

function numeric(device, name, max = Infinity, min = 0) {
  const item = reading(device, name);
  if (!item || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(item.value)) return null;
  const value = Number(item.value);
  return Number.isFinite(value) && value >= min && value <= max ? {...item, number:value} : null;
}

const numberLabel = value => value.toLocaleString('de-DE', {maximumFractionDigits:1});

export const SYSTEM_METRIC_UNITS = ['', '%', '°C', 'B', 'KiB', 'MiB', 'GiB', 'MB', 'GB',
  'B/s', 'KiB/s', 'MiB/s', 'kB/s', 'Mbit/s', 's', 'W'];

export function systemMonitorAdditionalReadings(mapping) {
  return mapping.additionalReadings ?? (mapping.secondaryReading
    ? [{reading:mapping.secondaryReading, unit:mapping.secondaryUnit || ''}] : []);
}

export function validateSystemMetricMappings(mappings) {
  if (!Array.isArray(mappings) || mappings.length > 21) throw new Error('Höchstens 21 Wertezuordnungen erlaubt.');
  const keys = new Set();
  for (const item of mappings) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => !['key','label','reading','unit','totalReading','secondaryReading','secondaryUnit','additionalReadings'].includes(key))
      || ![...SYSTEM_READINGS.map(([,name]) => systemMonitorMetricKey(name)), 'network'].includes(item.key)
        && !/^custom-[A-Za-z0-9_-]{1,40}$/.test(item.key || '')
      || keys.has(item.key) || typeof item.label !== 'string' || !item.label.trim()
      || item.label.length > 64 || /[\x00-\x1f\x7f]/.test(item.label)
      || !SYSTEM_METRIC_UNITS.includes(item.unit)
      || !['reading','totalReading','secondaryReading'].every(key =>
        item[key] === undefined && key !== 'reading' || typeof item[key] === 'string'
          && (item[key] === '' || isValidName(item[key])))
      || item.secondaryUnit !== undefined && !SYSTEM_METRIC_UNITS.includes(item.secondaryUnit)) {
      throw new Error('Ungültige Wertezuordnung: Bezeichnung, Reading und Einheit prüfen.');
    }
    const additions = systemMonitorAdditionalReadings(item);
    if (!Array.isArray(additions)
      || item.additionalReadings !== undefined && item.secondaryReading
      || additions.some(row => !row || typeof row !== 'object' || Array.isArray(row)
        || Object.keys(row).some(key => !['reading','unit'].includes(key))
        || typeof row.reading !== 'string' || row.reading !== '' && !isValidName(row.reading)
        || !SYSTEM_METRIC_UNITS.includes(row.unit))
      || new Set([item.reading, ...additions.map(row => row.reading)].filter(Boolean)).size
        !== [item.reading,...additions.map(row => row.reading)].filter(Boolean).length) {
      throw new Error('Ungültige Datenreihen: eindeutige Readings und Einheiten wählen.');
    }
    keys.add(item.key);
  }
  if (mappings.filter(item => item.key.startsWith('custom-')).length > 12) {
    throw new Error('Höchstens zwölf zusätzliche Werteboxen erlaubt.');
  }
}

export function systemMonitorMetricMappings(devices, systemDevice, mappings = []) {
  validateSystemMetricMappings(mappings);
  const device = devices.find(item => item.name === systemDevice && item.type === 'SYSMON');
  const choose = (...names) => names.find(name => reading(device, name)) || '';
  const defaults = SYSTEM_READINGS.map(([label, name, alternate]) => ({
    key:systemMonitorMetricKey(name), label, reading:choose(name, alternate), unit:'',
  }));
  for (const item of defaults) {
    if (item.key === 'stat_cpu_text') { item.reading = choose('cpu_usage', 'stat_cpu_text'); item.unit = item.reading === 'cpu_usage' ? '%' : ''; }
    if (['ram','swap'].includes(item.key)) {
      item.reading = choose(`${item.key}_used`, item.key);
      item.unit = item.reading.endsWith('_used') ? 'MB' : '';
      item.totalReading = choose(`${item.key}_total`);
    }
    if (item.key === 'root') {
      item.reading = choose('root_used_percent','fs_root_used_percent','fs_root','root');
      item.unit = item.reading.endsWith('_percent') ? '%' : '';
    }
    if (item.key === 'cpu_temp') item.unit = '°C';
  }
  defaults.push({key:'network',label:'Netzwerk',reading:choose('net_rx_kbs'),unit:'KiB/s',
    secondaryReading:choose('net_tx_kbs'),secondaryUnit:'KiB/s'});
  return [...defaults.map(item => mappings.find(mapping => mapping.key === item.key) || item),
    ...mappings.filter(item => item.key.startsWith('custom-'))];
}

function metricPresentation(device, key) {
  if (key === 'stat_cpu_text') {
    const cpu = numeric(device, 'cpu_usage', 100);
    return cpu ? {displayValue:`${numberLabel(cpu.number)} %`, displayTimestamp:cpu.timestamp} : {};
  }
  if (key === 'root') {
    const used = numeric(device, 'root_used_percent', 100) || numeric(device, 'fs_root_used_percent', 100);
    return used ? {displayValue:`${numberLabel(used.number)} % belegt`, progress:used.number, displayTimestamp:used.timestamp} : {};
  }
  if (key !== 'ram' && key !== 'swap') return {};
  const used = numeric(device, `${key}_used`);
  const totalReading = numeric(device, `${key}_total`);
  const totalText = reading(device, key)?.value.match(/^Total:\s*(\d+(?:\.\d+)?)\s+MB(?:,|$)/);
  const total = totalReading?.number ?? (totalText ? Number(totalText[1]) : null);
  if (!used) return {};
  if (total === null || !Number.isFinite(total) || total <= 0 || used.number > total) {
    return {displayValue:`${numberLabel(used.number)} MB belegt`, displayTimestamp:used.timestamp};
  }
  const progress = used.number / total * 100;
  return {displayValue:`${numberLabel(used.number)} / ${numberLabel(total)} MB · ${numberLabel(progress)} %`,
    progress, displayTimestamp:used.timestamp};
}

const LOG_READINGS = [
  'state', 'CacheUsage', 'CacheOverflowLastState', 'CacheOverflowLastNum',
  'LastError', 'lastError', 'DbFileSize', 'logfileSize', 'LogFileSize',
];
const pendingLoads = new WeakMap();

export function loadSystemMonitorDevices(service) {
  if (typeof service !== 'function') throw new Error('FHEM-Gerätedienst nicht verfügbar');
  if (!pendingLoads.has(service)) {
    const request = Promise.resolve().then(() => service());
    pendingLoads.set(service, request);
    request.then(() => pendingLoads.delete(service), () => pendingLoads.delete(service));
  }
  return pendingLoads.get(service);
}

function text(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 512).trim();
}

function reading(device, name) {
  const value = text(device?.readings?.[name]);
  return value ? { name, value, timestamp: text(device?.readingTimes?.[name]) || null } : null;
}

export function systemMonitorSnapshot(devices, systemDevice = '', mappings = []) {
  if (!Array.isArray(devices)) throw new Error('Ungültige FHEM-Geräteliste');
  validateSystemMetricMappings(mappings);
  const systems = devices.filter(device => device?.type === 'SYSMON' && isValidName(device.name));
  const selected = systemDevice ? systems.find(device => device.name === systemDevice) : null;
  const metrics = SYSTEM_READINGS.map(([label, name, alternate]) => {
    const item = reading(selected, name) || (alternate ? reading(selected, alternate) : null);
    return { label, reading: item?.name ?? name, value: item?.value ?? null, timestamp: item?.timestamp ?? null,
      ...metricPresentation(selected, systemMonitorMetricKey(item?.name ?? name)) };
  });
  const rx = numeric(selected, 'net_rx_kbs'), tx = numeric(selected, 'net_tx_kbs');
  metrics.push({label:'Netzwerk', reading:'network',
    value:rx || tx ? `Empfang: ${rx?.value ?? 'Nicht verfügbar'} · Versand: ${tx?.value ?? 'Nicht verfügbar'}` : null,
    displayValue:rx || tx ? `↓ ${rx ? numberLabel(rx.number) : '–'} · ↑ ${tx ? numberLabel(tx.number) : '–'} KiB/s` : null,
    timestamp:[rx?.timestamp, tx?.timestamp].filter(Boolean).sort()[0] || null});
  for (const item of metrics) item.key = systemMonitorMetricKey(item.reading);
  for (const mapping of mappings) {
    const raw = reading(selected, mapping.reading);
    const value = numeric(selected, mapping.reading, mapping.unit === '%' ? 100 : Infinity,
      mapping.unit === '%' ? 0 : -Infinity);
    const additions = systemMonitorAdditionalReadings(mapping);
    let total = numeric(selected, mapping.totalReading);
    if (!mapping.totalReading && ['ram','swap'].includes(mapping.key) && mapping.unit === 'MB') {
      const capacity = reading(selected, mapping.key)?.value.match(/^Total:\s*(\d+(?:\.\d+)?)\s+MB(?:,|$)/);
      if (capacity && Number(capacity[1]) > 0) total = {number:Number(capacity[1])};
    }
    const suffix = mapping.unit ? ` ${mapping.unit}` : '';
    let displayValue = value ? `${numberLabel(value.number)}${suffix}` : mapping.unit ? null : raw?.value;
    if (additions.length) {
      displayValue = [{reading:mapping.reading,unit:mapping.unit},...additions].map((row,index) => {
        const measured = numeric(selected,row.reading,row.unit === '%' ? 100 : Infinity,row.unit === '%' ? 0 : -Infinity);
        const label = mapping.key === 'network' && index < 2 ? index ? '↑' : '↓' : row.reading || 'Wert';
        return `${label} ${measured ? numberLabel(measured.number) + (row.unit ? ` ${row.unit}` : '') : '–'}`;
      }).join(' · ');
    } else if (value && value.number >= 0 && total?.number > 0 && value.number <= total.number) {
      displayValue = `${numberLabel(value.number)} / ${numberLabel(total.number)}${suffix} · ${numberLabel(value.number / total.number * 100)} %`;
    }
    const progress = !additions.length && value
      ? total?.number > 0 && value.number >= 0 && value.number <= total.number ? value.number / total.number * 100
        : mapping.unit === '%' ? value.number : undefined : undefined;
    const metric = {key:mapping.key, reading:mapping.reading, label:mapping.label,
      value:raw?.value ?? null, timestamp:raw?.timestamp ?? null,
      displayValue:displayValue ?? 'Nicht verfügbar', progress,
      displayTimestamp:[raw?.timestamp,...additions.map(row=>reading(selected,row.reading)?.timestamp)]
        .filter(Boolean).sort()[0] || null};
    const index = metrics.findIndex(item => item.key === mapping.key);
    if (index < 0) metrics.push(metric); else metrics[index] = metric;
  }
  const logs = devices.filter(device => isValidName(device?.name)
    && (device?.type === 'DbLog' || device?.type === 'FileLog'))
    .map(device => ({
      name: text(device.name),
      type: device.type,
      readings: LOG_READINGS.map(name => reading(device, name)).filter(Boolean),
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'de'));
  return {
    systems: systems.map(device => ({name: text(device.name), alias: text(device.alias)})),
    selected: selected ? text(selected.name) : null,
    metrics,
    logs,
  };
}

const GRAPH_READINGS = {
  cpu_usage: ['CPU-Auslastung', '%'],
  loadavg_1: ['Lastmittel · 1 Minute', ''],
  loadavg_5: ['Lastmittel · 5 Minuten', ''],
  loadavg_15: ['Lastmittel · 15 Minuten', ''],
  net_rx_kbs: ['Netzwerk Empfang', 'KiB/s'],
  net_tx_kbs: ['Netzwerk Versand', 'KiB/s'],
  fhemuptime: ['FHEM-Laufzeit', 's'],
  uptime: ['Systemlaufzeit', 's'],
  cpu_temp: ['CPU-Temperatur', '°C'],
  ram_used: ['Arbeitsspeicher belegt', 'MB'],
  swap_used: ['Swap belegt', 'MB'],
  root_used_percent: ['Dateisystem / belegt', '%'],
  fs_root_used_percent: ['Dateisystem / belegt', '%'],
  CacheUsage: ['DbLog-Cache', ''],
};

export function systemMonitorMetricForGraph(reading) {
  if (reading === 'net_rx_kbs' || reading === 'net_tx_kbs') return 'network';
  if (/^loadavg(?:_[135]|_15)?$/.test(reading)) return 'loadavg';
  if (/^cpu_.*(?:percent|usage)$/.test(reading) || reading === 'stat_cpu_usage') return 'stat_cpu_text';
  if (reading === 'fhemuptime' || reading === 'uptime') return `${reading}_text`;
  if (reading === 'cpu_temp') return reading;
  if (/^ram_/.test(reading)) return 'ram';
  if (/^swap_/.test(reading)) return 'swap';
  if (/^(?:fs_)?root_/.test(reading)) return 'root';
  return null;
}

export function systemMonitorGraphCandidates(devices, systemDevice, mappings = []) {
  if (!Array.isArray(devices)) throw new Error('Ungültige FHEM-Geräteliste');
  validateSystemMetricMappings(mappings);
  return devices.filter(device => isValidName(device?.name)
    && (device.type === 'SYSMON' ? device.name === systemDevice
      : device.type === 'DbLog' || device.type === 'FileLog'))
    .flatMap(device => Object.entries(device.readings || {})
      .filter(([name, value]) => isValidName(name)
        && (device.type === 'SYSMON' || LOG_READINGS.includes(name))
        && typeof value === 'string'
        && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
        && Number.isFinite(Number(value)))
      .flatMap(([name]) => {
        const mapped = mappings.filter(item => item.reading === name
          || systemMonitorAdditionalReadings(item).some(row => row.reading === name));
        const base = {
        device: device.name, reading: name,
        title: `${device.name} · ${GRAPH_READINGS[name]?.[0] || name}`,
        unit: GRAPH_READINGS[name]?.[1] || '',
        };
        if (device.name !== systemDevice) return [base];
        const automatic = systemMonitorMetricForGraph(name);
        const result = mapped.length || automatic && mappings.some(item => item.key === automatic) ? [] : [base];
        return [...result, ...mapped.map(item => ({...base, metric:item.key,
          title:`${device.name} · ${item.label}`,unit:item.reading === name ? item.unit
            : systemMonitorAdditionalReadings(item).find(row => row.reading === name)?.unit || ''}))];
      }));
}
