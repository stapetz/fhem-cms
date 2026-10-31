import { isValidName } from '../js/fhem-client.js';

const TARGET_MIN = 5;
const TARGET_MAX = 30;
const TARGET_STEP = 0.5;
const SEND_DELAY_MS = 1500;
const CONFIRM_WAIT_MS = 120000;
const PICKER_MAX_ROWS = 200;
const PICKER_COLUMNS = [
  { key: 'name', label: 'Device' },
  { key: 'alias', label: 'Alias' },
  { key: 'type', label: 'Typ' },
  { key: 'room', label: 'Raum' },
  { key: 'parent', label: 'Kanal von' }
];

// Das erste Device der Gruppe (Hauptdevice, dann Kanäle) mit diesem Reading liefert den Wert.
function lookupReading(group, name) {
  if (!Array.isArray(group) || !name) {
    return null;
  }
  for (const device of group) {
    if (device.readings[name] !== undefined) {
      return { device: device.name, value: device.readings[name] };
    }
  }
  return null;
}

const PRESETS = {
  actual: ['temperature', 'measured-temp'],
  target: ['desiredTemperature', 'desired-temp'],
  valve: ['valveposition', 'ValvePosition'],
  mode: ['mode', 'R-controlMode', 'controlMode'],
  battery: ['batteryPercent', 'battery', 'batteryState', 'batteryLevel']
};

const FIELDS = [
  { key: 'actual', label: 'Isttemperatur', required: true },
  { key: 'target', label: 'Solltemperatur (wird auch zum Setzen verwendet)', required: true },
  { key: 'valve', label: 'Ventilstellung', required: false },
  { key: 'mode', label: 'Betriebsart', required: false },
  { key: 'battery', label: 'Batterie', required: false }
];

function toNumber(value) {
  if (typeof value !== 'string' || !/^-?[0-9]+(\.[0-9]+)?$/.test(value.trim())) {
    return null;
  }
  return Number.parseFloat(value);
}

const MODE_LABELS = {
  auto: 'Auto', manual: 'Manuell', boost: 'Boost', day: 'Tag', night: 'Nacht',
  eco: 'Eco', comfort: 'Komfort'
};
const MAX_MODES = ['auto', 'eco', 'comfort', 'boost', 'manual'];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

function hasCommand(usage, command) {
  return typeof usage === 'string'
    && new RegExp(`(?:^|\\s)${escapeRegExp(command)}(?:\\s|\\(|:|$)`).test(usage);
}

// Wie im Thermostat-Dashboard: Befehle und Wertebereich ergeben sich aus den möglichen Set-Befehlen des Geräts.
function thermostatControl(group, targetReading) {
  const device = (Array.isArray(group) ? group : []).find((item) => item.readings[targetReading] !== undefined) || null;
  const usage = device ? device.sets : '';
  const isMax = Boolean(device) && device.type === 'MAX';
  const result = { device: device ? device.name : '', min: TARGET_MIN, max: TARGET_MAX, modes: [], modeCommand: '', modeDevice: '' };
  if (!device) {
    return result;
  }
  if (!isMax) {
    const list = new RegExp(`\\b${escapeRegExp(targetReading)}:([A-Za-z0-9.,|+-]+)`).exec(usage);
    const range = new RegExp(`\\b${escapeRegExp(targetReading)}\\s+\\([^)]*?([-+]?\\d+(?:\\.\\d+)?)\\.\\.([-+]?\\d+(?:\\.\\d+)?)`).exec(usage);
    const numbers = list ? list[1].split(/[|,]/).map(toNumber).filter((n) => n !== null) : [];
    if (numbers.length > 0) {
      result.min = Math.min(...numbers);
      result.max = Math.max(...numbers);
    } else if (range) {
      result.min = Number.parseFloat(range[1]);
      result.max = Number.parseFloat(range[2]);
    }
  }
  if (isMax) {
    if (hasCommand(usage, 'desiredTemperature')) {
      result.modeCommand = 'desiredTemperature';
      result.modeDevice = device.name;
      result.modes = MAX_MODES;
    }
  } else {
    // controlMode kann am Hauptdevice oder am Kanal liegen.
    for (const item of [device, ...(Array.isArray(group) ? group : [])]) {
      const match = /\bcontrolMode(?:\s+\(([^)]*)\)|:([A-Za-z0-9_|,-]+))/.exec(item.sets || '');
      if (match) {
        result.modeCommand = 'controlMode';
        result.modeDevice = item.name;
        result.modes = (match[1] || match[2]).split(/[|,]/).filter((mode) => MODE_LABELS[mode]);
        break;
      }
    }
  }
  return result;
}

