import { isValidName } from './fhem-client.js';
import { formatDateDisplay } from './date-display.js';

export const volvoGroups = [
  ['state', 'Energie & Akku'], ['statistics', 'Statistik'],
  ['vehicle', 'Allgemeine Fahrzeuginformationen'], ['location', 'Fahrzeugstandort'],
  ['warnings', 'Licht'], ['doors', 'Türen & Verriegelung'], ['windows', 'Fenster'],
  ['engineDiagnostics', 'Diagnose'], ['capabilities', 'Fähigkeiten'],
  ['brakes', 'Bremsen'], ['workshopDiagnostics', 'Werkstattdiagnose'],
  ['commandAccessibility', 'Befehlsverfügbarkeit'], ['commands', 'Fahrzeugbefehle'],
  ['tyres', 'Reifen'],
];
export const volvoCards = [...volvoGroups.slice(0, 3), ['gallery', 'Bildergalerie'], ...volvoGroups.slice(3)];

export const volvoGroupIcons = {
  state: '🔋', capabilities: '✓', warnings: '💡', brakes: '🛑', doors: '🔒',
  windows: '▣', engineDiagnostics: '⚙', workshopDiagnostics: '🔧',
  commandAccessibility: '⚡', commands: '▶', statistics: '📊', tyres: '◉',
  vehicle: '🚙', location: '📍', gallery: '▧',
};

export function volvoGroupOrder(config = {}) {
  const keys = volvoCards.map(([key]) => key);
  const order = config.groupOrder || [];
  const result = [...order, ...keys.filter(key => !order.includes(key) && key !== 'gallery')];
  if (!result.includes('gallery')) result.splice(result.indexOf('vehicle') + 1, 0, 'gallery');
  return result;
}

export function validateVolvoGroups(config) {
  if (config.cardGrid !== undefined && (!config.cardGrid || typeof config.cardGrid !== 'object'
    || Array.isArray(config.cardGrid) || Object.keys(config.cardGrid).sort().join() !== 'columns,rowHeight'
    || ![12,24,48,96,192].includes(config.cardGrid.columns)
    || typeof config.cardGrid.rowHeight !== 'number' || !Number.isFinite(config.cardGrid.rowHeight)
    || config.cardGrid.rowHeight <= 0 || config.cardGrid.rowHeight > 2000)) {
    return 'Ungültiges VolvoConnect-Kartenraster.';
  }
  if (config.cardSizes !== undefined) {
    const sizes = config.cardSizes;
    const keys = new Set(volvoCards.map(([key]) => key));
    if (!sizes || typeof sizes !== 'object' || Array.isArray(sizes)
      || Object.keys(sizes).length > keys.size
      || Object.entries(sizes).some(([key, size]) => !keys.has(key) || !size
        || typeof size !== 'object' || Array.isArray(size)
        || Object.keys(size).sort().join() !== 'h,w'
        || !Number.isInteger(size.w) || size.w < (config.cardGrid ? 1 : 3)
        || size.w > (config.cardGrid?.columns || 12)
        || !Number.isInteger(size.h) || size.h < (config.cardGrid ? 1 : 6)
        || size.h > (config.cardGrid ? 1000 : 64))) {
      return 'Ungültige VolvoConnect-Kachelgrößen.';
    }
  }
  if (config.hiddenReadings !== undefined && (!Array.isArray(config.hiddenReadings)
    || config.hiddenReadings.length > 1000
    || config.hiddenReadings.some(key => !isValidName(key) || (!['state','lastUpdate'].includes(key)
      && !/^(?:state|statistics|vehicle|location|warnings|doors|windows|engineDiagnostics|capabilities|brakes|workshopDiagnostics|commandAccessibility|commands|tyres)_.+$/.test(key)))
    || new Set(config.hiddenReadings).size !== config.hiddenReadings.length)) {
    return 'Ungültige VolvoConnect-Readings in hiddenReadings.';
  }
  for (const field of ['groupOrder', 'hiddenGroups']) {
    const keys = new Set((field === 'groupOrder' ? volvoCards : volvoGroups).map(([key]) => key));
    if (config[field] === undefined) continue;
    const values = config[field];
    if (!Array.isArray(values) || values.length > keys.size
      || values.some(key => !keys.has(key)) || new Set(values).size !== values.length) {
      return `Ungültige VolvoConnect-Gruppen in ${field}.`;
    }
  }
  return null;
}

