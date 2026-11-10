const paths = {
  toggle: 'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4',
  on: 'M12 3v9M6 6a9 9 0 1 0 12 0',
  off: 'M12 3v9M6 6a9 9 0 1 0 12 0M3 3l18 18',
  unknown: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17v.1M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  press: 'M9 8V5a3 3 0 0 1 6 0v7l2-2a2 2 0 0 1 3 2l-3 8H8l-4-7a2 2 0 0 1 3-2l2 2V8',
};

export function defaultActionIcon(command = '') {
  const key = command.toLowerCase();
  const path = Object.hasOwn(paths, key) ? paths[key] : paths.press;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function actionIconUrl(name, command, services) {
  return name ? services.iconUrl(name) : defaultActionIcon(command);
}

export const actionPresentationFields = `
  <label>Darstellung
    <select name="showLabel">
      <option value="false">Nur Symbol</option>
      <option value="true">Symbol + Beschriftung</option>
    </select>
  </label>`;

export function collectActionPresentation(form) {
  const value = form.elements.showLabel.value;
  if (!['false', 'true'].includes(value)) throw new Error('Bitte eine gültige Darstellung wählen');
  return value === 'true';
}
