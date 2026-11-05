import { openDevicePicker } from '../js/device-picker.js';

const MAX_ROWS = 40;
const UNITS = [
  ['', 'Keine Einheit'],
  ['°C', '°C (Celsius)'],
  ['°F', '°F (Fahrenheit)'],
  ['km', 'km'],
  ['m', 'm'],
  ['cm', 'cm'],
  ['mm', 'mm'],
  ['km/h', 'km/h'],
  ['m/s', 'm/s'],
  ['%', '%'],
  ['W', 'W'],
  ['kW', 'kW'],
  ['Wh', 'Wh'],
  ['kWh', 'kWh'],
  ['V', 'V'],
  ['A', 'A'],
  ['mA', 'mA'],
  ['L', 'L'],
  ['ml', 'ml'],
  ['l/min', 'l/min'],
  ['m³', 'm³'],
  ['Pa', 'Pa'],
  ['hPa', 'hPa'],
  ['ppm', 'ppm'],
  ['dB', 'dB'],
  ['lx', 'lx'],
  ['kg', 'kg'],
  ['g', 'g'],
  ['s', 's'],
  ['min', 'min'],
  ['h', 'h'],
  ['custom', 'Andere …']
];

class FHEMCMSReadingsTable extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.snapshots = new Map();
    this.devices = [];
    this.mode = 'single';
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
        tfoot th { position: static; text-align: left; border-top: 1px solid var(--cms-border, #3a4a40); color: var(--cms-text, inherit); font-weight: 700; }
        tfoot th[data-sum-value] { text-align: right; }
        thead th:last-child { text-align: right; }
        th:last-child, td:last-child { padding-right: 2rem; }
        thead[hidden] { display: none; }
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
        .row { display: grid; grid-template-columns: minmax(9rem, 1.2fr) minmax(7rem, 0.9fr) minmax(7rem, 1fr) minmax(8rem, 0.8fr) auto; align-items: end; gap: 0.45rem;
          padding: 0.5rem 0; border-top: 1px solid var(--cms-border-subtle, #3a4d42); }
        [hidden] { display: none !important; }
        fieldset.mode { display: grid; gap: 0.4rem; }
        label.check { display: flex; align-items: center; gap: 0.5rem; }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .single .row { grid-template-columns: minmax(7rem, 1fr) minmax(8rem, 1fr) minmax(7rem, 0.8fr) auto; }
        .device, .single-device { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.3rem; }
        .device input { min-width: 0; }
        .unit-fields { display: grid; gap: 0.3rem; }
        .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { min-height: 1.2em; margin: 0; color: var(--cms-danger, #ffb4a8); }
        @media (max-width: 36rem) {
          .row, .single .row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
          .row > button { grid-column: 2; justify-self: end; }
          .unit-label { grid-column: 1 / -1; }
        }
      </style>
      <article class="tile" data-tile>
        <header data-header hidden><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="Tabelle konfigurieren">⚙</button>
        <table>
          <thead data-head><tr><th data-device-heading>Device</th><th data-value-heading>Wert</th></tr></thead>
          <tbody data-rows></tbody>
          <tfoot data-sum hidden><tr><th data-sum-label>Summe</th><th data-sum-value></th></tr></tfoot>
        </table>
      </article>
      <dialog data-dialog aria-labelledby="table-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="table-dialog-title">Tabelle konfigurieren</h3>
          <label>Titel (optional)<input name="title" type="text" maxlength="64" autocomplete="off"></label>
          <fieldset class="mode"><legend>Tabellenüberschrift</legend>
            <label class="check"><input name="header" type="checkbox" checked>Überschrift anzeigen</label>
            <div data-header-fields>
              <label>Bezeichnungsspalte<input name="deviceLabel" type="text" maxlength="32" placeholder="Device" autocomplete="off"></label>
              <label>Wertespalte<input name="valueLabel" type="text" maxlength="32" placeholder="Wert" autocomplete="off"></label>
              <label class="check"><input name="showValueLabel" type="checkbox" checked>Wertespalten-Überschrift anzeigen</label>
            </div></fieldset>
          <fieldset class="mode"><legend>Summenzeile</legend>
            <label class="check"><input name="sum" type="checkbox">Summenzeile unter der Tabelle anzeigen</label>
            <div data-sum-field hidden>
              <label>Beschriftung<input name="sumLabel" type="text" maxlength="32" placeholder="Summe" autocomplete="off"></label>
              <label class="check"><input name="showSumLabel" type="checkbox" checked>Beschriftung anzeigen</label>
              <label>Einheit<span class="unit-fields"><select name="sumUnitSelect" data-sum-unit></select>
                <input name="sumUnitCustom" type="text" maxlength="16" placeholder="Eigene Einheit" autocomplete="off" hidden></span></label>
            </div></fieldset>
          <fieldset class="mode"><legend>Herkunft der Werte</legend>
            <label class="check"><input type="radio" name="mode" value="single" checked>Werte kommen aus einem Device</label>
            <label class="check"><input type="radio" name="mode" value="multi">Werte kommen aus mehreren Devices</label></fieldset>
          <div data-single>
            <span class="single-device"><input name="deviceSingle" type="text" readonly placeholder="Device wählen" aria-label="Device für alle Werte">
              <button type="button" data-pick-single>Wählen …</button></span>
            <span class="hint" data-alias></span>
          </div>
          <fieldset><legend>Readings</legend><div data-config-rows></div>
            <button type="button" data-add>Reading hinzufügen</button></fieldset>
          <p class="error" data-error role="alert"></p>
          <div class="actions"><button type="button" class="danger" data-delete>Entfernen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit">Speichern</button></div>
        </form>
      </dialog>`;
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.shadowRoot.querySelector('[data-add]').addEventListener('click', () => this.addRow());
    this.shadowRoot.querySelector('[name="sum"]').addEventListener('change', (event) => {
      this.shadowRoot.querySelector('[data-sum-field]').hidden = !event.target.checked;
    });
    this.shadowRoot.querySelector('[name="header"]').addEventListener('change', (event) => {
      this.shadowRoot.querySelector('[data-header-fields]').hidden = !event.target.checked;
    });
    const sumUnit = this.shadowRoot.querySelector('[data-sum-unit]');
    sumUnit.replaceChildren(...[['auto', 'Automatisch (wie die Einzelwerte)'], ...UNITS].map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }));
    sumUnit.addEventListener('change', () => {
      const custom = this.shadowRoot.querySelector('[name="sumUnitCustom"]');
      custom.hidden = sumUnit.value !== 'custom';
      if (custom.hidden) {
        custom.value = '';
      } else {
        custom.focus();
      }
    });
    const pickSingle = () => this.pickSingleDevice();
    this.shadowRoot.querySelector('[data-pick-single]').addEventListener('click', pickSingle);
    this.shadowRoot.querySelector('[name="deviceSingle"]').addEventListener('click', pickSingle);
    for (const radio of this.shadowRoot.querySelectorAll('[name="mode"]')) {
      radio.addEventListener('change', () => this.setMode(radio.value));
    }
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
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.deviceLabel.value = this.widgetConfig.deviceLabel || '';
    form.elements.sum.checked = this.widgetConfig.sum === true;
    form.elements.sumLabel.value = this.widgetConfig.sumLabel || '';
    this.shadowRoot.querySelector('[data-sum-field]').hidden = !form.elements.sum.checked;
    form.elements.showSumLabel.checked = this.widgetConfig.hideSumLabel !== true;
    form.elements.header.checked = this.widgetConfig.hideHeader !== true;
    this.shadowRoot.querySelector('[data-header-fields]').hidden = !form.elements.header.checked;
    form.elements.valueLabel.value = this.widgetConfig.valueLabel || '';
    form.elements.showValueLabel.checked = this.widgetConfig.hideValueLabel !== true;
    const unitSelect = form.elements.sumUnitSelect;
    const customUnit = form.elements.sumUnitCustom;
    const savedUnit = this.widgetConfig.sumUnit;
    if (savedUnit === undefined) {
      unitSelect.value = 'auto';
    } else if (UNITS.some(([value]) => value === savedUnit && value !== 'custom')) {
      unitSelect.value = savedUnit;
    } else {
      unitSelect.value = 'custom';
    }
    customUnit.hidden = unitSelect.value !== 'custom';
    customUnit.value = unitSelect.value === 'custom' ? savedUnit : '';
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    const container = this.shadowRoot.querySelector('[data-config-rows]');
    container.replaceChildren();
    try {
      this.devices = await this.services.listAllDevices();
    } catch (error) {
      this.devices = [];
      this.shadowRoot.querySelector('[data-error]').textContent = `Devices konnten nicht geladen werden: ${error.message}`;
    }
    // Bestehende Tabellen mit Zeilen aus mehreren Devices öffnen im Mehr-Device-Modus.
    const used = [...new Set((this.widgetConfig.rows || []).map((row) => row.device))];
    this.mode = used.length > 1 ? 'multi' : 'single';
    form.elements.mode.value = this.mode;
    form.elements.deviceSingle.value = used.length === 1 ? used[0] : '';
    this.showAlias(form.elements.deviceSingle.value);
    this.applyMode();
    for (const row of this.widgetConfig.rows || []) {
      await this.addRow(row);
    }
    if (container.children.length === 0) {
      await this.addRow();
    }
    this.shadowRoot.querySelector('[data-dialog]').showModal();
  }

  showAlias(name) {
    this.shadowRoot.querySelector('[data-alias]').textContent = this.devices.find((item) => item.name === name)?.alias || '';
  }

  applyMode() {
    const single = this.mode !== 'multi';
    this.shadowRoot.querySelector('[data-single]').hidden = !single;
    this.shadowRoot.querySelector('[data-config-rows]').classList.toggle('single', single);
    for (const label of this.shadowRoot.querySelectorAll('[data-device-field]')) {
      label.hidden = single;
    }
  }

  rowsInDialog() {
    return [...this.shadowRoot.querySelectorAll('[data-config-rows] .row')];
  }

  // Beim Umschalten bleiben die Zeilen erhalten; das Reading bleibt, wenn das Device es kennt.
  setMode(mode) {
    const form = this.shadowRoot.querySelector('[data-form]');
    const previous = this.mode;
    this.mode = mode;
    if (mode === 'single' && previous !== 'single') {
      const name = this.rowsInDialog().map((row) => row.querySelector('.device input').value).find(Boolean) || '';
      form.elements.deviceSingle.value = name;
      this.showAlias(name);
      this.applySharedDevice(name);
    }
    this.applyMode();
  }

  applySharedDevice(name) {
    const device = this.devices.find((item) => item.name === name);
    for (const row of this.rowsInDialog()) {
      this.setRowDevice(row, device, row.querySelector('select:not([data-unit-select])').value);
    }
  }

  async pickSingleDevice() {
    try {
      const device = await openDevicePicker({ services: this.services });
      if (!device) {
        return;
      }
      if (!this.devices.some((item) => item.name === device.name)) {
        this.devices = [...this.devices, device];
      }
      const form = this.shadowRoot.querySelector('[data-form]');
      form.elements.deviceSingle.value = device.name;
      this.showAlias(device.name);
      this.applySharedDevice(device.name);
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
    }
  }

  async addRow(initial = {}) {
    const container = this.shadowRoot.querySelector('[data-config-rows]');
    if (container.children.length >= MAX_ROWS) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Höchstens ${MAX_ROWS} Tabellenzeilen`;
      return;
    }
    if (this.mode !== 'multi' && !initial.device) {
      initial = { ...initial, device: this.shadowRoot.querySelector('[name="deviceSingle"]').value };
    }
    const row = document.createElement('div');
    row.className = 'row';
    const deviceLabel = document.createElement('label');
    deviceLabel.dataset.deviceField = '';
    deviceLabel.hidden = this.mode !== 'multi';
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
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Bezeichner (optional)';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 32;
    nameInput.autocomplete = 'off';
    nameInput.placeholder = 'Alias oder Device-Name';
    nameInput.dataset.rowLabel = '';
    nameInput.value = initial.label || '';
    nameLabel.append(nameInput);
    const readingLabel = document.createElement('label');
    readingLabel.textContent = 'Reading';
    const readingSelect = document.createElement('select');
    readingSelect.required = true;
    readingLabel.append(readingSelect);
    const unitLabel = document.createElement('label');
    unitLabel.className = 'unit-label';
    unitLabel.textContent = 'Einheit';
    const unitFields = document.createElement('span');
    unitFields.className = 'unit-fields';
    const unitSelect = document.createElement('select');
    unitSelect.dataset.unitSelect = '';
    unitSelect.replaceChildren(...UNITS.map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }));
    const customUnit = document.createElement('input');
    customUnit.type = 'text';
    customUnit.maxLength = 16;
    customUnit.placeholder = 'Eigene Einheit';
    customUnit.autocomplete = 'off';
    customUnit.dataset.customUnit = '';
    customUnit.hidden = true;
    unitSelect.addEventListener('change', () => {
      customUnit.hidden = unitSelect.value !== 'custom';
      if (customUnit.hidden) {
        customUnit.value = '';
      } else {
        customUnit.focus();
      }
    });
    unitFields.append(unitSelect, customUnit);
    unitLabel.append(unitFields);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Entfernen';
    remove.addEventListener('click', () => row.remove());
    pick.addEventListener('click', async () => {
      try {
        const device = await openDevicePicker({ services: this.services });
        if (device) {
          if (!this.devices.some((item) => item.name === device.name)) {
            this.devices = [...this.devices, device];
          }
          this.setRowDevice(row, device, '');
        }
      } catch (error) {
        this.shadowRoot.querySelector('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
      }
    });
    row.append(deviceLabel, nameLabel, readingLabel, unitLabel, remove);
    container.append(row);
    this.setRowUnit(row, initial.unit || '');
    if (initial.device) {
      try {
        const devices = this.devices.length ? this.devices : await this.services.listAllDevices();
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

  setRowUnit(row, unit) {
    const select = row.querySelector('[data-unit-select]');
    const customUnit = row.querySelector('[data-custom-unit]');
    if (UNITS.some(([value]) => value === unit && value !== 'custom')) {
      select.value = unit;
      customUnit.value = '';
      customUnit.hidden = true;
      return;
    }
    select.value = 'custom';
    customUnit.value = unit;
    customUnit.hidden = false;
  }

  async saveConfig() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const title = form.elements.title.value.trim();
    const deviceLabel = form.elements.deviceLabel.value.trim();
    const sumLabel = form.elements.sumLabel.value.trim();
    const valueLabel = form.elements.valueLabel.value.trim();
    const sumUnitChoice = form.elements.sumUnitSelect.value;
    const sumUnit = sumUnitChoice === 'custom' ? form.elements.sumUnitCustom.value.trim() : sumUnitChoice;
    const badText = (text, max) => text.length > max || /[\u0000-\u001f\u007f]/.test(text);
    if (badText(sumLabel, 32) || badText(valueLabel, 32) || badText(sumUnit, 16)
      || (form.elements.sum.checked && sumUnitChoice === 'custom' && !sumUnit)) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Beschriftung oder Einheit der Tabelle ist ungültig (Überschriften max. 32, Einheit max. 16 Zeichen, eigene Einheit nicht leer).';
      return;
    }
    const sharedDevice = form.elements.deviceSingle.value.trim();
    if (this.mode !== 'multi' && !sharedDevice) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Bitte zuerst das Device wählen.';
      return;
    }
    const rows = [...this.shadowRoot.querySelectorAll('[data-config-rows] .row')].map((row) => {
      const unitSelect = row.querySelector('[data-unit-select]');
      const customUnit = row.querySelector('[data-custom-unit]').value.trim();
      const label = row.querySelector('[data-row-label]').value.trim();
      return {
        device: this.mode === 'multi' ? row.querySelector('.device input').value : sharedDevice,
        ...(label ? { label } : {}),
        reading: row.querySelector('select:not([data-unit-select])').value,
        ...(unitSelect.value === 'custom' ? (customUnit ? { unit: customUnit } : {}) : (unitSelect.value ? { unit: unitSelect.value } : {}))
      };
    });
    if (!rows.length || rows.some((row) => !row.device || !row.reading)) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Für jede Zeile Device und Reading wählen.';
      return;
    }
    if ([...this.shadowRoot.querySelectorAll('[data-config-rows] .row')]
      .some((row) => row.querySelector('[data-unit-select]').value === 'custom'
        && !row.querySelector('[data-custom-unit]').value.trim())) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Bitte die eigene Einheit eingeben oder eine andere Einheit wählen.';
      return;
    }
    if (deviceLabel.length > 32 || /[\u0000-\u001f\u007f]/.test(deviceLabel)
      || rows.some((row) => (row.unit && (row.unit.length > 16 || /[\u0000-\u001f\u007f]/.test(row.unit)))
        || (row.label && (row.label.length > 32 || /[\u0000-\u001f\u007f]/.test(row.label))))) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Bezeichnung oder Einheit ist ungültig.';
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
    if (deviceLabel) {
      next.deviceLabel = deviceLabel;
    }
    if (form.elements.sum.checked) {
      next.sum = true;
      if (sumLabel) {
        next.sumLabel = sumLabel;
      }
      if (!form.elements.showSumLabel.checked) {
        next.hideSumLabel = true;
      }
      if (sumUnitChoice !== 'auto') {
        next.sumUnit = sumUnit;
      }
    }
    if (!form.elements.header.checked) {
      next.hideHeader = true;
    } else {
      if (valueLabel) {
        next.valueLabel = valueLabel;
      }
      if (!form.elements.showValueLabel.checked) {
        next.hideValueLabel = true;
      }
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
    this.shadowRoot.querySelector('[data-device-heading]').textContent = this.widgetConfig.deviceLabel || 'Device';
    this.shadowRoot.querySelector('[data-head]').hidden = this.widgetConfig.hideHeader === true;
    this.shadowRoot.querySelector('[data-value-heading]').textContent = this.widgetConfig.hideValueLabel === true
      ? '' : (this.widgetConfig.valueLabel || 'Wert');
    const body = this.shadowRoot.querySelector('[data-rows]');
    const numbers = [];
    const units = new Set();
    body.replaceChildren(...(this.widgetConfig.rows || []).map((row) => {
      const tr = document.createElement('tr');
      const deviceCell = document.createElement('td');
      const valueCell = document.createElement('td');
      const group = this.snapshots.get(row.device) || [];
      deviceCell.textContent = row.label || group.find((snapshot) => snapshot.name === row.device)?.alias || row.device;
      const item = group.find((snapshot) => snapshot.readings?.[row.reading] !== undefined);
      const number = item ? Number.parseFloat(String(item.readings[row.reading]).trim().replace(',', '.')) : Number.NaN;
      if (Number.isFinite(number)) {
        numbers.push(number);
        units.add(row.unit || '');
      }
      valueCell.textContent = item ? `${item.readings[row.reading]}${row.unit ? ` ${row.unit}` : ''}` : '–';
      tr.append(deviceCell, valueCell);
      return tr;
    }));
    const foot = this.shadowRoot.querySelector('[data-sum]');
    foot.hidden = this.widgetConfig.sum !== true;
    this.shadowRoot.querySelector('[data-sum-label]').textContent = this.widgetConfig.hideSumLabel === true
      ? '' : (this.widgetConfig.sumLabel || 'Summe');
    const total = Math.round(numbers.reduce((acc, value) => acc + value, 0) * 100) / 100;
    // Automatisch: Einheit nur, wenn alle summierten Werte dieselbe haben.
    const unit = this.widgetConfig.sumUnit !== undefined
      ? this.widgetConfig.sumUnit
      : (units.size === 1 ? [...units][0] : '');
    this.shadowRoot.querySelector('[data-sum-value]').textContent = numbers.length ? `${total}${unit ? ` ${unit}` : ''}` : '–';
  }
}

if (!customElements.get('cms-table')) {
  customElements.define('cms-table', FHEMCMSReadingsTable);
}