export function arrangeVolvoCards(order, sizes, config = {}) {
  const hidden = key => key === 'gallery' ? config.showGallery === false : config.hiddenGroups?.includes(key);
  return [...order].sort((a, b) =>
    Number(Boolean(hidden(a))) - Number(Boolean(hidden(b)))
    || (sizes[b]?.h || 6) - (sizes[a]?.h || 6) || (sizes[b]?.w || 4) - (sizes[a]?.w || 4));
}

export function placeVolvoCards(order, sizes, columns, config = {}) {
  const hidden = key => key === 'gallery' ? config.showGallery === false : config.hiddenGroups?.includes(key);
  const placed = [];
  let row = 0, col = 0;
  for (const [index,key] of order.entries()) {
    const {w,h} = sizes[key];
    if (hidden(key) && (index === 0 || !hidden(order[index - 1])) && order.slice(index).every(hidden)) {
      row = Math.max(row, ...placed.map(entry => entry.row + entry.h));
      col = 0;
    }
    for (;;) {
      if (col + w > columns) { col = 0; row++; }
      const overlap = placed.find(entry => col < entry.col + entry.w && col + w > entry.col
        && row < entry.row + entry.h && row + h > entry.row);
      if (!overlap) break;
      col = overlap.col + overlap.w;
    }
    placed.push({key,col,row,w,h});
    col += w;
  }
  return placed;
}

export function volvoReadingIcon(group, key) {
  if (/battery|chargeLevel/i.test(key)) return '🔋';
  if (/time|timestamp|hours/i.test(key)) return '◷';
  if (/charg|electric|energy/i.test(key)) return '⚡';
  if (/range|distance|odometer|tripMeter/i.test(key)) return '🛣';
  if (/speed/i.test(key)) return '◴';
  if (/fuel/i.test(key)) return '⛽';
  return volvoGroupIcons[group];
}

export function volvoStatusSymbol(group, key, value) {
  const text = volvoText(value);
  if (text === 'NO_WARNING' || text === 'OK'
    || (group === 'capabilities' && /^(?:1|true)$/.test(text)) || text === 'AVAILABLE') {
    return { icon: '✓', tone: 'good' };
  }
  if (/^(?:LOCKED|CLOSED)$/.test(text)) return { icon: '🔒', tone: 'good' };
  if (/^(?:UNLOCKED|OPEN)$/.test(text)) return { icon: '🔓', tone: 'warning' };
  if (/WARNING|VERY_LOW|LOW_PRESSURE|HIGH_PRESSURE|TOO_LOW|TOO_HIGH|ERROR/.test(text)) {
    return { icon: '⚠', tone: 'warning' };
  }
  if (key === 'engineStatus' && /^(?:RUNNING|STOPPED)$/.test(text)) {
    return { icon: text === 'RUNNING' ? '▶' : '⏻', tone: 'neutral' };
  }
  if (/^(?:CONNECTED|DISCONNECTED)$/.test(text)) {
    return { icon: text === 'CONNECTED' ? '🔌' : '🔌̸', tone: text === 'CONNECTED' ? 'good' : 'neutral' };
  }
  if (text === 'CHARGING_STOPPED') return { icon:'⏸', tone:'neutral' };
  if (group === 'commands' && /^(?:COMPLETED|SUCCESS)$/.test(text)) return { icon:'✓', tone:'good' };
  if (/^(?:CHARGING|ONGOING|PROVIDING_POWER)$/.test(text)) return { icon: '⚡', tone: 'good' };
  if (/^(?:NONE|NO_POWER_AVAILABLE|UNAVAILABLE|0|false)$/.test(text)
    && (group === 'capabilities' || !/^(?:0|false)$/.test(text))) return { icon: '−', tone: 'neutral' };
  if (/^(?:IDLE|STOPPED|DONE)$/.test(text)) return { icon: '⏸', tone: 'neutral' };
  return null;
}

