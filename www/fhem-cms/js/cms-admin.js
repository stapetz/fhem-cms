import { showCmsModal } from './modal-dialog.js';
import { FhemClient, isValidName } from './fhem-client.js';
import { createSchema5Transport } from './fcui-schema5-transport.js';
import { Schema5DraftController } from './fcui-schema5-draft.js';
import { applyCmsAdminAppearance } from './cms-admin-link.js?v=admin-20261113-5';

const CONFIG_LIMIT = 1048576;

export function validateInventory(value) {
  if (!value || typeof value.token !== 'string' || !/^[0-9a-f]{64}$/.test(value.token) || !Array.isArray(value.items)
    || value.items.length > 500) throw new Error('Ungültiger CMS-Bestand');
  const names = new Set();
  for (const item of value.items) {
    if (!item || !isValidName(item.name) || names.has(item.name)
      || !['device', 'orphan'].includes(item.kind) || !Array.isArray(item.files)
      || (item.blocked !== null && typeof item.blocked !== 'string')
      || item.files.some(file => !file || typeof file.path !== 'string'
        || typeof file.directory !== 'boolean')) throw new Error('Ungültiger CMS-Eintrag');
    names.add(item.name);
  }
  return value;
}

export async function createCmsConfigurationSession(device, base) {
  if (!isValidName(device)) throw new Error('Ungültiger CMS-Device-Name');
  const client = new FhemClient(device, base);
  const schemaVersion = await client.getLayoutFormat();
  if (![5, 6].includes(schemaVersion)) {
    throw new Error(`CMS ${device} verwendet Schema ${schemaVersion}; JSON-Import und -Export benötigen Schema 5 oder 6`);
  }
  const controller = new Schema5DraftController(createSchema5Transport(client));
  const state = await controller.reload();
  return { controller, schemaVersion, state };
}

export function requestAdminClose(browser, notify) {
  try {
    browser.close();
  } catch {
    notify('Der Browser konnte dieses Fenster nicht schließen. Bitte den Tab oder das Fenster manuell schließen.');
    return;
  }
  browser.setTimeout(() => {
    if (!browser.closed) {
      notify('Der Browser erlaubt das Schließen dieses Tabs nicht, da er nicht skriptgesteuert geöffnet wurde. Bitte den Tab manuell schließen.');
    }
  }, 100);
}

export class CmsAdminClient {
  constructor(base = new URL('../../', import.meta.url)) {
    this.base = new URL(base);
    this.endpoint = new URL(`${this.base.pathname.replace(/\/$/, '')}/fhemcms-admin`, this.base);
  }

  async request(payload = null) {
    const url = new URL(this.endpoint);
    url.searchParams.set('op', payload ? 'delete' : 'list');
    const options = { credentials: 'same-origin', cache: 'no-store' };
    if (payload) {
      const tokenResponse = await fetch(new URL(`${this.base.pathname.replace(/\/$/, '')}?XHR=1`, this.base),
        options);
      if (!tokenResponse.ok) throw new Error(`CSRF-Abfrage: HTTP ${tokenResponse.status}`);
      const token = tokenResponse.headers.get('X-FHEM-csrfToken');
      options.method = 'POST';
      options.body = new URLSearchParams({ payload: JSON.stringify(payload) });
      if (token) options.body.set('fwcsrf', token);
    }
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`CMS-Verwaltung: HTTP ${response.status}`);
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    return result;
  }

  async inventory() { return validateInventory(await this.request()); }

  async remove(items, token) {
    const result = await this.request({ items, token, confirmation: 'DELETE' });
    if (!Array.isArray(result.results) || result.results.length !== items.length
      || result.results.some((entry, index) => entry?.name !== items[index].name
        || entry.kind !== items[index].kind || typeof entry.ok !== 'boolean'
        || typeof entry.message !== 'string')) throw new Error('Löschung nicht eindeutig bestätigt; Bestand erneut prüfen');
    return result.results;
  }
}

