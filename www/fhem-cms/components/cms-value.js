const UNITS = ['°C', '%', 'W', 'kW', 'kWh', 'V', 'A', 'hPa', 'lx', 'mm', 'm', 'km', 'km/h', 'm/s', 'l', 'ppm', 'dB'];
const ICON_PAGE = 120;
const PICKER_MAX_ROWS = 200;
const PICKER_COLUMNS = [
  { key: 'name', label: 'Device' },
  { key: 'alias', label: 'Alias' },
  { key: 'type', label: 'Typ' },
  { key: 'room', label: 'Raum' },
  { key: 'parent', label: 'Kanal von' }
];
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
        [data-title] { text-align: var(--cms-widget-title-align, left); width: 100%; min-width: 0; flex: 1; }
        :host { display: block; min-width: 0; min-height: 0; }
        * { box-sizing: border-box; }
        .tile { position: relative; height: 100%; overflow: hidden; container-type: size; border: 1px solid var(--cms-frame, #7f8c84); border-radius: 1.4rem;
          background: var(--cms-surface, #202e27); display: flex; flex-direction: column; }
        header { position: absolute; top: 0; left: 0; right: 1.6rem; z-index: 1; display: flex; align-items: center; gap: 0.4rem;
          padding: 0.4em 0 0 1.1em; font-size: max(5px, min(13cqh, 5cqw)); }
        header[hidden] { display: none; }
        h3 { margin: 0; font-size: 1.1em; font-weight: 400; color: var(--cms-muted, #a5c9b2); font-family: inherit;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .main { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; gap: 0.5em; padding: 0 0.8em; }
        .gear.solo { position: absolute; top: 0.2rem; right: 0.3rem; font-size: 0.75rem; }
        .tile[data-stale] { opacity: 0.65; border-style: dashed; }
        :host { --cms-icon-color: var(--cms-accent, #8fd0a8); }
        .glyph { display: inline-block; background-color: var(--cms-icon-color);
          -webkit-mask: var(--icon-url) center / contain no-repeat; mask: var(--icon-url) center / contain no-repeat; }
        .glyph[hidden] { display: none; }
        .icon { height: 1.1em; width: 1.1em; flex: none; }
        .icon-row .icon { width: 2rem; height: 2rem; }
        .value { font-size: max(5px, min(var(--vh, 38cqh), 11cqw)); min-width: 0; line-height: 1.1; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .main { font-size: max(5px, min(var(--vh, 38cqh), 11cqw)); }
        .value { font-size: inherit; flex: 0 1 auto; text-align: center; }
        .unit { margin-left: 0.25rem; font-size: 0.6em; font-weight: 400; color: var(--cms-muted, #a5c9b2); }
        button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.35rem 0.7rem; }
        button:hover { background: var(--cms-surface-hover, #34493e); }
        button:focus-visible, input:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        .tile[data-has-title] { --vh: 32cqh; }
        .gear { padding: 0 0.35em; font-size: 1em; line-height: 1.4; flex: none; }
        @container (max-height: 3rem) { header { display: none; } .tile[data-has-title] { --vh: 38cqh; } }
        @container (max-width: 6rem) { .gear { display: none; } }
        :host([view-only]) [data-open-config] { display: none; }
        dialog { border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef);
          padding: 1.25rem; width: min(94vw, 34rem); max-height: 94vh; overflow: auto; }
        dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
        form, .picker-body { display: grid; gap: 0.75rem; }
        .device-row { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
        dialog.picker { width: min(94vw, 44rem); }
        .picker-list { max-height: 50vh; overflow: auto; border: 1px solid var(--cms-border, #43564a); border-radius: 0.5rem; }
        .picker-list table { width: 100%; border-collapse: collapse; font-size: 0.9rem; table-layout: fixed; }
        .picker-list th:nth-child(1) { width: 26%; }
        .picker-list th:nth-child(2) { width: 22%; }
        .picker-list th:nth-child(3) { width: 14%; }
        .picker-list th:nth-child(4) { width: 20%; }
        .picker-list td { overflow-wrap: anywhere; }
        .picker-list th { position: sticky; top: 0; background: var(--cms-bg, #17211d); text-align: left; color: var(--cms-muted, #a5c9b2); }
        .picker-list tr.filters th { top: 2.1rem; padding-top: 0; font-weight: normal; }
        .picker-list tr.filters input { padding: 0.25rem 0.4rem; font-size: 0.8rem; }
        .picker-list td.dim { color: var(--cms-muted, #a5c9b2); }
        .picker-list th, .picker-list td { padding: 0.4rem 0.6rem; }
        .picker-list tbody tr { cursor: pointer; border-top: 1px solid var(--cms-border-subtle, #3a4d42); }
        .picker-list tbody tr:hover, .picker-list tbody tr:focus { background: var(--cms-surface-hover, #34493e); outline: none; }
        select { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
        label { display: grid; gap: 0.25rem; font-size: 0.9rem; }
        input { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
        .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
        .chips button { padding: 0.15rem 0.55rem; font-size: 0.85rem; }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .icon-row { display: flex; align-items: center; gap: 0.5rem; }
        .icon-picker { display: grid; gap: 0.5rem; padding: 0.6rem; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.75rem; }
        .icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(3.2rem, 1fr)); gap: 0.35rem;
          max-height: 14rem; overflow: auto; }
        .icon-grid button { padding: 0.3rem; display: grid; place-items: center; }
        .icon-grid .glyph { width: 1.8rem; height: 1.8rem; }
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
        <header data-header hidden>
          <h3 data-title></h3>
        </header>
        <button type="button" class="gear solo" data-open-config title="Widget konfigurieren" aria-label="Wert-Anzeige konfigurieren">⚙</button>
        <div class="main">
          <span class="glyph icon" data-icon aria-hidden="true" hidden></span>
          <div class="value"><span data-value>–</span><span class="unit" data-unit></span></div>
        </div>
      </article>
      <dialog data-dialog aria-labelledby="value-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="value-dialog-title">Wert-Anzeige konfigurieren</h3>
          <label>Titel (optional)
            <input name="title" maxlength="64" autocomplete="off">
          </label>
          <label style="display:flex;align-items:center;gap:0.35em"><input name="showTitle" type="checkbox" checked> Titel anzeigen</label>
          <label>FHEM-Device
            <span class="device-row">
              <input name="device" maxlength="128" autocomplete="off" readonly required placeholder="Noch kein Device gewählt">
              <button type="button" data-pick-device>Auswählen …</button>
            </span>
          </label>
          <span class="hint" data-device-alias></span>
          <label>Reading
            <select name="reading" required></select>
          </label>
          <label>Einheit (optional, Vorschlag wählen oder frei eintragen)
            <input name="unit" autocomplete="off" maxlength="16">
          </label>
          <div class="chips" role="group" aria-label="Einheiten-Vorschläge">${UNITS.map((unit) => `<button type="button" data-unit-choice="${unit}">${unit}</button>`).join('')}</div>
          <div>
            <span class="hint">Icon (optional)</span>
            <div class="icon-row">
              <span class="glyph icon" data-icon-preview aria-hidden="true" hidden></span>
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
            <button type="button" class="danger" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button>
            <button type="submit" data-save>Speichern</button>
          </div>
        </form>
      </dialog>
      <dialog data-picker aria-labelledby="value-picker-title" class="picker">
        <div class="picker-body">
          <h3 id="value-picker-title">Device auswählen</h3>
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
          <p class="hint" data-picker-info></p>
          <div class="actions"><button type="button" data-picker-cancel>Abbrechen</button></div>
        </div>
      </dialog>
    `;

    const $ = (selector) => this.shadowRoot.querySelector(selector);
    this.shadowRoot.querySelectorAll('[data-open-config]').forEach((button) => button.addEventListener('click', () => this.openConfig()));
    $('[data-cancel]').addEventListener('click', () => this.closeDialog(true));
    $('[data-delete]').addEventListener('click', () => this.onDelete());
    $('[data-dialog]').addEventListener('cancel', () => this.closeDialog(true));
    $('[data-icon-toggle]').addEventListener('click', () => this.toggleIconPicker());
    $('[data-icon-clear]').addEventListener('click', () => this.setIcon(''));
    $('[data-icon-filter]').addEventListener('input', () => this.renderIcons());
    const form = $('[data-form]');
    for (const chip of this.shadowRoot.querySelectorAll('[data-unit-choice]')) {
      chip.addEventListener('click', () => {
        form.elements.unit.value = chip.dataset.unitChoice;
      });
    }
    $('[data-pick-device]').addEventListener('click', () => this.openPicker());
    form.elements.device.addEventListener('click', () => this.openPicker());
    $('[data-picker-cancel]').addEventListener('click', () => this.closePicker());
    $('[data-picker-search]').addEventListener('input', () => this.renderPickerRows());
    for (const filter of this.shadowRoot.querySelectorAll('[data-picker-filter]')) {
      filter.addEventListener('input', () => this.renderPickerRows());
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
    const title = this.shadowRoot.querySelector('[data-title]');
    title.textContent = this.widgetConfig.title || '';
    const titleShown = Boolean(this.widgetConfig.title) && this.widgetConfig.showTitle !== false;
    this.shadowRoot.querySelector('[data-header]').hidden = !titleShown;
    tile.toggleAttribute('data-has-title', titleShown);
    const icon = this.shadowRoot.querySelector('[data-icon]');
    const url = this.widgetConfig.icon && this.services ? this.services.iconUrl(this.widgetConfig.icon) : '';
    icon.hidden = !url;
    this.setIconSrc(icon, url);
  }

  // Das Icon dient als Maske und erbt die Farbe (--cms-icon-color) aus dem CSS; so sind auch schwarze Icons lesbar.
  setIconSrc(element, url, onMissing) {
    if (!url) {
      element.style.removeProperty('--icon-url');
      return;
    }
    if (element.dataset.src === url) {
      return;
    }
    element.dataset.src = url;
    element.style.setProperty('--icon-url', `url("${url}")`);
    if (onMissing) {
      const probe = new Image();
      probe.onerror = onMissing;
      probe.src = url;
    }
  }

  async openConfig(options = {}) {
    this.isNew = Boolean(options.isNew);
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.device.value = this.widgetConfig.device || '';
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    this.showAlias();
    form.elements.unit.value = this.widgetConfig.unit || '';
    this.setIcon(this.widgetConfig.icon || '');
    this.shadowRoot.querySelector('[data-icon-picker]').hidden = true;
    this.shadowRoot.querySelector('[data-delete]').hidden = this.isNew;
    this.setDialogError('');
    this.shadowRoot.querySelector('[data-dialog]').showModal();
    this.devices = [];
    this.fillReadings(this.widgetConfig.reading || '');
    try {
      this.devices = await this.services.listAllDevices();
      this.showAlias();
      this.fillReadings(this.widgetConfig.reading || '');
    } catch (error) {
      this.setDialogError(`Geräteliste nicht verfügbar: ${error.message}`);
    }
  }

  fillReadings(wanted) {
    const form = this.shadowRoot.querySelector('[data-form]');
    const device = (this.devices || []).find((item) => item.name === form.elements.device.value.trim());
    const names = new Set(Object.keys(device ? device.readings : {}));
    if (wanted) {
      names.add(wanted);
    }
    const options = [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
      const option = document.createElement('option');
      option.value = name;
      const value = device && device.readings[name];
      option.textContent = value === undefined ? name : `${name} (${value})`;
      return option;
    });
    form.elements.reading.replaceChildren(...options);
    form.elements.reading.value = wanted && names.has(wanted) ? wanted : (options[0]?.value || '');
  }

  async openPicker() {
    const $ = (selector) => this.shadowRoot.querySelector(selector);
    $('[data-picker-search]').value = '';
    for (const filter of this.shadowRoot.querySelectorAll('[data-picker-filter]')) {
      filter.value = '';
    }
    if (!$('[data-picker]').open) {
      $('[data-picker]').showModal();
    }
    $('[data-picker-search]').focus();
    if (!this.devices || this.devices.length === 0) {
      $('[data-picker-info]').textContent = 'Geräteliste wird geladen …';
      try {
        this.devices = await this.services.listAllDevices();
      } catch (error) {
        $('[data-picker-info]').textContent = error.message || 'Geräteliste konnte nicht geladen werden';
        return;
      }
    }
    this.renderPickerRows();
  }

  renderPickerRows() {
    const $ = (selector) => this.shadowRoot.querySelector(selector);
    const split = (text) => text.toLowerCase().split(/\s+/).filter(Boolean);
    const terms = split($('[data-picker-search]').value);
    const filters = PICKER_COLUMNS.map((column) => ({
      key: column.key,
      terms: split($(`[data-picker-filter="${column.key}"]`).value)
    })).filter((filter) => filter.terms.length > 0);
    const text = (device, key) => String(device[key] ?? '');
    const matches = this.devices.filter((device) => {
      const haystack = PICKER_COLUMNS.map((column) => text(device, column.key)).join(' ').toLowerCase();
      return terms.every((term) => haystack.includes(term))
        && filters.every((filter) => filter.terms.every((term) => text(device, filter.key).toLowerCase().includes(term)));
    });
    const shown = matches.slice(0, PICKER_MAX_ROWS);
    $('[data-picker-rows]').replaceChildren(...shown.map((device) => {
      const row = document.createElement('tr');
      row.tabIndex = 0;
      for (const column of PICKER_COLUMNS) {
        const cell = document.createElement('td');
        cell.textContent = text(device, column.key);
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
    $('[data-picker-info]').textContent = matches.length === 0
      ? 'Keine passenden Devices gefunden'
      : matches.length > shown.length
        ? `${shown.length} von ${matches.length} Treffern angezeigt, Suche weiter einschränken`
        : `${matches.length} Devices`;
  }

  showAlias(device) {
    const form = this.shadowRoot.querySelector('[data-form]');
    const name = form.elements.device.value.trim();
    const found = device || (this.devices || []).find((item) => item.name === name);
    this.shadowRoot.querySelector('[data-device-alias]').textContent =
      found && found.alias && found.alias !== name ? `Alias: ${found.alias}` : '';
  }

  pickDevice(device) {
    this.shadowRoot.querySelector('[data-form]').elements.device.value = device.name;
    this.showAlias(device);
    this.closePicker();
    this.setDialogError('');
    this.fillReadings('');
  }

  closePicker() {
    const picker = this.shadowRoot.querySelector('[data-picker]');
    if (picker.open) {
      picker.close();
    }
  }

  setIcon(name) {
    this.icon = name;
    const preview = this.shadowRoot.querySelector('[data-icon-preview]');
    const url = name && this.services ? this.services.iconUrl(name) : '';
    preview.hidden = !url;
    this.setIconSrc(preview, url);
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
      const image = document.createElement('span');
      image.className = 'glyph';
      image.setAttribute('aria-hidden', 'true');
      this.setIconSrc(image, this.services.iconUrl(name), () => button.remove());
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
    const title = form.elements.title.value.trim();
    if (title) {
      widget.title = title;
    }
    if (!form.elements.showTitle.checked) {
      widget.showTitle = false;
    }
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
