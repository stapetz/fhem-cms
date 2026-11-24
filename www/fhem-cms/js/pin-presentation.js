import { pinReadingRaw, pinReadingValues } from './pin-readings.js';
import { ICON_NAME } from './fhem-client.js';

export const PIN_TYPES = Object.freeze({
  thermostat: {},
  'fhem-value': {},
  'fhem-switch': {},
  'fhem-button': {},
  'fhem-clock': {forceCard: true},
  'fhem-icon': {},
  'fhem-table': {},
  'fhem-solarflow': {},
  'fhem-solar-energy': {},
  'fhem-volvoconnect': {},
  'fhem-chart': {},
  'fhem-calllist': {},
  weather: {},
  'fhem-slider': {},
  'fhem-select': {},
  'fhem-html': {},
  text: {forceCard: true},
  'fhem-link': {forceCard: true},
});

export function pinKeepsCard(widget) {
  if (!Object.hasOwn(PIN_TYPES, widget.type)) throw new Error('Unbekannter Pin-Widgettyp');
  return widget.forceCard ?? PIN_TYPES[widget.type].forceCard ?? false;
}

export function pinPresentation(widget, stale = false, snapshots = new Map(), services = {}) {
  if (!Object.hasOwn(PIN_TYPES, widget.type)) throw new Error('Unbekannter Pin-Widgettyp');
  const raw = pinReadingRaw({device: widget.device, reading: widget.reading}, snapshots);
  let name = widget.icon;
  if (widget.type === 'fhem-switch' && raw === widget.off && widget.iconOff) name = widget.iconOff;
  if (widget.type === 'fhem-icon') name = widget.states?.find(state => state.value === raw)?.icon;
  if (name !== undefined && (typeof name !== 'string' || (name && !ICON_NAME.test(name)))) {
    throw new Error('Ungültiges Pin-Icon');
  }
  const iconUrl = name ? services.iconUrl?.(name) ?? '' : '';
  return {
    label: widget.title || widget.config?.customTitle || widget.device || widget.id,
    icon: '', iconUrl, values: pinReadingValues(widget, snapshots),
    state: widget.type === 'fhem-switch' && raw === widget.on ? 'active' : 'normal',
    ...(widget.type === 'fhem-switch' && widget.icon && (!widget.iconOff || widget.iconOff === widget.icon)
      && (raw === widget.on || raw === widget.off) ? {switchColor: raw === widget.on ? 'on' : 'off'} : {}),
    stale,
  };
}
