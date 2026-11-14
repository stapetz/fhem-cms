import { openDevicePicker } from '../js/device-picker.js';
import { openIconPicker } from '../js/icon-picker.js';
import { switchCommands } from './cms-switch.js';
import { fittedContentCss, fitWidgetContent } from '../js/widget-content-fit.js';
import { actionIconUrl, actionPresentationFields, collectActionPresentation } from '../js/action-presentation.js';
import { dialogGroupStyles, titleVisibilityField } from '../js/dialog-groups.js';
import { createManualFieldTracker, suggestedChoice } from '../js/device-suggestions.js';

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
      this.stopContentFit = fitWidgetContent(this);
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        [data-title] { text-align: var(--cms-widget-title-align, left); width: 100%; min-width: 0; flex: 1; }
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
        ${fittedContentCss}
        .push { display: inline-flex; align-items: center; justify-content: center; gap: 0.14em;
          padding: 0.25em 0.35em; border-radius: 14px; border: 1px solid rgba(16,185,129,.35); background: rgba(16,185,129,.15); color: inherit;
          font-size: 1em; line-height: 1.1; font-weight: 600; transition: background 0.15s, transform 0.1s; }
        .push:hover { background: rgba(16,185,129,.25); }
        .push:active { transform: scale(0.96); }
        .push:disabled { cursor: default; opacity: 0.7; }
        .push[data-done] { background: rgba(16,185,129,.25); border-color: #10b981; }
        .label { white-space: nowrap; }
        .label[hidden] { display: none; }
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
        ${dialogGroupStyles}
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
        /* Einheitliche Auswahllisten: eigener Pfeil statt Systemdarstellung (Safari). */
        select { appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238a9a8f' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 0.5em center; background-size: 0.65em;
          padding-right: 1.6em; }
      </style>
      <article class="tile" data-tile>
        <header data-header hidden><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="Taster konfigurieren">⚙</button>
        <div class="main">
          <button type="button" class="push" data-push data-fit-content>
            <span class="glyph" data-icon aria-hidden="true" hidden></span>
            <span class="label" data-label></span>
          </button>
        </div>
        <p class="msg" role="alert" data-msg></p>
      </article>
      <dialog data-dialog aria-labelledby="button-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="button-dialog-title">Taster konfigurieren</h3>
          <details class="config-group" open><summary>Allgemein</summary>
            <div class="config-group-fields">
              <label>Titel (optional)<input name="title" maxlength="64" autocomplete="off"></label>
              ${titleVisibilityField}
            </div>
          </details>
          <details class="config-group" open><summary>Datenquelle und Aktion</summary>
            <div class="config-group-fields">
              <label>FHEM-Device
                <span class="device-row">
                  <input name="device" maxlength="128" autocomplete="off" readonly required placeholder="Noch kein Device gewählt">
                  <button type="button" data-pick-device>Auswählen …</button>
                </span>
              </label>
              <span class="hint" data-device-alias></span>
              <label>Befehl (set &lt;Device&gt; …)<select name="command" required></select></label>
            </div>
          </details>
          <details class="config-group"><summary>Beschriftung und Darstellung</summary>
            <div class="config-group-fields">
              <label>Beschriftung des Knopfs (leer = Befehl)<input name="label" maxlength="32" autocomplete="off"></label>
              ${actionPresentationFields}
              <div>
                <span class="hint">Icon (leer = passendes Standardsymbol)</span>
                <div class="icon-row">
                  <span class="glyph" data-icon-preview aria-hidden="true" hidden></span>
                  <span data-icon-name>kein Icon</span>
                  <button type="button" data-icon-choose>Icon wählen …</button>
                </div>
              </div>
            </div>
          </details>
          <p class="error" role="alert" data-dialog-error></p>
          <div class="actions">
            <button type="button" class="danger" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button>
            <button type="submit" data-save>Speichern</button>
          </div>
        </form>
      </dialog>
    `;

    const $ = (selector) => this.shadowRoot.querySelector(selector);
    const form = $('[data-form]');
    this.suggestionTracker = createManualFieldTracker(form);
    $('[data-open-config]').addEventListener('click', () => this.openConfig());
    $('[data-push]').addEventListener('click', () => this.push());
    $('[data-cancel]').addEventListener('click', () => this.closeDialog(true));
    $('[data-delete]').addEventListener('click', () => this.onDelete());
    $('[data-dialog]').addEventListener('cancel', () => this.closeDialog(true));
    $('[data-pick-device]').addEventListener('click', () => this.pickDevice());
    form.elements.device.addEventListener('click', () => this.pickDevice());
    $('[data-icon-choose]').addEventListener('click', () => this.chooseIcon());
    form.elements.command.addEventListener('change', () => this.setIcon(this.icon));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.onSave();
    });
    this.stopContentFit = fitWidgetContent(this);
    this.render();
  }

  disconnectedCallback() {
    this.stopContentFit?.();
    this.stopContentFit = null;
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
    const label = config.label || config.command || 'Taster';
    const caption = this.shadowRoot.querySelector('[data-label]');
    caption.textContent = label;
    caption.hidden = config.showLabel !== true;
    push.setAttribute('aria-label', label);
    push.title = label;
    const title = config.showTitle === false ? '' : (config.title || '');
    this.shadowRoot.querySelector('[data-title]').textContent = title;
    this.shadowRoot.querySelector('[data-header]').hidden = !title;
    const tile = this.shadowRoot.querySelector('[data-tile]');
    tile.toggleAttribute('data-has-title', Boolean(title));
    tile.title = `${config.device || ''}: set ${config.command || ''}`;
    const url = actionIconUrl(config.icon, config.command, this.services);
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
    this.suggestionTracker.reset();
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    form.elements.device.value = this.widgetConfig.device || '';
    form.elements.label.value = this.widgetConfig.label || '';
    form.elements.showLabel.value = String(this.widgetConfig.showLabel === true);
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
    const available = new Set(device ? switchCommands(device.sets) : []);
    const names = new Set(available);
    if (wanted) {
      names.add(wanted);
    }
    const selected = this.suggestionTracker.isEdited(form.elements.command)
      ? form.elements.command.value
      : (wanted || suggestedChoice([...names]));
    if (selected) {
      names.add(selected);
    }
    const options = [new Option('Befehl wählen …', ''), ...[...names].sort((a, b) => a.localeCompare(b)).map((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = available.has(item) || !device ? item : `${item} (nicht verfügbar)`;
      return option;
    })];
    form.elements.command.replaceChildren(...options);
    form.elements.command.value = selected && names.has(selected) ? selected : '';
    this.setIcon(this.icon);
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
    const command = this.shadowRoot.querySelector('[data-form]').elements.command.value;
    const url = actionIconUrl(name, command, this.services);
    preview.hidden = !url;
    this.setIconSrc(preview, url);
    this.shadowRoot.querySelector('[data-icon-name]').textContent = name || 'Standardsymbol';
  }

  async chooseIcon() {
    const name = await openIconPicker({ services: this.services, clearLabel: 'Standardsymbol' });
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
    const device = this.devices.find((item) => item.name === value('device'));
    if (device && !switchCommands(device.sets).includes(value('command'))) {
      throw new Error('Das Device bietet den ausgewählten Befehl nicht an.');
    }
    if (value('label').length > 32 || /[\u0000-\u001f\u007f]/.test(value('label'))) {
      throw new Error('Die Beschriftung enthält ungültige Zeichen');
    }
    const widget = {
      id: this.widgetConfig.id, type: 'fhem-button', device: value('device'), command: value('command'),
      grid: { ...this.widgetConfig.grid }
    };
    widget.showLabel = collectActionPresentation(form);
    for (const field of ['title', 'label']) {
      if (value(field)) {
        widget[field] = value(field);
      }
    }
    if (!form.elements.showTitle.checked) {
      widget.showTitle = false;
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
