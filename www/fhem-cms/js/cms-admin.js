import { isValidName } from './fhem-client.js';
import { applyCmsAdminAppearance } from './cms-admin-link.js?v=admin-20261113-5';

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
  reload = () => root.ownerDocument.defaultView.location.reload()) {
  const $ = selector => root.querySelector(selector);
  const status = $('#status');
  const dialog = $('#confirmation');
  let inventory;
  let busy = false;
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
  };
  const message = (text, error = false) => {
    status.textContent = text;
    status.toggleAttribute('data-error', error);
    status.setAttribute('aria-busy', String(busy));
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
      message(error.message, true);
    } finally {
      busy = false;
      actions();
      status.setAttribute('aria-busy', 'false');
    }
  };
  $('#refresh').addEventListener('click', refresh);
  for (const kind of ['device', 'orphan']) {
    $(`#delete-${kind}s`).addEventListener('click', () => {
      if (busy || !inventory) return;
      selected = choices(kind).map(input => ({ name: input.value, kind }));
      if (!selected.length || selected.length > 20) return;
      $('#selected').replaceChildren(...selected.map(item => element('li', item.name)));
      $('#confirm-text').value = '';
      dialog.returnValue = '';
      dialog.showModal();
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
