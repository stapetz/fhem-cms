import { isValidName } from './fhem-client.js';
import { computeFlows } from '../components/cms-solarflow.js';

export const solarEnergyFields = [
  ['pv', 'PV-Leistung'], ['home', 'Hausverbrauch'],
  ['grid', 'Netzleistung (+ Einspeisung / - Bezug)'],
  ['battery', 'Speicherleistung (+ Laden / - Entladen)'], ['soc', 'Ladestand (%)'],
  ['status', 'Systemstatus'], ['hour', 'PV-Ertrag Stunde'], ['day', 'Ertrag heute gesamt'],
  ['month', 'Ertrag Monat gesamt'], ['year', 'Ertrag Jahr gesamt'], ['total', 'Ertrag seit Start'],
];
export const solarYieldFields = [
  ['total', 'Gesamt seit Start'], ['hour', 'Stunde'], ['day', 'Heute'],
  ['month', 'Monat'], ['previousMonth', 'Vormonat'], ['year', 'Jahr'],
];
export const MAX_SOLAR_SECTIONS = 8;

export function solarEnergyDevices(config) {
  return [...new Set([config.readings, ...(config.sections || []).map(section => section.readings)]
    .flatMap(readings => Object.values(readings || {}).map(source => source.device)))];
}

export function validateSolarEnergy(config) {
  const devices = new Set();
  const validateSources = (readings, fields) => {
    if (!readings || typeof readings !== 'object' || Array.isArray(readings)) throw new Error('Readings müssen ein Objekt sein.');
    for (const [key, source] of Object.entries(readings)) {
      if (!fields.some(([name]) => name === key) || !source || typeof source !== 'object'
        || Array.isArray(source) || Object.keys(source).length !== 2
        || !isValidName(source.device) || !isValidName(source.reading)) {
        throw new Error(`Ungültige Device-/Reading-Zuordnung: ${key}`);
      }
      devices.add(source.device);
    }
  };
  validateSources(config.readings, solarEnergyFields);
  if (!config.readings.pv) throw new Error('Device und Reading für die PV-Leistung sind erforderlich.');
  if (!Array.isArray(config.sections) || config.sections.length > MAX_SOLAR_SECTIONS) {
    throw new Error(`Höchstens ${MAX_SOLAR_SECTIONS} Ertragskarten sind erlaubt.`);
  }
  for (const section of config.sections) {
    if (!section || typeof section !== 'object' || Object.keys(section).some(key => !['label', 'readings'].includes(key))
      || typeof section.label !== 'string' || !section.label.trim() || section.label.length > 64
      || /[\u0000-\u001f\u007f]/.test(section.label)) throw new Error('Jede Ertragskarte benötigt einen gültigen Namen (1–64 Zeichen).');
    validateSources(section.readings, solarYieldFields);
    if (!Object.keys(section.readings).length) throw new Error('Jede Ertragskarte benötigt mindestens ein Reading.');
  }
  if (devices.size > 20) throw new Error('Höchstens 20 verschiedene Devices sind erlaubt.');
  for (const [key, values] of [['powerUnit', ['W', 'kW']], ['energyUnit', ['Wh', 'kWh', 'MWh']]]) {
    if (config[key] !== undefined && !values.includes(config[key])) throw new Error('Ungültige Reading-Einheit.');
  }
  if (config.threshold !== undefined && (!Number.isInteger(config.threshold) || config.threshold < 0 || config.threshold > 1000)) {
    throw new Error('Der Schwellwert muss zwischen 0 und 1000 Watt liegen.');
  }
  if (config.deriveHome !== undefined && typeof config.deriveHome !== 'boolean') throw new Error('Ungültige Hausverbrauchsberechnung.');
}

export function solarReading(source, snapshots) {
  if (!source) return null;
  const group = snapshots?.get(source.device);
  const value = group?.find(item => item.readings?.[source.reading] !== undefined)?.readings[source.reading];
  return value === undefined || value === null ? null : String(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 256);
}

export function solarNumber(source, snapshots) {
  const value = solarReading(source, snapshots)?.trim().replace(',', '.');
  if (!value || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function solarEnergyModel(config, snapshots) {
  const read = key => solarNumber(config.readings?.[key], snapshots);
  const scale = config.powerUnit === 'kW' ? 1000 : 1;
  const power = key => { const n = read(key); return n === null || !Number.isFinite(n * scale) ? null : n * scale; };
  const values = { pv: power('pv'), home: power('home'), grid: power('grid'), bat: power('battery') };
  if (values.pv !== null) values.pv = Math.max(0, values.pv);
  const missingSupply = [['grid', 'grid'], ['battery', 'bat']]
    .some(([key, value]) => config.readings?.[key] && values[value] === null);
  if (!config.readings?.home && config.deriveHome !== false && values.pv !== null && !missingSupply) {
    const home = values.pv - (values.grid || 0) - (values.bat || 0);
    values.home = Number.isFinite(home) ? Math.max(0, home) : null;
  }
  if (values.home !== null) values.home = Math.max(0, values.home);
  const flows = values.pv === null || values.home === null || missingSupply ? {} : computeFlows(values);
  const soc = read('soc');
  return { values, flows, soc: soc === null ? null : Math.max(0, Math.min(100, soc)),
    status: solarReading(config.readings?.status, snapshots) };
}
