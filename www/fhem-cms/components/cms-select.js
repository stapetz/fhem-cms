import { isValidName } from '../js/fhem-client.js';
import { widgetDesignCss } from '../js/widget-design.js';
import { openDevicePicker } from '../js/device-picker.js';
import { dialogGroupStyles, titleVisibilityField } from '../js/dialog-groups.js';
import { createManualFieldTracker } from '../js/device-suggestions.js';
import { parseDiscreteSetCommands } from '../js/select-commands.js';

const LABEL_MAX_LENGTH = 64;
const CONFIRM_WAIT_MS = 120000;

function labelFor(value, labels) {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels) || !Object.hasOwn(labels, value)) {
    return value;
  }
  const label = labels[value];
  return typeof label === 'string' && label.trim() && label.length <= LABEL_MAX_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(label) ? label : value;
}

function labelsFor(values, labels) {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return {};
  return Object.fromEntries(values
    .map((value) => [value, labelFor(value, labels)])
    .filter(([value, label]) => label !== value));
}

class FHEMCMSSelect extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.snapshot = null;
    this.staleSince = null;
    this.devices = [];
    this.pending = false;
    this.sent = null;
    this.confirmTimer = null;
    this.error = '';
    this.isNew = false;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) return;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; min-height: 0; }
        * { box-sizing: border-box; }
        .tile { position: relative; display: grid; height: 100%; align-content: start; gap: 0.55rem;
          overflow: hidden; container-type: size; border: 1px solid var(--cms-frame, #7f8c84);
          border-radius: 1.4rem; background: var(--cms-surface, #202e27); padding: 0.75rem; }
        .tile[data-stale] { opacity: 0.65; border-style: dashed; }
        header { padding-right: 1.8rem; color: var(--cms-muted, #a5c9b2);
          font-size: max(8px, min(12cqh, 0.95rem)); }
        [data-title] { text-align: var(--cms-widget-title-align, left); width: 100%; min-width: 0; }
        h3 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; }
        button, select { font: inherit; color: inherit; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.45rem 0.6rem; }
        button { cursor: pointer; }
        button:hover:not(:disabled) { background: var(--cms-surface-hover, #34493e); }
        button:focus-visible, select:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        button[aria-pressed="true"] { border-color: var(--cms-accent, #8fd0a8); color: var(--cms-accent, #8fd0a8); }
        button:disabled, select:disabled { cursor: default; opacity: 0.7; }
        .gear { position: absolute; top: 0.25rem; right: 0.35rem; padding: 0 0.35rem; }
        :host([view-only]) [data-open-config] { display: none; }
        .choices { min-width: 0; }
        .choices[data-mode="buttons"] { display: flex; flex-wrap: wrap; gap: 0.35rem; }
        .choices[data-mode="buttons"] button { min-width: 2.5rem; }
        select { width: 100%; }
        .status { min-height: 1em; margin: 0; color: var(--cms-muted, #a5c9b2);
          font-size: max(8px, min(10cqh, 0.8rem)); overflow-wrap: anywhere; }
        .tile[data-error] .status { color: var(--cms-danger, #ffb4a8); }
        dialog { width: min(94vw, 36rem); max-height: 94vh; overflow: auto; padding: 1.25rem;
          border: 1px solid var(--cms-border, #43564a); border-radius: 1rem;
          background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef); }
        dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
        form { display: grid; gap: 0.75rem; }
        ${dialogGroupStyles}
        label { display: grid; gap: 0.25rem; }
        input, select { font: inherit; color: inherit; background: var(--cms-bg, #17211d);
          border: 1px solid var(--cms-border, #43564a); border-radius: 0.5rem; padding: 0.4rem 0.5rem; }
        .device-row { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
        .labels { display: grid; gap: 0.4rem; }
        .label-row { display: grid; grid-template-columns: minmax(5rem, 0.7fr) minmax(8rem, 1fr);
          align-items: center; gap: 0.5rem; }
        .technical-value { overflow-wrap: anywhere; color: var(--cms-muted, #a5c9b2); }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { min-height: 1.2em; margin: 0; color: var(--cms-danger, #ffb4a8); }
        :host(:not([view-only])) .choices { pointer-events: none; }
        /* Einheitliche Auswahllisten: eigener Pfeil statt Systemdarstellung (Safari). */
        select { appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238a9a8f' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 0.5em center; background-size: 0.65em; padding-right: 1.6em; }
        ${widgetDesignCss}
        .tile .choices { border: 1px solid rgba(128,128,128,.18); border-radius: 14px;
          padding: 14px; background: rgba(128,128,128,.08); }
        .tile .choices button, .tile .choices select { min-height: 48px; min-width: 48px; }
        .tile .status { color: inherit; font-size: .86rem; }
        .tile[data-error] .status { color: var(--cms-danger, #ffb4a8); }
      </style>
      <article class="tile" data-tile>
        <header><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="Auswahl-Widget konfigurieren">⚙</button>
        <div class="choices" data-choices></div>
        <p class="status" data-status role="status" aria-live="polite"></p>
      </article>
      <dialog data-dialog aria-labelledby="select-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="select-dialog-title">Auswahl-Widget konfigurieren</h3>
          <details class="config-group" open><summary>Allgemein</summary>
            <div class="config-group-fields">
              <label>Titel (optional)<input name="title" type="text" maxlength="64" autocomplete="off"></label>
              ${titleVisibilityField}
            </div>
          </details>
          <details class="config-group" open><summary>Datenquelle und Darstellung</summary>
            <div class="config-group-fields">
              <label>FHEM-Device
                <span class="device-row"><input name="device" readonly required placeholder="Noch kein Device gewählt">
                  <button type="button" data-pick-device>Auswählen …</button></span>
              </label>
              <label>Set-Befehl mit Werteliste<select name="command" required></select></label>
              <label>Reading für den aktuellen Wert<select name="reading" required></select></label>
              <label>Darstellung<select name="mode">
                <option value="dropdown">Dropdown</option>
                <option value="buttons">Kompakte Buttons</option>
              </select></label>
              <span class="hint" data-alias></span>
              <fieldset><legend>Anzeigenamen (optional)</legend>
                <p class="hint">Leere Namen verwenden den technischen Wert.</p>
                <div class="labels" data-labels></div>
              </fieldset>
            </div>
          </details>
          <p class="error" data-error role="alert"></p>
          <div class="actions"><button type="button" class="danger" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit" data-save>Speichern</button></div>
        </form>
      </dialog>`;

    const $ = (selector) => this.shadowRoot.querySelector(selector);
    this.suggestionTracker = createManualFieldTracker($('[data-form]'));
    $('[data-open-config]').addEventListener('click', () => this.openConfig());
    $('[data-pick-device]').addEventListener('click', () => this.pickDevice());
    $('[name="device"]').addEventListener('click', () => this.pickDevice());
    $('[name="command"]').addEventListener('change', () => this.fillLabels());
    $('[data-choices]').addEventListener('change', (event) => {
      if (event.target.matches('select[data-selection]')) this.sendValue(event.target.value);
    });
    $('[data-choices]').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-selection]');
      if (button) this.sendValue(button.value);
    });
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
    window.clearTimeout(this.confirmTimer);
  }

  set config(value) {
    this.widgetConfig = value;
    this.render();
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

  deviceInfo() {
    if (!Array.isArray(this.snapshot)) return null;
    return this.snapshot.find((item) => item?.name === this.widgetConfig?.device) || null;
  }

  currentReading() {
    const device = this.deviceInfo();
    const value = device?.readings?.[this.widgetConfig?.reading];
    return value === undefined || value === null ? null : String(value);
  }

  currentCommand() {
    return parseDiscreteSetCommands(this.deviceInfo()?.sets)
      .find((entry) => entry.command === this.widgetConfig?.command) || null;
  }

  optionLabel(value) {
    return labelFor(value, this.widgetConfig?.labels);
  }

  render() {
    const choices = this.shadowRoot.querySelector('[data-choices]');
    if (!choices || !this.widgetConfig) return;
    const command = this.currentCommand();
    const values = command?.values || [];
    const reading = this.currentReading();
    const selected = reading !== null && values.includes(reading) ? reading : '';
    if (this.sent && selected === this.sent.value) {
      this.sent = null;
      window.clearTimeout(this.confirmTimer);
    }

    const mode = this.widgetConfig.mode === 'buttons' ? 'buttons' : 'dropdown';
    choices.dataset.mode = mode;
    choices.replaceChildren();
    const enabled = this.hasAttribute('view-only') && typeof this.services?.setCommand === 'function'
      && Boolean(command) && this.staleSince === null && !this.pending;
    if (mode === 'buttons') {
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', this.widgetConfig.title || this.widgetConfig.command || 'Wert auswählen');
      for (const value of values) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.selection = '';
        button.value = value;
        button.textContent = this.optionLabel(value);
        button.setAttribute('aria-pressed', String(value === selected));
        button.disabled = !enabled;
        choices.append(button);
      }
    } else {
      choices.removeAttribute('role');
      choices.removeAttribute('aria-label');
      const select = document.createElement('select');
      select.dataset.selection = '';
      select.setAttribute('aria-label', this.widgetConfig.title || 'Wert auswählen');
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = values.length ? 'Wert auswählen …' : 'Keine Werteliste verfügbar';
      select.append(placeholder);
      for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = this.optionLabel(value);
        select.append(option);
      }
      select.value = selected;
      select.disabled = !enabled;
      choices.append(select);
    }

    const title = this.widgetConfig.showTitle === false ? ''
      : this.widgetConfig.title || this.widgetConfig.device || 'Auswahl';
    this.shadowRoot.querySelector('[data-title]').textContent = title;
    const status = this.shadowRoot.querySelector('[data-status]');
    status.setAttribute('role', this.error ? 'alert' : 'status');
    status.textContent = this.error || (this.staleSince
      ? `Veraltet seit ${new Date(this.staleSince).toLocaleTimeString('de-DE')}`
      : this.pending
        ? 'Wert wird gesendet …'
        : this.sent
          ? 'Wert gesendet, wartet auf Bestätigung des Geräts'
          : !this.snapshot
            ? 'Keine Daten für dieses Device'
            : !command
              ? 'Der Set-Befehl ist nicht verfügbar oder enthält keine gültige Werteliste'
              : reading === null
                ? 'Das konfigurierte Reading ist nicht verfügbar'
                : !selected
                  ? 'Der aktuelle Reading-Wert ist nicht in der angebotenen Werteliste'
                  : !this.hasAttribute('view-only')
                    ? 'Steuerung ist im Bearbeitungsmodus gesperrt'
                    : '');
    this.shadowRoot.querySelector('[data-tile]').toggleAttribute('data-error',
      Boolean(this.error) || Boolean(this.staleSince) || !command || (reading !== null && !selected));
  }

  async sendValue(value) {
    const command = this.currentCommand();
    if (!this.hasAttribute('view-only') || this.pending || !this.services
      || typeof this.services.setCommand !== 'function' || this.staleSince !== null
      || !isValidName(this.widgetConfig?.device) || !command
      || !command.values.includes(value)) {
      this.render();
      return;
    }
    this.pending = true;
    this.error = '';
    this.render();
    try {
      await this.services.setCommand(this.widgetConfig.device, command.command, value);
      this.pending = false;
      this.sent = { value };
      window.clearTimeout(this.confirmTimer);
      this.confirmTimer = window.setTimeout(() => {
        if (!this.sent || this.sent.value !== value) return;
        this.sent = null;
        this.error = 'Das Gerät hat den gewählten Wert nicht bestätigt.';
        this.render();
      }, CONFIRM_WAIT_MS);
      this.render();
    } catch (error) {
      this.pending = false;
      this.error = error?.message || 'Senden fehlgeschlagen';
      this.render();
    }
  }

  async openConfig({ isNew = false } = {}) {
    this.isNew = isNew;
    this.error = '';
    this.suggestionTracker.reset();
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    form.elements.device.value = this.widgetConfig.device || '';
    form.elements.mode.value = this.widgetConfig.mode === 'buttons' ? 'buttons' : 'dropdown';
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    this.shadowRoot.querySelector('[data-dialog]').showModal();
    try {
      this.devices = await this.services.listAllDevices();
      const device = this.devices.find((item) => item.name === this.widgetConfig.device) || null;
      this.setDevice(device, this.widgetConfig.command || undefined, this.widgetConfig.reading || undefined);
      this.shadowRoot.querySelector('[data-alias]').textContent = device?.alias && device.alias !== device.name
        ? `Alias: ${device.alias}` : '';
      if (this.widgetConfig.device && !device) {
        this.shadowRoot.querySelector('[data-error]').textContent = 'Das konfigurierte Device ist nicht verfügbar.';
      }
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Devices konnten nicht geladen werden: ${error.message}`;
    }
  }

  async pickDevice() {
    try {
      const device = await openDevicePicker({
        services: this.services,
        title: 'Device für das Auswahl-Widget wählen',
        accept: (item) => parseDiscreteSetCommands(item.sets).length > 0,
      });
      if (device) {
        const form = this.shadowRoot.querySelector('[data-form]');
        this.setDevice(
          device,
          this.suggestionTracker.isEdited(form.elements.command) ? form.elements.command.value : undefined,
          this.suggestionTracker.isEdited(form.elements.reading) ? form.elements.reading.value : undefined
        );
      }
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
    }
  }

  setDevice(device, selectedCommand, selectedReading) {
    this.device = device;
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.device.value = device?.name || '';
    const commands = parseDiscreteSetCommands(device?.sets);
    const commandNames = commands.map((entry) => entry.command);
    const command = selectedCommand === undefined
      ? commandNames.length === 1 ? commandNames[0] : ''
      : commandNames.includes(selectedCommand) ? selectedCommand : '';
    form.elements.command.replaceChildren(new Option('Befehl wählen …', ''),
      ...commands.map((entry) => new Option(`${entry.command}: ${entry.values.join(', ')}`, entry.command)));
    form.elements.command.value = command;

    const readings = Object.keys(device?.readings || {}).filter(isValidName).sort();
    const reading = selectedReading === undefined
      ? readings.length === 1 ? readings[0] : ''
      : readings.includes(selectedReading) ? selectedReading : '';
    form.elements.reading.replaceChildren(new Option('Reading wählen …', ''),
      ...readings.map((name) => new Option(name, name)));
    form.elements.reading.value = reading;
    this.fillLabels();
  }

  fillLabels() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const device = this.devices.find((item) => item.name === form.elements.device.value)
      || this.device || null;
    const entry = parseDiscreteSetCommands(device?.sets)
      .find((item) => item.command === form.elements.command.value);
    const values = entry?.values || [];
    const old = new Map([...this.shadowRoot.querySelectorAll('[data-label-value]')]
      .map((input) => [input.dataset.labelValue, input.value]));
    const configured = labelsFor(values, this.widgetConfig?.labels);
    const labels = this.shadowRoot.querySelector('[data-labels]');
    labels.replaceChildren();
    for (const value of values) {
      const row = document.createElement('label');
      row.className = 'label-row';
      const technical = document.createElement('span');
      technical.className = 'technical-value';
      technical.textContent = value;
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = LABEL_MAX_LENGTH;
      input.autocomplete = 'off';
      input.dataset.labelValue = value;
      input.setAttribute('aria-label', `Anzeigename für ${value}`);
      input.value = old.get(value) ?? configured[value] ?? '';
      row.append(technical, input);
      labels.append(row);
    }
    if (!values.length) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Für dieses Device ist kein gültiger diskreter Set-Befehl gewählt.';
      labels.append(hint);
    }
  }

  collectWidget() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const device = form.elements.device.value.trim();
    const command = form.elements.command.value;
    const reading = form.elements.reading.value;
    const title = form.elements.title.value.trim();
    if (!isValidName(device) || !isValidName(command) || !isValidName(reading)) {
      throw new Error('Bitte Device, Set-Befehl und Reading wählen.');
    }
    const deviceInfo = this.devices.find((item) => item.name === device);
    const option = parseDiscreteSetCommands(deviceInfo?.sets)
      .find((entry) => entry.command === command);
    if (!option) throw new Error('Der Set-Befehl bietet keine gültige diskrete Werteliste.');
    if (title.length > LABEL_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(title)) {
      throw new Error('Ungültiger Titel');
    }
    const labels = Object.create(null);
    for (const input of this.shadowRoot.querySelectorAll('[data-label-value]')) {
      const label = input.value.trim();
      if (label.length > LABEL_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(label)) {
        throw new Error(`Ungültiger Anzeigename für ${input.dataset.labelValue}`);
      }
      if (label) labels[input.dataset.labelValue] = label;
    }
    const next = {
      id: this.widgetConfig.id,
      type: 'fhem-select',
      device,
      command,
      reading,
      mode: form.elements.mode.value,
      grid: { ...this.widgetConfig.grid },
    };
    if (title) next.title = title;
    if (!form.elements.showTitle.checked) next.showTitle = false;
    if (Object.keys(labels).length) next.labels = labels;
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
    if (!window.confirm('Dieses Auswahl-Widget entfernen?')) return;
    try {
      await this.services.deleteWidget(this.widgetConfig.id);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Entfernen fehlgeschlagen: ${error.message}`;
    }
  }

  closeConfig(saved) {
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) dialog.close();
    if (!saved && this.isNew) {
      this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true }));
    }
  }
}

if (!customElements.get('cms-select')) {
  customElements.define('cms-select', FHEMCMSSelect);
}
