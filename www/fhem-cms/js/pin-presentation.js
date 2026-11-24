import { pinReadingRaw, pinReadingValues } from './pin-readings.js';

export const PIN_TYPES = Object.freeze({
  thermostat: {icon: '♨'},
  'fhem-value': {icon: '≡'},
  'fhem-switch': {icon: '⏻'},
  'fhem-button': {icon: '●'},
  'fhem-clock': {icon: '◷', forceCard: true},
  'fhem-icon': {icon: '◆'},
  'fhem-table': {icon: '▦'},
  'fhem-solarflow': {icon: '☀'},
  'fhem-solar-energy': {icon: '☀'},
  'fhem-volvoconnect': {icon: '▰'},
  'fhem-chart': {icon: '▥'},
  'fhem-calllist': {icon: '☎'},
  weather: {icon: '☁'},
  'fhem-slider': {icon: '↔'},
  'fhem-select': {icon: '☷'},
  'fhem-html': {icon: '◇'},
  text: {icon: 'T', forceCard: true},
  'fhem-link': {icon: '↗', forceCard: true},
});

export function pinKeepsCard(widget) {
  if (!Object.hasOwn(PIN_TYPES, widget.type)) throw new Error('Unbekannter Pin-Widgettyp');
  return widget.forceCard ?? PIN_TYPES[widget.type].forceCard ?? false;
}

export function pinPresentation(widget, stale = false, snapshots = new Map()) {
  if (!Object.hasOwn(PIN_TYPES, widget.type)) throw new Error('Unbekannter Pin-Widgettyp');
  const type = PIN_TYPES[widget.type];
  return {
    label: widget.title || widget.config?.customTitle || widget.device || widget.id,
    icon: type.icon, values: pinReadingValues(widget, snapshots),
    state: widget.type === 'fhem-switch'
      && pinReadingRaw({device: widget.device, reading: widget.reading}, snapshots) === widget.on ? 'active' : 'normal',
    stale,
  };
}
