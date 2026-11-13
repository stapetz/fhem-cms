export function gridPreferenceKey(client) {
  return `fhem-cms:show-grid:${client.endpoint?.pathname || ''}:${client.cmsDevice || ''}`;
}

export function readGridPreference(browser, client, notify) {
  try {
    if (!browser.localStorage) throw new Error('localStorage nicht verfügbar');
    const value = browser.localStorage.getItem(gridPreferenceKey(client));
    return (value ?? browser.localStorage.getItem('fhem-cms-show-grid')) === '1';
  } catch {
    notify('Die Rasteranzeige kann nicht aus dem Browser gelesen werden.');
    return false;
  }
}

export function writeGridPreference(browser, client, enabled, notify) {
  try {
    if (!browser.localStorage) throw new Error('localStorage nicht verfügbar');
    browser.localStorage.setItem(gridPreferenceKey(client), enabled ? '1' : '0');
  } catch {
    notify('Die Rasteranzeige konnte nicht dauerhaft gespeichert werden. Sie gilt nur für diesen Besuch.');
  }
}