const labels = {
  batteryChargeLevel: 'Akkustand', chargerConnectionStatus: 'Ladekabel',
  charge: 'Laden', charge_start: 'Laden starten', charge_stop: 'Laden stoppen',
  climate: 'Klimatisierung', climate_stop: 'Klimatisierung stoppen',
  precondition: 'Vorkonditionierung', lock: 'Verriegeln', unlock: 'Entriegeln', horn: 'Hupe',
  chargerPowerStatus: 'Ladeleistung-Status', chargingCurrentLimit: 'Lade-Stromlimit',
  chargingPower: 'Ladeleistung', chargingStatus: 'Ladestatus', chargingType: 'Lade-Typ',
  electricRange: 'Elektrische Reichweite',
  estimatedChargingTimeToTargetBatteryChargeLevel: 'Restladezeit',
  targetBatteryChargeLevel: 'Ziel-Ladestand', isSupported: 'Unterstützt',
  centralLock: 'Zentralverriegelung', frontLeftDoor: 'Tür vorne links',
  frontRightDoor: 'Tür vorne rechts', rearLeftDoor: 'Tür hinten links',
  rearRightDoor: 'Tür hinten rechts', hood: 'Motorhaube', tailgate: 'Heckklappe',
  tankLid: 'Tankdeckel', odometer: 'Kilometerstand',
  averageFuelConsumption: 'Ø Verbrauch',
  averageSpeed: 'Ø Geschwindigkeit',
  averageEnergyConsumption: 'Ø Energieverbrauch',
  averageSpeedAutomatic: 'Ø Geschwindigkeit automatisch',
  distanceToService: 'Strecke bis zur Wartung', engineHoursToService: 'Betriebsstunden bis zur Wartung',
  serviceWarning: 'Service', timeToService: 'Zeit bis zur Wartung',
  washerFluidLevelWarning: 'Wischwasser', distanceToEmptyBattery: 'Reichweite Akku',
  distanceToEmptyTank: 'Reichweite Tank', tripMeterAutomatic: 'Tageskilometer automatisch',
  tripMeterManual: 'Tageskilometer manuell', chargingSystemStatus: 'Lade-Systemstatus',
  transferLimit: 'Transferlimit', availabilityStatus: 'Verfügbarkeitsstatus',
  unavailableReason: 'Grund der Nichtverfügbarkeit', engineCoolantLevelWarning: 'Kühlmittelstand',
  oilLevelWarning: 'Ölstand', engineStatus: 'Motor', fuelAmount: 'Kraftstoffmenge',
  batteryCapacityKWH: 'Batteriekapazität', modelYear: 'Modelljahr', gearbox: 'Getriebe',
  fuelType: 'Antriebsart', externalColour: 'Außenfarbe', vin: 'VIN',
  descriptions_model: 'Modell', descriptions_steering: 'Lenkradseite',
  descriptions_upholstery: 'Polsterung', frontLeft: 'Vorne links', frontRight: 'Vorne rechts',
  rearLeft: 'Hinten links', rearRight: 'Hinten rechts', invokeStatus: 'Befehlsstatus',
  command: 'Befehl', href: 'Befehlsadresse', frontLeftWindow: 'Fenster vorne links',
  frontRightWindow: 'Fenster vorne rechts', rearLeftWindow: 'Fenster hinten links',
  rearRightWindow: 'Fenster hinten rechts', sunroof: 'Schiebedach',
  brakeFluidLevelWarning: 'Bremsflüssigkeitsstand', brakeLightCenterWarning: 'Bremslicht Mitte',
  brakeLightLeftWarning: 'Bremslicht links', brakeLightRightWarning: 'Bremslicht rechts',
  daytimeRunningLightLeftWarning: 'Tagfahrlicht links',
  daytimeRunningLightRightWarning: 'Tagfahrlicht rechts',
  fogLightFrontWarning: 'Nebelscheinwerfer vorne', fogLightRearWarning: 'Nebelschlussleuchte',
  hazardLightsWarning: 'Warnblinkanlage', highBeamLeftWarning: 'Fernlicht links',
  highBeamRightWarning: 'Fernlicht rechts', lowBeamLeftWarning: 'Abblendlicht links',
  lowBeamRightWarning: 'Abblendlicht rechts', positionLightFrontLeftWarning: 'Positionslicht vorne links',
  positionLightFrontRightWarning: 'Positionslicht vorne rechts',
  positionLightRearLeftWarning: 'Positionslicht hinten links',
  positionLightRearRightWarning: 'Positionslicht hinten rechts',
  registrationPlateLightWarning: 'Kennzeichenbeleuchtung', reverseLightsWarning: 'Rückfahrlicht',
  sideMarkLightsWarning: 'Seitenmarkierungsleuchten',
  turnIndicationFrontLeftWarning: 'Blinker vorne links',
  turnIndicationFrontRightWarning: 'Blinker vorne rechts',
  turnIndicationRearLeftWarning: 'Blinker hinten links',
  turnIndicationRearRightWarning: 'Blinker hinten rechts',
  road: 'Straße', house_number: 'Hausnummer', postcode: 'Postleitzahl', city: 'Ort',
  state: 'Bundesland', country: 'Land', latitude: 'Breitengrad', longitude: 'Längengrad',
  timestamp: 'Positionszeitpunkt',
  specifications_numberOfSeats: 'Sitzplätze', specifications_numberOfDoors: 'Türenanzahl',
  specifications_driveType: 'Antriebsart', specifications_enginePowerKw: 'Motorleistung (kW)',
  specifications_firstRegistrationDate: 'Erstzulassung',
  specifications_grossWeightKg: 'Zulässiges Gesamtgewicht (kg)',
  specifications_modelYear: 'Modelljahr', specifications_gearbox: 'Getriebe',
  specifications_fuelType: 'Antriebsart', specifications_steering: 'Lenkradseite',
  specifications_batteryCapacityKWH: 'Batteriekapazität',
  specifications_enginePower: 'Motorleistung', specifications_engineVolume: 'Hubraum',
  specifications_height: 'Höhe', specifications_length: 'Länge',
  specifications_width: 'Breite', specifications_weight: 'Gewicht',
  specifications_fuelCapacity: 'Tankinhalt', specifications_doors: 'Türenanzahl',
};
const states = {
  state: { authenticated: 'Verbunden', auth_required: 'Anmeldung erforderlich',
    token_refreshing: 'Token wird erneuert', disabled: 'Deaktiviert', error: 'API-Fehler' },
  chargingStatus: { DONE: 'Beendet', ONGOING: 'Lädt', STOPPED: 'Gestoppt' },
  chargingType: { AC: 'Wechselstrom (AC)', DC: 'Gleichstrom (DC)' },
  chargerConnectionStatus: { CONNECTED: 'Verbunden', DISCONNECTED: 'Nicht verbunden' },
  chargerPowerStatus: { PROVIDING_POWER: 'Liefert Leistung', CHARGING_STOPPED: 'Laden gestoppt' },
  engineStatus: { RUNNING: 'Läuft', STOPPED: 'Aus' },
};
const commonStates = { NO_WARNING: 'OK', AVAILABLE: 'Ja', UNAVAILABLE: 'Nein',
  LOCKED: 'Verriegelt', UNLOCKED: 'Entriegelt', CLOSED: 'Geschlossen', OPEN: 'Offen',
  NONE: 'Keiner', IDLE: 'Bereit', CHARGING: 'Lädt', CONNECTED: 'Verbunden',
  DISCONNECTED: 'Nicht verbunden', NO_POWER_AVAILABLE: 'Keine Ladeleistung' };
