const UNITS = ['°C', '%', 'W', 'kW', 'kWh', 'V', 'A', 'hPa', 'lx', 'mm', 'm', 'km', 'km/h', 'm/s', 'l', 'ppm', 'dB'];
const ICON_PAGE = 120;
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

class FHEMCMSValue extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.snapshot = null;
    this.staleSince = null;
    this.isNew = false;
    this.icon = '';
    this.icons = null;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount > 0) {
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; }
        * { box-sizing: border-box; }
        .tile { height: 100%; padding: 0.6rem 1rem; border: 1px solid #43564a; border-radius: 1rem;
          background: #202e27; display: flex; align-items: center; gap: 0.6rem; }
        .tile[data-stale] { opacity: 0.65; border-style: dashed; }
        .icon { width: 2rem; height: 2rem; flex: none; object-fit: contain; }
        .value { flex: 1; min-width: 0; font-size: 1.6rem; font-weight: 600; overflow-wrap: anywhere; }
        .unit { margin-left: 0.25rem; font-size: 1rem; font-weight: 400; color: #a5c9b2; }
        button { font: inherit; color: inherit; cursor: pointer; border: 1px solid #43564a;
          border-radius: 0.5rem; background: #2a3b32; padding: 0.35rem 0.7rem; }
        button:hover { background: #34493e; }
        button:focus-visible, input:focus-visible { outline: 2px solid #8fd0a8; outline-offset: 2px; }
        .gear { padding: 0.2rem 0.5rem; }
        :host([view-only]) [data-open-config] { display: none; }
        dialog { border: 1px solid #43564a; border-radius: 1rem; background: #202e27; color: #edf4ef;
          padding: 1.25rem; width: min(94vw, 34rem); max-height: 94vh; overflow: auto; }
        dialog::backdrop { background: rgb(0 0 0 / 0.6); }
        form { display: grid; gap: 0.75rem; }
        label { display: grid; gap: 0.25rem; font-size: 0.9rem; }
        input { font: inherit; color: inherit; background: #17211d; border: 1px solid #43564a;
          border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
        .hint { margin: 0; color: #a5c9b2; font-size: 0.8rem; }
        .icon-row { display: flex; align-items: center; gap: 0.5rem; }
        .icon-row .icon { background: #17211d; border-radius: 0.4rem; padding: 0.15rem; }
        .icon-picker { display: grid; gap: 0.5rem; padding: 0.6rem; border: 1px solid #43564a;
          border-radius: 0.75rem; }
        .icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(3.2rem, 1fr)); gap: 0.35rem;
          max-height: 14rem; overflow: auto; }
        .icon-grid button { padding: 0.3rem; display: grid; place-items: center; }
        .icon-grid img { width: 1.8rem; height: 1.8rem; object-fit: contain; }
        .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
        .danger { margin-right: auto; border-color: #7f3b33; }
        .error { margin: 0; color: #ffb4a8; min-height: 1.2em; }
      </style>
      <article class="tile" data-tile>
        <img class="icon" data-icon alt="" hidden>
        <div class="value"><span data-value>–</span><span class="unit" data-unit></span></div>
        <button type="button" class="gear" data-open-config aria-label="Wert-Anzeige konfigurieren">⚙</button>
      </article>
      <dialog data-dialog aria-labelledby="value-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="value-dialog-title">Wert-Anzeige konfigurieren</h3>
          <label>Device
            <input name="device" list="value-devices" autocomplete="off" maxlength="64" required>
            <datalist id="value-devices" data-devices></datalist>
          </label>
          <label>Reading
            <input name="reading" list="value-readings" autocomplete="off" maxlength="64" required>
            <datalist id="value-readings" data-readings></datalist>
          </label>
          <label>Einheit (optional, Vorschlag wählen oder frei eintragen)
            <input name="unit" list="value-units" autocomplete="off" maxlength="16">
            <datalist id="value-units">${UNITS.map((unit) => `<option value="${unit}"></option>`).join('')}</datalist>
          </label>
          <div>
            <span class="hint">Icon (optional)</span>
            <div class="icon-row">
              <img class="icon" data-icon-preview alt="" hidden>
              <span data-icon-name>kein Icon</span>
              <button type="button" data-icon-toggle>Icon wählen …</button>
              <button type="button" data-icon-clear>Entfernen</button>
            </div>
          </div>
          <div class="icon-picker" data-icon-picker hidden>
            <input type="search" data-icon-filter placeholder="Icons filtern (z. B. temp, light, door)" autocomplete="off">
            <div class="icon-grid" data-icon-grid role="listbox" aria-label="Icons"></div>
            <p class="hint" data-icon-hint></p>
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
    $('[data-open-config]').addEventListener('click', () => this.openConfig());
    $('[data-cancel]').addEventListener('click', () => this.closeDialog(true));
    $('[data-delete]').addEventListener('click', () => this.onDelete());
    $('[data-dialog]').addEventListener('cancel', () => this.closeDialog(true));
    $('[data-icon-toggle]').addEventListener('click', () => this.toggleIconPicker());
    $('[data-icon-clear]').addEventListener('click', () => this.setIcon(''));
    $('[data-icon-filter]').addEventListener('input', () => this.renderIcons());
    const form = $('[data-form]');
    form.elements.device.addEventListener('change', () => this.fillReadings());
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

  render() {
    const value = this.shadowRoot.querySelector('[data-value]');
    if (!value || !this.widgetConfig) {
      return;
    }
    const raw = this.readingValue();
    value.textContent = raw === null || raw === '' ? '–' : raw;
    this.shadowRoot.querySelector('[data-unit]').textContent =
      raw !== null && raw !== '' && this.widgetConfig.unit ? this.widgetConfig.unit : '';
    const tile = this.shadowRoot.querySelector('[data-tile]');
    tile.title = `${this.widgetConfig.device || ''}:${this.widgetConfig.reading || ''}`;
    const icon = this.shadowRoot.querySelector('[data-icon]');
    const url = this.widgetConfig.icon && this.services ? this.services.iconUrl(this.widgetConfig.icon) : '';
    icon.hidden = !url;
    if (url && icon.getAttribute('src') !== url) {
      icon.src = url;
    }
  }

  async openConfig(options = {}) {
    this.isNew = Boolean(options.isNew);
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.device.value = this.widgetConfig.device || '';
    form.elements.reading.value = this.widgetConfig.reading || '';
    form.elements.unit.value = this.widgetConfig.unit || '';
    this.setIcon(this.widgetConfig.icon || '');
    this.shadowRoot.querySelector('[data-icon-picker]').hidden = true;
    this.shadowRoot.querySelector('[data-delete]').hidden = this.isNew;
    this.setDialogError('');
    this.shadowRoot.querySelector('[data-dialog]').showModal();
    try {
      this.devices = await this.services.listAllDevices();
      const list = this.shadowRoot.querySelector('[data-devices]');
      list.replaceChildren(...this.devices.map((device) => {
        const option = document.createElement('option');
        option.value = device.name;
        option.label = device.alias ? `${device.alias} (${device.name})` : device.name;
        return option;
      }));
      this.fillReadings();
    } catch (error) {
      this.setDialogError(`Geräteliste nicht verfügbar: ${error.message}`);
    }
  }

  fillReadings() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const device = (this.devices || []).find((item) => item.name === form.elements.device.value.trim());
    const list = this.shadowRoot.querySelector('[data-readings]');
    list.replaceChildren(...Object.keys(device ? device.readings : {}).sort().map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.label = `${name}: ${device.readings[name]}`;
      return option;
    }));
  }

  setIcon(name) {
    this.icon = name;
    const preview = this.shadowRoot.querySelector('[data-icon-preview]');
    const url = name && this.services ? this.services.iconUrl(name) : '';
    preview.hidden = !url;
    if (url) {
      preview.src = url;
    }
    this.shadowRoot.querySelector('[data-icon-name]').textContent = name || 'kein Icon';
  }

  async toggleIconPicker() {
    const picker = this.shadowRoot.querySelector('[data-icon-picker]');
    picker.hidden = !picker.hidden;
    if (picker.hidden) {
      return;
    }
    if (!this.icons) {
      try {
        this.icons = await this.services.listIcons();
      } catch (error) {
        this.setDialogError(`Icons nicht verfügbar: ${error.message}`);
        this.icons = [];
      }
    }
    this.renderIcons();
    this.shadowRoot.querySelector('[data-icon-filter]').focus();
  }

  renderIcons() {
    const filter = this.shadowRoot.querySelector('[data-icon-filter]').value.trim().toLowerCase();
    const matches = (this.icons || []).filter((name) => name.toLowerCase().includes(filter));
    const grid = this.shadowRoot.querySelector('[data-icon-grid]');
    grid.replaceChildren(...matches.slice(0, ICON_PAGE).map((name) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = name;
      button.setAttribute('aria-label', name);
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.alt = '';
      image.src = this.services.iconUrl(name);
      button.append(image);
      button.addEventListener('click', () => {
        this.setIcon(name);
        this.shadowRoot.querySelector('[data-icon-picker]').hidden = true;
      });
      return button;
    }));
    this.shadowRoot.querySelector('[data-icon-hint]').textContent = (this.icons || []).length === 0
      ? 'Keine Icons gefunden.'
      : `${matches.length} Treffer${matches.length > ICON_PAGE ? `, die ersten ${ICON_PAGE} werden angezeigt – Filter verfeinern` : ''}`;
  }

  setDialogError(message) {
    this.shadowRoot.querySelector('[data-dialog-error]').textContent = message;
  }

  collectWidget() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const device = form.elements.device.value.trim();
    const reading = form.elements.reading.value.trim();
    const unit = form.elements.unit.value.trim();
    if (!NAME_PATTERN.test(device)) {
      throw new Error('Bitte ein gültiges Device angeben');
    }
    if (!NAME_PATTERN.test(reading)) {
      throw new Error('Bitte ein gültiges Reading angeben');
    }
    if (/[\u0000-\u001f\u007f]/.test(unit)) {
      throw new Error('Die Einheit enthält ungültige Zeichen');
    }
    const widget = { id: this.widgetConfig.id, type: 'fhem-value', device, reading, grid: { ...this.widgetConfig.grid } };
    if (unit) {
      widget.unit = unit;
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
    if (!window.confirm('Diese Wert-Anzeige wirklich löschen?')) {
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

if (!customElements.get('cms-value')) {
  customElements.define('cms-value', FHEMCMSValue);
}
