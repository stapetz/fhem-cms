import { openDevicePicker } from '../js/device-picker.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_POWER = 3000;
const DEFAULT_THRESHOLD = 10;
const READING_FIELDS = [
  { key: 'pv', label: 'PV-Leistung', required: true },
  { key: 'home', label: 'Hausverbrauch' },
  { key: 'grid', label: 'Netzleistung (+ Bezug, − Einspeisung)' },
  { key: 'battery', label: 'Batterieleistung (+ Laden, − Entladen)' },
  { key: 'soc', label: 'Batterie-Ladestand (%)' }
];
const STATIONS = {
  pv: { x: 200, y: 58, label: 'PV' },
  home: { x: 200, y: 190, label: 'Haus' },
  grid: { x: 60, y: 305, label: 'Netz' },
  bat: { x: 340, y: 305, label: 'Batterie' }
};
const EDGES = [
  { a: 'pv', b: 'home', d: 'M200 112 L200 136' },
  { a: 'pv', b: 'grid', d: 'M158 48 Q60 80 60 250' },
  { a: 'pv', b: 'bat', d: 'M242 48 Q340 80 340 250' },
  { a: 'home', b: 'grid', d: 'M158 224 L102 271' },
  { a: 'home', b: 'bat', d: 'M242 224 L298 271' },
  { a: 'grid', b: 'bat', d: 'M108 330 Q200 385 292 330' }
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
  const supply = { pv: values.pv || 0, bat: values.bat < 0 ? -values.bat : 0, grid: values.grid > 0 ? values.grid : 0 };
  const demand = { home: values.home || 0, bat: values.bat > 0 ? values.bat : 0, grid: values.grid < 0 ? -values.grid : 0 };
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

export const computeModel = (config, snapshot) => {
  const readings = config.readings || {};
  const item = (snapshot || []).find((entry) => entry.name === config.device) || (snapshot || [])[0];
  const scale = config.unit === 'kW' ? 1000 : 1;
  const read = (name, factor = 1) => {
    const number = name ? parseNumber(item?.readings?.[name]) : null;
    return number === null ? null : number * factor;
  };
  const pv = read(readings.pv, scale);
  const grid = read(readings.grid, config.invertGrid ? -scale : scale);
  const bat = read(readings.battery, config.invertBattery ? -scale : scale);
  const soc = read(readings.soc);
  let home = read(readings.home, scale);
  if (home === null && pv !== null) {
    home = Math.max(0, pv + (grid || 0) - (bat || 0));
  }
  const values = { pv: pv === null ? null : Math.max(0, pv), home: home === null ? null : Math.max(0, home), grid, bat };
  const threshold = Number.isFinite(config.threshold) ? config.threshold : DEFAULT_THRESHOLD;
  const flows = computeFlows(values);
  const visible = { pv: true, home: true, grid: Boolean(readings.grid), bat: Boolean(readings.battery) };
  const edges = EDGES.filter((edge) => visible[edge.a] && visible[edge.b]).map((edge) => {
    const forward = flows[`${edge.a}>${edge.b}`] || 0;
    const backward = flows[`${edge.b}>${edge.a}`] || 0;
    const power = Math.max(forward, backward);
    return { ...edge, power: power >= Math.max(threshold, 1) ? power : 0, reverse: backward > forward };
  });
  return { values, soc: soc === null ? null : Math.min(100, Math.max(0, soc)), visible, edges, threshold };
};

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
        :host { display: block; min-width: 0; min-height: 0; }
        * { box-sizing: border-box; }
        .tile { position: relative; display: grid; height: 100%; overflow: hidden; container-type: size;
          border: 1px solid var(--cms-frame, #7f8c84); border-radius: 1.4rem; background: var(--cms-surface, #202e27); padding: 0.4rem; }
        header { position: absolute; top: 0.4rem; left: 0.7rem; right: 2rem; }
        h3 { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        header[hidden] { display: none; }
        svg { width: 100%; height: 100%; min-height: 0; }
        .link { fill: none; stroke-linecap: round; stroke: #c9c9c9; }
        .link[data-idle] { stroke: var(--cms-border, #43564a); stroke-width: 3; opacity: 0.6; }
        .dot { fill: #f6c945; stroke: #fff7d0; stroke-width: 0.8; }
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
        label { display: grid; gap: 0.25rem; }
        label.check { display: flex; align-items: center; gap: 0.5rem; }
        input, select { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a); border-radius: 0.5rem; padding: 0.4rem 0.5rem; }
        input[type="text"], input[type="number"], select { width: 100%; }
        .device-row { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { min-height: 1.2em; margin: 0; color: var(--cms-danger, #ffb4a8); }
      </style>
      <article class="tile">
        <header data-header hidden><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config aria-label="SolarFlow konfigurieren">⚙</button>
        <svg data-svg viewBox="0 0 400 380" preserveAspectRatio="xMidYMid meet" role="img"></svg>
        <span class="sr-only" data-accessible></span>
      </article>
      <dialog data-dialog aria-labelledby="solarflow-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="solarflow-dialog-title">SolarFlow konfigurieren</h3>
          <label>Titel (optional)<input name="title" type="text" maxlength="64" autocomplete="off"></label>
          <label>SolarDevice
            <span class="device-row"><input name="device" readonly required placeholder="Noch kein Device gewählt">
              <button type="button" data-pick-device>Auswählen …</button></span>
          </label>
          <span class="hint" data-alias></span>
          ${READING_FIELDS.map((field) => `<label>${field.label}${field.required ? '' : ' (optional)'}
            <select name="reading-${field.key}"></select></label>`).join('')}
          <label>Einheit der Leistungs-Readings
            <select name="unit"><option value="W">Watt (W)</option><option value="kW">Kilowatt (kW)</option></select></label>
          <label class="check"><input name="invertGrid" type="checkbox">Vorzeichen der Netzleistung umkehren</label>
          <label class="check"><input name="invertBattery" type="checkbox">Vorzeichen der Batterieleistung umkehren</label>
          <label>Schwellwert „inaktiv“ in Watt<input name="threshold" type="number" min="0" max="1000" step="1"></label>
          <p class="hint">Netz: Bezug positiv, Einspeisung negativ. Batterie: Laden positiv, Entladen negativ. Fehlt das Reading für Hausverbrauch, wird er aus den übrigen Werten berechnet. Ohne Netz- oder Batterie-Reading entfällt die jeweilige Station. Das Widget liest nur und sendet keine FHEM-Befehle.</p>
          <p class="error" data-error role="alert"></p>
          <div class="actions"><button type="button" class="danger" data-delete>Entfernen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit">Speichern</button></div>
        </form>
      </dialog>`;
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.shadowRoot.querySelector('[data-pick-device]').addEventListener('click', () => this.pickDevice());
    this.shadowRoot.querySelector('[name="device"]').addEventListener('click', () => this.pickDevice());
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
    form.elements.device.value = config.device || '';
    form.elements.unit.value = config.unit === 'kW' ? 'kW' : 'W';
    form.elements.invertGrid.checked = config.invertGrid === true;
    form.elements.invertBattery.checked = config.invertBattery === true;
    form.elements.threshold.value = Number.isFinite(config.threshold) ? config.threshold : DEFAULT_THRESHOLD;
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    this.device = null;
    try {
      const devices = await this.services.listAllDevices();
      this.device = devices.find((item) => item.name === config.device) || null;
      this.setReadings(this.device, config.readings || {});
      this.shadowRoot.querySelector('[data-alias]').textContent = this.device?.alias || '';
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Devices konnten nicht geladen werden: ${error.message}`;
    }
    this.shadowRoot.querySelector('[data-dialog]').showModal();
  }

  setReadings(device, selected) {
    const names = Object.keys(device?.readings || {}).sort();
    for (const field of READING_FIELDS) {
      const select = this.shadowRoot.querySelector(`[name="reading-${field.key}"]`);
      const options = field.required ? [] : [new Option('– nicht verwendet –', '')];
      const current = selected[field.key] || '';
      const all = current && !names.includes(current) ? [current, ...names] : names;
      options.push(...all.map((name) => new Option(name, name)));
      select.replaceChildren(...options);
      select.value = current || (field.required ? (names[0] || '') : '');
    }
  }

  async pickDevice() {
    try {
      const device = await openDevicePicker({ services: this.services });
      if (!device) {
        return;
      }
      this.device = device;
      this.shadowRoot.querySelector('[name="device"]').value = device.name;
      this.shadowRoot.querySelector('[data-alias]').textContent = device.alias || '';
      this.setReadings(device, {});
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
    }
  }

  async saveConfig() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const title = form.elements.title.value.trim();
    const device = form.elements.device.value.trim();
    const readings = {};
    for (const field of READING_FIELDS) {
      const value = form.elements[`reading-${field.key}`].value;
      if (value) {
        readings[field.key] = value;
      }
    }
    const threshold = Number.parseInt(form.elements.threshold.value, 10);
    if (!device || !readings.pv) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Device und PV-Reading sind erforderlich.';
      return;
    }
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 1000) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Der Schwellwert muss zwischen 0 und 1000 liegen.';
      return;
    }
    const next = {
      id: this.widgetConfig.id,
      type: 'fhem-solarflow',
      device,
      readings,
      unit: form.elements.unit.value === 'kW' ? 'kW' : 'W',
      invertGrid: form.elements.invertGrid.checked,
      invertBattery: form.elements.invertBattery.checked,
      threshold,
      grid: { ...this.widgetConfig.grid }
    };
    if (title) {
      next.title = title;
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
    const links = model.edges.map((edge, index) => {
      if (edge.power === 0) {
        return `<path class="link" data-idle d="${edge.d}"/>`;
      }
      const ratio = Math.min(1, edge.power / MAX_POWER);
      const width = (5 + 9 * ratio).toFixed(1);
      const duration = (3.2 - 2.2 * ratio).toFixed(2);
      const count = edge.power < 300 ? 1 : edge.power < 1500 ? 2 : 3;
      const dots = reduced
        ? `<circle class="dot" r="${(width * 0.5).toFixed(1)}"><animateMotion dur="1s" repeatCount="1" fill="freeze" keyPoints="0.5;0.5" keyTimes="0;1" calcMode="linear" path="${edge.d}"/></circle>`
        : Array.from({ length: count }, (_, dot) => `<circle class="dot" r="${(width * 0.55).toFixed(1)}">
            <animateMotion dur="${duration}s" begin="-${((dot * duration) / count).toFixed(2)}s" repeatCount="indefinite" path="${edge.d}"
              ${edge.reverse ? 'keyPoints="1;0" keyTimes="0;1" calcMode="linear"' : ''}/></circle>`).join('');
      return `<path class="link" id="e${index}" d="${edge.d}" stroke-width="${width}"/>${dots}`;
    }).join('');
    const station = (key) => {
      if (!model.visible[key]) {
        return '';
      }
      const { x, y } = STATIONS[key];
      return `<g transform="translate(${x} ${y})" data-station="${key}">
        <circle r="46" fill="url(#ring-grey)" data-ring/>
        <circle r="36" fill="#fafafa"/>
        <g class="icon" transform="translate(0 -9) scale(0.85)">${ICONS[key]}${key === 'bat' ? '<rect data-level x="-8" width="16" rx="1.500" stroke="none"/>' : ''}</g>
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
    title.parentElement.hidden = !this.widgetConfig.title;
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
    ring('grid', !active(grid) ? 'grey' : grid > 0 ? 'red' : 'green');
    ring('bat', !active(bat) ? 'grey' : bat > 0 ? 'green' : 'red');
    const soc = root.querySelector('[data-soc]');
    if (soc) {
      soc.textContent = model.soc === null ? '' : `${Math.round(model.soc)}%`;
    }
    const level = root.querySelector('[data-level]');
    if (level) {
      const height = model.soc === null ? 0 : 34 * model.soc / 100;
      level.setAttribute('y', String(17 - height));
      level.setAttribute('height', String(height));
      level.setAttribute('fill', model.soc === null ? 'none' : model.soc < 25 ? '#e53935' : model.soc < 50 ? '#f0a020' : '#43c04a');
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
