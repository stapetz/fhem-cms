import { isValidName } from '../js/fhem-client.js';

const TARGET_MIN = 5;
const TARGET_MAX = 25;
const TARGET_STEP = 0.5;
const SEND_DELAY_MS = 1500;
const CONFIRM_WAIT_MS = 120000;

const PRESETS = {
  actual: ['temperature', 'measured-temp'],
  target: ['desiredTemperature', 'desired-temp'],
  valve: ['valveposition', 'ValvePosition'],
  mode: ['mode', 'R-controlMode', 'controlMode'],
  battery: ['battery', 'batteryState', 'batteryLevel']
};

const FIELDS = [
  { key: 'actual', label: 'Isttemperatur', required: true },
  { key: 'target', label: 'Solltemperatur (wird auch zum Setzen verwendet)', required: true },
  { key: 'valve', label: 'Ventilstellung', required: false },
  { key: 'mode', label: 'Betriebsart', required: false },
  { key: 'battery', label: 'Batterie', required: false }
];

const GRID_FIELDS = [
  { key: 'col', label: 'Spalte (1–12)', min: 1, max: 12 },
  { key: 'row', label: 'Zeile', min: 1, max: 1000 },
  { key: 'w', label: 'Breite (Spalten)', min: 1, max: 12 },
  { key: 'h', label: 'Höhe (Zeilen)', min: 1, max: 1000 }
];