const units = { percentage: '%', minutes: 'min', month: 'Monat', months: 'Monate',
  ampere: 'A', amperes: 'A' };

export const volvoActions = [
  ['lock', 'Verriegeln'], ['unlock', 'Entriegeln'], ['climate', 'Klima starten'],
  ['climate_stop', 'Klima stoppen'], ['charge_start', 'Laden starten'],
  ['charge_stop', 'Laden stoppen'], ['precondition', 'Vorkonditionieren'], ['horn', 'Hupe'],
];

const permissionDenied = value => typeof value === 'string'
  && /^Not authorized to access this resource\.?$/i.test(value.trim());

export function volvoText(value, max = 256) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return '';
  const text = String(value).trim();
  return text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) && !permissionDenied(text)
    && !/^(?:null|undefined|NaN|[+-]?Infinity|ERROR_READING_PROPERTY|PROPERTY_NOT_FOUND|PROPERTY_NOT_SUPPORTED|NOT_SUPPORTED|NOT_AVAILABLE|UNSPECIFIED)$/i.test(text)
    ? text : '';
}

export function volvoImageUrl(value) {
  const text = volvoText(value, 4096);
  if (!/^https?:\/\/[^\s<>"]+$/i.test(text)) return '';
  try {
    const url = new URL(text);
    return url.username || url.password ? '' : url.href;
  } catch { return ''; }
}

export function volvoLabel(key) {
  const clean = key.replace(/^getEnergyState_/, '').replace(/_isSupported$/, '');
  const label = Object.hasOwn(labels, clean) ? labels[clean]
    : clean.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
  return (label.charAt(0).toUpperCase() + label.slice(1))
    .replace(/Durchschnitt(?:licher|liche|liches|lichen|lich)?\s*/gi, 'Ø ')
    .replace(/\bAverage\s*/gi, 'Ø ') + (/_isSupported$/.test(key) ? ' unterstützt' : '');
}

export function volvoValue(group, key, value, unit = '') {
  let text = formatDateDisplay(volvoText(value));
  if (!text) return '';
  if (Object.hasOwn(states, key) && Object.hasOwn(states[key], text)) text = states[key][text];
  else if (group === 'capabilities' && /^(?:0|1|true|false)$/.test(text)) {
    text = /^(?:1|true)$/.test(text) ? 'Ja' : 'Nein';
  } else if (Object.hasOwn(commonStates, text)) text = commonStates[text];
  const suffix = volvoText(unit, 32);
  const normalized = Object.hasOwn(units, suffix) ? units[suffix] : suffix;
  if (suffix === 'minutes' && /^\d+$/.test(text)) {
    return `${String(Math.floor(Number(text) / 60)).padStart(2, '0')}:${String(Number(text) % 60).padStart(2, '0')} h`;
  }
  return text + (normalized ? `${normalized === '%' ? '' : ' '}${normalized}` : '');
}

export function volvoModel(snapshot, device) {
  const item = Array.isArray(snapshot) ? snapshot.find(entry => entry.name === device) : null;
  const readings = item?.readings || {};
  const groups = new Map(volvoGroups.map(([key]) => [key, []]));
  const read = key => Object.hasOwn(readings, key) ? volvoText(readings[key]) : '';
  const images = [
    ['vehicle_images_exteriorImageUrl', 'Außenansicht'],
    ['vehicle_images_internalImageUrl', 'Innenansicht'],
  ].flatMap(([key, label]) => {
    const url = volvoImageUrl(readings[key]);
    return url ? [{ key, label, url }] : [];
  });
  for (const reading of Object.keys(readings).sort()) {
    if (!isValidName(reading) || permissionDenied(readings[reading]) || /_unit$/.test(reading)
      || /^vehicle_images_(?:exterior|internal)ImageUrl$/.test(reading)) continue;
    const match = /^(state|fuel|capabilities|warnings|brakes|doors|windows|engineDiagnostics|engine|workshopDiagnostics|commandAccessibility|commands|statistics|odometer|tyres|vehicle|location)_(.+)$/.exec(reading);
    if (!match) continue;
    let [, group, key] = match;
    if (key === 'code') continue;
    if (group === 'fuel') group = 'state';
    if (group === 'odometer') group = 'statistics';
    if (group === 'engine' || reading === 'workshopDiagnostics_washerFluidLevelWarning'
      || reading === 'brakes_brakeFluidLevelWarning') group = 'engineDiagnostics';
    if (group === 'location' && /^(?:address|altitude|heading)$/.test(key)) continue;
    const value = volvoValue(group, key, readings[reading], readings[`${reading}_unit`])
      || (key === 'chargingType' ? '−' : '');
    if (value) groups.get(group).push({ reading, visibilityKey: `${group}_${key}`, key, label: volvoLabel(key), value,
      icon: volvoReadingIcon(group, key), status: volvoStatusSymbol(group, key, readings[reading]) });
  }
  const energy = groups.get('state');
  if (energy.length && !energy.some(entry => entry.key === 'chargingType')
    && !permissionDenied(readings.state_chargingType) && !permissionDenied(readings.fuel_chargingType)) {
    energy.push({reading:'state_chargingType',visibilityKey:'state_chargingType',key:'chargingType',label:volvoLabel('chargingType'),
      value:'−',icon:volvoReadingIcon('state','chargingType'),status:null});
  }
  const location = groups.get('location');
  for (const [main, extra, prepend] of [['road', 'house_number', false], ['city', 'postcode', true]]) {
    const primary = location.find(row => row.key === main);
    const secondary = location.find(row => row.key === extra);
    if (primary && secondary) {
      primary.value = (prepend ? [secondary.value, primary.value] : [primary.value, secondary.value]).join(' ');
      location.splice(location.indexOf(secondary), 1);
    }
    const locationOrder = ['road', 'city', 'state', 'country', 'latitude', 'longitude', 'timestamp'];
    const locationRank = key => locationOrder.includes(key) ? locationOrder.indexOf(key) : locationOrder.length;
    location.sort((a, b) => locationRank(a.key) - locationRank(b.key));
  }
  const number = (key, limit) => /^-?\d+(?:\.\d+)?$/.test(read(key))
    && Number.isFinite(Number(read(key))) && Math.abs(Number(read(key))) <= limit ? Number(read(key)) : null;
  const charge = ['state_batteryChargeLevel', 'fuel_batteryChargeLevel']
    .map(key => number(key, 100)).find(value => value !== null && value >= 0);
  const rangeReading = ['state_electricRange', 'fuel_distanceToEmptyBattery', 'statistics_distanceToEmptyBattery']
    .find(key => number(key, Number.MAX_SAFE_INTEGER) !== null && Number(read(key)) >= 0);
  return {
    available: Boolean(item), groups, images, read,
    soc: charge ?? null,
    range: rangeReading ? read(rangeReading) : '',
    rangeUnit: rangeReading ? read(`${rangeReading}_unit`) : '',
    latitude: number('location_latitude', 90), longitude: number('location_longitude', 180),
    actions: volvoActions.filter(([command]) => typeof item?.sets === 'string'
      && item.sets.split(/\s+/).some(entry => entry === command || entry.startsWith(`${command}:`))),
  };
}
