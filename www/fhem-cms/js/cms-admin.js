import { showCmsModal } from './modal-dialog.js?v=admin-20261122-4';
import { FhemClient, isValidName } from './fhem-client.js?v=admin-20261122-4';
import { createSchema5Transport } from './fcui-schema5-transport.js?v=admin-20261122-4';
import { Schema5DraftController } from './fcui-schema5-draft.js?v=admin-20261122-4';
import { applyCmsAdminAppearance } from './cms-admin-link.js?v=admin-20261122-4';

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
  return { client, controller, schemaVersion, state };
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
  let inventory;
  let busy = false;
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
    for (const button of root.querySelectorAll('button[data-config-action]')) button.disabled = busy;
    status.setAttribute('aria-busy', String(busy));
  };
  const message = (text, error = false) => {
    status.textContent = text;
    status.toggleAttribute('data-error', error);
    status.setAttribute('aria-busy', String(busy));
  };
  const begin = text => {
    busy = true;
    actions();
    message(text);
  };
  const finish = () => {
    busy = false;
    actions();
  };
  const exportConfiguration = async device => {
    if (busy) return;
    begin(`Konfiguration für ${device} wird geladen …`);
    try {
      const { state } = await createSession(device, client.base);
      const config = state.draft || state.live;
      const url = browser.URL.createObjectURL(new browser.Blob([JSON.stringify(config, null, 2)],
        { type: 'application/json' }));
      const anchor = element('a');
      anchor.href = url;
      anchor.download = `${device}-config.json`;
      anchor.hidden = true;
      root.ownerDocument.body.append(anchor);
      try { anchor.click(); }
      finally {
        anchor.remove();
        browser.setTimeout(() => browser.URL.revokeObjectURL(url), 1000);
      }
      message(`Konfiguration von ${device} exportiert (${state.draft ? 'Entwurf' : 'Live'}).`);
    } catch (error) {
      message(`Export für ${device} fehlgeschlagen: ${error.message}`, true);
    } finally { finish(); }
  };
  const prepareImport = async (device, file) => {
    if (!file || busy) return;
    begin(`JSON für ${device} wird geprüft …`);
    try {
      if (file.size > CONFIG_LIMIT) throw new Error('Die JSON-Datei ist größer als 1 MiB.');
      const candidate = JSON.parse(await file.text());
      const { controller, state } = await createSession(device, client.base);
      pendingImport = { device, candidate, controller, token: state.token };
      $('#import-file-name').textContent = `${file.name || 'JSON-Datei'} wird als Entwurf für ${device} übernommen.`;
      importDialog.returnValue = '';
      showCmsModal(importDialog);
    } catch (error) {
      pendingImport = null;
      message(`Import für ${device} fehlgeschlagen: ${error.message}`, true);
      finish();
    }
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
          const configActions = element('div');
          configActions.className = 'cms-admin-config-actions';
          const importButton = element('button', 'JSON importieren …');
          const exportButton = element('button', 'JSON exportieren');
          const fileInput = element('input');
          fileInput.type = 'file';
          fileInput.accept = 'application/json,.json';
          fileInput.hidden = true;
          for (const [button, action] of [[importButton, 'import'], [exportButton, 'export']]) {
            button.type = 'button';
            button.className = 'cms-button';
            button.dataset.configAction = action;
            button.setAttribute('aria-label', `${button.textContent} für ${item.name}`);
          }
          importButton.addEventListener('click', () => { if (!busy) fileInput.click(); });
          fileInput.addEventListener('change', () => {
            const [file] = fileInput.files;
            fileInput.value = '';
            if (file) void prepareImport(item.name, file);
          });
          exportButton.addEventListener('click', () => { void exportConfiguration(item.name); });
          configActions.append(importButton, exportButton, fileInput);
          row.append(configActions);
        }
        if (item.blocked) row.append(element('p', `Gesperrt: ${item.blocked}`));
        const tree = element('details');
        tree.append(element('summary', `Dateistruktur (${item.files.length} Einträge)`));
        tree.append(element('pre', item.files.map(file => `${file.path}${file.directory ? '/' : ''}`).join('\n') || 'Keine CMS-Dateien vorhanden.'));
        row.append(tree);
        list.append(row);
      }
    }
    actions();
  };
  const refresh = async () => {
    begin('CMS-Bestand wird geladen …');
    inventory = null;
    try {
      inventory = await client.inventory();
      render();
      message(`${inventory.items.filter(item => item.kind === 'device').length} CMS-Devices, ${inventory.items.filter(item => item.kind === 'orphan').length} verwaiste Einträge.`);
    } catch (error) {
      $('#devices').replaceChildren();
      $('#orphans').replaceChildren();
      message(error.message, true);
    } finally { finish(); }
  };
  $('#refresh').addEventListener('click', () => { if (!busy) void refresh(); });
  const cancelImport = () => {
    pendingImport = null;
    importDialog.close('cancel');
    message('JSON-Import abgebrochen.');
    finish();
  };
  importDialog.querySelector('form').addEventListener('submit', async event => {
    if (event.submitter?.value === 'cancel') {
      event.preventDefault();
      cancelImport();
      return;
    }
    if (event.submitter?.value !== 'import') return;
    event.preventDefault();
    const pending = pendingImport;
    if (!pending) return;
    pendingImport = null;
    importDialog.close('import');
    message(`JSON wird als Entwurf für ${pending.device} gespeichert …`);
    try {
      await pending.controller.saveDraft(pending.candidate, pending.token);
      message(`JSON wurde als Entwurf für ${pending.device} gespeichert. Die Live-Konfiguration blieb unverändert.`);
    } catch (error) {
      message(`Import für ${pending.device} nicht bestätigt: ${error.message}. Der Entwurf könnte bereits gespeichert sein. Vor einem erneuten Import den aktuellen Zustand per JSON-Export prüfen.`, true);
    } finally { finish(); }
  });
  importDialog.addEventListener('cancel', event => {
    event.preventDefault();
    cancelImport();
  });
  const closeWindow = () => requestAdminClose(browser, text => message(text, true));
  $('#close-window').addEventListener('click', closeWindow);
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const activeDialog = event.target.closest?.('dialog[open]') || root.querySelector('dialog[open]');
    if (activeDialog) {
      if (![importDialog, dialog].includes(activeDialog)) return;
      event.preventDefault();
      if (activeDialog === importDialog) cancelImport();
      else activeDialog.close('cancel');
      return;
    }
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
    begin('Ausgewählte CMS werden bearbeitet …');
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