function toNumber(value) {
  if (typeof value !== 'string' || !/^-?[0-9]+(\.[0-9]+)?$/.test(value.trim())) {
    return null;
  }
  return Number.parseFloat(value);
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
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount > 0) {
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; }
        * { box-sizing: border-box; }
        .tile {
          height: 100%;
          padding: 1rem;
          border: 1px solid #43564a;
          border-radius: 1rem;
          background: #202e27;
          display: grid;
          gap: 0.6rem;
          align-content: start;
        }
        header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
        h3 { margin: 0; font-size: 1rem; overflow-wrap: anywhere; }
        button {
          font: inherit; color: inherit; cursor: pointer;
          border: 1px solid #43564a; border-radius: 0.5rem;
          background: #2a3b32; padding: 0.35rem 0.7rem;
        }
        button:hover { background: #34493e; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #8fd0a8; outline-offset: 2px; }
        .icon { padding: 0.2rem 0.5rem; }
        .actual { font-size: 2.4rem; font-weight: 700; line-height: 1.1; }
        .label { color: #a5c9b2; font-size: 0.8rem; }
        .target-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
        input[type="range"] { width: 100%; accent-color: #8fd0a8; }
        .meta { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; color: #c4d0c8; font-size: 0.9rem; }
        .valve[hidden] { display: none; }
        .bar { position: relative; height: 0.5rem; border-radius: 0.25rem;
          background: linear-gradient(90deg, #3b82f6, #ef4444, #7f1d1d); }
        .marker { position: absolute; top: -0.2rem; width: 0.2rem; height: 0.9rem; background: #fff; border-radius: 0.1rem; }
        .status { margin: 0; min-height: 1.2em; font-size: 0.85rem; color: #a5c9b2; }
        .status[data-error] { color: #ffb4a8; }
        dialog { border: 1px solid #43564a; border-radius: 1rem; background: #202e27; color: #edf4ef;
          padding: 1.25rem; width: min(92vw, 32rem); }
        dialog::backdrop { background: rgb(0 0 0 / 0.6); }
        form { display: grid; gap: 0.75rem; }
        label { display: grid; gap: 0.25rem; font-size: 0.9rem; }
        input, select { font: inherit; color: inherit; background: #17211d;
          border: 1px solid #43564a; border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
        fieldset { border: 1px solid #43564a; border-radius: 0.75rem; padding: 0.75rem;
          display: grid; gap: 0.75rem; margin: 0; }
        legend { color: #a5c9b2; font-size: 0.8rem; }
        .grid-fields { grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr)); }
        .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
        .danger { margin-right: auto; border-color: #7f3b33; }
        .error { margin: 0; color: #ffb4a8; min-height: 1.2em; }
      </style>
      <article class="tile">
        <header>
          <h3 data-title></h3>
          <button type="button" class="icon" data-open-config aria-label="Kachel konfigurieren">⚙</button>
        </header>
        <div>
          <div class="actual" data-actual>–</div>
          <div class="label">Ist</div>
        </div>
        <div>
          <div class="target-row">
            <label class="label" for="slider">Soll</label>
            <output data-target-out>–</output>
          </div>
          <input id="slider" type="range" data-slider min="${TARGET_MIN}" max="${TARGET_MAX}" step="${TARGET_STEP}" disabled>
        </div>
        <div class="meta"><span data-mode></span><span data-battery></span></div>
        <div class="valve" data-valve hidden>
          <div class="label">Ventil <span data-valve-text></span></div>
          <div class="bar"><span class="marker" data-valve-marker></span></div>
        </div>
        <p class="status" role="status" data-status></p>
      </article>
      <dialog data-dialog aria-labelledby="dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="dialog-title">Thermostat-Kachel konfigurieren</h3>
          <label>Titel (optional)
            <input name="title" maxlength="64" autocomplete="off">
          </label>
          <label>FHEM-Device
            <input name="device" list="device-list" maxlength="128" autocomplete="off" required>
            <datalist id="device-list" data-device-list></datalist>
          </label>
          <fieldset data-readings>
            <legend>Readings</legend>
          </fieldset>
          <fieldset class="grid-fields" data-grid>
            <legend>Position im 12-Spalten-Raster</legend>
          </fieldset>
          <p class="error" role="alert" data-dialog-error></p>
          <div class="actions">
            <button type="button" class="danger" data-delete>Kachel löschen</button>
            <button type="button" data-cancel>Abbrechen</button>
            <button type="submit" data-save>Speichern</button>
          </div>
        </form>
      </dialog>
    `;

    this.buildDialogFields();
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.shadowRoot.querySelector('[data-slider]').addEventListener('input', () => this.onSliderInput());
    this.shadowRoot.querySelector('[data-cancel]').addEventListener('click', () => this.closeDialog(true));
    this.shadowRoot.querySelector('[data-delete]').addEventListener('click', () => this.onDelete());
    this.shadowRoot.querySelector('[data-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      this.onSave();
    });
    this.shadowRoot.querySelector('[data-dialog]').addEventListener('cancel', () => this.closeDialog(true));
    this.shadowRoot.querySelector('input[name="device"]').addEventListener('change', () => this.onDeviceChanged());
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

    const grid = this.shadowRoot.querySelector('[data-grid]');
    for (const field of GRID_FIELDS) {
      const label = document.createElement('label');
      label.append(field.label);
      const input = document.createElement('input');
      input.type = 'number';
      input.name = `grid-${field.key}`;
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = '1';
      input.required = true;
      label.append(input);
      grid.append(label);
    }
  }

  render() {
    const root = this.shadowRoot;
    if (!root || !root.querySelector('[data-title]') || !this.widgetConfig) {
      return;
    }

    const config = this.widgetConfig;
    const readings = (this.snapshot && this.snapshot.readings) || {};
    const alias = (this.snapshot && this.snapshot.alias) || '';
    root.querySelector('[data-title]').textContent = config.title || alias || config.device || 'Thermostat';

    const actualRaw = readings[config.readings.actual];
    const actual = toNumber(actualRaw);
    root.querySelector('[data-actual]').textContent = actual === null
      ? (actualRaw !== undefined && actualRaw !== '' ? actualRaw : '–')
      : `${actual.toFixed(1)} °C`;

    const slider = root.querySelector('[data-slider]');
    const output = root.querySelector('[data-target-out]');
    const targetRaw = readings[config.readings.target];
    const target = toNumber(targetRaw);
    slider.disabled = !this.services || !this.snapshot || target === null;
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
        slider.value = String(Math.min(TARGET_MAX, Math.max(TARGET_MIN, target)));
        output.textContent = `${target.toFixed(1)} °C`;
      }
    }

    this.renderOptional('[data-mode]', 'Modus', readings[config.readings.mode], config.readings.mode);
    this.renderOptional('[data-battery]', 'Batterie', readings[config.readings.battery], config.readings.battery);

    const valveRaw = config.readings.valve ? readings[config.readings.valve] : undefined;
    const valve = toNumber(valveRaw === undefined ? '' : valveRaw.replace('%', '').trim());
    const valveBox = root.querySelector('[data-valve]');
    valveBox.hidden = valve === null;
    if (valve !== null) {
      const percent = Math.min(100, Math.max(0, valve));
      root.querySelector('[data-valve-text]').textContent = `${percent} %`;
      root.querySelector('[data-valve-marker]').style.left = `calc(${percent}% - 0.1rem)`;
    }

    if (this.snapshot === null && !this.pending) {
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

  async sendTarget() {
    const slider = this.shadowRoot.querySelector('[data-slider]');
    const value = Number.parseFloat(slider.value).toFixed(1);
    try {
      await this.services.setTarget(this.widgetConfig, value);
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
    for (const field of GRID_FIELDS) {
      form.elements[`grid-${field.key}`].value = String(config.grid[field.key]);
    }
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
    const list = this.shadowRoot.querySelector('[data-device-list]');
    list.replaceChildren(...this.devices.map((device) => {
      const option = document.createElement('option');
      option.value = device.name;
      if (device.alias) {
        option.label = device.alias;
      }
      return option;
    }));
    this.fillReadingOptions(this.findDevice(form.elements.device.value), config.readings);
  }

  findDevice(name) {
    return this.devices.find((device) => device.name === name) || null;
  }

  onDeviceChanged() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const device = this.findDevice(form.elements.device.value.trim());
    this.fillReadingOptions(device, {});
    this.setDialogError(device || !form.elements.device.value.trim()
      ? ''
      : 'Dieses Device wurde nicht gefunden');
  }

  fillReadingOptions(device, selected) {
    const form = this.shadowRoot.querySelector('[data-form]');
    const names = device ? Object.keys(device.readings).sort((a, b) => a.localeCompare(b)) : [];

    for (const field of FIELDS) {
      const select = form.elements[`reading-${field.key}`];
      const wanted = selected[field.key] || PRESETS[field.key].find((name) => names.includes(name)) || '';
      const entries = new Set(names);
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
        const option = document.createElement('option');
        option.value = name;
        option.textContent = device && device.readings[name] !== undefined
          ? `${name} (${device.readings[name]})`
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

    const grid = {};
    for (const field of GRID_FIELDS) {
      const raw = form.elements[`grid-${field.key}`].value;
      const number = Number.parseInt(raw, 10);
      if (!/^[0-9]+$/.test(raw) || number < field.min || number > field.max) {
        throw new Error(`${field.label}: Wert zwischen ${field.min} und ${field.max} erforderlich`);
      }
      grid[field.key] = number;
    }
    if (grid.col + grid.w > 13) {
      throw new Error('Spalte und Breite passen nicht in das 12-Spalten-Raster');
    }

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
