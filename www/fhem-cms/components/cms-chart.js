import { isValidName } from '../js/fhem-client.js';
import { openDevicePicker } from '../js/device-picker.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const REFRESH_MS = 300000;
const RANGES = { '24h': '24 Stunden', '7d': '7 Tage', '30d': '30 Tage', '365d': '365 Tage' };
const GRANULARITIES = { auto: 'Automatisch', raw: 'Rohdaten', '15m': '15 Minuten', '1h': '1 Stunde', '1d': '1 Tag' };
const SOURCES = { auto: 'Automatisch', dblog: 'DbLog', filelog: 'FileLog' };
const W = 400;
const H = 200;
const PAD = { left: 38, right: 8, top: 8, bottom: 20 };

function svg(name, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function niceNumber(value) {
  return Math.abs(value) >= 100 ? value.toFixed(0) : Number(value.toFixed(2)).toString();
}

function timeLabel(seconds, rangeSeconds) {
  const date = new Date(seconds * 1000);
  return rangeSeconds <= 86400 * 1.5
    ? date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function fillSelect(select, options) {
  select.replaceChildren(...Object.entries(options).map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
}

class FHEMCMSChart extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.isNew = false;
    this.range = null;
    this.granularity = null;
    this.timer = null;
    this.requestId = 0;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) {
      this.scheduleRefresh();
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; min-height: 0; }
        * { box-sizing: border-box; }
        .tile { position: relative; display: grid; grid-template-rows: auto 1fr auto; height: 100%; gap: 0.2rem; overflow: hidden;
          container-type: size; border: 1px solid var(--cms-frame, #7f8c84); border-radius: 1.4rem;
          background: var(--cms-surface, #202e27); padding: 0.4rem 1.2rem 0.4rem 0.8rem; }
        header { display: flex; align-items: center; gap: 0.5rem; min-width: 0; padding-right: 1.2rem; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        h3 { margin: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1em; font-weight: 400; }
        .controls { display: flex; gap: 0.3rem; }
        .controls select { font: inherit; font-size: 0.75rem; color: inherit; background: var(--cms-bg, #17211d);
          border: 1px solid var(--cms-border, #43564a); border-radius: 0.4rem; padding: 0.1rem 0.2rem; }
        .plot { position: relative; min-height: 0; }
        svg { width: 100%; height: 100%; display: block; }
        .axis { stroke: var(--cms-border, #43564a); stroke-width: 1; }
        .grid { stroke: var(--cms-border, #43564a); stroke-width: 0.5; opacity: 0.5; }
        .band { fill: var(--cms-accent, #8fd0a8); opacity: 0.2; }
        .line { fill: none; stroke: var(--cms-accent, #8fd0a8); stroke-width: 1.6; stroke-linejoin: round; }
        text { fill: var(--cms-muted, #a5c9b2); font-size: 9px; }
        .message { position: absolute; inset: 0; display: grid; place-items: center; text-align: center;
          color: var(--cms-muted, #a5c9b2); font-size: 0.85rem; padding: 0.5rem; }
        .message[data-error] { color: var(--cms-danger, #ffb4a8); }
        .stats { display: flex; flex-wrap: wrap; gap: 0.2rem 0.9rem; color: var(--cms-muted, #a5c9b2); font-size: 0.75rem;
          font-variant-numeric: tabular-nums; }
        .gear, button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.35rem 0.7rem; }
        .gear { position: absolute; top: 0.2rem; right: 0.3rem; padding: 0 0.35em; font-size: 0.75rem; }
        button:hover:not(:disabled) { background: var(--cms-surface-hover, #34493e); }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        :host([view-only]) [data-open-config] { display: none; }
        @container (max-height: 7rem) { .stats { display: none; } }
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
      </style>
      <article class="tile" data-tile>
        <header><h3 data-title></h3>
          <span class="controls"><select data-range aria-label="Zeitraum"></select>
            <select data-granularity aria-label="Granularität"></select></span></header>
        <button type="button" class="gear" data-open-config aria-label="Diagramm konfigurieren">⚙</button>
        <div class="plot"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-svg role="img" aria-label="Verlaufsdiagramm"></svg>
          <div class="message" data-message role="status"></div></div>
        <div class="stats" data-stats></div>
      </article>
      <dialog data-dialog aria-labelledby="chart-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="chart-dialog-title">Diagramm konfigurieren</h3>
          <label>Titel (optional)<input name="title" type="text" maxlength="64" autocomplete="off"></label>
          <label>FHEM-Device
            <span class="device-row"><input name="device" readonly required placeholder="Noch kein Device gewählt">
              <button type="button" data-pick-device>Auswählen …</button></span>
          </label>
          <label>Geloggtes Reading<select name="reading" required></select></label>
          <p class="hint" data-source-hint></p>
          <label>Einheit (optional)<input name="unit" type="text" maxlength="16" autocomplete="off"></label>
          <label>Standard-Zeitraum<select name="range"></select></label>
          <label>Standard-Granularität<select name="granularity"></select></label>
          <label>Datenquelle<select name="source"></select></label>
          <p class="error" data-error role="alert"></p>
          <div class="actions"><button type="button" class="danger" data-delete>Entfernen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit" data-save>Speichern</button></div>
        </form>
      </dialog>`;
    const $ = (selector) => this.shadowRoot.querySelector(selector);
    fillSelect($('[data-range]'), RANGES);
    fillSelect($('[data-granularity]'), GRANULARITIES);
    fillSelect($('[name="range"]'), RANGES);
    fillSelect($('[name="granularity"]'), GRANULARITIES);
    fillSelect($('[name="source"]'), SOURCES);
    $('[data-range]').addEventListener('change', (event) => {
      this.range = event.target.value;
      this.load();
    });
    $('[data-granularity]').addEventListener('change', (event) => {
      this.granularity = event.target.value;
      this.load();
    });
    $('[data-open-config]').addEventListener('click', () => this.openConfig());
    $('[data-pick-device]').addEventListener('click', () => this.pickDevice());
    $('[name="device"]').addEventListener('click', () => this.pickDevice());
    $('[name="source"]').addEventListener('change', () => this.loadReadings(this.shadowRoot.querySelector('[name="reading"]').value));
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
    this.load();
    this.scheduleRefresh();
  }

  disconnectedCallback() {
    window.clearInterval(this.timer);
    this.timer = null;
  }

  scheduleRefresh() {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.load(), REFRESH_MS);
  }

  set config(value) {
    this.widgetConfig = value;
    this.range = value?.range || '24h';
    this.granularity = value?.granularity || 'auto';
    if (this.shadowRoot.childElementCount) {
      this.render();
      this.load();
    }
  }

  get config() {
    return this.widgetConfig;
  }

  set data(value) {}

  set stale(value) {}

  render() {
    if (!this.widgetConfig || !this.shadowRoot.querySelector('[data-svg]')) {
      return;
    }
    const $ = (selector) => this.shadowRoot.querySelector(selector);
    $('[data-title]').textContent = this.widgetConfig.title || `${this.widgetConfig.device || ''} ${this.widgetConfig.reading || ''}`.trim() || 'Diagramm';
    $('[data-range]').value = this.range || '24h';
    $('[data-granularity]').value = this.granularity || 'auto';
  }

  message(text, isError = false) {
    const node = this.shadowRoot.querySelector('[data-message]');
    node.textContent = text;
    node.toggleAttribute('data-error', isError);
    node.hidden = !text;
  }

  async load() {
    const config = this.widgetConfig;
    if (!config || !this.services?.history || !isValidName(config.device) || !isValidName(config.reading)) {
      this.message('Noch nicht konfiguriert');
      return;
    }
    const requestId = ++this.requestId;
    this.message('Verlauf wird geladen …');
    try {
      const result = await this.services.history(config.device, config.reading, this.range, this.granularity, config.source || 'auto');
      if (requestId !== this.requestId) {
        return;
      }
      this.draw(result);
    } catch (error) {
      if (requestId === this.requestId) {
        this.shadowRoot.querySelector('[data-svg]').replaceChildren();
        this.shadowRoot.querySelector('[data-stats]').textContent = '';
        this.message(error.message || 'Der Verlauf konnte nicht geladen werden', true);
      }
    }
  }

  draw(result) {
    const points = result.points || [];
    const target = this.shadowRoot.querySelector('[data-svg]');
    const stats = this.shadowRoot.querySelector('[data-stats]');
    target.replaceChildren();
    if (!points.length) {
      stats.textContent = '';
      this.message('Keine Werte im gewählten Zeitraum');
      return;
    }
    this.message('');
    const unit = this.widgetConfig.unit ? ` ${this.widgetConfig.unit}` : '';
    const from = Number.isFinite(result.from) ? result.from : points[0][0];
    const to = Number.isFinite(result.to) && result.to > from ? result.to : points[points.length - 1][0] + 1;
    let low = Math.min(...points.map((p) => p[2] ?? p[1]));
    let high = Math.max(...points.map((p) => p[3] ?? p[1]));
    if (high === low) {
      high += 1;
      low -= 1;
    }
    const margin = (high - low) * 0.05;
    low -= margin;
    high += margin;
    const x = (t) => PAD.left + ((t - from) / (to - from)) * (W - PAD.left - PAD.right);
    const y = (v) => PAD.top + (1 - (v - low) / (high - low)) * (H - PAD.top - PAD.bottom);

    for (let i = 0; i <= 4; i += 1) {
      const value = low + ((high - low) * i) / 4;
      target.append(svg('line', { class: 'grid', x1: PAD.left, x2: W - PAD.right, y1: y(value), y2: y(value) }));
      target.append(svg('text', { x: PAD.left - 3, y: y(value) + 3, 'text-anchor': 'end' }, niceNumber(value)));
    }
    for (let i = 0; i <= 4; i += 1) {
      const t = from + ((to - from) * i) / 4;
      target.append(svg('text', { x: x(t), y: H - 5, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' }, timeLabel(t, to - from)));
    }
    target.append(svg('line', { class: 'axis', x1: PAD.left, x2: PAD.left, y1: PAD.top, y2: H - PAD.bottom }));
    target.append(svg('line', { class: 'axis', x1: PAD.left, x2: W - PAD.right, y1: H - PAD.bottom, y2: H - PAD.bottom }));

    if (points.length > 1 && points.some((p) => p[2] !== p[3])) {
      const upper = points.map((p) => `${x(p[0]).toFixed(1)},${y(p[3] ?? p[1]).toFixed(1)}`);
      const lower = points.map((p) => `${x(p[0]).toFixed(1)},${y(p[2] ?? p[1]).toFixed(1)}`).reverse();
      target.append(svg('polygon', { class: 'band', points: [...upper, ...lower].join(' ') }));
    }
    if (points.length === 1) {
      target.append(svg('circle', { cx: x(points[0][0]), cy: y(points[0][1]), r: 3, fill: 'var(--cms-accent, #8fd0a8)' }));
    } else {
      target.append(svg('polyline', { class: 'line', points: points.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ') }));
    }

    const min = Math.min(...points.map((p) => p[2] ?? p[1]));
    const max = Math.max(...points.map((p) => p[3] ?? p[1]));
    const last = points[points.length - 1][1];
    const parts = [`Letzter: ${niceNumber(last)}${unit}`, `Min: ${niceNumber(min)}${unit}`, `Max: ${niceNumber(max)}${unit}`];
    if (result.truncated) {
      parts.push('Daten gekürzt');
    }
    stats.textContent = parts.join(' · ');
  }

  async openConfig({ isNew = false } = {}) {
    this.isNew = isNew;
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.device.value = this.widgetConfig.device || '';
    form.elements.unit.value = this.widgetConfig.unit || '';
    form.elements.range.value = this.widgetConfig.range || '24h';
    form.elements.granularity.value = this.widgetConfig.granularity || 'auto';
    form.elements.source.value = this.widgetConfig.source || 'auto';
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    this.shadowRoot.querySelector('[data-dialog]').showModal();
    if (this.widgetConfig.device) {
      await this.loadReadings(this.widgetConfig.reading);
    } else {
      this.fillReadings([], '');
    }
  }

  fillReadings(readings, selected) {
    const select = this.shadowRoot.querySelector('[name="reading"]');
    const names = selected && !readings.includes(selected) ? [selected, ...readings] : readings;
    select.replaceChildren(...names.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      return option;
    }));
    select.value = names.includes(selected) ? selected : (names[0] || '');
  }

  async loadReadings(selected) {
    const form = this.shadowRoot.querySelector('[data-form]');
    const device = form.elements.device.value.trim();
    const hint = this.shadowRoot.querySelector('[data-source-hint]');
    const error = this.shadowRoot.querySelector('[data-error]');
    if (!isValidName(device)) {
      return;
    }
    hint.textContent = 'Geloggte Readings werden gelesen …';
    error.textContent = '';
    try {
      const result = await this.services.logReadings(device, form.elements.source.value);
      this.fillReadings(result.readings, selected);
      hint.textContent = result.readings.length
        ? `Quelle: ${SOURCES[result.source] || result.source}; ${result.readings.length} geloggte Readings gefunden.`
        : 'Für dieses Device wurden keine geloggten Readings gefunden.';
    } catch (failure) {
      this.fillReadings([], selected);
      hint.textContent = '';
      error.textContent = failure.message || 'Geloggte Readings konnten nicht gelesen werden';
    }
  }

  async pickDevice() {
    try {
      const device = await openDevicePicker({ services: this.services, accept: () => true });
      if (device) {
        this.shadowRoot.querySelector('[name="device"]').value = device.name;
        await this.loadReadings('');
      }
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
    }
  }

  collectWidget() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const device = form.elements.device.value.trim();
    const reading = form.elements.reading.value;
    const title = form.elements.title.value.trim();
    const unit = form.elements.unit.value.trim();
    if (!isValidName(device) || !isValidName(reading)) {
      throw new Error('Bitte Device und geloggtes Reading wählen.');
    }
    if (title.length > 64 || /[\u0000-\u001f\u007f]/.test(title)) {
      throw new Error('Ungültiger Titel');
    }
    if (unit.length > 16 || /[\u0000-\u001f\u007f]/.test(unit)) {
      throw new Error('Ungültige Einheit');
    }
    const next = {
      id: this.widgetConfig.id,
      type: 'fhem-chart',
      device,
      reading,
      range: form.elements.range.value,
      granularity: form.elements.granularity.value,
      source: form.elements.source.value,
      grid: { ...this.widgetConfig.grid }
    };
    if (title) {
      next.title = title;
    }
    if (unit) {
      next.unit = unit;
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
    if (!window.confirm('Dieses Diagramm entfernen?')) {
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

if (!customElements.get('cms-chart')) {
  customElements.define('cms-chart', FHEMCMSChart);
}
