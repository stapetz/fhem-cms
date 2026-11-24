import { PIN_TYPES } from './pin-presentation.js';
import { pinReadingRaw } from './pin-readings.js';
import { isValidName } from './fhem-client.js';

export const PIN_BEHAVIOR = Object.freeze(Object.fromEntries(Object.keys(PIN_TYPES)
  .map(type => [type, type === 'fhem-switch' ? 'toggle' : type === 'fhem-button' ? 'trigger' : 'open'])));

export function pinCommand(widget, snapshots) {
  if (!Object.hasOwn(PIN_BEHAVIOR, widget.type)) throw new Error('Unbekannter Pin-Widgettyp');
  if (PIN_BEHAVIOR[widget.type] === 'open') return null;
  if (!isValidName(widget.device)) throw new Error('Ungültiges Pin-Device');
  let command = widget.command;
  if (PIN_BEHAVIOR[widget.type] === 'toggle') {
    const raw = pinReadingRaw({device: widget.device, reading: widget.reading}, snapshots);
    if (raw !== widget.on && raw !== widget.off) return null;
    command = raw === widget.on ? widget.off : widget.on;
  }
  if (!isValidName(command)) throw new Error('Ungültiger Pin-Schaltbefehl');
  return {device: widget.device, command};
}
