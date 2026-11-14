import { isValidName } from './fhem-client.js';

export const volvoGroups = [
  ['state', 'Energie & Akku'], ['capabilities', 'Fähigkeiten'], ['warnings', 'Licht'],
  ['brakes', 'Bremsen'], ['doors', 'Türen & Verriegelung'], ['windows', 'Fenster'],
  ['engineDiagnostics', 'Diagnose'], ['workshopDiagnostics', 'Werkstattdiagnose'],
  ['commandAccessibility', 'Befehlsverfügbarkeit'], ['commands', 'Fahrzeugbefehle'],
  ['statistics', 'Statistik'], ['tyres', 'Reifen'],
  ['vehicle', 'Allgemeine Fahrzeuginformationen'], ['location', 'Fahrzeugstandort'],
];

const labels = {
  batteryChargeLevel: 'Akkustand', chargerConnectionStatus: 'Ladekabel',
  chargerPowerStatus: 'Ladeleistung-Status', chargingCurrentLimit: 'Lade-Stromlimit',
  chargingPower: 'Ladeleistung', chargingStatus: 'Ladestatus', chargingType: 'Lade-Typ',
  electricRange: 'Elektrische Reichweite',
  estimatedChargingTimeToTargetBatteryChargeLevel: 'Restladezeit',
  targetBatteryChargeLevel: 'Ziel-Ladestand', isSupported: 'Unterstützt',
  centralLock: 'Zentralverriegelung', frontLeftDoor: 'Tür vorne links',
  frontRightDoor: 'Tür vorne rechts', rearLeftDoor: 'Tür hinten links',
  rearRightDoor: 'Tür hinten rechts', hood: 'Motorhaube', tailgate: 'Heckklappe',
  tankLid: 'Tankdeckel', odometer: 'Kilometerstand',
  averageFuelConsumption: 'Durchschnittlicher Verbrauch',
  averageSpeed: 'Durchschnittsgeschwindigkeit',
  averageEnergyConsumption: 'Durchschnittlicher Energieverbrauch',
  averageSpeedAutomatic: 'Durchschnittsgeschwindigkeit automatisch',
  distanceToService: 'Strecke bis zur Wartung', engineHoursToService: 'Betriebsstunden bis zur Wartung',
  serviceWarning: 'Service', timeToService: 'Zeit bis zur Wartung',
  washerFluidLevelWarning: 'Wischwasser', distanceToEmptyBattery: 'Reichweite Akku',
  distanceToEmptyTank: 'Reichweite Tank', tripMeterAutomatic: 'Tageskilometer automatisch',
  tripMeterManual: 'Tageskilometer manuell', chargingSystemStatus: 'Lade-Systemstatus',
  transferLimit: 'Transferlimit', availabilityStatus: 'Verfügbarkeitsstatus',
  unavailableReason: 'Grund der Nichtverfügbarkeit', engineCoolantLevelWarning: 'Kühlmittelstand',
  oilLevelWarning: 'Ölstand', engineStatus: 'Motor', fuelAmount: 'Kraftstoffmenge',
  batteryCapacityKWH: 'Batteriekapazität', modelYear: 'Modelljahr', gearbox: 'Getriebe',
  fuelType: 'Antriebsart', externalColour: 'Außenfarbe', vin: 'Fahrgestellnummer',
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

export function volvoText(value, max = 256) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return '';
  const text = String(value).trim();
  return text.length <= max && !/[\u0000-\u001f\u007f]/.test(text)
    && !/^(?:null|undefined|NaN|[+-]?Infinity|ERROR_READING_PROPERTY|NOT_SUPPORTED|NOT_AVAILABLE|UNSPECIFIED)$/i.test(text)
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
  return label.charAt(0).toUpperCase() + label.slice(1) + (/_isSupported$/.test(key) ? ' unterstützt' : '');
}

export function volvoValue(group, key, value, unit = '') {
  let text = volvoText(value);
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
    if (!isValidName(reading) || /_unit$/.test(reading)
      || /^vehicle_images_(?:exterior|internal)ImageUrl$/.test(reading)) continue;
    const match = /^(state|fuel|capabilities|warnings|brakes|doors|windows|engineDiagnostics|engine|workshopDiagnostics|commandAccessibility|commands|statistics|odometer|tyres|vehicle|location)_(.+)$/.exec(reading);
    if (!match) continue;
    let [, group, key] = match;
    if (group === 'fuel') group = 'state';
    if (group === 'odometer') group = 'statistics';
    if (group === 'engine' || reading === 'workshopDiagnostics_washerFluidLevelWarning'
      || reading === 'brakes_brakeFluidLevelWarning') group = 'engineDiagnostics';
    if (group === 'location' && /^(?:address|altitude|heading)$/.test(key)) continue;
    const value = volvoValue(group, key, readings[reading], readings[`${reading}_unit`]);
    if (value) groups.get(group).push({ reading, key, label: volvoLabel(key), value });
  }
  const location = groups.get('location');
  for (const [main, extra, prepend] of [['road', 'house_number', false], ['city', 'postcode', true]]) {
    const primary = location.find(row => row.key === main);
    const secondary = location.find(row => row.key === extra);
    if (primary && secondary) {
      primary.value = (prepend ? [secondary.value, primary.value] : [primary.value, secondary.value]).join(' ');
      location.splice(location.indexOf(secondary), 1);
    }
  }
  const number = (key, limit) => /^-?\d+(?:\.\d+)?$/.test(read(key))
    && Number.isFinite(Number(read(key))) && Math.abs(Number(read(key))) <= limit ? Number(read(key)) : null;
  const charge = number('state_batteryChargeLevel', 100);
  return {
    available: Boolean(item), groups, images, read,
    soc: charge !== null && charge >= 0 ? charge : null,
    range: read('state_electricRange') || read('fuel_distanceToEmptyBattery'),
    latitude: number('location_latitude', 90), longitude: number('location_longitude', 180),
    actions: volvoActions.filter(([command]) => typeof item?.sets === 'string'
      && item.sets.split(/\s+/).some(entry => entry === command || entry.startsWith(`${command}:`))),
  };
}
