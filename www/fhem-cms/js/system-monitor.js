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

export function systemMonitorSnapshot(devices, systemDevice = '') {
  if (!Array.isArray(devices)) throw new Error('Ungültige FHEM-Geräteliste');
  const systems = devices.filter(device => device?.type === 'SYSMON' && isValidName(device.name));
  const selected = systemDevice ? systems.find(device => device.name === systemDevice) : null;
  const metrics = SYSTEM_READINGS.map(([label, name, alternate]) => {
    const item = reading(selected, name) || (alternate ? reading(selected, alternate) : null);
    return { label, reading: item?.name ?? name, value: item?.value ?? null, timestamp: item?.timestamp ?? null };
  });
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
  if (/^loadavg(?:_[135]|_15)?$/.test(reading)) return 'loadavg';
  if (/^cpu_.*(?:percent|usage)$/.test(reading) || reading === 'stat_cpu_usage') return 'stat_cpu_text';
  if (reading === 'fhemuptime' || reading === 'uptime') return `${reading}_text`;
  if (reading === 'cpu_temp') return reading;
  if (/^ram_/.test(reading)) return 'ram';
  if (/^swap_/.test(reading)) return 'swap';
  if (/^(?:fs_)?root_/.test(reading)) return 'root';
  return null;
}

export function systemMonitorGraphCandidates(devices, systemDevice) {
  if (!Array.isArray(devices)) throw new Error('Ungültige FHEM-Geräteliste');
  return devices.filter(device => isValidName(device?.name)
    && (device.type === 'SYSMON' ? device.name === systemDevice
      : device.type === 'DbLog' || device.type === 'FileLog'))
    .flatMap(device => Object.entries(device.readings || {})
      .filter(([name, value]) => isValidName(name)
        && (device.type === 'SYSMON' || LOG_READINGS.includes(name))
        && typeof value === 'string'
        && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
        && Number.isFinite(Number(value)))
      .map(([name]) => ({
        device: device.name, reading: name,
        title: `${device.name} · ${GRAPH_READINGS[name]?.[0] || name}`,
        unit: GRAPH_READINGS[name]?.[1] || '',
      })));
}
