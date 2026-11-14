import { openDevicePicker } from '../js/device-picker.js';
import { unitInputCss, unitSuggestions } from '../js/unit-input.js';
import { dialogGroupStyles, titleVisibilityField } from '../js/dialog-groups.js';
import { createManualFieldTracker, suggestedReading } from '../js/device-suggestions.js';
import { updateWidgetDom } from '../js/widget-dom.js';

const MAX_ROWS = 40;

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
    this.pickerAbort = new AbortController();
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) {
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        [data-title] { text-align: var(--cms-widget-title-align, left); width: 100%; min-width: 0; flex: 1; }
        :host { display: block; min-width: 0; min-height: 0; }
        * { box-sizing: border-box; }
        .tile { position: relative; height: var(--cms-widget-height, 100%); overflow: var(--cms-widget-overflow, auto);
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          color: inherit; display: flex; flex-direction: column; gap: 14px; padding: 8px;
          background: var(--cms-surface, #202e27); border: 1px solid var(--cms-frame, #7f8c84);
          border-radius: 1.4rem; }
        .tile[data-stale] { opacity: 0.65; }
        .tile[data-stale] .table-card { border-style: dashed; }
        header { display: flex; justify-content: space-between; align-items: center;
          padding: 0 48px 8px 0; border-bottom: 1px solid rgba(128,128,128,.25); }
        h3 { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 1.05rem; font-weight: 400; }
        h3[data-title] { color: inherit; font-size: 1.4rem; font-weight: 700;
          overflow-wrap: anywhere; }
        header[hidden] { display: none; }
        .table-card { flex: 1; min-height: 4rem; overflow: auto;
          background: rgba(128,128,128,.08); border: 1px solid rgba(128,128,128,.18);
          border-radius: 14px; padding: 14px; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: .86rem; }
        th, td { padding: 8px 0; border-bottom: 1px solid rgba(128,128,128,.1);
          text-align: left; vertical-align: top; overflow-wrap: anywhere; }
        th:first-child, td:first-child { padding-right: 14px; }
        thead th { border-bottom-color: rgba(128,128,128,.2); }
        tbody tr:last-child td { border-bottom: 0; }
        tfoot th, tfoot td { position: static; text-align: left; border-top: 1px solid rgba(128,128,128,.25);
          border-bottom: 0; color: inherit; font-weight: 700; }
        tfoot [data-sum-value] { text-align: right; }
        thead th:last-child { text-align: right; }
        thead[hidden] { display: none; }
        th { color: inherit; font-weight: 600; }
        tfoot th { background: transparent; }
        td:last-child { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
        .gear, button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.3rem 0.55rem; }
        .gear { position: absolute; top: 8px; right: 8px; z-index: 2;
          min-width: 48px; min-height: 48px; }
        :host(:not([view-only])) header { min-height: 56px; }
        :host(:not([view-only])) .tile:has(header[hidden]) { padding-top: 64px; }
        :host([view-only]) header { padding-right: 0; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        :host([view-only]) [data-open-config] { display: none; }
        dialog { width: min(94vw, 38rem); max-height: 94vh; overflow: auto; padding: 1.25rem;
          border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef); }
        dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
        form { display: grid; gap: 0.75rem; }
        ${dialogGroupStyles}
        label { display: grid; gap: 0.25rem; }
        input, select { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a); border-radius: 0.5rem; padding: 0.4rem 0.5rem; }
        input[type="text"], select { width: 100%; }
        .row { display: grid; grid-template-columns: minmax(9rem, 1.2fr) minmax(7rem, 0.9fr) minmax(7rem, 1fr) auto; align-items: end; gap: 0.45rem;
          padding: 0.5rem 0; border-top: 1px solid var(--cms-border-subtle, #3a4d42); }
        [hidden] { display: none !important; }
        fieldset.mode { display: grid; gap: 0.4rem; }
        label.check { display: flex; align-items: center; gap: 0.5rem; }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .single .row { grid-template-columns: minmax(7rem, 1fr) minmax(8rem, 1fr) auto; }
        .device, .single-device { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.3rem; }
        .device input { min-width: 0; }
        .unit-fields { display: grid; grid-column: 1 / -1; gap: 0.3rem; }
        .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { min-height: 1.2em; margin: 0; color: var(--cms-danger, #ffb4a8); }
        @media (max-width: 36rem) {
          .row, .single .row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
          .row > button { grid-column: 2; justify-self: end; }
          .unit-label { grid-column: 1 / -1; }
        }
        /* Einheitliche Auswahllisten: eigener Pfeil statt Systemdarstellung (Safari). */
        select { appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238a9a8f' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 0.5em center; background-size: 0.65em;
          padding-right: 1.6em; }
        ${unitInputCss}
      </style>
      <article class="tile" data-tile>
        <header data-header hidden><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="Tabelle konfigurieren">⚙</button>
        <div class="table-card">
          <table>
            <thead data-head><tr><th scope="col" data-device-heading>Bezeichner</th><th scope="col" data-value-heading>Wert</th></tr></thead>
            <tbody data-rows></tbody>
            <tfoot data-sum hidden><tr><th scope="row" data-sum-label>Summe</th><td data-sum-value></td></tr></tfoot>
          </table>
        </div>
      </article>
      <dialog data-dialog aria-labelledby="table-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="table-dialog-title">Tabelle konfigurieren</h3>
          <details class="config-group" open><summary>Allgemein</summary>
            <div class="config-group-fields">
              <label>Titel (optional)<input name="title" type="text" maxlength="64" autocomplete="off"></label>
              ${titleVisibilityField}
            </div>
          </details>
          <details class="config-group" open><summary>Datenquelle und Readings</summary>
            <div class="config-group-fields">
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
            </div>
          </details>
          <details class="config-group"><summary>Tabellenanzeige</summary>
            <div class="config-group-fields">
              <fieldset class="mode"><legend>Tabellenüberschrift</legend>
                <label class="check"><input name="header" type="checkbox" checked>Überschrift anzeigen</label>
                <div data-header-fields>
                  <label>Bezeichnungsspalte<input name="deviceLabel" type="text" maxlength="32" placeholder="Bezeichner" autocomplete="off"></label>
                  <label>Wertespalte<input name="valueLabel" type="text" maxlength="32" placeholder="Wert" autocomplete="off"></label>
                  <label class="check"><input name="showValueLabel" type="checkbox" checked>Wertespalten-Überschrift anzeigen</label>
                </div></fieldset>
              <fieldset class="mode"><legend>Summenzeile</legend>
                <label class="check"><input name="sum" type="checkbox">Summenzeile unter der Tabelle anzeigen</label>
                <div data-sum-field hidden>
                  <label>Beschriftung<input name="sumLabel" type="text" maxlength="32" placeholder="Summe" autocomplete="off"></label>
                  <label class="check"><input name="showSumLabel" type="checkbox" checked>Beschriftung anzeigen</label>
                  <label class="check"><input name="sumUnitAuto" type="checkbox" checked>Einheit automatisch wie die Einzelwerte</label>
                  <div data-sum-unit-fields hidden>
                    <label>Einheit (optional, Vorschlag wählen oder frei eintragen)
                      <input name="sumUnit" type="text" maxlength="16" autocomplete="off"></label>
                    <div data-sum-unit-choices></div>
                  </div>
                </div></fieldset>
            </div>
          </details>
          <p class="error" data-error role="alert"></p>
          <div class="actions"><button type="button" class="danger" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit">Speichern</button></div>
        </form>
      </dialog>`;
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.suggestionTracker = createManualFieldTracker(this.shadowRoot.querySelector('[data-form]'));
    this.shadowRoot.querySelector('[data-add]').addEventListener('click', () => this.addRow());
    this.shadowRoot.querySelector('[name="sum"]').addEventListener('change', (event) => {
      this.shadowRoot.querySelector('[data-sum-field]').hidden = !event.target.checked;
    });
    this.shadowRoot.querySelector('[name="header"]').addEventListener('change', (event) => {
      this.shadowRoot.querySelector('[data-header-fields]').hidden = !event.target.checked;
    });
    this.shadowRoot.querySelector('[data-sum-unit-choices]')
      .append(unitSuggestions(this.shadowRoot.querySelector('[name="sumUnit"]'), { compact: true }));
    this.shadowRoot.querySelector('[name="sumUnitAuto"]').addEventListener('change', (event) => {
      this.shadowRoot.querySelector('[data-sum-unit-fields]').hidden = event.target.checked;
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
    this.pickerAbort.abort();
    this.pickerAbort = new AbortController();
    this.isNew = isNew;
    this.suggestionTracker.reset();
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    form.elements.deviceLabel.value = this.widgetConfig.deviceLabel || '';
    form.elements.sum.checked = this.widgetConfig.sum === true;
    form.elements.sumLabel.value = this.widgetConfig.sumLabel || '';
    this.shadowRoot.querySelector('[data-sum-field]').hidden = !form.elements.sum.checked;
    form.elements.showSumLabel.checked = this.widgetConfig.hideSumLabel !== true;
    form.elements.header.checked = this.widgetConfig.hideHeader !== true;
    this.shadowRoot.querySelector('[data-header-fields]').hidden = !form.elements.header.checked;
    form.elements.valueLabel.value = this.widgetConfig.valueLabel || '';
    form.elements.showValueLabel.checked = this.widgetConfig.hideValueLabel !== true;
    const savedUnit = this.widgetConfig.sumUnit;
    form.elements.sumUnitAuto.checked = savedUnit === undefined;
    form.elements.sumUnit.value = savedUnit || '';
    this.shadowRoot.querySelector('[data-sum-unit-fields]').hidden = savedUnit === undefined;
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

  updateLabelDefaults() {
    const rows = this.rowsInDialog();
    const multipleDevices = new Set(rows.map((row) => row.querySelector('.device input').value).filter(Boolean)).size > 1;
    for (const row of rows) {
      const device = row.querySelector('.device input').value;
      const reading = row.querySelector('select').value;
      row.querySelector('[data-row-label]').placeholder = reading
        ? multipleDevices ? `${device}: ${reading}` : reading
        : 'Reading wählen';
    }
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
      this.applySharedDevice(name, true);
    }
    this.applyMode();
  }

  applySharedDevice(name, preserveExisting = false) {
    const device = this.devices.find((item) => item.name === name);
    for (const row of this.rowsInDialog()) {
      const select = row.querySelector('select');
      const currentDevice = row.querySelector('.device input').value;
      const keepCurrent = preserveExisting && currentDevice === name
        && device?.readings?.[select.value] !== undefined;
      this.setRowDevice(row, device, keepCurrent ? select.value : undefined);
    }
  }

  async pickSingleDevice() {
    try {
      const device = await openDevicePicker({ signal: this.pickerAbort.signal, services: {
        ...this.services, listAllDevices: () => this.services.listAllDevices({ refresh: true }),
      } });
      if (!device) {
        return;
      }
      this.devices = [...this.devices.filter((item) => item.name !== device.name), device];
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
    nameInput.placeholder = 'Reading wählen';
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
    unitLabel.textContent = 'Einheit (optional, Vorschlag wählen oder frei eintragen)';
    const unitInput = document.createElement('input');
    unitInput.type = 'text';
    unitInput.maxLength = 16;
    unitInput.autocomplete = 'off';
    unitInput.dataset.unit = '';
    unitLabel.append(unitInput);
    const unitFields = document.createElement('div');
    unitFields.className = 'unit-fields unit-label';
    unitFields.append(unitLabel, unitSuggestions(unitInput, { compact: true }));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Entfernen';
    remove.addEventListener('click', () => {
      row.remove();
      this.updateLabelDefaults();
    });
    const pickRowDevice = async () => {
      try {
        const device = await openDevicePicker({ signal: this.pickerAbort.signal, services: {
          ...this.services, listAllDevices: () => this.services.listAllDevices({ refresh: true }),
        } });
        if (device && row.isConnected) {
          this.devices = [...this.devices.filter((item) => item.name !== device.name), device];
          this.setRowDevice(row, device);
        }
      } catch (error) {
        this.shadowRoot.querySelector('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
      }
    };
    pick.addEventListener('click', pickRowDevice);
    deviceInput.addEventListener('click', pickRowDevice);
    row.append(deviceLabel, nameLabel, readingLabel, remove, unitFields);
    readingSelect.addEventListener('change', () => this.updateLabelDefaults());
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
    this.updateLabelDefaults();
  }

  setRowDevice(row, device, selectedReading) {
    const deviceInput = row.querySelector('input');
    const select = row.querySelector('select');
    deviceInput.value = device?.name || '';
    const readings = Object.keys(device?.readings || {}).sort();
    const selected = selectedReading === undefined
      ? suggestedReading(device?.readings, 'fhem-table')
      : selectedReading;
    const options = [new Option('Reading wählen …', ''), ...readings.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      return option;
    })];
    if (selected && !readings.includes(selected)) {
      options.push(new Option(`${selected} (nicht verfügbar)`, selected));
    }
    select.replaceChildren(...options);
    select.value = selected || '';
    this.updateLabelDefaults();
  }

  setRowUnit(row, unit) {
    row.querySelector('[data-unit]').value = unit;
  }

  async saveConfig() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const title = form.elements.title.value.trim();
    const deviceLabel = form.elements.deviceLabel.value.trim();
    const sumLabel = form.elements.sumLabel.value.trim();
    const valueLabel = form.elements.valueLabel.value.trim();
    const sumUnit = form.elements.sumUnitAuto.checked ? '' : form.elements.sumUnit.value.trim();
    const badText = (text, max) => text.length > max || /[\u0000-\u001f\u007f]/.test(text);
    if (badText(sumLabel, 32) || badText(valueLabel, 32) || badText(sumUnit, 16)) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Beschriftung oder Einheit der Tabelle ist ungültig (Überschriften max. 32, Einheit max. 16 Zeichen).';
      return;
    }
    const sharedDevice = form.elements.deviceSingle.value.trim();
    if (this.mode !== 'multi' && !sharedDevice) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Bitte zuerst das Device wählen.';
      return;
    }
    const rows = [...this.shadowRoot.querySelectorAll('[data-config-rows] .row')].map((row) => {
      const unit = row.querySelector('[data-unit]').value.trim();
      const label = row.querySelector('[data-row-label]').value.trim();
      return {
        device: this.mode === 'multi' ? row.querySelector('.device input').value : sharedDevice,
        ...(label ? { label } : {}),
        reading: row.querySelector('select').value,
        ...(unit ? { unit } : {})
      };
    });
    if (!rows.length || rows.some((row) => !row.device || !row.reading)) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Für jede Zeile Device und Reading wählen.';
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
    if (!form.elements.showTitle.checked) {
      next.showTitle = false;
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
      if (!form.elements.sumUnitAuto.checked) {
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
    this.pickerAbort.abort();
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) {
      dialog.close();
    }
    if (!saved && this.isNew) {
      this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true }));
    }
  }

  disconnectedCallback() {
    this.pickerAbort.abort();
  }

  render() {
    if (!this.widgetConfig || !this.shadowRoot.querySelector('[data-rows]')) {
      return;
    }
    const title = this.shadowRoot.querySelector('[data-title]');
    title.textContent = this.widgetConfig.title || '';
    title.parentElement.hidden = !this.widgetConfig.title || this.widgetConfig.showTitle === false;
    this.shadowRoot.querySelector('[data-device-heading]').textContent = this.widgetConfig.deviceLabel || 'Bezeichner';
    this.shadowRoot.querySelector('[data-head]').hidden = this.widgetConfig.hideHeader === true;
    this.shadowRoot.querySelector('[data-value-heading]').textContent = this.widgetConfig.hideValueLabel === true
      ? '' : (this.widgetConfig.valueLabel || 'Wert');
    const body = this.shadowRoot.querySelector('[data-rows]');
    const numbers = [];
    const units = new Set();
    const multipleDevices = new Set((this.widgetConfig.rows || []).map((row) => row.device)).size > 1;
    const nextRows = document.createDocumentFragment();
    nextRows.append(...(this.widgetConfig.rows || []).map((row) => {
      const tr = document.createElement('tr');
      const deviceCell = document.createElement('td');
      const valueCell = document.createElement('td');
      const group = this.snapshots.get(row.device) || [];
      deviceCell.textContent = row.label || (multipleDevices ? `${row.device}: ${row.reading}` : row.reading);
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
    updateWidgetDom(body, nextRows);
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
