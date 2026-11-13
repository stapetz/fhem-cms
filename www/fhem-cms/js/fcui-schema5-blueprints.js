import { openDevicePicker } from './device-picker.js';

const DEVICE_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_BLUEPRINTS = 100;

function addDevice(devices, value) {
  if (typeof value === 'string' && DEVICE_NAME.test(value)) devices.add(value);
}

function inspectDevices(value, key, devices) {
  if (Array.isArray(value)) {
    if (key === 'devices') value.forEach((entry) => addDevice(devices, entry));
    else value.forEach((entry) => inspectDevices(entry, '', devices));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (key === 'device') addDevice(devices, value);
    if (typeof value === 'string' && ['html', 'markdown', 'title'].includes(key)) {
      for (const match of value.matchAll(/\{\{([A-Za-z0-9_.-]{1,128}):/g)) addDevice(devices, match[1]);
      for (const match of value.matchAll(/\bdevice\s*=\s*"([A-Za-z0-9_.-]{1,128})"/g)) {
        addDevice(devices, match[1]);
      }
      for (const match of value.matchAll(/\bdata-cms-class\s*=\s*"([^"]*)"/g)) {
        for (const condition of match[1].split(';')) addDevice(devices, condition.trim().match(/^([A-Za-z0-9_.-]{1,128}):/)?.[1]);
      }
    }
    return;
  }
  for (const [childKey, child] of Object.entries(value)) inspectDevices(child, childKey, devices);
}

export function blueprintDevices(widget) {
  const devices = new Set();
  inspectDevices(widget, '', devices);
  return [...devices];
}

function replaceDeviceInMarkup(text, source, target) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`(\\{\\{)${escaped}(:)`, 'g'), `$1${target}$2`)
    .replace(new RegExp(`(\\bdevice\\s*=\\s*")${escaped}(")`, 'g'), `$1${target}$2`)
    .replace(/\bdata-cms-class\s*=\s*"([^"]*)"/g, (attribute, conditions) => {
      const rewritten = conditions.replace(new RegExp(`(^\\s*|;\\s*)${escaped}(?=:)`, 'g'), `$1${target}`);
      return attribute.replace(conditions, rewritten);
    });
}

function remapValue(value, key, source, target) {
  if (Array.isArray(value)) {
    return key === 'devices'
      ? value.map((entry) => entry === source ? target : entry)
      : value.map((entry) => remapValue(entry, '', source, target));
  }
  if (!value || typeof value !== 'object') {
    if (key === 'device' && value === source) return target;
    if (typeof value === 'string' && ['html', 'markdown', 'title'].includes(key)) {
      return replaceDeviceInMarkup(value, source, target);
    }
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) =>
    [childKey, remapValue(child, childKey, source, target)]));
}

export function remapBlueprintDevice(widget, source, target) {
  if (!DEVICE_NAME.test(source || '') || !DEVICE_NAME.test(target || '')) {
    throw new Error('Ungültiges Quell- oder Ziel-Device');
  }
  return remapValue(structuredClone(widget), '', source, target);
}

export class Schema5BlueprintPanel {
  #root;
  #client;
  #services;
  #browser;
  #widget;
  #onInsert;
  #onClose;
  #items = [];
  #token = '';
  #busy = false;
  #status;

