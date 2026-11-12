import { openDevicePicker } from '../js/device-picker.js';
import { dialogGroupStyles } from '../js/dialog-groups.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_POWER = 3000;
const DEFAULT_THRESHOLD = 10;
const READING_FIELDS = [
  { key: 'pv', label: 'PV-Leistung', required: true },
  { key: 'home', label: 'Hausverbrauch' },
  { key: 'grid', label: 'Netzleistung (− Bezug, + Einspeisung)' },
  { key: 'battery', label: 'Batterieleistung (+ Laden, − Entladen)' },
  { key: 'soc', label: 'Batterie-Ladestand (%)' }
];
// Die Stationen liegen auf einem Kreis um das Haus; die Verbindungen PV, Netz und Batterie sind Bögen dieses Kreises.
const CENTER = { x: 200, y: 205 };
const RADIUS = 150;
const STATION_R = 46;
const GAP = 6;
const ANGLES = { pv: -90, bat: 30, grid: 150 };
const point = (angle, radius = RADIUS) => ({
  x: CENTER.x + radius * Math.cos(angle * Math.PI / 180),
  y: CENTER.y + radius * Math.sin(angle * Math.PI / 180)
});
const STATIONS = { home: { ...CENTER }, pv: point(ANGLES.pv), grid: point(ANGLES.grid), bat: point(ANGLES.bat) };
const fixed = (value) => value.toFixed(1);
const arcPath = (from, to) => {
  const offset = (2 * Math.asin((STATION_R + GAP) / (2 * RADIUS))) * 180 / Math.PI;
  // Kürzester Weg auf dem Kreis (bei 120° Abstand nie der große Bogen).
  const direction = ((ANGLES[to] - ANGLES[from] + 540) % 360) - 180 > 0 ? 1 : -1;
  const start = point(ANGLES[from] + direction * offset);
  const end = point(ANGLES[to] - direction * offset);
  return `M${fixed(start.x)} ${fixed(start.y)} A${RADIUS} ${RADIUS} 0 0 ${direction > 0 ? 1 : 0} ${fixed(end.x)} ${fixed(end.y)}`;
};
const linePath = (from, to) => {
  const a = STATIONS[from];
  const b = STATIONS[to];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const inset = STATION_R + GAP;
  return `M${fixed(a.x + ux * inset)} ${fixed(a.y + uy * inset)} L${fixed(b.x - ux * inset)} ${fixed(b.y - uy * inset)}`;
};
const EDGES = [
  { a: 'pv', b: 'home', d: linePath('pv', 'home') },
  { a: 'pv', b: 'grid', d: arcPath('pv', 'grid') },
  { a: 'pv', b: 'bat', d: arcPath('pv', 'bat') },
  { a: 'home', b: 'grid', d: linePath('home', 'grid') },
  { a: 'home', b: 'bat', d: linePath('home', 'bat') },
  { a: 'grid', b: 'bat', d: arcPath('grid', 'bat') }
];

const ICONS = {
  pv: `<circle cx="0" cy="-13" r="4.5"/><path d="M0 -23V-20M-10 -20L-8 -18M10 -20L8 -18M-14 -13H-11M14 -13H11"/>
    <path d="M-14 -4L14 -4L18 13L-18 13Z" fill="#888"/><path d="M-5 -4L-6.500 13M5 -4L6.500 13M-16 4.500H16" stroke="#fafafa"/>
    <path d="M0 13V19M-8 19H8"/>`,
  home: '<path d="M-22 1L0 -20L22 1M-15 -5V19H15V-5M-5 19V6H5V19"/><circle cx="0" cy="-6" r="2.500"/>',
  grid: '<path d="M0 -22L-8 22M0 -22L8 22M-10 -12H10M-15 0H15M-6 10H6M-8 22H8"/>',
  bat: '<path d="M-4 -24H4V-21H-4Z" fill="#888"/><rect x="-11" y="-21" width="22" height="40" rx="3"/>'
};

const parseNumber = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const number = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
};

