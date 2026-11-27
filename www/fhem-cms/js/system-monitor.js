const SYSTEM_READINGS = [
  ['FHEM-Laufzeit', 'fhemuptime_text'],
  ['Systemlaufzeit', 'uptime_text'],
  ['CPU-Last', 'loadavg'],
  ['CPU-Auslastung', 'stat_cpu_text'],
  ['CPU-Temperatur', 'cpu_temp'],
  ['Arbeitsspeicher', 'ram'],
  ['Swap', 'swap'],
];

const LOG_READINGS = ['state', 'CacheUsage', 'CacheOverflowLastState', 'LastError', 'lastError'];

function text(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 512).trim();
}

function reading(device, name) {
  const value = text(device?.readings?.[name]);
  return value ? { name, value } : null;
}

export function systemMonitorSnapshot(devices, systemDevice = '') {
  if (!Array.isArray(devices)) throw new Error('Ungültige FHEM-Geräteliste');
  const systems = devices.filter(device => device?.type === 'SYSMON');
  const selected = systemDevice ? systems.find(device => device.name === systemDevice) : null;
  const metrics = SYSTEM_READINGS.map(([label, name]) => ({
    label, reading: name, value: reading(selected, name)?.value || null,
  }));
  const logs = devices.filter(device => device?.type === 'DbLog' || device?.type === 'FileLog')
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
