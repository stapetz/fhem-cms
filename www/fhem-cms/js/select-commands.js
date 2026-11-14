const COMMAND_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const VALUE_PATTERN = /^[A-Za-z0-9_.+-]{1,32}$/;
const MAX_DISCRETE_VALUES = 32;
const FHEM_INPUT_TYPES = new Set([
  'colorpicker',
  'date',
  'file',
  'image',
  'multiple',
  'noArg',
  'select',
  'slider',
  'textField',
  'textField-long',
  'time',
]);

export function parseDiscreteSetCommand(token) {
  if (typeof token !== 'string') return null;
  const colon = token.indexOf(':');
  if (colon < 1 || token.indexOf(':', colon + 1) !== -1) return null;

  const command = token.slice(0, colon);
  const values = token.slice(colon + 1).split(',');
  if (!COMMAND_PATTERN.test(command) || values.length < 2 || values.length > MAX_DISCRETE_VALUES
    || FHEM_INPUT_TYPES.has(values[0])
    || values.some((value) => !VALUE_PATTERN.test(value) || value === '.' || value === '..')
    || new Set(values).size !== values.length) {
    return null;
  }
  return { command, values };
}

export function parseDiscreteSetCommands(sets) {
  if (typeof sets !== 'string') return [];
  const seen = new Set();
  const parsed = [];
  for (const token of sets.split(/\s+/).filter(Boolean)) {
    const entry = parseDiscreteSetCommand(token);
    if (entry && !seen.has(entry.command)) {
      seen.add(entry.command);
      parsed.push(entry);
    }
  }
  return parsed;
}

export function isDiscreteSetCommand(token) {
  return parseDiscreteSetCommand(token) !== null;
}
