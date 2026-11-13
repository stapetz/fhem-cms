import { isValidName } from './fhem-client.js';
import { schema5WidgetSuggestions } from './fcui-schema5-setup-wizard.js';
import { suggestedReading } from './device-suggestions.js';
import { sliderCommands } from './slider-commands.js';

export function deviceWidgetSuggestions(device, devices = [], logInfo = null) {
  if (!device || !isValidName(device.name) || !Array.isArray(devices)) {
    throw new Error('Ungültiges Device oder Geräteliste');
  }
  const readings = device.readings && typeof device.readings === 'object'
    && !Array.isArray(device.readings) ? device.readings : {};
  const names = Object.keys(readings).filter(isValidName);
  const title = (typeof device.alias === 'string' && !/[\x00-\x1f\x7f]/.test(device.alias)
    && device.alias.trim() ? device.alias.trim() : device.name).slice(0, 64);
  const result = new Map();
  const add = (type, fields) => result.set(type, { title, ...fields });
  const reading = suggestedReading(names, 'fhem-value') || names[0];
  if (reading) {
    add('fhem-value', { device: device.name, reading });
    add('fhem-icon', { device: device.name, reading: names.includes('state') ? 'state' : reading });
    add('fhem-table', { rows: names.slice(0, 20).map((name) => ({ device: device.name, reading: name })) });
  }
  const candidates = [device, ...devices.filter((entry) => entry.parent === device.name && isValidName(entry.name))];
  for (const candidate of candidates) {
    for (const suggestion of schema5WidgetSuggestions(candidate)) {
      if (['thermostat', 'fhem-solarflow'].includes(suggestion.type) && !result.has(suggestion.type)) {
        const { type, label, ...fields } = suggestion;
        add(type, fields);
      }
    }
  }
  const sets = typeof device.sets === 'string' ? device.sets : '';
  const noArgs = sets.split(/\s+/).filter((entry) =>
    /^[A-Za-z0-9_.-]+(?::noArg)?$/.test(entry)).map((entry) => entry.split(':')[0]);
  if (noArgs.length) {
    add('fhem-button', { device: device.name, command: noArgs.includes('toggle') ? 'toggle' : noArgs[0] });
  }
  if (noArgs.includes('on') && noArgs.includes('off') && names.includes('state')) {
    add('fhem-switch', { device: device.name, reading: 'state', on: 'on', off: 'off' });
  }
  const slider = sliderCommands(sets)[0];
  if (slider) {
    add('fhem-slider', { device: device.name, command: slider.command,
      reading: names.includes(slider.command) ? slider.command
        : suggestedReading(names, 'fhem-slider') || reading || '' });
  }
  if (device.type === 'FB_CALLLIST') add('fhem-calllist', { device: device.name });
  if (logInfo && /^(?:dblog|filelog)$/.test(logInfo.source) && Array.isArray(logInfo.readings)) {
    const logged = logInfo.readings.filter((name) => names.includes(name)
      && String(readings[name]).trim() !== '' && Number.isFinite(Number(readings[name])));
    const historyReading = suggestedReading(logged, 'fhem-chart') || logged[0];
    if (historyReading) add('fhem-chart', { device: device.name, reading: historyReading, source: logInfo.source });
  }
  const placeholder = reading ? `{{${device.name}:${reading}}}` : '';
  add('text', { html: placeholder ? `<p>${placeholder}</p>` : '' });
  add('fhem-html', { html: placeholder ? `<p>${placeholder}</p>` : '', devices: placeholder ? [device.name] : [] });
  return result;
}
