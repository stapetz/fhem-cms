import { openDevicePicker } from '../js/device-picker.js';
import { openIconPicker } from '../js/icon-picker.js';

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const PENDING_MS = 4000;

// Befehle ohne Parameter aus PossibleSets, z. B. "on:noArg off toggle:noArg dim:slider,0,10,100" -> on, off, toggle.
export const switchCommands = (sets) => String(sets || '').split(/\s+/).filter(Boolean)
  .map((token) => token.split(':'))
  .filter(([name, argument]) => NAME_PATTERN.test(name) && (argument === undefined || argument === 'noArg'))
  .map(([name]) => name);

class FHEMCMSSwitch extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.snapshot = null;
    this.staleSince = null;
    this.isNew = false;
    this.devices = [];
    this.pendingState = null;
    this.pendingTimer = null;
    this.errorTimer = null;
    this.iconOn = '';
    this.iconOff = '';
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount > 0) {
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; min-height: 0; --cms-icon-color: var(--cms-accent, #8fd0a8); }
        * { box-sizing: border-box; }
        .tile { position: relative; height: 100%; overflow: hidden; container-type: size; border: 1px solid var(--cms-frame, #7f8c84); border-radius: 1.4rem;
          background: var(--cms-surface, #202e27); display: flex; flex-direction: column; }
        .tile[data-stale] { opacity: 0.65; border-style: dashed; }
        header { position: absolute; top: 0; left: 0; right: 1.6rem; z-index: 1; padding: 0.4em 0 0 1.1em;
          font-size: max(5px, min(13cqh, 5cqw)); }
        header[hidden] { display: none; }
        h3 { margin: 0; font-size: 1.1em; font-weight: 400; color: var(--cms-muted, #a5c9b2); font-family: inherit;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .gear { position: absolute; top: 0.2rem; right: 0.3rem; z-index: 2; font-size: 0.75rem; padding: 0 0.35em; line-height: 1.4; }
        button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.35rem 0.7rem; }
        button:hover { background: var(--cms-surface-hover, #34493e); }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        .main { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; gap: 0.5em; padding: 0 0.8em;
          font-size: max(5px, min(30cqh, 9cqw)); }
        .tile[data-has-title] .main { font-size: max(5px, min(26cqh, 9cqw)); }
        .toggle { all: unset; box-sizing: border-box; display: block; width: 2.4em; height: 1.3em; flex: none; border-radius: 1em;
          background: var(--cms-bg, #17211d); border: 0.08em solid var(--cms-border, #43564a); position: relative; cursor: pointer; transition: background 0.2s; }
        .toggle::after { content: ""; position: absolute; top: 0.12em; left: 0.12em; width: 0.9em; height: 0.9em; border-radius: 50%;
          background: var(--cms-muted, #a5c9b2); transition: transform 0.2s, background 0.2s; }
        .toggle[aria-checked="true"] { background: var(--cms-accent-strong, #2f6b47); border-color: var(--cms-accent, #8fd0a8); }
        .toggle[aria-checked="true"]::after { transform: translateX(1.1em); background: var(--cms-on-accent, #e9f8ee); }
        .toggle[data-unknown] { border-style: dashed; }
        .toggle[data-unknown]::after { transform: translateX(0.55em); opacity: 0.5; }
        .toggle:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 3px; }
        .toggle:disabled { cursor: default; }
        .glyph { display: inline-block; flex: none; width: 1.1em; height: 1.1em; background-color: var(--cms-icon-color);
          -webkit-mask: var(--icon-url) center / contain no-repeat; mask: var(--icon-url) center / contain no-repeat; }
        .glyph[hidden] { display: none; }
        .msg { position: absolute; left: 0; right: 0; bottom: 0.3em; margin: 0; text-align: center; color: var(--cms-danger, #ffb4a8);
          font-size: max(5px, min(9cqh, 3.5cqw)); }
        :host([view-only]) [data-open-config] { display: none; }
        :host(:not([view-only])) .toggle { pointer-events: none; }
        @container (max-width: 6rem) { .gear { display: none; } }
        dialog { border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef);
          padding: 1.25rem; width: min(94vw, 34rem); max-height: 94vh; overflow: auto; }
        dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
        form { display: grid; gap: 0.75rem; }
        label { display: grid; gap: 0.25rem; font-size: 0.9rem; }
        input, select { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
        .device-row { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
        .icon-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
        .icon-row .glyph { width: 2rem; height: 2rem; }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { margin: 0; color: var(--cms-danger, #ffb4a8); min-height: 1.2em; }
      </style>
      <article class="tile" data-tile>
        <header data-header hidden><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="Schalter konfigurieren">⚙</button>
        <div class="main">
          <span class="glyph" data-icon aria-hidden="true" hidden></span>
          <button type="button" class="toggle" role="switch" aria-checked="false" data-toggle aria-label="Schalter"></button>
        </div>
        <p class="msg" role="alert" data-msg></p>
      </article>
      <dialog data-dialog aria-labelledby="switch-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="switch-dialog-title">Schalter konfigurieren</h3>
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
          <label>Reading für den Zustand
            <select name="reading" required></select>
          </label>
          <label>Befehl für „An“ (set &lt;Device&gt; …)
            <select name="on" required></select>
          </label>
          <label>Befehl für „Aus“
            <select name="off" required></select>
          </label>
          <p class="hint">Der Schalter gilt als „an“, wenn das Reading den Wert des An-Befehls hat, und als „aus“, wenn es den Wert des Aus-Befehls hat.</p>
          <div>
            <span class="hint">Icon bei „An“ (optional)</span>
            <div class="icon-row">
              <span class="glyph" data-icon-preview="on" aria-hidden="true" hidden></span>
              <span data-icon-name="on">kein Icon</span>
              <button type="button" data-icon-choose="on">Icon wählen …</button>
            </div>
          </div>
          <div>
            <span class="hint">Icon bei „Aus“ (optional, leer = wie bei „An“)</span>
            <div class="icon-row">
              <span class="glyph" data-icon-preview="off" aria-hidden="true" hidden></span>
              <span data-icon-name="off">kein Icon</span>
              <button type="button" data-icon-choose="off">Icon wählen …</button>
            </div>
          </div>
          <p class="error" role="alert" data-dialog-error></p>
          <div class="actions">
            <button type="button" class="danger" data-delete>Löschen</button>
            <button type="button" data-cancel>Abbrechen</button>
            <button type="submit" data-save>Speichern</button>
          </div>
        </form>
      </dialog>
    `;

    const $ = (selector) => this.shadowRoot.querySelector(selector);
    const form = $('[data-form]');
    this.shadowRoot.querySelectorAll('[data-open-config]').forEach((button) => button.addEventListener('click', () => this.openConfig()));
    $('[data-toggle]').addEventListener('click', () => this.toggle());
    $('[data-cancel]').addEventListener('click', () => this.closeDialog(true));
    $('[data-delete]').addEventListener('click', () => this.onDelete());
    $('[data-dialog]').addEventListener('cancel', () => this.closeDialog(true));
    $('[data-pick-device]').addEventListener('click', () => this.pickDevice());
    form.elements.device.addEventListener('click', () => this.pickDevice());
    for (const button of this.shadowRoot.querySelectorAll('[data-icon-choose]')) {
      button.addEventListener('click', () => this.chooseIcon(button.dataset.iconChoose));
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.onSave();
    });
    this.render();
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

  set stale(since) {
    this.staleSince = since || null;
    const tile = this.shadowRoot.querySelector('[data-tile]');
    if (tile) {
      tile.toggleAttribute('data-stale', this.staleSince !== null);
    }
  }

  readingValue() {
    if (!this.widgetConfig || !Array.isArray(this.snapshot)) {
      return null;
    }
    for (const item of this.snapshot) {
      if (item.readings && Object.prototype.hasOwnProperty.call(item.readings, this.widgetConfig.reading)) {
        return item.readings[this.widgetConfig.reading];
      }
    }
    return null;
  }

  // 'on', 'off' oder null (unbekannt). Nach einem Klick gilt kurz der erwartete Zustand, bis das Device bestätigt.
  currentState() {
    const raw = this.readingValue();
    const confirmed = raw === this.widgetConfig.on ? 'on' : raw === this.widgetConfig.off ? 'off' : null;
    if (this.pendingState !== null) {
      if (confirmed === this.pendingState) {
        this.clearPending();
      } else {
        return this.pendingState;
      }
    }
    return confirmed;
  }

  clearPending() {
    this.pendingState = null;
    window.clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  render() {
    const toggle = this.shadowRoot.querySelector('[data-toggle]');
    if (!toggle || !this.widgetConfig) {
      return;
    }
    const state = this.currentState();
    toggle.setAttribute('aria-checked', String(state === 'on'));
    toggle.toggleAttribute('data-unknown', state === null);
    const title = this.widgetConfig.title || '';
    toggle.setAttribute('aria-label', title || `${this.widgetConfig.device || 'Schalter'}`);
    const raw = this.readingValue();
    const tile = this.shadowRoot.querySelector('[data-tile]');
    tile.title = `${this.widgetConfig.device || ''}:${this.widgetConfig.reading || ''} = ${raw === null ? '–' : raw}`;
    tile.toggleAttribute('data-has-title', Boolean(title));
    this.shadowRoot.querySelector('[data-title]').textContent = title;
    this.shadowRoot.querySelector('[data-header]').hidden = !title;
    const name = state === 'off' && this.widgetConfig.iconOff ? this.widgetConfig.iconOff : this.widgetConfig.icon;
    const url = name && this.services ? this.services.iconUrl(name) : '';
    const icon = this.shadowRoot.querySelector('[data-icon]');
    icon.hidden = !url;
    this.setIconSrc(icon, url);
  }

  setIconSrc(element, url) {
    if (url) {
      element.style.setProperty('--icon-url', `url("${url}")`);
    } else {
      element.style.removeProperty('--icon-url');
    }
  }

  showMessage(text) {
    const box = this.shadowRoot.querySelector('[data-msg]');
    box.textContent = text;
    window.clearTimeout(this.errorTimer);
    if (text) {
      this.errorTimer = window.setTimeout(() => {
        box.textContent = '';
      }, PENDING_MS);
    }
  }

  // Schalten nur in der Ansicht; im Bearbeitungsmodus würde ein Klick beim Verschieben versehentlich schalten.
  async toggle() {
    if (!this.hasAttribute('view-only') || !this.widgetConfig || !this.services) {
      return;
    }
    const target = this.currentState() === 'on' ? 'off' : 'on';
    const command = this.widgetConfig[target];
    this.pendingState = target;
    this.showMessage('');
    window.clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => {
      this.clearPending();
      this.render();
    }, PENDING_MS);
    this.render();
    try {
      await this.services.setCommand(this.widgetConfig.device, command);
    } catch (error) {
      this.clearPending();
      this.render();
      this.showMessage(error.message || 'Senden fehlgeschlagen');
    }
  }

  setDialogError(message) {
    this.shadowRoot.querySelector('[data-dialog-error]').textContent = message;
  }

  async openConfig(options = {}) {
    this.isNew = Boolean(options.isNew);
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.device.value = this.widgetConfig.device || '';
    this.setIcon('on', this.widgetConfig.icon || '');
    this.setIcon('off', this.widgetConfig.iconOff || '');
    this.shadowRoot.querySelector('[data-delete]').hidden = this.isNew;
    this.setDialogError('');
    this.shadowRoot.querySelector('[data-dialog]').showModal();
    this.devices = [];
    this.fillChoices(this.widgetConfig);
    try {
      this.devices = await this.services.listAllDevices();
      this.fillChoices(this.widgetConfig);
    } catch (error) {
      this.setDialogError(`Geräteliste nicht verfügbar: ${error.message}`);
    }
  }

  fillChoices(wanted) {
    const form = this.shadowRoot.querySelector('[data-form]');
    const name = form.elements.device.value.trim();
    const device = this.devices.find((item) => item.name === name);
    const readings = new Set(Object.keys(device ? device.readings : {}));
    const commands = new Set(device ? switchCommands(device.sets) : []);
    for (const [key, field] of [['reading', readings], ['on', commands], ['off', commands]]) {
      if (wanted && wanted[key]) {
        field.add(wanted[key]);
      }
    }
    readings.add('state');
    const fill = (select, names, chosen, preferred) => {
      const options = [...names].sort((a, b) => a.localeCompare(b)).map((item) => {
        const option = document.createElement('option');
        option.value = item;
        const value = select.name === 'reading' && device ? device.readings[item] : undefined;
        option.textContent = value === undefined ? item : `${item} (${value})`;
        return option;
      });
      select.replaceChildren(...options);
      const pick = [chosen, preferred].find((candidate) => candidate && names.has(candidate));
      select.value = pick || (options[0]?.value || '');
    };
    fill(form.elements.reading, readings, wanted && wanted.reading, 'state');
    fill(form.elements.on, commands, wanted && wanted.on, 'on');
    fill(form.elements.off, commands, wanted && wanted.off, 'off');
    const alias = device && device.alias && device.alias !== name ? `Alias: ${device.alias}` : '';
    this.shadowRoot.querySelector('[data-device-alias]').textContent = alias;
  }

  async pickDevice() {
    const device = await openDevicePicker({
      services: this.services,
      title: 'Device für den Schalter wählen',
      accept: (item) => switchCommands(item.sets).length > 0
    });
    if (!device) {
      return;
    }
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.device.value = device.name;
    if (!this.devices.some((item) => item.name === device.name)) {
      this.devices.push(device);
    }
    this.setDialogError('');
    this.fillChoices(null);
  }

  setIcon(which, name) {
    if (which === 'on') {
      this.iconOn = name;
    } else {
      this.iconOff = name;
    }
    const preview = this.shadowRoot.querySelector(`[data-icon-preview="${which}"]`);
    const url = name && this.services ? this.services.iconUrl(name) : '';
    preview.hidden = !url;
    this.setIconSrc(preview, url);
    this.shadowRoot.querySelector(`[data-icon-name="${which}"]`).textContent = name || 'kein Icon';
  }

  async chooseIcon(which) {
    const name = await openIconPicker({ services: this.services, title: which === 'on' ? 'Icon bei „An“' : 'Icon bei „Aus“' });
    if (name !== null) {
      this.setIcon(which, name);
    }
  }

  collectWidget() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const value = (field) => form.elements[field].value.trim();
    for (const [field, label] of [['device', 'ein gültiges Device'], ['reading', 'ein gültiges Reading'],
      ['on', 'einen Befehl für „An“'], ['off', 'einen Befehl für „Aus“']]) {
      if (!NAME_PATTERN.test(value(field))) {
        throw new Error(`Bitte ${label} angeben`);
      }
    }
    if (value('on') === value('off')) {
      throw new Error('„An“ und „Aus“ brauchen verschiedene Befehle');
    }
    const widget = {
      id: this.widgetConfig.id, type: 'fhem-switch', device: value('device'), reading: value('reading'),
      on: value('on'), off: value('off'), grid: { ...this.widgetConfig.grid }
    };
    if (value('title')) {
      widget.title = value('title');
    }
    if (this.iconOn) {
      widget.icon = this.iconOn;
    }
    if (this.iconOff) {
      widget.iconOff = this.iconOff;
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
    if (!window.confirm('Diesen Schalter wirklich löschen?')) {
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

if (!customElements.get('cms-switch')) {
  customElements.define('cms-switch', FHEMCMSSwitch);
}
