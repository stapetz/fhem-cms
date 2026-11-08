import { openDevicePicker } from '../js/device-picker.js';
import { openIconPicker } from '../js/icon-picker.js';

const MAX_STATES = 20;

class FHEMCMSIcon extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.snapshot = null;
    this.device = null;
    this.isNew = false;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) {
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; min-height: 0; }
        * { box-sizing: border-box; }
        .tile { position: relative; display: grid; height: 100%; place-items: center; overflow: hidden; container-type: size;
          border: 1px solid var(--cms-frame, #7f8c84); border-radius: 1.4rem; background: var(--cms-surface, #202e27); padding: 0.6rem; }
        header { position: absolute; top: 0.4rem; left: 0.7rem; right: 2rem; }
        h3 { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 1.05rem; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        h3[data-title] { font-size: max(5px, min(12cqh, 5cqw)); }
        header[hidden] { display: none; }
        .glyph { width: min(42cqh, 42cqw); height: min(42cqh, 42cqw); background-color: var(--state-color, var(--cms-accent, #8fd0a8));
          -webkit-mask: var(--icon-url) center / contain no-repeat; mask: var(--icon-url) center / contain no-repeat; }
        .glyph[hidden] { display: none; }
        .state { max-width: 100%; overflow-wrap: anywhere; text-align: center; font-size: 0.85em; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        .tile[data-stale] { opacity: 0.65; border-style: dashed; }
        .gear, button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.35rem 0.7rem; }
        .gear { position: absolute; top: 0.2rem; right: 0.3rem; padding: 0 0.35em; }
        button:hover { background: var(--cms-surface-hover, #34493e); }
        button:focus-visible, input:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        :host([view-only]) [data-open-config] { display: none; }
        dialog { width: min(94vw, 38rem); max-height: 94vh; overflow: auto; padding: 1.25rem;
          border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef); }
        dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
        form { display: grid; gap: 0.75rem; }
        label { display: grid; gap: 0.25rem; }
        input, select { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a); border-radius: 0.5rem; padding: 0.4rem 0.5rem; }
        input[type="text"], select { width: 100%; }
        .device-row { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
        .mapping { display: grid; grid-template-columns: minmax(5rem, 1fr) minmax(7rem, 1fr) 3rem auto; align-items: end; gap: 0.4rem; padding: 0.5rem 0; border-top: 1px solid var(--cms-border-subtle, #3a4d42); }
        .mapping button { min-height: 2.2rem; }
        .color { width: 3rem; height: 2.2rem; padding: 0.2rem; }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { min-height: 1.2em; margin: 0; color: var(--cms-danger, #ffb4a8); }
        @media (max-width: 34rem) { .mapping { grid-template-columns: 1fr 1fr; } }
        /* Einheitliche Auswahllisten: eigener Pfeil statt Systemdarstellung (Safari). */
        select { appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238a9a8f' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 0.5em center; background-size: 0.65em;
          padding-right: 1.6em; }
      </style>
      <article class="tile">
        <header data-header hidden><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="Status-Symbol konfigurieren">⚙</button>
        <span class="glyph" data-icon aria-hidden="true" hidden></span>
        <span class="state" data-state>–</span>
        <span class="sr-only" data-accessible></span>
      </article>
      <dialog data-dialog aria-labelledby="icon-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="icon-dialog-title">Status-Symbol konfigurieren</h3>
          <label>Titel (optional)<input name="title" type="text" maxlength="64" autocomplete="off"></label>
          <label style="display:flex;align-items:center;gap:0.35em"><input name="showTitle" type="checkbox" checked> Titel anzeigen</label>
          <label>FHEM-Device
            <span class="device-row"><input name="device" readonly required placeholder="Noch kein Device gewählt">
              <button type="button" data-pick-device>Auswählen …</button></span>
          </label>
          <span class="hint" data-alias></span>
          <label>Reading<select name="reading" required></select></label>
          <fieldset><legend>Zuordnung von Reading-Werten</legend>
            <div data-mappings></div>
            <button type="button" data-add>Zuordnung hinzufügen</button>
          </fieldset>
          <p class="hint">Für jeden Reading-Wert ein Icon und eine Farbe wählen. Nicht zugeordnete Werte werden als Text angezeigt.</p>
          <p class="error" data-error role="alert"></p>
          <div class="actions"><button type="button" class="danger" data-delete>Entfernen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit">Speichern</button></div>
        </form>
      </dialog>`;
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.shadowRoot.querySelector('[data-pick-device]').addEventListener('click', () => this.pickDevice());
    this.shadowRoot.querySelector('[name="device"]').addEventListener('click', () => this.pickDevice());
    this.shadowRoot.querySelector('[data-add]').addEventListener('click', () => this.addMapping());
    this.shadowRoot.querySelector('[data-cancel]').addEventListener('click', () => this.closeConfig(false));
    this.shadowRoot.querySelector('[data-delete]').addEventListener('click', () => this.deleteWidget());
    this.shadowRoot.querySelector('[data-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveConfig();
    });
    this.shadowRoot.querySelector('[data-dialog]').addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeConfig(false);
    });
    this.render();
  }

  set config(value) {
    this.widgetConfig = value;
    if (this.shadowRoot.childElementCount) {
      this.render();
    }
  }

  get config() {
    return this.widgetConfig;
  }

  set data(value) {
    this.snapshot = value;
    this.render();
  }

  set stale(value) {
    this.shadowRoot.querySelector('.tile')?.toggleAttribute('data-stale', value !== null);
  }

  async openConfig({ isNew = false } = {}) {
    this.isNew = isNew;
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    form.elements.device.value = this.widgetConfig.device || '';
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    this.device = null;
    try {
      const devices = await this.services.listAllDevices();
      this.device = devices.find((item) => item.name === this.widgetConfig.device) || null;
      this.setReadings(this.device, this.widgetConfig.reading);
      this.shadowRoot.querySelector('[data-alias]').textContent = this.device?.alias || '';
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Devices konnten nicht geladen werden: ${error.message}`;
    }
    this.shadowRoot.querySelector('[data-mappings]').replaceChildren();
    const mappings = this.widgetConfig.states || [];
    for (const mapping of mappings) {
      this.addMapping(mapping);
    }
    this.shadowRoot.querySelector('[data-dialog]').showModal();
  }

  setReadings(device, selected) {
    const select = this.shadowRoot.querySelector('[name="reading"]');
    const names = Object.keys(device?.readings || {}).sort();
    select.replaceChildren(...names.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      return option;
    }));
    select.value = names.includes(selected) ? selected : (names[0] || '');
  }

  async pickDevice() {
    try {
      const device = await openDevicePicker({ services: this.services });
      if (!device) {
        return;
      }
      this.device = device;
      this.shadowRoot.querySelector('[name="device"]').value = device.name;
      this.shadowRoot.querySelector('[data-alias]').textContent = device.alias || '';
      this.setReadings(device, '');
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
    }
  }

  addMapping(mapping = {}) {
    const container = this.shadowRoot.querySelector('[data-mappings]');
    if (container.children.length >= MAX_STATES) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Höchstens ${MAX_STATES} Zuordnungen`;
      return;
    }
    const row = document.createElement('div');
    row.className = 'mapping';
    const valueLabel = document.createElement('label');
    valueLabel.textContent = 'Reading-Wert';
    const value = document.createElement('input');
    value.type = 'text';
    value.maxLength = 64;
    value.required = true;
    value.value = mapping.value || '';
    valueLabel.append(value);
    const iconLabel = document.createElement('label');
    iconLabel.textContent = 'Icon';
    const iconButton = document.createElement('button');
    iconButton.type = 'button';
    iconButton.textContent = mapping.icon || 'Wählen …';
    iconLabel.append(iconButton);
    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Farbe';
    const color = document.createElement('input');
    color.type = 'color';
    color.className = 'color';
    color.value = /^#[0-9a-f]{6}$/i.test(mapping.color || '') ? mapping.color : '#8fd0a8';
    colorLabel.append(color);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Entfernen';
    remove.addEventListener('click', () => row.remove());
    iconButton.addEventListener('click', async () => {
      const name = await openIconPicker({ services: this.services, title: 'Status-Icon wählen' });
      if (name !== null) {
        iconButton.textContent = name || 'Wählen …';
        iconButton.dataset.icon = name;
      }
    });
    if (mapping.icon) {
      iconButton.dataset.icon = mapping.icon;
    }
    row.append(valueLabel, iconLabel, colorLabel, remove);
    container.append(row);
  }

  async saveConfig() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const title = form.elements.title.value.trim();
    const device = form.elements.device.value.trim();
    const reading = form.elements.reading.value;
    const states = [...this.shadowRoot.querySelectorAll('.mapping')].map((row) => ({
      value: row.querySelector('input[type="text"]').value.trim(),
      icon: row.querySelector('button').dataset.icon || '',
      color: row.querySelector('input[type="color"]').value
    }));
    if (!device || !reading || states.length === 0 || states.some((item) => !item.value || !item.icon)) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Device, Reading und vollständige Zuordnungen sind erforderlich.';
      return;
    }
    if (new Set(states.map((item) => item.value)).size !== states.length) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Jeder Reading-Wert darf nur einmal zugeordnet sein.';
      return;
    }
    const next = { id: this.widgetConfig.id, type: 'fhem-icon', device, reading, states, grid: { ...this.widgetConfig.grid } };
    if (title) {
      next.title = title;
    }
    if (!form.elements.showTitle.checked) {
      next.showTitle = false;
    }
    try {
      await this.services.saveWidget(next);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Speichern fehlgeschlagen: ${error.message}`;
    }
  }

  async deleteWidget() {
    if (!window.confirm('Dieses Status-Symbol entfernen?')) {
      return;
    }
    try {
      await this.services.deleteWidget(this.widgetConfig.id);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Entfernen fehlgeschlagen: ${error.message}`;
    }
  }

  closeConfig(saved) {
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) {
      dialog.close();
    }
    if (!saved && this.isNew) {
      this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true }));
    }
  }

  render() {
    if (!this.widgetConfig || !this.shadowRoot.querySelector('[data-icon]')) {
      return;
    }
    const title = this.shadowRoot.querySelector('[data-title]');
    title.textContent = this.widgetConfig.title || '';
    title.parentElement.hidden = !this.widgetConfig.title || this.widgetConfig.showTitle === false;
    const current = (this.snapshot || []).find((item) => item.readings?.[this.widgetConfig.reading] !== undefined);
    const readingValue = current ? String(current.readings[this.widgetConfig.reading]) : '';
    const mapping = (this.widgetConfig.states || []).find((item) => item.value === readingValue);
    const icon = this.shadowRoot.querySelector('[data-icon]');
    const state = this.shadowRoot.querySelector('[data-state]');
    if (mapping) {
      icon.hidden = false;
      icon.style.setProperty('--icon-url', `url("${this.services.iconUrl(mapping.icon)}")`);
      icon.style.setProperty('--state-color', mapping.color);
      state.textContent = '';
      icon.setAttribute('aria-label', readingValue);
      icon.title = readingValue;
      this.shadowRoot.querySelector('[data-accessible]').textContent = `${this.widgetConfig.title || 'Status'}, ${readingValue}`;
    } else {
      icon.hidden = true;
      state.textContent = readingValue || '–';
      this.shadowRoot.querySelector('[data-accessible]').textContent = '';
    }
  }
}

if (!customElements.get('cms-icon')) {
  customElements.define('cms-icon', FHEMCMSIcon);
}
