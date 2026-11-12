import { isValidName } from '../js/fhem-client.js';
import { openDevicePicker } from '../js/device-picker.js';
import { widgetHierarchyCss } from '../js/widget-content-fit.js';

const SEND_DELAY_MS = 1500;
const CONFIRM_WAIT_MS = 120000;
const NUMBER_PATTERN = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function parseNumber(value) {
  if (typeof value !== 'string' || !NUMBER_PATTERN.test(value.trim())) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sliderCommands(sets) {
  if (typeof sets !== 'string') {
    return [];
  }
  const result = [];
  const pattern = /(?:^|\s)([A-Za-z0-9_.-]+):slider,([-+]?(?:\d+(?:\.\d*)?|\.\d+)),([-+]?(?:\d+(?:\.\d*)?|\.\d+)),([-+]?(?:\d+(?:\.\d*)?|\.\d+))(?=\s|$)/g;
  for (const match of sets.matchAll(pattern)) {
    const min = parseNumber(match[2]);
    const step = parseNumber(match[3]);
    const max = parseNumber(match[4]);
    const count = (max - min) / step;
    if (min === null || step === null || max === null || step <= 0 || max <= min
      || !Number.isFinite(count) || count > 10000) {
      continue;
    }
    result.push({ command: match[1], min, step, max });
  }
  return result;
}

function readingNumber(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^([-+]?(?:\d+(?:[.,]\d*)?|\.\d+))\s*%?$/.exec(value.trim());
  return match ? parseNumber(match[1].replace(',', '.')) : null;
}

class FHEMCMSlider extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.snapshot = null;
    this.staleSince = null;
    this.sendTimer = null;
    this.pending = false;
    this.sent = null;
    this.error = '';
    this.isNew = false;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) {
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        ${widgetHierarchyCss}
        [data-title] { text-align: var(--cms-widget-title-align, left); width: 100%; min-width: 0; flex: 1; }
        :host { display: block; min-width: 0; min-height: 0; }
        * { box-sizing: border-box; }
        .tile { position: relative; display: grid; height: 100%; align-content: start; gap: max(1px, 3cqh); overflow: hidden;
          container-type: size; border: 1px solid var(--cms-frame, #7f8c84); border-radius: 1.4rem;
          background: var(--cms-surface, #202e27); padding: max(2px, 3cqh) 3%; }
        header { padding-right: 0; color: var(--cms-muted, #a5c9b2); font-size: max(5px, min(10cqh, 4cqw)); }
        h3 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1em; font-weight: 400; }
        .value { display: flex; align-items: baseline; justify-content: center; gap: 0.35em; min-width: 0;
          color: var(--cms-muted, #a5c9b2); font-size: clamp(10px, min(12cqh, 6cqw), 12px); line-height: 1.1; font-variant-numeric: tabular-nums; }
        output { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .reading { color: var(--cms-muted, #a5c9b2); font-size: 0.55em; overflow-wrap: anywhere; }
        input[type="range"] { width: 100%; margin: 0; accent-color: var(--cms-accent, #8fd0a8); }
        .range { display: flex; justify-content: space-between; gap: 0.5rem; color: var(--cms-muted, #a5c9b2);
          font-size: max(5px, min(9cqh, 3.5cqw)); font-variant-numeric: tabular-nums; }
        .status { min-height: 1em; margin: 0; color: var(--cms-muted, #a5c9b2); font-size: max(5px, min(8cqh, 3cqw)); }
        .tile[data-error] .status { color: var(--cms-danger, #ffb4a8); }
        .tile[data-stale] { opacity: 0.65; border-style: dashed; }
        .gear, button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.35rem 0.7rem; }
        .gear { position: absolute; top: 0.2rem; right: 0.3rem; padding: 0 0.35em; font-size: 0.75rem; }
        button:hover:not(:disabled) { background: var(--cms-surface-hover, #34493e); }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        :host([view-only]) [data-open-config] { display: none; }
        dialog { width: min(94vw, 34rem); max-height: 94vh; overflow: auto; padding: 1.25rem;
          border: 1px solid var(--cms-border, #43564a); border-radius: 1rem;
          background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef); }
        dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
        form { display: grid; gap: 0.75rem; }
        label { display: grid; gap: 0.25rem; }
        input, select { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; padding: 0.4rem 0.5rem; }
        input[type="text"], select { width: 100%; }
        .device-row { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { min-height: 1.2em; margin: 0; color: var(--cms-danger, #ffb4a8); }
        @container (max-height: 4.5rem) { .range, .status { display: none; } }
        /* Einheitliche Auswahllisten: eigener Pfeil statt Systemdarstellung (Safari). */
        select { appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238a9a8f' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 0.5em center; background-size: 0.65em;
          padding-right: 1.6em; }
      </style>
      <article class="tile" data-tile>
        <header><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="Schieberegler konfigurieren">⚙</button>
        <div class="value"><output data-value>–</output><span class="reading" data-reading></span></div>
        <input type="range" data-slider aria-label="FHEM-Wert" disabled>
        <div class="range"><span data-min>–</span><span data-max>–</span></div>
        <p class="status" data-status role="status"></p>
      </article>
      <dialog data-dialog aria-labelledby="slider-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="slider-dialog-title">Schieberegler konfigurieren</h3>
          <label>Titel (optional)<input name="title" type="text" maxlength="64" autocomplete="off"></label>
          <label style="display:flex;align-items:center;gap:0.35em"><input name="showTitle" type="checkbox" checked> Titel anzeigen</label>
          <label>FHEM-Device
            <span class="device-row"><input name="device" readonly required placeholder="Noch kein Device gewählt">
              <button type="button" data-pick-device>Auswählen …</button></span>
          </label>
          <label>Set-Befehl mit Slider<select name="command" required></select></label>
          <p class="hint" data-range-hint></p>
          <label>Reading für den aktuellen Wert<select name="reading" required></select></label>
          <span class="hint" data-alias></span>
          <p class="error" data-error role="alert"></p>
          <div class="actions"><button type="button" class="danger" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit" data-save>Speichern</button></div>
        </form>
      </dialog>`;
    const $ = (selector) => this.shadowRoot.querySelector(selector);
    $('[data-open-config]').addEventListener('click', () => this.openConfig());
    $('[data-pick-device]').addEventListener('click', () => this.pickDevice());
    $('[name="device"]').addEventListener('click', () => this.pickDevice());
    $('[name="command"]').addEventListener('change', () => this.updateRangeHint());
    $('[data-slider]').addEventListener('input', () => this.onSliderInput());
    $('[data-cancel]').addEventListener('click', () => this.closeConfig(false));
    $('[data-delete]').addEventListener('click', () => this.deleteWidget());
    $('[data-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveConfig();
    });
    $('[data-dialog]').addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeConfig(false);
    });
    this.render();
  }

  disconnectedCallback() {
    window.clearTimeout(this.sendTimer);
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
    this.staleSince = value || null;
    this.shadowRoot.querySelector('[data-tile]')?.toggleAttribute('data-stale', this.staleSince !== null);
    this.render();
  }

  async openConfig({ isNew = false } = {}) {
    this.isNew = isNew;
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    form.elements.device.value = this.widgetConfig.device || '';
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    try {
      const devices = await this.services.listAllDevices();
      const device = devices.find((item) => item.name === this.widgetConfig.device) || null;
      this.setDevice(device, this.widgetConfig.command, this.widgetConfig.reading);
      this.shadowRoot.querySelector('[data-alias]').textContent = device?.alias || '';
      if (this.widgetConfig.device && !device) {
        this.shadowRoot.querySelector('[data-error]').textContent = 'Das konfigurierte Device ist nicht verfügbar.';
      }
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Devices konnten nicht geladen werden: ${error.message}`;
    }
    this.shadowRoot.querySelector('[data-dialog]').showModal();
  }

  async pickDevice() {
    try {
      const device = await openDevicePicker({
        services: this.services,
        accept: (item) => sliderCommands(item.sets).length > 0
      });
      if (device) {
        this.setDevice(device, '', '');
      }
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
    }
  }

  setDevice(device, selectedCommand, selectedReading) {
    this.device = device;
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.device.value = device?.name || '';
    const commands = sliderCommands(device?.sets);
    const commandSelect = form.elements.command;
    commandSelect.replaceChildren(...commands.map((item) => {
      const option = document.createElement('option');
      option.value = item.command;
      option.textContent = item.command;
      return option;
    }));
    commandSelect.value = commands.some((item) => item.command === selectedCommand)
      ? selectedCommand
      : (commands[0]?.command || '');

    const readings = Object.keys(device?.readings || {}).sort();
    const readingSelect = form.elements.reading;
    readingSelect.replaceChildren(...readings.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      return option;
    }));
    const wantedReading = selectedReading || commandSelect.value;
    readingSelect.value = readings.includes(wantedReading) ? wantedReading : (readings[0] || '');
    this.updateRangeHint();
  }

  updateRangeHint() {
    const command = this.shadowRoot.querySelector('[name="command"]').value;
    const range = sliderCommands(this.device?.sets).find((item) => item.command === command);
    this.shadowRoot.querySelector('[data-range-hint]').textContent = range
      ? `Bereich ${range.min} bis ${range.max}, Schritt ${range.step}`
      : 'Dieses Device bietet keinen gültigen Slider-Set-Befehl.';
  }

  currentRange() {
    const group = Array.isArray(this.snapshot) ? this.snapshot : [];
    const item = group.find((device) => device.name === this.widgetConfig.device) || group[0];
    return sliderCommands(item?.sets).find((range) => range.command === this.widgetConfig.command) || null;
  }

  currentReading() {
    const group = Array.isArray(this.snapshot) ? this.snapshot : [];
    for (const item of group) {
      const value = item.readings?.[this.widgetConfig.reading];
      if (value !== undefined) {
        return String(value);
      }
    }
    return '';
  }

  render() {
    if (!this.widgetConfig || !this.shadowRoot.querySelector('[data-slider]')) {
      return;
    }
    const range = this.currentRange();
    const slider = this.shadowRoot.querySelector('[data-slider]');
    const reading = this.currentReading();
    const current = readingNumber(reading);
    let value = current;
    if (this.sent) {
      if (current === this.sent.value || Date.now() > this.sent.until) {
        this.sent = null;
      } else {
        value = this.sent.value;
      }
    }
    this.shadowRoot.querySelector('[data-title]').textContent = this.widgetConfig.showTitle === false ? ''
      : this.widgetConfig.title || this.widgetConfig.device || 'Schieberegler';
    this.shadowRoot.querySelector('[data-reading]').textContent = this.widgetConfig.reading || '';
    this.shadowRoot.querySelector('[data-value]').textContent = value === null
      ? (reading || '–')
      : String(value);
    this.shadowRoot.querySelector('[data-min]').textContent = range ? String(range.min) : '–';
    this.shadowRoot.querySelector('[data-max]').textContent = range ? String(range.max) : '–';
    if (range) {
      slider.min = String(range.min);
      slider.max = String(range.max);
      slider.step = String(range.step);
      if (value !== null && !this.pending) {
        slider.value = String(Math.min(range.max, Math.max(range.min, value)));
      }
    }
    slider.disabled = !range || value === null || !this.services || this.staleSince !== null;
    const status = this.shadowRoot.querySelector('[data-status]');
    status.textContent = this.error || (this.staleSince
      ? `Veraltet seit ${new Date(this.staleSince).toLocaleTimeString('de-DE')}`
      : this.sent
        ? 'Wert gesendet, wartet auf Bestätigung des Geräts'
      : value === null
        ? (this.snapshot ? 'Reading enthält keinen numerischen Wert' : 'Keine Daten für dieses Device')
        : '');
    this.shadowRoot.querySelector('[data-tile]').toggleAttribute('data-error',
      Boolean(this.error) || value === null || this.staleSince !== null);
  }

  onSliderInput() {
    const slider = this.shadowRoot.querySelector('[data-slider]');
    this.error = '';
    this.pending = true;
    this.shadowRoot.querySelector('[data-value]').textContent = slider.value;
    this.shadowRoot.querySelector('[data-status]').textContent = 'Wird gleich gesendet …';
    window.clearTimeout(this.sendTimer);
    this.sendTimer = window.setTimeout(() => this.sendValue(), SEND_DELAY_MS);
  }

  async sendValue() {
    const range = this.currentRange();
    const slider = this.shadowRoot.querySelector('[data-slider]');
    const value = parseNumber(slider.value);
    if (!range || value === null || value < range.min || value > range.max) {
      this.pending = false;
      this.render();
      return;
    }
    try {
      await this.services.setCommand(this.widgetConfig.device, this.widgetConfig.command, slider.value);
      this.sent = { value, until: Date.now() + CONFIRM_WAIT_MS };
      this.error = '';
      this.shadowRoot.querySelector('[data-status]').textContent = 'Wert gesendet, wartet auf Bestätigung des Geräts';
    } catch (error) {
      this.error = error.message || 'Senden fehlgeschlagen';
      this.shadowRoot.querySelector('[data-tile]').setAttribute('data-error', '');
    } finally {
      this.pending = false;
      this.render();
    }
  }

  collectWidget() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const device = form.elements.device.value.trim();
    const command = form.elements.command.value;
    const reading = form.elements.reading.value;
    const title = form.elements.title.value.trim();
    if (!isValidName(device) || !isValidName(command) || !isValidName(reading)) {
      throw new Error('Bitte Device, Slider-Set-Befehl und Reading wählen.');
    }
    if (!sliderCommands(this.device?.sets).some((item) => item.command === command)) {
      throw new Error('Der ausgewählte Set-Befehl bietet keinen gültigen Slider-Bereich.');
    }
    if (title.length > 64 || /[\u0000-\u001f\u007f]/.test(title)) {
      throw new Error('Ungültiger Titel');
    }
    const next = {
      id: this.widgetConfig.id,
      type: 'fhem-slider',
      device,
      command,
      reading,
      grid: { ...this.widgetConfig.grid }
    };
    if (title) {
      next.title = title;
    }
    if (!form.elements.showTitle.checked) {
      next.showTitle = false;
    }
    return next;
  }

  async saveConfig() {
    const save = this.shadowRoot.querySelector('[data-save]');
    try {
      const next = this.collectWidget();
      save.disabled = true;
      await this.services.saveWidget(next);
      this.isNew = false;
      this.closeConfig(false);
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = error.message || 'Speichern fehlgeschlagen';
    } finally {
      save.disabled = false;
    }
  }

  async deleteWidget() {
    if (!window.confirm('Diesen Schieberegler entfernen?')) {
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
}

if (!customElements.get('cms-slider')) {
  customElements.define('cms-slider', FHEMCMSlider);
}
