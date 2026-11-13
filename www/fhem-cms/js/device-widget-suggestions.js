import { isValidName } from './fhem-client.js';
import { schema5WidgetSuggestions } from './fcui-schema5-setup-wizard.js';
import { suggestedReading } from './device-suggestions.js';
import { sliderCommands } from './slider-commands.js';
import { parseDiscreteSetCommands } from './select-commands.js';

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
        if (type === 'fhem-solarflow') {
          add('fhem-solar-energy', { readings: Object.fromEntries(
            Object.entries(fields.readings).map(([key, source]) => [key,
              typeof source === 'string' ? { device: fields.device, reading: source } : source])),
          sections: [] });
        }
      }
    }
  }
  const sets = typeof device.sets === 'string' ? device.sets : '';
  // Bare FHEM set entries do not prove that a command takes no argument.
  // Offer everyday actuator actions, not sensor maintenance or reset commands.
  const noArgs = sets.split(/\s+/).filter((entry) =>
    /^(?:on|off|toggle|up|down|stop|open|close)(?::noArg)?$/.test(entry)).map((entry) => entry.split(':')[0]);
  if (noArgs.length) {
    add('fhem-button', { device: device.name, command: noArgs.includes('toggle') ? 'toggle' : noArgs[0] });
  }
  if (noArgs.includes('on') && noArgs.includes('off') && names.includes('state')
    && /^(?:on|off)$/.test(readings.state)) {
    add('fhem-switch', { device: device.name, reading: 'state', on: 'on', off: 'off' });
  }
  const sliderReading = (command) => names.includes(command) ? command
    : command === 'dim' && names.includes('pct') ? 'pct' : '';
  const slider = sliderCommands(sets).find(({ command }) => sliderReading(command));
  if (slider) {
    add('fhem-slider', { device: device.name, command: slider.command,
      reading: sliderReading(slider.command) });
  }
  const selection = parseDiscreteSetCommands(sets).find(({ command }) => names.includes(command));
  if (selection) {
    add('fhem-select', { device: device.name, command: selection.command,
      reading: names.includes(selection.command) ? selection.command : '',
      mode: 'dropdown' });
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
