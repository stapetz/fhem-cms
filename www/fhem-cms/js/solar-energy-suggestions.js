import { isValidName } from './fhem-client.js';

const POWER_READINGS = {
  pv: ['pv_total_power', 'pvPower', 'pv_power', 'PVPower', 'powerPV'],
  home: ['home_power', 'homePower', 'house_power', 'housePower'],
  grid: ['grid_feed_in_power', 'gridFeedInPower'],
  battery: ['battery_power', 'batteryPower'],
  soc: ['battery_remain_capacity', 'batterySOC', 'battery_soc', 'stateOfCharge', 'soc'],
};
const PERIODS = { hour: 'Hour', day: 'Day', month: 'Month', previousMonth: 'MonthLast', year: 'Year' };
const source = (device, reading) => ({ device: device.name, reading });
const namesOf = device => Object.keys(device?.readings || {}).filter(isValidName);

function uniqueReading(device, aliases) {
  const matches = namesOf(device).filter(name => aliases.includes(name));
  return matches.length === 1 ? source(device, matches[0]) : null;
}

function yieldGroups(device) {
  const names = new Set(namesOf(device));
  const groups = new Map();
  for (const name of names) {
    const match = /^(?:stat)?(Energy[A-Za-z0-9_.-]*?)(?:Hour|Day|MonthLast|Month|Year)?$/.exec(name);
    if (!match) continue;
    const base = match[1];
    if (!groups.has(base)) groups.set(base, {});
    const readings = groups.get(base);
    if (names.has(base)) readings.total = source(device, base);
    for (const [field, suffix] of Object.entries(PERIODS)) {
      if (names.has(`stat${base}${suffix}`)) readings[field] = source(device, `stat${base}${suffix}`);
    }
  }
  return [...groups].filter(([, readings]) => Object.keys(readings).length);
}

export function suggestedSolarSource(device, key, label) {
  if (POWER_READINGS[key]) return uniqueReading(device, POWER_READINGS[key]);
  if (key === 'status') return uniqueReading(device, ['state']);
  const base = label === undefined ? 'EnergyTotal' : `Energy${label}`;
  return yieldGroups(device).find(([name]) => name === base)?.[1][key] || null;
}

export function solarEnergySuggestions(devices, preferredDevice) {
  const valid = devices.filter(device => device && isValidName(device.name));
  const candidates = valid.filter(device => namesOf(device).some(name => POWER_READINGS.pv.includes(name)));
  const anchor = preferredDevice ? valid.find(device => device.name === preferredDevice)
    : candidates.length === 1 ? candidates[0] : null;
  if (!anchor) return { readings: {}, sections: [], ambiguous: candidates.length > 1 };
  const readings = {};
  for (const key of [...Object.keys(POWER_READINGS), 'status', 'hour', 'day', 'month', 'year', 'total']) {
    const local = suggestedSolarSource(anchor, key);
    // Only device-independent power roles may be completed from a unique external source.
    const matches = POWER_READINGS[key] && key !== 'pv'
      ? valid.flatMap(device => {
        const aliases = namesOf(device).filter(name => POWER_READINGS[key].includes(name));
        return aliases.map(reading => source(device, reading));
      }) : [];
    const selected = local || (matches.length === 1 ? matches[0] : null);
    if (selected) readings[key] = selected;
  }
  const sections = yieldGroups(anchor)
    .filter(([base]) => base !== 'EnergyTotal' && base !== 'Energy')
    .map(([base, sources]) => ({ label: base.slice(6), readings: sources }))
    .filter(section => section.label.length <= 64).slice(0, 8);
  return { readings, sections, ambiguous: false };
}