export async function mountCmsAdmin(root, client = new CmsAdminClient(),
  reload = () => root.ownerDocument.defaultView.location.reload(),
  browser = root.ownerDocument.defaultView,
  createSession = createCmsConfigurationSession) {
  const $ = selector => root.querySelector(selector);
  const status = $('#status');
  const dialog = $('#confirmation');
  const importDialog = $('#import-confirmation');
  const deviceSelect = $('#configuration-device');
  const importInput = $('#config-file');
  let inventory;
  let busy = false;
  let configurationBusy = false;
  let configurationSession;
  let configurationGeneration = 0;
  let pendingImport;
  let selected = [];
  const element = (tag, text) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const choices = kind => [...root.querySelectorAll(`input[data-kind="${kind}"]:checked`)];
  const actions = () => {
    $('#refresh').disabled = busy;
    for (const kind of ['device', 'orphan']) {
      const count = choices(kind).length;
      $(`#delete-${kind}s`).disabled = busy || !count || count > 20;
    }
    for (const input of root.querySelectorAll('input[data-kind]')) input.disabled = busy || !!input.dataset.blocked;
    deviceSelect.disabled = busy || configurationBusy || !inventory
      || !inventory.items.some(item => item.kind === 'device');
    const configReady = !!configurationSession && !configurationBusy && !busy;
    $('#refresh-config').disabled = !deviceSelect.value || configurationBusy || busy;
    $('#import-config').disabled = !configReady;
    $('#export-config').disabled = !configReady;
    $('#configuration-status').setAttribute('aria-busy', String(configurationBusy));
  };
  const message = (text, error = false) => {
    status.textContent = text;
    status.toggleAttribute('data-error', error);
    status.setAttribute('aria-busy', String(busy));
  };
  const configurationMessage = (text, error = false) => {
    const target = $('#configuration-status');
    target.textContent = text;
    target.toggleAttribute('data-error', error);
    target.setAttribute('aria-busy', String(configurationBusy));
  };
  const renderConfiguration = () => {
    const details = $('#configuration-details');
    if (!configurationSession) {
      details.hidden = true;
      return;
    }
    const { state, schemaVersion } = configurationSession;
    const config = state.draft || state.live;
    details.hidden = false;
    $('#configuration-name').textContent = deviceSelect.value;
    $('#configuration-schema').textContent = String(config.schemaVersion || schemaVersion);
    $('#configuration-state').textContent = state.draft
      ? 'Entwurf vorhanden. Export verwendet den Entwurf.'
      : 'Kein Entwurf vorhanden. Export verwendet die Live-Konfiguration.';
  };
  const renderConfigurationDevices = () => {
    const previous = deviceSelect.value;
    const devices = inventory?.items.filter(item => item.kind === 'device') || [];
    deviceSelect.replaceChildren(element('option', 'CMS-Device auswählen …'));
    deviceSelect.firstElementChild.value = '';
    for (const item of devices) {
      const option = element('option', item.name);
      option.value = item.name;
      deviceSelect.append(option);
    }
    if (devices.some(item => item.name === previous)) {
      deviceSelect.value = previous;
    } else {
      deviceSelect.value = '';
      if (previous) {
        configurationGeneration++;
        configurationSession = null;
        configurationBusy = false;
        configurationMessage('Wähle unter Bearbeiten ein CMS-Device aus.');
      }
    }
    renderConfiguration();
  };
  const render = () => {
    for (const kind of ['device', 'orphan']) {
      const list = $(`#${kind}s`);
      list.replaceChildren();
      const items = inventory.items.filter(item => item.kind === kind);
      if (!items.length) list.append(element('p', kind === 'device' ? 'Keine CMS-Devices vorhanden.' : 'Keine verwaisten CMS-Verzeichnisse gefunden.'));
      for (const item of items) {
        const row = element('article');
        const label = element('label');
        const input = element('input');
        input.type = 'checkbox';
        input.value = item.name;
        input.dataset.kind = kind;
        if (item.blocked) input.dataset.blocked = 'true';
        input.addEventListener('change', actions);
        label.append(input, element('strong', item.name));
        row.append(label);
        if (kind === 'device') {
          const link = element('a', 'CMS öffnen');
          link.className = 'cms-button';
          link.href = `${client.base.pathname.replace(/\/$/, '')}/fhem-cms/${encodeURIComponent(item.name)}/index.html?mode=edit`;
          row.append(link);
        }
        if (item.blocked) row.append(element('p', `Gesperrt: ${item.blocked}`));
        const tree = element('details');
        tree.append(element('summary', `Dateistruktur (${item.files.length} Einträge)`));
        tree.append(element('pre', item.files.map(file => `${file.path}${file.directory ? '/' : ''}`).join('\n') || 'Keine CMS-Dateien vorhanden.'));
        row.append(tree);
        list.append(row);
      }
    }
    renderConfigurationDevices();
    actions();
  };
  const refresh = async () => {
    busy = true;
    inventory = null;
    actions();
    message('CMS-Bestand wird geladen …');
    try {
      inventory = await client.inventory();
      render();
      message(`${inventory.items.filter(item => item.kind === 'device').length} CMS-Devices, ${inventory.items.filter(item => item.kind === 'orphan').length} verwaiste Einträge.`);
    } catch (error) {
      $('#devices').replaceChildren();
      $('#orphans').replaceChildren();
      renderConfigurationDevices();
      message(error.message, true);
    } finally {
      busy = false;
      actions();
      status.setAttribute('aria-busy', 'false');
    }
  };
  const selectConfiguration = async () => {
    const device = deviceSelect.value;
    const generation = ++configurationGeneration;
    configurationSession = null;
    if (!device) {
      configurationBusy = false;
      renderConfiguration();
      configurationMessage('Wähle unter Bearbeiten ein CMS-Device aus.');
      actions();
      return;
    }
    configurationBusy = true;
    renderConfiguration();
    configurationMessage(`Schema und Konfiguration von ${device} werden geladen …`);
    actions();
    try {
      const session = await createSession(device, client.base);
      if (generation !== configurationGeneration) return;
      configurationSession = { ...session, device };
      renderConfiguration();
      configurationMessage(`Konfiguration für ${device} geladen.`);
    } catch (error) {
      if (generation === configurationGeneration) {
        configurationMessage(`Konfiguration für ${device} konnte nicht geladen werden: ${error.message}`, true);
      }
    } finally {
      if (generation === configurationGeneration) {
        configurationBusy = false;
        actions();
      }
    }
  };
  const refreshConfiguration = async () => {
    if (!deviceSelect.value || configurationBusy || busy) return;
    if (!configurationSession) return selectConfiguration();
    const generation = configurationGeneration;
    configurationBusy = true;
    configurationMessage(`Konfiguration für ${configurationSession.device} wird neu geladen …`);
    actions();
    try {
      const state = await configurationSession.controller.reload();
      if (generation !== configurationGeneration) return;
      configurationSession.state = state;
      renderConfiguration();
      configurationMessage(`Konfiguration für ${configurationSession.device} neu geladen.`);
    } catch (error) {
      if (generation === configurationGeneration) {
        configurationMessage(`Neuladen fehlgeschlagen: ${error.message}`, true);
      }
    } finally {
      if (generation === configurationGeneration) {
        configurationBusy = false;
        actions();
      }
    }
  };
  const prepareImport = async file => {
    if (!file || !configurationSession || configurationBusy || busy) return;
    const generation = configurationGeneration;
    try {
      if (file.size > CONFIG_LIMIT) throw new Error('Die JSON-Datei ist größer als 1 MiB.');
      const candidate = JSON.parse(await file.text());
      if (generation !== configurationGeneration || !configurationSession) return;
      pendingImport = { candidate, generation };
      $('#import-file-name').textContent = `${file.name || 'JSON-Datei'} wird als Entwurf für ${configurationSession.device} übernommen.`;
      importDialog.returnValue = '';
      showCmsModal(importDialog);
    } catch (error) {
      if (generation === configurationGeneration) {
        configurationMessage(`Import fehlgeschlagen: ${error.message}`, true);
      }
    }
  };
  const importConfiguration = async pending => {
    if (!pending || pending.generation !== configurationGeneration
      || !configurationSession || configurationBusy || busy) return;
    configurationBusy = true;
    configurationMessage(`JSON wird als Entwurf für ${configurationSession.device} gespeichert …`);
    actions();
    try {
      const state = configurationSession.controller.snapshot();
      configurationSession.state = await configurationSession.controller.saveDraft(pending.candidate, state.token);
      renderConfiguration();
      configurationMessage(`JSON wurde als Entwurf für ${configurationSession.device} gespeichert. Die Live-Konfiguration blieb unverändert.`);
    } catch (error) {
      configurationMessage(`Import fehlgeschlagen: ${error.message}. Zustand neu laden und erneut prüfen.`, true);
    } finally {
      configurationBusy = false;
      actions();
    }
  };
  const exportConfiguration = () => {
    if (!configurationSession || configurationBusy || busy) return;
    try {
      const state = configurationSession.controller.snapshot();
      const config = state.draft || state.live;
      const url = browser.URL.createObjectURL(new browser.Blob([JSON.stringify(config, null, 2)],
        { type: 'application/json' }));
      const anchor = root.ownerDocument.createElement('a');
      anchor.href = url;
      anchor.download = `${configurationSession.device}-config.json`;
      anchor.hidden = true;
      root.ownerDocument.body.append(anchor);
      anchor.click();
      anchor.remove();
      browser.setTimeout(() => browser.URL.revokeObjectURL(url), 1000);
      configurationMessage(`Konfiguration von ${configurationSession.device} exportiert (${state.draft ? 'Entwurf' : 'Live'}).`);
    } catch (error) {
      configurationMessage(`Export fehlgeschlagen: ${error.message}`, true);
    }
  };
  $('#refresh').addEventListener('click', refresh);
  deviceSelect.addEventListener('change', () => {
    root.querySelectorAll('.cms-menu[open]').forEach(menu => { menu.open = false; });
    void selectConfiguration();
  });
  $('#refresh-config').addEventListener('click', () => { void refreshConfiguration(); });
  $('#import-config').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const [file] = importInput.files;
    importInput.value = '';
    if (file) void prepareImport(file);
  });
  $('#export-config').addEventListener('click', exportConfiguration);
  importDialog.querySelector('form').addEventListener('submit', event => {
    if (event.submitter?.value !== 'import') return;
    event.preventDefault();
    const pending = pendingImport;
    pendingImport = null;
    importDialog.close('import');
    void importConfiguration(pending);
  });
  importDialog.addEventListener('cancel', () => { pendingImport = null; });
  root.querySelectorAll('.cms-menu').forEach(menu => menu.addEventListener('toggle', () => {
    if (menu.open) {
      root.querySelectorAll('.cms-menu[open]').forEach(other => {
        if (other !== menu) other.open = false;
      });
    }
  }));
  root.querySelectorAll('.cms-menu .cms-button').forEach(button => button.addEventListener('click', () => {
    root.querySelectorAll('.cms-menu[open]').forEach(menu => { menu.open = false; });
  }));
  const closeWindow = () => requestAdminClose(browser,
    text => message(text, true));
  $('#close-window').addEventListener('click', closeWindow);
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const openMenu = root.querySelector('.cms-menu[open]');
    if (openMenu) {
      event.preventDefault();
      openMenu.open = false;
      openMenu.querySelector('summary').focus();
      return;
    }
    if (root.querySelector('dialog[open]')) return;
    event.preventDefault();
    closeWindow();
  });
  for (const kind of ['device', 'orphan']) {
    $(`#delete-${kind}s`).addEventListener('click', () => {
      if (busy || !inventory) return;
      selected = choices(kind).map(input => ({ name: input.value, kind }));
      if (!selected.length || selected.length > 20) return;
      $('#selected').replaceChildren(...selected.map(item => element('li', item.name)));
      $('#confirm-text').value = '';
      dialog.returnValue = '';
      showCmsModal(dialog);
    });
  }
  dialog.querySelector('form').addEventListener('submit', async event => {
    if (event.submitter?.value !== 'delete') return;
    event.preventDefault();
    if ($('#confirm-text').value !== 'DELETE' || busy || !inventory || !selected.length) return;
    dialog.close('delete');
    busy = true;
    actions();
    message('Ausgewählte CMS werden bearbeitet …');
    $('#results').replaceChildren();
    let completed = false;
    try {
      const results = await client.remove(selected, inventory.token);
      completed = results.length === selected.length && results.every(result => result.ok);
      for (const result of results) {
        const li = element('li', `${result.name}: ${result.message}`);
        li.toggleAttribute('data-error', !result.ok);
        $('#results').append(li);
      }
    } catch (error) {
      const li = element('li', `Nicht bestätigt: ${error.message}. Bereits entfernte Dateien sind nicht wiederherstellbar; Bestand prüfen.`);
      li.setAttribute('data-error', '');
      $('#results').append(li);
    } finally {
      await refresh();
    }
    if (completed) reload();
  });
  await refresh();
}

if (typeof document !== 'undefined' && document.querySelector('.cms-admin')) {
  try {
    applyCmsAdminAppearance(document.documentElement, document.defaultView.location.hash);
    mountCmsAdmin(document.documentElement);
  } catch (error) {
    const status = document.querySelector('#status');
    status.textContent = error.message;
    status.setAttribute('data-error', '');
  }
}
