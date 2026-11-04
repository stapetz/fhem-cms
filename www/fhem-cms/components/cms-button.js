import { openDevicePicker } from '../js/device-picker.js';
import { openIconPicker } from '../js/icon-picker.js';
import { switchCommands } from './cms-switch.js';

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const FEEDBACK_MS = 1500;

class FHEMCMSButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.isNew = false;
    this.devices = [];
    this.icon = '';
    this.feedbackTimer = null;
    this.busy = false;
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
        .main { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 0.4em 0.8em;
          font-size: max(5px, min(22cqh, 8cqw)); }
        .tile[data-has-title] .main { padding-top: 1.6em; font-size: max(5px, min(20cqh, 8cqw)); }
        .push { display: inline-flex; align-items: center; justify-content: center; gap: 0.4em; max-width: 100%; min-width: 0;
          padding: 0.35em 1em; border-radius: 0.8em; border: 0.06em solid var(--cms-accent, #8fd0a8); background: var(--cms-accent-strong, #2f6b47); color: var(--cms-on-accent, #e9f8ee);
          font-size: 1em; font-weight: 600; transition: background 0.15s, transform 0.1s; }
        .push:hover { background: var(--cms-accent-hover, #3a7f55); }
        .push:active { transform: scale(0.96); }
        .push:disabled { cursor: default; opacity: 0.7; }
        .push[data-done] { background: var(--cms-accent, #8fd0a8); color: var(--cms-bg, #17211d); }
        .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
        .glyph { display: inline-block; flex: none; width: 1.1em; height: 1.1em; background-color: currentColor;
          -webkit-mask: var(--icon-url) center / contain no-repeat; mask: var(--icon-url) center / contain no-repeat; }
        .glyph[hidden] { display: none; }
        .msg { position: absolute; left: 0; right: 0; bottom: 0.3em; margin: 0; text-align: center; color: var(--cms-danger, #ffb4a8);
          font-size: max(5px, min(9cqh, 3.5cqw)); }
        :host([view-only]) [data-open-config] { display: none; }
        :host(:not([view-only])) .push { pointer-events: none; }
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
        .icon-row .glyph { width: 2rem; height: 2rem; background-color: var(--cms-icon-color); }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { margin: 0; color: var(--cms-danger, #ffb4a8); min-height: 1.2em; }
      </style>
      <article class="tile" data-tile>
        <header data-header hidden><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config aria-label="Taster konfigurieren">⚙</button>
        <div class="main">
          <button type="button" class="push" data-push>
            <span class="glyph" data-icon aria-hidden="true" hidden></span>
            <span class="label" data-label></span>
          </button>
        </div>
        <p class="msg" role="alert" data-msg></p>
      </article>
      <dialog data-dialog aria-labelledby="button-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="button-dialog-title">Taster konfigurieren</h3>
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
          <label>Befehl (set &lt;Device&gt; …)
            <select name="command" required></select>
          </label>
          <label>Beschriftung des Knopfs (leer = Befehl)
            <input name="label" maxlength="32" autocomplete="off">
          </label>
          <div>
            <span class="hint">Icon (optional)</span>
            <div class="icon-row">
              <span class="glyph" data-icon-preview aria-hidden="true" hidden></span>
              <span data-icon-name>kein Icon</span>
              <button type="button" data-icon-choose>Icon wählen …</button>
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
    $('[data-open-config]').addEventListener('click', () => this.openConfig());
    $('[data-push]').addEventListener('click', () => this.push());
    $('[data-cancel]').addEventListener('click', () => this.closeDialog(true));
    $('[data-delete]').addEventListener('click', () => this.onDelete());
    $('[data-dialog]').addEventListener('cancel', () => this.closeDialog(true));
    $('[data-pick-device]').addEventListener('click', () => this.pickDevice());
    form.elements.device.addEventListener('click', () => this.pickDevice());
    $('[data-icon-choose]').addEventListener('click', () => this.chooseIcon());
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

  // Der Taster zeigt keine Live-Werte; die Schnittstelle bleibt wie bei den anderen Widgets.
  set data(value) {
    this.snapshot = value;
  }

  set stale(since) {
    const tile = this.shadowRoot.querySelector('[data-tile]');
    if (tile) {
      tile.toggleAttribute('data-stale', Boolean(since));
    }
  }

  render() {
    const push = this.shadowRoot.querySelector('[data-push]');
    if (!push || !this.widgetConfig) {
      return;
    }
    const config = this.widgetConfig;
    this.shadowRoot.querySelector('[data-label]').textContent = config.label || config.command || '';
    const title = config.title || '';
    this.shadowRoot.querySelector('[data-title]').textContent = title;
    this.shadowRoot.querySelector('[data-header]').hidden = !title;
    const tile = this.shadowRoot.querySelector('[data-tile]');
    tile.toggleAttribute('data-has-title', Boolean(title));
    tile.title = `${config.device || ''}: set ${config.command || ''}`;
    const url = config.icon && this.services ? this.services.iconUrl(config.icon) : '';
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
    this.shadowRoot.querySelector('[data-msg]').textContent = text;
  }

  // Gesendet wird nur in der Ansicht (view-only), nie im Bearbeitungsmodus.
  async push() {
    if (!this.hasAttribute('view-only') || !this.widgetConfig || !this.services || this.busy) {
      return;
    }
    const button = this.shadowRoot.querySelector('[data-push]');
    this.busy = true;
    button.disabled = true;
    this.showMessage('');
    try {
      await this.services.setCommand(this.widgetConfig.device, this.widgetConfig.command);
      button.setAttribute('data-done', '');
      window.clearTimeout(this.feedbackTimer);
      this.feedbackTimer = window.setTimeout(() => button.removeAttribute('data-done'), FEEDBACK_MS);
    } catch (error) {
      this.showMessage(error.message || 'Senden fehlgeschlagen');
    } finally {
      this.busy = false;
      button.disabled = false;
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
    form.elements.label.value = this.widgetConfig.label || '';
    this.setIcon(this.widgetConfig.icon || '');
    this.shadowRoot.querySelector('[data-delete]').hidden = this.isNew;
    this.setDialogError('');
    this.shadowRoot.querySelector('[data-dialog]').showModal();
    this.devices = [];
    this.fillCommands(this.widgetConfig.command);
    try {
      this.devices = await this.services.listAllDevices();
      this.fillCommands(this.widgetConfig.command);
    } catch (error) {
      this.setDialogError(`Geräteliste nicht verfügbar: ${error.message}`);
    }
  }

  fillCommands(wanted) {
    const form = this.shadowRoot.querySelector('[data-form]');
    const name = form.elements.device.value.trim();
    const device = this.devices.find((item) => item.name === name);
    const names = new Set(device ? switchCommands(device.sets) : []);
    if (wanted) {
      names.add(wanted);
    }
    const options = [...names].sort((a, b) => a.localeCompare(b)).map((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      return option;
    });
    form.elements.command.replaceChildren(...options);
    form.elements.command.value = wanted && names.has(wanted) ? wanted : (options[0]?.value || '');
    this.shadowRoot.querySelector('[data-device-alias]').textContent =
      device && device.alias && device.alias !== name ? `Alias: ${device.alias}` : '';
  }

  async pickDevice() {
    const device = await openDevicePicker({
      services: this.services,
      title: 'Device für den Taster wählen',
      accept: (item) => switchCommands(item.sets).length > 0
    });
    if (!device) {
      return;
    }
    this.shadowRoot.querySelector('[data-form]').elements.device.value = device.name;
    if (!this.devices.some((item) => item.name === device.name)) {
      this.devices.push(device);
    }
    this.setDialogError('');
    this.fillCommands(null);
  }

  setIcon(name) {
    this.icon = name;
    const preview = this.shadowRoot.querySelector('[data-icon-preview]');
    const url = name && this.services ? this.services.iconUrl(name) : '';
    preview.hidden = !url;
    this.setIconSrc(preview, url);
    this.shadowRoot.querySelector('[data-icon-name]').textContent = name || 'kein Icon';
  }

  async chooseIcon() {
    const name = await openIconPicker({ services: this.services });
    if (name !== null) {
      this.setIcon(name);
    }
  }

  collectWidget() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const value = (field) => form.elements[field].value.trim();
    if (!NAME_PATTERN.test(value('device'))) {
      throw new Error('Bitte ein gültiges Device angeben');
    }
    if (!NAME_PATTERN.test(value('command'))) {
      throw new Error('Bitte einen Befehl wählen');
    }
    if (/[\u0000-\u001f\u007f]/.test(value('label'))) {
      throw new Error('Die Beschriftung enthält ungültige Zeichen');
    }
    const widget = {
      id: this.widgetConfig.id, type: 'fhem-button', device: value('device'), command: value('command'),
      grid: { ...this.widgetConfig.grid }
    };
    for (const field of ['title', 'label']) {
      if (value(field)) {
        widget[field] = value(field);
      }
    }
    if (this.icon) {
      widget.icon = this.icon;
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
    if (!window.confirm('Diesen Taster wirklich löschen?')) {
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

if (!customElements.get('cms-button')) {
  customElements.define('cms-button', FHEMCMSButton);
}
