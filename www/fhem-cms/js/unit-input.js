export const UNIT_SUGGESTIONS = ['°C', '°F', 'K', '%', 'W', 'kW', 'Wh', 'kWh', 'MWh', 'V', 'A', 'mA',
  'Hz', 'lx', 's', 'min', 'h', 'm', 'cm', 'mm', 'km', 'km/h', 'm/s', 'm²', 'm³',
  'l', 'L', 'ml', 'l/min', 'm³/h', 'Pa', 'bar', 'hPa', 'ppm', 'µg/m³', 'dB', 'kg', 'g'];
const COMMON_UNIT_SUGGESTIONS = ['°C', '%', 'W', 'kW', 'kWh'];
const COMMON_UNIT_SUGGESTION_SET = new Set(COMMON_UNIT_SUGGESTIONS);

export const unitInputCss = `
  .cms-unit-choices { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .cms-unit-choices[data-compact] { display: grid; gap: 0.35rem; }
  .cms-unit-common, .cms-unit-other { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .cms-unit-choices button { font: inherit; border-radius: 0.5rem; padding: 0.15rem 0.55rem; font-size: 0.85rem; }
  .cms-unit-more { font-size: 0.85em; }
  .cms-unit-more summary { cursor: pointer; color: var(--cms-muted, #a5c9b2); }
  .cms-unit-more[open] .cms-unit-other { margin-top: 0.35rem; }
`;

export function unitSuggestions(input, { compact = false } = {}) {
  const group = document.createElement('div');
  group.className = 'cms-unit-choices';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Einheiten-Vorschläge');
  const createButton = (unit) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = unit;
    button.dataset.unitChoice = unit;
    button.addEventListener('click', () => {
      input.value = unit;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return button;
  };
  if (!compact) {
    group.append(...UNIT_SUGGESTIONS.map(createButton));
    return group;
  }
  group.dataset.compact = '';
  const common = document.createElement('div');
  common.className = 'cms-unit-common';
  const more = document.createElement('details');
  more.className = 'cms-unit-more';
  const summary = document.createElement('summary');
  summary.textContent = `Weitere Einheiten (${UNIT_SUGGESTIONS.length - COMMON_UNIT_SUGGESTIONS.length})`;
  const other = document.createElement('div');
  other.className = 'cms-unit-other';
  more.append(summary, other);
  common.append(...COMMON_UNIT_SUGGESTIONS.map(createButton));
  other.append(...UNIT_SUGGESTIONS.filter((unit) => !COMMON_UNIT_SUGGESTION_SET.has(unit)).map(createButton));
  group.append(common, more);
  return group;
}