class FHEMCMSThermostat extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.snapshot = null;
    this.services = null;
    this.devices = [];
    this.isNew = false;
    this.sendTimer = null;
    this.pending = false;
    this.sent = null;
    this.modePending = false;
    this.control = null;
    this.staleSince = null;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount > 0) {
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; min-height: 0; }
        * { box-sizing: border-box; }
        .tile { height: 100%; overflow: hidden; container-type: size; border: 1px solid #43564a;
          border-radius: 1rem; background: #202e27; }
        .body { height: 100%; display: flex; flex-direction: column; justify-content: space-between;
          gap: clamp(0.1rem, 1.5cqh, 0.6rem); padding: clamp(0.25rem, 4cqmin, 1rem);
          font-size: clamp(0.65rem, 4.2cqmin, 1rem); }
        header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
        h3 { margin: 0; font-size: 1.05em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        button {
          font: inherit; color: inherit; cursor: pointer;
          border: 1px solid #43564a; border-radius: 0.5rem;
          background: #2a3b32; padding: 0.35rem 0.7rem;
        }
        button:hover { background: #34493e; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #8fd0a8; outline-offset: 2px; }
        .icon { padding: 0.1rem 0.45rem; flex: none; }
        :host([view-only]) [data-open-config] { display: none; }
        .actual { font-size: clamp(1.1rem, min(26cqh, 15cqw), 3rem); font-weight: 700; line-height: 1.05; white-space: nowrap; }
        .label { color: #a5c9b2; font-size: 0.85em; }
        .target-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
        input[type="range"] { width: 100%; margin: 0; accent-color: #8fd0a8; }
        .hint { margin: 0; color: #a5c9b2; font-size: 0.8rem; }
        .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 1rem; color: #c4d0c8; font-size: 0.9em; }
        .meta select { width: auto; max-width: 100%; padding: 0.15rem 0.4rem; font-size: 1em; }
        .valve[hidden], [data-mode-select][hidden] { display: none; }
        .bar { position: relative; height: 0.5em; border-radius: 0.25rem;
          background: linear-gradient(90deg, #3b82f6, #ef4444, #7f1d1d); }
        .marker { position: absolute; top: -0.2em; width: 0.2em; height: 0.9em; background: #fff; border-radius: 0.1rem; }
        .status { margin: 0; min-height: 1.2em; font-size: 0.85em; color: #a5c9b2; }
        .status[data-error] { color: #ffb4a8; }
        .tile[data-stale] { opacity: 0.65; border-style: dashed; }
        /* Je kleiner die Kachel, desto weniger Inhalt: erst Ventil, dann Meta, Titel und zuletzt der Schieber. */
        @container (max-height: 13rem) { .valve, .status:empty { display: none; } }
        @container (max-height: 10rem) { .meta [data-battery], .label.is-ist { display: none; } }
        @container (max-height: 7.5rem) { .meta, header .title-text { display: none; } }
        @container (max-height: 5rem) { .target-row .label, [data-slider] { display: none; } }
        @container (max-width: 7rem) { [data-open-config] { display: none; } .target-row .label { display: none; } }
        dialog { border: 1px solid #43564a; border-radius: 1rem; background: #202e27; color: #edf4ef;
          padding: 1.25rem; width: min(92vw, 32rem); }
        dialog::backdrop { background: rgb(0 0 0 / 0.6); }
        form, .picker-body { display: grid; gap: 0.75rem; }
        .device-row { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
        dialog.picker { width: min(94vw, 44rem); }
        .picker-list { max-height: 50vh; overflow: auto; border: 1px solid #43564a; border-radius: 0.5rem; }
        .picker-list table { width: 100%; border-collapse: collapse; font-size: 0.9rem; table-layout: fixed; }
        .picker-list th:nth-child(1) { width: 26%; }
        .picker-list th:nth-child(2) { width: 22%; }
        .picker-list th:nth-child(3) { width: 14%; }
        .picker-list th:nth-child(4) { width: 20%; }
        .picker-list td { overflow-wrap: anywhere; }
        .picker-info { margin: 0; min-height: 1.2em; font-size: 0.85rem; color: #a5c9b2; }
        .picker-list th { position: sticky; top: 0; background: #17211d; text-align: left; color: #a5c9b2; }
        .picker-list tr.filters th { top: 2.1rem; padding-top: 0; font-weight: normal; }
        .picker-list tr.filters input { padding: 0.25rem 0.4rem; font-size: 0.8rem; }
        .picker-list td.dim { color: #a5c9b2; }
        .picker-list th, .picker-list td { padding: 0.4rem 0.6rem; }
        .picker-list tbody tr { cursor: pointer; border-top: 1px solid #2f3f36; }
        .picker-list tbody tr:hover, .picker-list tbody tr:focus { background: #2c3f35; outline: none; }
        label { display: grid; gap: 0.25rem; font-size: 0.9rem; }
        input, select { font: inherit; color: inherit; background: #17211d;
          border: 1px solid #43564a; border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
        fieldset { border: 1px solid #43564a; border-radius: 0.75rem; padding: 0.75rem;
          display: grid; gap: 0.75rem; margin: 0; }
        legend { color: #a5c9b2; font-size: 0.8rem; }
        .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
        .danger { margin-right: auto; border-color: #7f3b33; }
        .error { margin: 0; color: #ffb4a8; min-height: 1.2em; }
      </style>
      <article class="tile" data-tile>
        <div class="body">
          <header>
            <h3 data-title></h3>
            <button type="button" class="icon" data-open-config aria-label="Kachel konfigurieren">⚙</button>
          </header>
          <div>
            <div class="actual" data-actual>–</div>
            <div class="label is-ist">Ist</div>
          </div>
          <div>
            <div class="target-row">
              <label class="label" for="slider">Soll</label>
              <output data-target-out>–</output>
            </div>
            <input id="slider" type="range" data-slider min="${TARGET_MIN}" max="${TARGET_MAX}" step="${TARGET_STEP}" disabled>
          </div>
          <div class="meta">
            <select data-mode-select aria-label="Betriebsart" hidden></select>
            <span data-mode></span><span data-battery></span>
          </div>
          <div class="valve" data-valve hidden>
            <div class="label">Ventil <span data-valve-text></span></div>
            <div class="bar"><span class="marker" data-valve-marker></span></div>
          </div>
          <p class="status" role="status" data-status></p>
        </div>
      </article>
      <dialog data-dialog aria-labelledby="dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="dialog-title">Thermostat-Kachel konfigurieren</h3>
          <label>Titel (optional)
            <input name="title" maxlength="64" autocomplete="off">
          </label>
          <label>FHEM-Device
            <span class="device-row">
              <input name="device" maxlength="128" autocomplete="off" readonly required placeholder="Noch kein Device gewählt">
              <button type="button" data-pick-device>Auswählen …</button>
            </span>
          </label>
          <span class="hint" data-device-alias></span>
          <fieldset data-readings>
            <legend>Readings</legend>
          </fieldset>
          <p class="error" role="alert" data-dialog-error></p>
          <div class="actions">
            <button type="button" class="danger" data-delete>Kachel löschen</button>
            <button type="button" data-cancel>Abbrechen</button>
            <button type="submit" data-save>Speichern</button>
          </div>
        </form>
      </dialog>
      <dialog data-picker aria-labelledby="picker-title" class="picker">
        <div class="picker-body">
          <h3 id="picker-title">Device auswählen</h3>
          <input type="search" data-picker-search placeholder="In allen Spalten suchen" autocomplete="off" aria-label="Devices durchsuchen">
          <div class="picker-list">
            <table>
              <thead>
                <tr>${PICKER_COLUMNS.map((column) => `<th>${column.label}</th>`).join('')}</tr>
                <tr class="filters">${PICKER_COLUMNS.map((column) => `<th><input type="search" data-picker-filter="${column.key}" placeholder="Filter" autocomplete="off" aria-label="${column.label} filtern"></th>`).join('')}</tr>
              </thead>
              <tbody data-picker-rows></tbody>
            </table>
          </div>
          <p class="picker-info" data-picker-info></p>
          <div class="actions"><button type="button" data-picker-cancel>Abbrechen</button></div>
        </div>
      </dialog>
    `;

    this.buildDialogFields();
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.shadowRoot.querySelector('[data-slider]').addEventListener('input', () => this.onSliderInput());
    this.shadowRoot.querySelector('[data-mode-select]').addEventListener('change', () => this.onModeChange());
    this.shadowRoot.querySelector('[data-cancel]').addEventListener('click', () => this.closeDialog(true));
    this.shadowRoot.querySelector('[data-delete]').addEventListener('click', () => this.onDelete());
    this.shadowRoot.querySelector('[data-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      this.onSave();
    });
    this.shadowRoot.querySelector('[data-dialog]').addEventListener('cancel', () => this.closeDialog(true));
    this.shadowRoot.querySelector('[data-pick-device]').addEventListener('click', () => this.openPicker());
    this.shadowRoot.querySelector('input[name="device"]').addEventListener('click', () => this.openPicker());
    this.shadowRoot.querySelector('[data-picker-cancel]').addEventListener('click', () => this.closePicker());
    this.shadowRoot.querySelector('[data-picker-search]').addEventListener('input', () => this.renderPickerRows());
    for (const filter of this.shadowRoot.querySelectorAll('[data-picker-filter]')) {
      filter.addEventListener('input', () => this.renderPickerRows());
    }
    this.render();
  }

  disconnectedCallback() {
    window.clearTimeout(this.sendTimer);
  }

  set config(value) {
    this.widgetConfig = value;
    this.render();
  }

  get config() {
    return this.widgetConfig;
  }

  set data(value) {
    this.snapshot = value || null;
    this.render();
  }

  // Zeitpunkt des letzten erfolgreichen Abrufs, solange die Anzeige veraltet ist; sonst null.
  set stale(since) {
    this.staleSince = since || null;
    const tile = this.shadowRoot.querySelector('.tile');
    if (!tile) {
      return;
    }
    tile.toggleAttribute('data-stale', this.staleSince !== null);
    this.render();
  }

  buildDialogFields() {
    const readings = this.shadowRoot.querySelector('[data-readings]');
    for (const field of FIELDS) {
      const label = document.createElement('label');
      label.append(field.label);
      const select = document.createElement('select');
      select.name = `reading-${field.key}`;
      select.required = field.required;
      label.append(select);
      readings.append(label);
    }

  }

  render() {
    const root = this.shadowRoot;
    if (!root || !root.querySelector('[data-title]') || !this.widgetConfig) {
      return;
    }

    const config = this.widgetConfig;
    const group = this.snapshot;
    const read = (name) => {
      const found = lookupReading(group, name);
      return found ? found.value : undefined;
    };
    const alias = (group && group[0].alias) || '';
    root.querySelector('[data-title]').textContent = config.title || alias || config.device || 'Thermostat';

    const actualRaw = read(config.readings.actual);
    const actual = toNumber(actualRaw);
    root.querySelector('[data-actual]').textContent = actual === null
      ? (actualRaw !== undefined && actualRaw !== '' ? actualRaw : '–')
      : `${actual.toFixed(1)} °C`;

    const slider = root.querySelector('[data-slider]');
    const output = root.querySelector('[data-target-out]');
    const targetRaw = read(config.readings.target);
    const target = toNumber(targetRaw);
    const control = thermostatControl(group, config.readings.target);
    this.control = control;
    slider.min = String(control.min);
    slider.max = String(control.max);
    slider.disabled = !this.services || !this.snapshot || target === null || Boolean(this.staleSince);
    if (this.sent && (target === this.sent.value || Date.now() > this.sent.until)) {
      this.sent = null;
      this.setStatus('');
    }
    if (!this.pending) {
      if (this.sent) {
        slider.value = String(this.sent.value);
        output.textContent = `${this.sent.value.toFixed(1)} °C (gesendet)`;
      } else if (target === null) {
        output.textContent = targetRaw !== undefined && targetRaw !== '' ? targetRaw : '–';
      } else {
        slider.value = String(Math.min(control.max, Math.max(control.min, target)));
        output.textContent = `${target.toFixed(1)} °C`;
      }
    }

    const modeValue = read(config.readings.mode);
    const select = root.querySelector('[data-mode-select]');
    const modeText = root.querySelector('[data-mode]');
    const canSetMode = Boolean(this.services) && control.modes.length > 0 && !this.staleSince;
    select.hidden = !canSetMode;
    if (canSetMode) {
      if (!this.modePending && this.shadowRoot.activeElement !== select) {
        const options = control.modes.map((mode) => {
          const option = document.createElement('option');
          option.value = mode;
          option.textContent = MODE_LABELS[mode] || mode;
          return option;
        });
        if (!control.modes.includes(modeValue)) {
          const unknown = document.createElement('option');
          unknown.value = '';
          unknown.textContent = modeValue ? `Modus: ${modeValue}` : 'Betriebsart …';
          unknown.disabled = true;
          options.unshift(unknown);
        }
        select.replaceChildren(...options);
        select.value = control.modes.includes(modeValue) ? modeValue : '';
      }
      modeText.textContent = '';
    } else {
      this.renderOptional('[data-mode]', 'Modus', modeValue, config.readings.mode);
    }
    this.renderOptional('[data-battery]', 'Batterie', read(config.readings.battery), config.readings.battery);

    const valveRaw = config.readings.valve ? read(config.readings.valve) : undefined;
    const valve = toNumber(valveRaw === undefined ? '' : valveRaw.replace('%', '').trim());
    const valveBox = root.querySelector('[data-valve]');
    valveBox.hidden = valve === null;
    if (valve !== null) {
      const percent = Math.min(100, Math.max(0, valve));
      root.querySelector('[data-valve-text]').textContent = `${percent} %`;
      root.querySelector('[data-valve-marker]').style.left = `calc(${percent}% - 0.1rem)`;
    }

    if (this.staleSince && !this.pending) {
      this.setStatus(`Veraltet seit ${new Date(this.staleSince).toLocaleTimeString('de-DE')}`, true);
    } else if (this.snapshot === null && !this.pending) {
      this.setStatus('Keine Daten für dieses Device', true);
    } else if (!this.pending && root.querySelector('[data-status]').hasAttribute('data-error')) {
      this.setStatus('');
    }
  }

  renderOptional(selector, label, value, readingName) {
    const element = this.shadowRoot.querySelector(selector);
    element.textContent = readingName && value !== undefined && value !== '' ? `${label}: ${value}` : '';
  }

  setStatus(message, isError = false) {
    const status = this.shadowRoot.querySelector('[data-status]');
    status.textContent = message;
    status.toggleAttribute('data-error', isError);
  }

  onSliderInput() {
    const slider = this.shadowRoot.querySelector('[data-slider]');
    this.pending = true;
    this.shadowRoot.querySelector('[data-target-out]').textContent =
      `${Number.parseFloat(slider.value).toFixed(1)} °C`;
    this.setStatus('Wird gleich gesendet …');
    window.clearTimeout(this.sendTimer);
    this.sendTimer = window.setTimeout(() => this.sendTarget(), SEND_DELAY_MS);
  }

  async onModeChange() {
    const select = this.shadowRoot.querySelector('[data-mode-select]');
    const control = this.control;
    if (!control || !control.modeCommand || !select.value) {
      return;
    }
    this.modePending = true;
    select.disabled = true;
    this.setStatus('Betriebsart wird gesendet …');
    try {
      await this.services.setCommand(control.modeDevice, control.modeCommand, select.value);
      this.setStatus('Betriebsart gesendet, wartet auf Bestätigung des Geräts');
    } catch (error) {
      this.setStatus(error.message || 'Senden fehlgeschlagen', true);
    } finally {
      select.disabled = false;
      window.setTimeout(() => {
        this.modePending = false;
        this.render();
      }, 3000);
    }
  }

  async sendTarget() {
    const slider = this.shadowRoot.querySelector('[data-slider]');
    const value = Number.parseFloat(slider.value).toFixed(1);
    try {
      const found = lookupReading(this.snapshot, this.widgetConfig.readings.target);
      await this.services.setTarget(this.widgetConfig, value, found ? found.device : this.widgetConfig.device);
      this.pending = false;
      this.sent = { value: Number.parseFloat(value), until: Date.now() + CONFIRM_WAIT_MS };
      this.setStatus('Wert gesendet, wartet auf Bestätigung des Geräts');
    } catch (error) {
      this.pending = false;
      this.render();
      this.setStatus(error.message || 'Senden fehlgeschlagen', true);
      return;
    }
    this.render();
  }

  async openConfig(options = {}) {
    this.isNew = Boolean(options.isNew);
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    const form = this.shadowRoot.querySelector('[data-form]');
    const config = this.widgetConfig;

    form.elements.title.value = config.title || '';
    form.elements.device.value = config.device || '';
    this.shadowRoot.querySelector('[data-delete]').hidden = this.isNew;
    this.setDialogError('');
    this.devices = [];
    this.fillReadingOptions(null, config.readings);

    if (!dialog.open) {
      dialog.showModal();
    }

    if (this.services) {
      try {
        this.devices = await this.services.listDevices();
      } catch (error) {
        this.setDialogError(error.message || 'Geräteliste konnte nicht geladen werden');
      }
    }
    this.showAlias();
    this.fillReadingOptions(this.groupFor(form.elements.device.value), config.readings);
  }

  showAlias() {
    const name = this.shadowRoot.querySelector('input[name="device"]').value.trim();
    const found = this.findDevice(name);
    this.shadowRoot.querySelector('[data-device-alias]').textContent =
      found && found.alias && found.alias !== name ? `Alias: ${found.alias}` : '';
  }

  findDevice(name) {
    return this.devices.find((device) => device.name === name) || null;
  }

  groupFor(name) {
    const main = this.findDevice(name);
    if (!main) {
      return null;
    }
    const channels = this.devices
      .filter((device) => device.parent === name)
      .sort((a, b) => a.name.localeCompare(b.name));
    return [main, ...channels];
  }

  async openPicker() {
    const picker = this.shadowRoot.querySelector('[data-picker]');
    const search = this.shadowRoot.querySelector('[data-picker-search]');
    search.value = '';
    for (const filter of this.shadowRoot.querySelectorAll('[data-picker-filter]')) {
      filter.value = '';
    }
    if (!picker.open) {
      picker.showModal();
    }
    search.focus();
    if (this.devices.length === 0 && this.services) {
      this.setPickerInfo('Geräteliste wird geladen …');
      try {
        this.devices = await this.services.listDevices();
      } catch (error) {
        this.setPickerInfo(error.message || 'Geräteliste konnte nicht geladen werden');
        return;
      }
    }
    this.renderPickerRows();
  }

  renderPickerRows() {
    const split = (text) => text.toLowerCase().split(/\s+/).filter(Boolean);
    const terms = split(this.shadowRoot.querySelector('[data-picker-search]').value);
    const filters = PICKER_COLUMNS.map((column) => ({
      key: column.key,
      terms: split(this.shadowRoot.querySelector(`[data-picker-filter="${column.key}"]`).value)
    })).filter((filter) => filter.terms.length > 0);
    const matches = this.devices.filter((device) => {
      const haystack = PICKER_COLUMNS.map((column) => device[column.key]).join(' ').toLowerCase();
      return terms.every((term) => haystack.includes(term))
        && filters.every((filter) => filter.terms.every((term) => device[filter.key].toLowerCase().includes(term)));
    });
    const shown = matches.slice(0, PICKER_MAX_ROWS);
    this.shadowRoot.querySelector('[data-picker-rows]').replaceChildren(...shown.map((device) => {
      const row = document.createElement('tr');
      row.tabIndex = 0;
      for (const column of PICKER_COLUMNS) {
        const cell = document.createElement('td');
        cell.textContent = device[column.key];
        if (column.key === 'parent') {
          cell.className = 'dim';
        }
        row.append(cell);
      }
      const choose = () => this.pickDevice(device);
      row.addEventListener('click', choose);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose();
        }
      });
      return row;
    }));
    this.setPickerInfo(matches.length === 0
      ? 'Keine passenden Devices gefunden'
      : matches.length > shown.length
        ? `${shown.length} von ${matches.length} Treffern angezeigt, Suche weiter einschränken`
        : `${matches.length} Devices`);
  }

  setPickerInfo(message) {
    this.shadowRoot.querySelector('[data-picker-info]').textContent = message;
  }

  pickDevice(device) {
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.device.value = device.parent || device.name;
    this.showAlias();
    this.closePicker();
    this.onDeviceChanged();
  }

  closePicker() {
    const picker = this.shadowRoot.querySelector('[data-picker]');
    if (picker.open) {
      picker.close();
    }
  }

  onDeviceChanged() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const group = this.groupFor(form.elements.device.value.trim());
    this.fillReadingOptions(group, {});
    this.setDialogError(group || !form.elements.device.value.trim()
      ? ''
      : 'Dieses Device wurde nicht gefunden');
  }

  fillReadingOptions(group, selected) {
    const form = this.shadowRoot.querySelector('[data-form]');
    const names = new Set();
    for (const device of group || []) {
      for (const name of Object.keys(device.readings)) {
        names.add(name);
      }
    }
    const sorted = [...names].sort((a, b) => a.localeCompare(b));

    for (const field of FIELDS) {
      const select = form.elements[`reading-${field.key}`];
      const wanted = selected[field.key] || PRESETS[field.key].find((name) => names.has(name)) || '';
      const entries = new Set(sorted);
      if (wanted) {
        entries.add(wanted);
      }

      const options = [];
      if (!field.required) {
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '– nicht anzeigen –';
        options.push(none);
      }
      for (const name of entries) {
        const found = lookupReading(group, name);
        const option = document.createElement('option');
        option.value = name;
        option.textContent = found
          ? `${name} (${found.value})${found.device !== group[0].name ? ` · ${found.device}` : ''}`
          : name;
        options.push(option);
      }
      select.replaceChildren(...options);
      select.value = wanted;
    }
  }

  setDialogError(message) {
    this.shadowRoot.querySelector('[data-dialog-error]').textContent = message;
  }

  collectWidget() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const device = form.elements.device.value.trim();
    if (!isValidName(device)) {
      throw new Error('Bitte ein gültiges FHEM-Device angeben');
    }

    const readings = {};
    for (const field of FIELDS) {
      const value = form.elements[`reading-${field.key}`].value;
      if (value) {
        if (!isValidName(value)) {
          throw new Error(`Ungültiger Reading-Name für ${field.label}`);
        }
        readings[field.key] = value;
      } else if (field.required) {
        throw new Error(`Bitte ein Reading für ${field.label} wählen`);
      }
    }

    // Position und Größe ändert der Layout-Modus der Seite.
    const grid = { ...this.widgetConfig.grid };

    const title = form.elements.title.value.trim();
    if (/[\u0000-\u001f\u007f]/.test(title)) {
      throw new Error('Der Titel enthält ungültige Zeichen');
    }

    const widget = { id: this.widgetConfig.id, type: 'thermostat', device, readings, grid };
    if (title) {
      widget.title = title;
    }
    return widget;
  }

  async onSave() {
    const save = this.shadowRoot.querySelector('[data-save]');
    try {
      const widget = this.collectWidget();
      save.disabled = true;
      await this.services.saveWidget(widget);
      this.isNew = false;
      this.closeDialog(false);
    } catch (error) {
      this.setDialogError(error.message || 'Speichern fehlgeschlagen');
    } finally {
      save.disabled = false;
    }
  }

  async onDelete() {
    if (!window.confirm('Diese Kachel wirklich löschen?')) {
      return;
    }
    try {
      await this.services.deleteWidget(this.widgetConfig.id);
      this.closeDialog(false);
    } catch (error) {
      this.setDialogError(error.message || 'Löschen fehlgeschlagen');
    }
  }

  closeDialog(cancelled) {
    this.closePicker();
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) {
      dialog.close();
    }
    if (cancelled && this.isNew) {
      this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true, composed: true }));
    }
  }
}

customElements.define('cms-thermostat', FHEMCMSThermostat);
