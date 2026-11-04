import { openDevicePicker } from '../js/device-picker.js';

const MAX_ROWS = 40;

class FHEMCMSReadingsTable extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.snapshots = new Map();
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
        .tile { position: relative; height: 100%; overflow: auto; border: 1px solid var(--cms-frame, #7f8c84);
          border-radius: 1.2rem; background: var(--cms-surface, #202e27); padding: 0.6rem; }
        .tile[data-stale] { opacity: 0.65; border-style: dashed; }
        header { padding: 0.1rem 2rem 0.4rem 0.2rem; }
        h3 { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.85rem; font-weight: 400; }
        header[hidden] { display: none; }
        table { width: 100%; border-collapse: collapse; font-size: clamp(0.65rem, 3cqh, 0.9rem); }
        th, td { padding: 0.25rem 0.4rem; border-bottom: 1px solid var(--cms-border-subtle, #3a4d42); text-align: left; overflow-wrap: anywhere; }
        th { position: sticky; top: 0; background: var(--cms-surface, #202e27); color: var(--cms-muted-strong, #c4d0c8); font-weight: 500; }
        td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
        .gear, button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.3rem 0.55rem; }
        .gear { position: absolute; top: 0.25rem; right: 0.3rem; z-index: 2; padding: 0 0.35em; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        :host([view-only]) [data-open-config] { display: none; }
        dialog { width: min(94vw, 38rem); max-height: 94vh; overflow: auto; padding: 1.25rem;
          border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef); }
        dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
        form { display: grid; gap: 0.75rem; }
        label { display: grid; gap: 0.25rem; }
        input, select { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a); border-radius: 0.5rem; padding: 0.4rem 0.5rem; }
        input[type="text"], select { width: 100%; }
        .row { display: grid; grid-template-columns: minmax(8rem, 1fr) minmax(8rem, 1fr) auto; align-items: end; gap: 0.45rem;
          padding: 0.5rem 0; border-top: 1px solid var(--cms-border-subtle, #3a4d42); }
        .device { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.3rem; }
        .device input { min-width: 0; }
        .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { min-height: 1.2em; margin: 0; color: var(--cms-danger, #ffb4a8); }
        @media (max-width: 36rem) { .row { grid-template-columns: 1fr 1fr; } .row > button { grid-column: 2; justify-self: end; } }
      </style>
      <article class="tile" data-tile>
        <header data-header hidden><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config aria-label="Tabelle konfigurieren">⚙</button>
        <table>
          <thead><tr><th>Device</th><th>Reading</th><th>Wert</th></tr></thead>
          <tbody data-rows></tbody>
        </table>
      </article>
      <dialog data-dialog aria-labelledby="table-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="table-dialog-title">Tabelle konfigurieren</h3>
          <label>Titel (optional)<input name="title" type="text" maxlength="64" autocomplete="off"></label>
          <fieldset><legend>Devices und Readings</legend><div data-config-rows></div>
            <button type="button" data-add>Reading hinzufügen</button></fieldset>
          <p class="error" data-error role="alert"></p>
          <div class="actions"><button type="button" class="danger" data-delete>Entfernen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit">Speichern</button></div>
        </form>
      </dialog>`;
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.shadowRoot.querySelector('[data-add]').addEventListener('click', () => this.addRow());
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
    this.snapshots = value instanceof Map ? value : new Map();
    this.render();
  }

  set stale(value) {
    const tile = this.shadowRoot.querySelector('[data-tile]');
    if (tile) {
      tile.toggleAttribute('data-stale', value !== null);
    }
  }

  async openConfig({ isNew = false } = {}) {
    this.isNew = isNew;
    this.shadowRoot.querySelector('[data-form]').elements.title.value = this.widgetConfig.title || '';
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    const container = this.shadowRoot.querySelector('[data-config-rows]');
    container.replaceChildren();
    for (const row of this.widgetConfig.rows || []) {
      await this.addRow(row);
    }
    if (container.children.length === 0) {
      await this.addRow();
    }
    this.shadowRoot.querySelector('[data-dialog]').showModal();
  }

  async addRow(initial = {}) {
    const container = this.shadowRoot.querySelector('[data-config-rows]');
    if (container.children.length >= MAX_ROWS) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Höchstens ${MAX_ROWS} Tabellenzeilen`;
      return;
    }
    const row = document.createElement('div');
    row.className = 'row';
    const deviceLabel = document.createElement('label');
    deviceLabel.textContent = 'Device';
    const deviceBox = document.createElement('span');
    deviceBox.className = 'device';
    const deviceInput = document.createElement('input');
    deviceInput.type = 'text';
    deviceInput.readOnly = true;
    deviceInput.value = initial.device || '';
    deviceInput.placeholder = 'Device wählen';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.textContent = 'Wählen …';
    deviceBox.append(deviceInput, pick);
    deviceLabel.append(deviceBox);
    const readingLabel = document.createElement('label');
    readingLabel.textContent = 'Reading';
    const readingSelect = document.createElement('select');
    readingSelect.required = true;
    readingLabel.append(readingSelect);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Entfernen';
    remove.addEventListener('click', () => row.remove());
    pick.addEventListener('click', async () => {
      try {
        const device = await openDevicePicker({ services: this.services });
        if (device) {
          this.setRowDevice(row, device, '');
        }
      } catch (error) {
        this.shadowRoot.querySelector('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
      }
    });
    row.append(deviceLabel, readingLabel, remove);
    container.append(row);
    if (initial.device) {
      try {
        const devices = await this.services.listAllDevices();
        const device = devices.find((item) => item.name === initial.device);
        this.setRowDevice(row, device, initial.reading);
      } catch (error) {
        this.shadowRoot.querySelector('[data-error]').textContent = `Devices konnten nicht geladen werden: ${error.message}`;
      }
    }
  }

  setRowDevice(row, device, selectedReading) {
    const deviceInput = row.querySelector('input');
    const select = row.querySelector('select');
    deviceInput.value = device?.name || '';
    const readings = Object.keys(device?.readings || {}).sort();
    select.replaceChildren(...readings.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      return option;
    }));
    select.value = readings.includes(selectedReading) ? selectedReading : (readings[0] || '');
  }

  async saveConfig() {
    const title = this.shadowRoot.querySelector('[name="title"]').value.trim();
    const rows = [...this.shadowRoot.querySelectorAll('[data-config-rows] .row')].map((row) => ({
      device: row.querySelector('input').value,
      reading: row.querySelector('select').value
    }));
    if (!rows.length || rows.some((row) => !row.device || !row.reading)) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Für jede Zeile Device und Reading wählen.';
      return;
    }
    const keys = rows.map((row) => `${row.device}\u0000${row.reading}`);
    if (new Set(keys).size !== rows.length) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Dieselbe Device- und Reading-Kombination darf nur einmal vorkommen.';
      return;
    }
    const next = { id: this.widgetConfig.id, type: 'fhem-table', rows, grid: { ...this.widgetConfig.grid } };
    if (title) {
      next.title = title;
    }
    try {
      await this.services.saveWidget(next);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Speichern fehlgeschlagen: ${error.message}`;
    }
  }

  async deleteWidget() {
    if (!window.confirm('Diese Tabelle entfernen?')) {
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
    if (!this.widgetConfig || !this.shadowRoot.querySelector('[data-rows]')) {
      return;
    }
    const title = this.shadowRoot.querySelector('[data-title]');
    title.textContent = this.widgetConfig.title || '';
    title.parentElement.hidden = !this.widgetConfig.title;
    const body = this.shadowRoot.querySelector('[data-rows]');
    body.replaceChildren(...(this.widgetConfig.rows || []).map((row) => {
      const tr = document.createElement('tr');
      const deviceCell = document.createElement('td');
      deviceCell.textContent = row.device;
      const readingCell = document.createElement('td');
      readingCell.textContent = row.reading;
      const valueCell = document.createElement('td');
      const group = this.snapshots.get(row.device) || [];
      const item = group.find((snapshot) => snapshot.readings?.[row.reading] !== undefined);
      valueCell.textContent = item ? String(item.readings[row.reading]) : '–';
      tr.append(deviceCell, readingCell, valueCell);
      return tr;
    }));
  }
}

if (!customElements.get('cms-table')) {
  customElements.define('cms-table', FHEMCMSReadingsTable);
}
