export const READING_PRESETS = [
  { names: ['temperature', 'measured-temp', 'measuredTemperature', 'temp'], label: 'Temperatur', unit: '°C' },
  { names: ['humidity', 'relativeHumidity'], label: 'Luftfeuchtigkeit', unit: '%' },
  { names: ['power', 'powerActual'], label: 'Leistung', unit: '' },
  { names: ['energy', 'energyCounter'], label: 'Energie', unit: '' },
  { names: ['batteryPercent', 'batteryLevel'], label: 'Batterie', unit: '%' },
  { names: ['state'], label: 'Status', unit: '' },
];

const READING_PREFERENCES = {
  'fhem-value': READING_PRESETS.flatMap(({ names }) => names),
  'fhem-chart': READING_PRESETS[0].names,
  'fhem-icon': READING_PRESETS[5].names,
  'fhem-switch': READING_PRESETS[5].names,
  'fhem-table': READING_PRESETS.flatMap(({ names }) => names),
  'fhem-slider': ['pct', 'position', 'valveposition', 'level', 'desiredTemperature', 'desired-temp'],
  'thermostat.actual': ['temperature', 'measured-temp'],
  'thermostat.target': ['desiredTemperature', 'desired-temp'],
  'thermostat.valve': ['valveposition', 'ValvePosition'],
  'thermostat.mode': ['mode', 'R-controlMode', 'controlMode'],
  'thermostat.battery': ['batteryPercent', 'battery', 'batteryState', 'batteryLevel'],
};

export function suggestedReading(readings, role) {
  if (!readings || typeof readings !== 'object') return '';
  const available = new Set(Array.isArray(readings) ? readings : Object.keys(readings));
  return READING_PREFERENCES[role]?.find((name) => available.has(name)) || '';
}

export function suggestedChoice(choices, preferred = []) {
  const available = [...new Set((Array.isArray(choices) ? choices : [])
    .filter((choice) => typeof choice === 'string' && choice))];
  return preferred.find((choice) => available.includes(choice))
    || (available.length === 1 ? available[0] : '');
}

export function createManualFieldTracker(form) {
  let editedFields = new WeakSet();
  const markEdited = (event) => {
    const field = event.target;
    if (field && (field.matches?.('input, select, textarea'))) editedFields.add(field);
  };
  form.addEventListener('input', markEdited);
  form.addEventListener('change', markEdited);
  return {
    reset() {
      editedFields = new WeakSet();
    },
    isEdited(field) {
      return editedFields.has(field);
    },
    value(field, suggestion) {
      return editedFields.has(field) ? field.value : suggestion;
    },
  };
}