  constructor({ root, client, services, widget = null, onInsert, onClose, browser = window }) {
    if (!root || !client || typeof client.getBlueprints !== 'function'
      || typeof client.saveBlueprints !== 'function' || !services
      || typeof services.listAllDevices !== 'function' || typeof onInsert !== 'function'
      || typeof onClose !== 'function' || !browser || typeof browser.confirm !== 'function') {
      throw new Error('Blueprint-Dienste und Dialog erforderlich');
    }
    this.#root = root;
    this.#client = client;
    this.#services = services;
    this.#browser = browser;
    this.#widget = widget ? structuredClone(widget) : null;
    this.#onInsert = onInsert;
    this.#onClose = onClose;
    root.innerHTML = `
      <form class="cms-blueprint-panel" novalidate>
        <h2>Widget-Vorlagen</h2>
        <label data-save-field hidden>Vorlagenname
          <input type="text" name="name" maxlength="64" autocomplete="off">
        </label>
        <button type="button" data-save hidden>Als Vorlage speichern</button>
        <p data-status role="status" aria-live="polite"></p>
        <div data-list></div>
        <div class="cms-panel-actions"><button type="button" class="cms-panel-close" data-close>Schließen</button></div>
      </form>`;
    this.#status = root.querySelector('[data-status]');
    this.#status.textContent = 'Vorlagen werden geladen …';
    root.querySelector('[data-save-field]').hidden = !this.#widget;
    root.querySelector('[data-save]').hidden = !this.#widget;
    root.querySelector('[data-save]').addEventListener('click', () => this.#save());
    root.querySelector('[data-close]').addEventListener('click', () => this.#onClose());
    root.querySelector('form').addEventListener('submit', (event) => event.preventDefault());
    this.#load();
  }

  async #load() {
    try {
      const result = await this.#client.getBlueprints();
      this.#items = result.items;
      this.#token = result.token;
      this.#render();
    } catch (error) {
      this.#status.textContent = `Vorlagen konnten nicht geladen werden: ${error.message}`;
      this.#status.setAttribute('data-error', '');
    }
  }

  #render() {
    const list = this.#root.querySelector('[data-list]');
    list.replaceChildren();
    if (!this.#items.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Noch keine Vorlagen gespeichert.';
      list.append(empty);
      this.#status.textContent = '';
      return;
    }
    for (const [index, blueprint] of this.#items.entries()) {
      const row = document.createElement('section');
      row.className = 'cms-blueprint-row';
      const title = document.createElement('strong');
      title.textContent = blueprint.name;
      row.append(title);
      const devices = blueprintDevices(blueprint.widget);
      let source = devices.length === 1 ? devices[0] : '';
      if (devices.length > 1) {
        const sourceSelect = document.createElement('select');
        sourceSelect.setAttribute('aria-label', `Quell-Device für ${blueprint.name}`);
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'Device zum Ersetzen auswählen';
        sourceSelect.append(empty);
        for (const device of devices) {
          const option = document.createElement('option');
          option.value = device;
          option.textContent = device;
          sourceSelect.append(option);
        }
        sourceSelect.addEventListener('change', () => { source = sourceSelect.value; });
        row.append(sourceSelect);
      }
      const insert = document.createElement('button');
      insert.type = 'button';
      insert.textContent = 'Einfügen';
      insert.disabled = devices.length > 1;
      if (devices.length > 1) {
        row.querySelector('select').addEventListener('change', () => { insert.disabled = !source; });
      }
      insert.addEventListener('click', () => this.#insert(blueprint, source));
      row.append(insert);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Löschen';
      remove.addEventListener('click', () => this.#delete(index));
      row.append(remove);
      list.append(row);
    }
    this.#status.textContent = '';
  }

  async #save() {
    if (this.#busy || !this.#widget) return;
    const name = this.#root.querySelector('[name="name"]').value.trim();
    if (!name || name.length > 64 || /[\x00-\x1f\x7f]/.test(name)) {
      this.#status.textContent = 'Bitte einen gültigen Vorlagennamen eingeben (1–64 Zeichen).';
      this.#status.setAttribute('data-error', '');
      return;
    }
    if (this.#items.some((item) => item.name === name)) {
      this.#status.textContent = 'Dieser Vorlagenname ist bereits vorhanden.';
      this.#status.setAttribute('data-error', '');
      return;
    }
    if (this.#items.length >= MAX_BLUEPRINTS) {
      this.#status.textContent = `Es können höchstens ${MAX_BLUEPRINTS} Vorlagen gespeichert werden.`;
      this.#status.setAttribute('data-error', '');
      return;
    }
    await this.#write([...this.#items, { name, widget: this.#widget }], 'Vorlage gespeichert.');
    this.#root.querySelector('[name="name"]').value = '';
  }

  async #delete(index) {
    const item = this.#items[index];
    if (this.#busy || !item || !this.#browser.confirm(`Vorlage „${item.name}“ löschen?`)) return;
    const next = this.#items.filter((_, entry) => entry !== index);
    await this.#write(next, 'Vorlage gelöscht.');
  }

  async #write(items, success) {
    this.#busy = true;
    this.#status.removeAttribute('data-error');
    this.#status.textContent = 'Vorlagen werden gespeichert …';
    this.#root.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      await this.#client.saveBlueprints(items, this.#token);
      const result = await this.#client.getBlueprints();
      this.#items = result.items;
      this.#token = result.token;
      this.#render();
      this.#status.textContent = success;
    } catch (error) {
      this.#status.textContent = `Vorlagen konnten nicht gespeichert werden: ${error.message}`;
      this.#status.setAttribute('data-error', '');
    } finally {
      this.#busy = false;
      this.#root.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
  }

  async #insert(blueprint, source) {
    if (this.#busy) return;
    this.#busy = true;
    this.#status.removeAttribute('data-error');
    this.#status.textContent = source ? 'Ziel-Device auswählen …' : 'Vorlage wird eingefügt …';
    this.#root.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      let widget = structuredClone(blueprint.widget);
      if (source) {
        const device = await openDevicePicker({
          services: this.#services,
          title: 'Ziel-Device für die Vorlage auswählen',
        });
        if (!device) return;
        widget = remapBlueprintDevice(widget, source, device.name);
      }
      await this.#onInsert(widget);
    } catch (error) {
      this.#status.textContent = `Vorlage konnte nicht eingefügt werden: ${error.message}`;
      this.#status.setAttribute('data-error', '');
    } finally {
      this.#busy = false;
      this.#root.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
  }

  suspend() {
    this.#root.close?.();
    this.#root.remove();
  }
}
