export const UNIT_SUGGESTIONS = ['°C', '°F', 'K', '%', 'W', 'kW', 'Wh', 'kWh', 'MWh', 'V', 'A', 'mA',
  'Hz', 'lx', 's', 'min', 'h', 'm', 'cm', 'mm', 'km', 'km/h', 'm/s', 'm²', 'm³',
  'l', 'L', 'ml', 'l/min', 'm³/h', 'Pa', 'bar', 'hPa', 'ppm', 'µg/m³', 'dB', 'kg', 'g'];

export const unitInputCss = `
  .cms-unit-choices { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .cms-unit-choices button { font: inherit; border-radius: 0.5rem; padding: 0.15rem 0.55rem; font-size: 0.85rem; }
`;

export function unitSuggestions(input) {
  const group = document.createElement('div');
  group.className = 'cms-unit-choices';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Einheiten-Vorschläge');
  for (const unit of UNIT_SUGGESTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = unit;
    button.dataset.unitChoice = unit;
    button.addEventListener('click', () => {
      input.value = unit;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    group.append(button);
  }
  return group;
}