// Verteilt die Leistungen auf die Verbindungen: PV versorgt zuerst das Haus, dann die Batterie, dann das Netz.
export const computeFlows = (values) => {
  const supply = { pv: values.pv || 0, bat: values.bat < 0 ? -values.bat : 0, grid: values.grid < 0 ? -values.grid : 0 };
  const demand = { home: values.home || 0, bat: values.bat > 0 ? values.bat : 0, grid: values.grid > 0 ? values.grid : 0 };
  const order = { pv: ['home', 'bat', 'grid'], bat: ['home', 'grid'], grid: ['home', 'bat'] };
  const flows = {};
  for (const source of ['pv', 'bat', 'grid']) {
    for (const target of order[source]) {
      const amount = Math.min(supply[source], demand[target]);
      if (amount > 0) {
        flows[`${source}>${target}`] = amount;
        supply[source] -= amount;
        demand[target] -= amount;
      }
    }
  }
  return flows;
};

// Jede Station nennt Device und Reading; ältere Konfigurationen hatten ein gemeinsames Device und Reading-Namen als Text.
export const sourceOf = (config, key) => {
  const entry = config.readings?.[key];
  if (typeof entry === 'string') {
    return entry && config.device ? { device: config.device, reading: entry } : null;
  }
  return entry?.device && entry?.reading ? entry : null;
};

export const devicesOfSolarFlow = (config) => [...new Set(READING_FIELDS.map((field) => sourceOf(config, field.key)?.device).filter(Boolean))];

export const computeModel = (config, snapshots) => {
  const scale = config.unit === 'kW' ? 1000 : 1;
  const read = (key, factor = 1) => {
    const source = sourceOf(config, key);
    const item = source ? (snapshots?.get(source.device) || []).find((entry) => entry.readings?.[source.reading] !== undefined) : null;
    const number = item ? parseNumber(item.readings[source.reading]) : null;
    return number === null ? null : number * factor;
  };
  const pv = read('pv', scale);
  const grid = read('grid', scale);
  const bat = read('battery', scale);
  const soc = read('soc');
  let home = read('home', scale);
  if (home === null && pv !== null && config.deriveHome !== false) {
    home = Math.max(0, pv - (grid || 0) - (bat || 0));
  }
  const values = { pv: pv === null ? null : Math.max(0, pv), home: home === null ? null : Math.max(0, home), grid, bat };
  const threshold = Number.isFinite(config.threshold) ? config.threshold : DEFAULT_THRESHOLD;
  const flows = config.deriveHome === false && home === null ? {} : computeFlows(values);
  const visible = { pv: true, home: true, grid: Boolean(sourceOf(config, 'grid')), bat: Boolean(sourceOf(config, 'battery')) };
  const edges = EDGES.filter((edge) => visible[edge.a] && visible[edge.b]).map((edge) => {
    const forward = flows[`${edge.a}>${edge.b}`] || 0;
    const backward = flows[`${edge.b}>${edge.a}`] || 0;
    const power = Math.max(forward, backward);
    return { ...edge, power: power >= Math.max(threshold, 1) ? power : 0, reverse: backward > forward };
  });
  return { values, soc: soc === null ? null : Math.min(100, Math.max(0, soc)), visible, edges, threshold };
};

// Unter 30 % rot, ab 30 % bis unter 65 % gelb, ab 65 % grün.
export const batteryColor = (soc) => (soc < 30 ? '#e53935' : soc < 65 ? '#f0c020' : '#43c04a');

const formatPower = (value) => (value === null ? '–' : `${Math.round(value)}W`);

class FHEMCMSSolarFlow extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.snapshot = null;
    this.device = null;
    this.isNew = false;
    this.structureKey = '';
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
        .tile { position: relative; display: flex; flex-direction: column; height: 100%; overflow: hidden; container-type: size;
          border: 1px solid var(--cms-frame, #7f8c84); border-radius: 1.4rem; background: var(--cms-surface, #202e27); padding: 0.4rem; }
        header { flex: 0 0 auto; min-width: 0; margin: 0 1.6rem 0.25rem 0.3rem; }
        h3 { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 1.05rem; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        h3[data-title] { font-size: max(5px, min(9cqh, 4cqw)); }
        header[hidden] { display: none; }
        svg { display: block; flex: 1 1 0; width: 100%; height: 0; min-height: 0; }
        .link { fill: none; stroke-linecap: round; stroke: #c9c9c9; stroke-width: 9; }
        .dot { fill: #f6c945; stroke: #fff7d0; stroke-width: 0.4; }
        .value { fill: #d4a030; font-size: 14px; text-anchor: middle; }
        .soc { fill: #d4a030; font-size: 11px; text-anchor: middle; }
        .icon { fill: none; stroke: #8a8a8a; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        .tile[data-stale] { opacity: 0.65; border-style: dashed; }
        .gear, button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.35rem 0.7rem; }
        .gear { position: absolute; top: 0.2rem; right: 0.3rem; padding: 0 0.35em; }
        button:hover { background: var(--cms-surface-hover, #34493e); }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        :host([view-only]) [data-open-config] { display: none; }
        dialog { width: min(94vw, 38rem); max-height: 94vh; overflow: auto; padding: 1.25rem;
          border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef); }
        dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
        form { display: grid; gap: 0.75rem; }
        ${dialogGroupStyles}
        label { display: grid; gap: 0.25rem; }
        label.check { display: flex; align-items: center; gap: 0.5rem; }
        input, select { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a); border-radius: 0.5rem; padding: 0.4rem 0.5rem; }
        input[type="text"], input[type="number"], select { width: 100%; }
        .device-row { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
        [hidden] { display: none !important; }
        fieldset { display: grid; gap: 0.4rem; margin: 0; border: 1px solid var(--cms-border-subtle, #3a4d42); border-radius: 0.5rem; }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { min-height: 1.2em; margin: 0; color: var(--cms-danger, #ffb4a8); }
        /* Einheitliche Auswahllisten: eigener Pfeil statt Systemdarstellung (Safari). */
        select { appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238a9a8f' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 0.5em center; background-size: 0.65em;
          padding-right: 1.6em; }
      </style>
      <article class="tile">
        <header data-header hidden><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="SolarFlow konfigurieren">⚙</button>
        <svg data-svg viewBox="0 0 400 375" preserveAspectRatio="xMidYMid meet" role="img"></svg>
        <span class="sr-only" data-accessible></span>
      </article>
      <dialog data-dialog aria-labelledby="solarflow-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="solarflow-dialog-title">SolarFlow konfigurieren</h3>
          <details class="config-group" open><summary>Allgemein</summary>
            <div class="config-group-fields">
              <label>Titel (optional)<input name="title" type="text" maxlength="64" autocomplete="off"></label>
              <label style="display:flex;align-items:center;gap:0.35em"><input name="showTitle" type="checkbox" checked> Titel anzeigen</label>
            </div>
          </details>
          <details class="config-group" open><summary>Datenquelle und Readings</summary>
            <div class="config-group-fields">
              <fieldset class="mode"><legend>Herkunft der Werte</legend>
                <label class="check"><input type="radio" name="mode" value="single" checked>Werte kommen aus einem Device</label>
                <label class="check"><input type="radio" name="mode" value="multi">Werte kommen aus mehreren Devices</label></fieldset>
              <div data-single>
                <span class="device-row"><input name="device-single" readonly placeholder="Device wählen …" aria-label="Device für alle Werte">
                  <button type="button" data-pick="single">Device …</button></span>
                <span class="hint" data-alias></span>
              </div>
              ${READING_FIELDS.map((field) => `<fieldset data-field="${field.key}"><legend>${field.label}${field.required ? '' : ' (optional)'}</legend>
                <span class="device-row" data-multi><input name="device-${field.key}" readonly placeholder="Device wählen …" aria-label="Device für ${field.label}">
                  <button type="button" data-pick="${field.key}">Device …</button></span>
                <select name="reading-${field.key}" aria-label="Reading für ${field.label}"></select>
              </fieldset>`).join('')}
            </div>
          </details>
          <details class="config-group"><summary>Darstellung und Berechnung</summary>
            <div class="config-group-fields">
              <label>Einheit der Leistungs-Readings
                <select name="unit"><option value="W">Watt (W)</option><option value="kW">Kilowatt (kW)</option></select></label>
              <label>Schwellwert „inaktiv“ in Watt<input name="threshold" type="number" min="0" max="1000" step="1"></label>
              <label class="check"><input type="checkbox" name="deriveHome"> Fehlenden Hausverbrauch aus den übrigen Werten berechnen</label>
              <p class="hint">Netz: Bezug negativ, Einspeisung positiv. Batterie: Laden positiv, Entladen negativ. Ohne Netz- oder Batterie-Reading entfällt die jeweilige Station. Das Widget liest nur und sendet keine FHEM-Befehle.</p>
            </div>
          </details>
          <p class="error" data-error role="alert"></p>
          <div class="actions"><button type="button" class="danger" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit">Speichern</button></div>
        </form>
      </dialog>`;
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    const single = () => this.pickDevice('single');
    this.shadowRoot.querySelector('[data-pick="single"]').addEventListener('click', single);
    this.shadowRoot.querySelector('[name="device-single"]').addEventListener('click', single);
    for (const radio of this.shadowRoot.querySelectorAll('[name="mode"]')) {
      radio.addEventListener('change', () => this.setMode(radio.value));
    }
    for (const field of READING_FIELDS) {
      const pick = () => this.pickDevice(field.key);
      this.shadowRoot.querySelector(`[data-pick="${field.key}"]`).addEventListener('click', pick);
      this.shadowRoot.querySelector(`[name="device-${field.key}"]`).addEventListener('click', pick);
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
    this.snapshot = value;
    this.render();
  }

  set stale(value) {
    this.shadowRoot.querySelector('.tile')?.toggleAttribute('data-stale', value !== null);
  }

  async openConfig({ isNew = false } = {}) {
    this.isNew = isNew;
    const form = this.shadowRoot.querySelector('[data-form]');
    const config = this.widgetConfig;
    form.elements.title.value = config.title || '';
    form.elements.showTitle.checked = config.showTitle !== false;
    form.elements.deriveHome.checked = config.deriveHome !== false;
    form.elements.unit.value = config.unit === 'kW' ? 'kW' : 'W';
    form.elements.threshold.value = Number.isFinite(config.threshold) ? config.threshold : DEFAULT_THRESHOLD;
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    this.devices = [];
    try {
      this.devices = await this.services.listAllDevices();
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Devices konnten nicht geladen werden: ${error.message}`;
    }
    const multi = READING_FIELDS.some((field) => typeof config.readings?.[field.key] === 'object');
    form.elements.mode.value = multi ? 'multi' : 'single';
    this.mode = multi ? 'multi' : 'single';
    form.elements['device-single'].value = multi ? '' : (config.device || '');
    this.showAlias(form.elements['device-single'].value);
    for (const field of READING_FIELDS) {
      const source = sourceOf(config, field.key);
      this.setSource(field.key, multi ? (source?.device || null) : (config.device || null), source?.reading || '');
    }
    this.applyMode();
    this.shadowRoot.querySelector('[data-dialog]').showModal();
  }

  showAlias(name) {
    this.shadowRoot.querySelector('[data-alias]').textContent = (this.devices || []).find((item) => item.name === name)?.alias || '';
  }

  applyMode() {
    const single = this.mode !== 'multi';
    this.shadowRoot.querySelector('[data-single]').hidden = !single;
    for (const row of this.shadowRoot.querySelectorAll('[data-multi]')) {
      row.hidden = single;
    }
  }

  // Beim Umschalten bleiben die gewählten Readings erhalten, soweit das Device sie kennt.
  setMode(mode) {
    const form = this.shadowRoot.querySelector('[data-form]');
    const previous = this.mode;
    this.mode = mode;
    if (mode === 'single' && previous !== 'single') {
      const name = form.elements['device-pv'].value || READING_FIELDS.map((field) => form.elements[`device-${field.key}`].value).find(Boolean) || '';
      form.elements['device-single'].value = name;
      this.showAlias(name);
      for (const field of READING_FIELDS) {
        this.setSource(field.key, name || null, name ? form.elements[`reading-${field.key}`].value : '');
      }
    } else if (mode === 'multi' && previous !== 'multi') {
      const name = form.elements['device-single'].value;
      for (const field of READING_FIELDS) {
        this.setSource(field.key, name || null, form.elements[`reading-${field.key}`].value);
      }
    }
    this.applyMode();
  }

  setSource(key, deviceName, selected) {
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements[`device-${key}`].value = deviceName || '';
    const device = (this.devices || []).find((item) => item.name === deviceName);
    const select = form.elements[`reading-${key}`];
    const names = Object.keys(device?.readings || {}).sort();
    const all = selected && !names.includes(selected) ? [selected, ...names] : names;
    const required = READING_FIELDS.find((field) => field.key === key).required;
    select.replaceChildren(...(required ? [] : [new Option('– nicht verwenden –', '')]), ...all.map((name) => new Option(name, name)));
    select.value = selected || (required && deviceName ? (names[0] || '') : '');
    select.disabled = !deviceName;
  }

  async pickDevice(key) {
    const form = this.shadowRoot.querySelector('[data-form]');
    try {
      const device = await openDevicePicker({ services: this.services });
      if (!device) {
        return;
      }
      if (!(this.devices || []).some((item) => item.name === device.name)) {
        this.devices = [...(this.devices || []), device];
      }
      if (key === 'single') {
        form.elements['device-single'].value = device.name;
        this.showAlias(device.name);
        for (const field of READING_FIELDS) {
          this.setSource(field.key, device.name, '');
        }
      } else {
        this.setSource(key, device.name, '');
      }
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
    }
  }

  async saveConfig() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const title = form.elements.title.value.trim();
    const multi = form.elements.mode.value === 'multi';
    const sharedDevice = form.elements['device-single'].value.trim();
    const readings = {};
    for (const field of READING_FIELDS) {
      const device = multi ? form.elements[`device-${field.key}`].value.trim() : sharedDevice;
      const reading = form.elements[`reading-${field.key}`].value;
      if (device && reading) {
        readings[field.key] = multi ? { device, reading } : reading;
      }
    }
    const threshold = Number.parseInt(form.elements.threshold.value, 10);
    if (!readings.pv) {
      this.shadowRoot.querySelector('[data-error]').textContent = multi ? 'Device und Reading für die PV-Leistung sind erforderlich.' : 'Device und Reading für die PV-Leistung sind erforderlich (Device oben wählen).';
      return;
    }
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 1000) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Der Schwellwert muss zwischen 0 und 1000 liegen.';
      return;
    }
    const next = {
      id: this.widgetConfig.id,
      type: 'fhem-solarflow',
      ...(multi ? {} : { device: sharedDevice }),
      readings,
      unit: form.elements.unit.value === 'kW' ? 'kW' : 'W',
      threshold,
      grid: { ...this.widgetConfig.grid }
    };
    if (title) {
      next.title = title;
    }
    if (!form.elements.showTitle.checked) {
      next.showTitle = false;
    }
    if (!form.elements.deriveHome.checked) {
      next.deriveHome = false;
    }
    try {
      await this.services.saveWidget(next);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Speichern fehlgeschlagen: ${error.message}`;
    }
  }

  async deleteWidget() {
    if (!window.confirm('Dieses SolarFlow-Widget entfernen?')) {
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

  // Der SVG-Aufbau wird nur bei geänderter Struktur (Verbindungen, Richtung, Leistungsstufe) neu erzeugt,
  // damit die laufenden Animationen bei reinen Wertänderungen nicht neu starten.
  buildStructure(model) {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const svg = this.shadowRoot.querySelector('[data-svg]');
    // Die Verbindungen sind immer gleich dick und grau; nur die Punkte zeigen den Fluss.
    const links = model.edges.map((edge) => {
      const path = `<path class="link" d="${edge.d}"/>`;
      if (edge.power === 0) {
        return path;
      }
      const ratio = Math.min(1, edge.power / MAX_POWER);
      const dotRadius = (2 + 1.2 * ratio).toFixed(1);
      const duration = (3.2 - 2.2 * ratio).toFixed(2);
      const count = Math.min(edge.d.includes('L') ? 2 : 3, edge.power < 300 ? 1 : edge.power < 1500 ? 2 : 3);
      const dots = reduced
        ? `<circle class="dot" r="${dotRadius}"><animateMotion dur="1s" repeatCount="1" fill="freeze" keyPoints="0.5;0.5" keyTimes="0;1" calcMode="linear" path="${edge.d}"/></circle>`
        : Array.from({ length: count }, (_, dot) => `<circle class="dot" r="${dotRadius}">
            <animateMotion dur="${duration}s" begin="-${((dot * duration) / count).toFixed(2)}s" repeatCount="indefinite" path="${edge.d}"
              ${edge.reverse ? 'keyPoints="1;0" keyTimes="0;1" calcMode="linear"' : ''}/></circle>`).join('');
      return path + dots;
    }).join('');
    const station = (key) => {
      if (!model.visible[key]) {
        return '';
      }
      const { x, y } = STATIONS[key];
      return `<g transform="translate(${x} ${y})" data-station="${key}">
        <circle r="${STATION_R}" fill="url(#ring-grey)" data-ring/>
        <circle r="36" fill="#fafafa"/>
        <g class="icon" transform="translate(0 -9) scale(0.85)">${ICONS[key]}${key === 'bat' ? [0, 1, 2, 3, 4].map((index) => `<rect data-segment="${index}" x="-8" y="${(10.8 - index * 6.8).toFixed(1)}" width="16" height="5.2" rx="1" fill="none" stroke="none"/>`).join('') : ''}</g>
        <text class="value" y="${key === 'bat' ? 22 : 28}" data-value="${key}">–</text>
        ${key === 'bat' ? '<text class="soc" y="34" data-soc>–</text>' : ''}
      </g>`;
    };
    svg.innerHTML = `<defs>
        <linearGradient id="ring-grey" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b4b4b4"/><stop offset="1" stop-color="#ececec"/></linearGradient>
        <linearGradient id="ring-green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6bff00"/><stop offset="1" stop-color="#f4fff0"/></linearGradient>
        <linearGradient id="ring-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff1a1a"/><stop offset="1" stop-color="#fff0f0"/></linearGradient>
      </defs>${links}${['pv', 'home', 'grid', 'bat'].map(station).join('')}`;
  }

  render() {
    if (!this.widgetConfig || !this.shadowRoot.querySelector('[data-svg]')) {
      return;
    }
    const title = this.shadowRoot.querySelector('[data-title]');
    title.textContent = this.widgetConfig.title || '';
    title.parentElement.hidden = !this.widgetConfig.title || this.widgetConfig.showTitle === false;
    const model = computeModel(this.widgetConfig, this.snapshot);
    const key = JSON.stringify([model.visible, model.edges.map((edge) => [edge.a, edge.b, edge.reverse, Math.round(edge.power > 0 ? Math.min(1, edge.power / MAX_POWER) * 10 : -1), edge.power < 300 ? 0 : edge.power < 1500 ? 1 : 2])]);
    if (key !== this.structureKey) {
      this.structureKey = key;
      this.buildStructure(model);
    }
    const root = this.shadowRoot;
    const ring = (station, color) => root.querySelector(`[data-station="${station}"] [data-ring]`)?.setAttribute('fill', `url(#ring-${color})`);
    for (const station of ['pv', 'home', 'grid', 'bat']) {
      const text = root.querySelector(`[data-value="${station}"]`);
      if (text) {
        text.textContent = formatPower(model.values[station]);
      }
    }
    const { grid, bat } = model.values;
    const active = (value) => value !== null && Math.abs(value) >= Math.max(model.threshold, 1);
    ring('grid', !active(grid) ? 'grey' : grid < 0 ? 'red' : 'green');
    ring('bat', !active(bat) ? 'grey' : bat > 0 ? 'green' : 'red');
    const soc = root.querySelector('[data-soc]');
    if (soc) {
      soc.textContent = model.soc === null ? '' : `${Math.round(model.soc)}%`;
    }
    const segments = root.querySelectorAll('[data-segment]');
    if (segments.length) {
      const filled = model.soc === null ? 0 : model.soc > 0 ? Math.ceil(model.soc / 20) : 0;
      const color = model.soc === null ? 'none' : batteryColor(model.soc);
      segments.forEach((segment, index) => segment.setAttribute('fill', index < filled ? color : 'none'));
    }
    const parts = [`PV ${formatPower(model.values.pv)}`, `Haus ${formatPower(model.values.home)}`];
    if (model.visible.grid) {
      parts.push(`Netz ${formatPower(grid)}`);
    }
    if (model.visible.bat) {
      parts.push(`Batterie ${formatPower(bat)}${model.soc === null ? '' : `, ${Math.round(model.soc)}%`}`);
    }
    const summary = `${this.widgetConfig.title || 'SolarFlow'}: ${parts.join(', ')}`;
    root.querySelector('[data-svg]').setAttribute('aria-label', summary);
    root.querySelector('[data-accessible]').textContent = summary;
  }
}

if (!customElements.get('cms-solarflow')) {
  customElements.define('cms-solarflow', FHEMCMSSolarFlow);
}
