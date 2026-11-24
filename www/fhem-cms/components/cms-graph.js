import { isValidName } from '../js/fhem-client.js';
import { graphPieValues, stackGraphSeries } from '../js/graph-data.js';
import { openDevicePicker } from '../js/device-picker.js';
import { showCmsModal } from '../js/modal-dialog.js';
import { widgetDesignCss } from '../js/widget-design.js';

const COLORS = ['#3b82f6', '#f59e0b', '#22c55e', '#e879f9', '#ef4444', '#14b8a6'];
const SVG = 'http://www.w3.org/2000/svg';
const RANGES = { '24h': '24 Stunden', '7d': '7 Tage', '30d': '30 Tage', '365d': '365 Tage' };
const GRANULARITIES = { auto: 'Automatisch', raw: 'Rohdaten', '15m': '15 Minuten', '1h': '1 Stunde', '1d': '1 Tag' };
const TYPES = { line: 'Linien', stack: 'Gestapelt', pie: 'Torte' };
const SOURCES = { auto: 'Automatisch', dblog: 'DbLog', filelog: 'FileLog' };

function options(values, selected) {
  return Object.entries(values).map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    return option;
  });
}

function svg(name, attributes = {}, text) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function label(series) {
  return series.label || `${series.device}: ${series.reading}`;
}

function validate(config) {
  if (!Array.isArray(config.series) || config.series.length < 1 || config.series.length > 20) {
    throw new Error('Bitte eine bis 20 Datenreihen auswählen.');
  }
  if (!Object.hasOwn(TYPES, config.chartType) || !Object.hasOwn(RANGES, config.range)
    || !Object.hasOwn(GRANULARITIES, config.granularity) || !['last', 'average'].includes(config.aggregation)) {
    throw new Error('Ungültige Diagrammeinstellung');
  }
  if ((config.title || '').length > 64 || /[\u0000-\u001f\u007f]/.test(config.title || '')) throw new Error('Ungültiger Titel');
  for (const row of config.series) {
    if (!isValidName(row.device) || !isValidName(row.reading) || !Object.hasOwn(SOURCES, row.source)
      || typeof row.label !== 'string' || row.label.length > 64 || /[\u0000-\u001f\u007f]/.test(row.label)
      || !/^#[a-fA-F0-9]{6}$/.test(row.color)) throw new Error('Ungültige Datenreihe');
  }
}

class FHEMCMSGraph extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'});
    this.request = 0;
    this.previewRequest = 0;
    this.hiddenSeries = new Set();
    this.pickerAbort = new AbortController();
  }

  connectedCallback() {
    if (!this.shadowRoot.childElementCount) this.initialize();
    this.render();
    void this.load();
    this.timer = window.setInterval(() => this.load(), 300000);
  }

  disconnectedCallback() {
    this.request++;
    this.previewRequest++;
    this.pickerAbort.abort();
    window.clearInterval(this.timer);
  }

  set config(value) {
    this.widgetConfig = value;
    this.hiddenSeries.clear();
    if (this.isConnected && this.shadowRoot.childElementCount) {
      this.render();
      void this.load();
    }
  }
  get config() { return this.widgetConfig; }
  set data(value) {}
  set stale(value) {}

  initialize() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; min-width:0; min-height:0; }
        * { box-sizing:border-box; }
        .tile { height:var(--cms-widget-height,100%); overflow:auto; display:flex; flex-direction:column; gap:.5rem;
          padding:1rem; border:1px solid var(--cms-frame); border-radius:1.4rem; background:var(--cms-surface); container-type:size; }
        header { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
        h3 { margin:0; flex:1; text-align:var(--cms-widget-title-align,left); }
        button,select,input { font:inherit; color:inherit; background:var(--cms-bg); border:1px solid var(--cms-border);
          border-radius:.5rem; padding:.4rem; }
        button { cursor:pointer; min-height:44px; }
        button:focus-visible,select:focus-visible,input:focus-visible { outline:2px solid var(--cms-accent); outline-offset:2px; }
        :host([view-only]) [data-open-config] { display:none; }
        .plot { position:relative; flex:1; min-height:10rem; border-radius:.75rem; background:rgba(128,128,128,.08); }
        .plot svg { width:100%; height:100%; position:absolute; inset:0; }
        svg text { fill:currentColor; font-size:9px; }
        .legend { display:flex; flex-wrap:wrap; gap:.25rem; }
        .legend button { display:flex; align-items:center; gap:.35rem; min-height:36px; }
        .legend button[aria-pressed="false"] { opacity:.5; text-decoration:line-through; }
        .swatch { width:.85rem; height:.85rem; border-radius:50%; flex:none; }
        .status { margin:0; color:var(--cms-muted); }
        .status[data-error] { color:var(--cms-danger); }
        dialog { width:min(94vw,48rem); max-height:94vh; overflow:auto; padding:1rem; color:var(--cms-text);
          background:var(--cms-surface); border:1px solid var(--cms-border); border-radius:1rem; }
        dialog::backdrop { background:var(--cms-backdrop); }
        form { display:grid; gap:.7rem; }
        label { display:grid; gap:.2rem; }
        .settings { display:grid; grid-template-columns:repeat(auto-fit,minmax(10rem,1fr)); gap:.5rem; }
        .row { display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:.4rem;
          padding:.7rem; border:1px solid var(--cms-border); border-radius:.5rem; }
        .row input,.row select { min-width:0; width:100%; }
        .actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.5rem; }
        .preview { height:16rem; flex:none; }
        [hidden] { display:none !important; }
        ${widgetDesignCss}
      </style>
      <article class="tile" data-tile><header><h3 data-title></h3>
        <select data-range aria-label="Zeitraum"></select>
        <button type="button" data-open-config>Konfigurieren</button></header>
        <div class="plot"><svg data-svg viewBox="0 0 400 220" role="img" aria-label="Graph"></svg></div>
        <div class="legend" data-legend></div><p class="status" data-status role="status"></p></article>
      <dialog data-dialog aria-label="Graph konfigurieren"><form data-form novalidate>
        <h3>Graph konfigurieren</h3>
        <label>Titel<input name="title" maxlength="64"></label>
        <div class="settings">
          <label>Diagrammtyp<select name="chartType"></select></label>
          <label>Tortenwerte<select name="aggregation"></select></label>
          <label>Zeitraum<select name="range"></select></label>
          <label>Granularität<select name="granularity"></select></label>
        </div>
        <section data-rows></section>
        <button type="button" data-add>Datenreihe hinzufügen</button>
        <strong>Vorschau</strong><div class="plot preview"><svg data-preview viewBox="0 0 400 220" role="img" aria-label="Graph-Vorschau"></svg></div>
        <div class="legend" data-preview-legend></div><p class="status" data-preview-status role="status"></p>
        <p class="status" data-error role="alert"></p>
        <div class="actions"><button type="button" data-delete>Widget löschen</button><button type="button" data-cancel>Abbrechen</button>
          <button type="submit" data-save>Speichern</button></div>
      </form></dialog>`;
    const $ = selector => this.shadowRoot.querySelector(selector);
    $('[data-open-config]').addEventListener('click', () => this.openConfig());
    $('[data-range]').addEventListener('change', event => { this.range = event.target.value; void this.load(); });
    $('[data-add]').addEventListener('click', () => this.addRow());
    $('[data-cancel]').addEventListener('click', () => this.closeConfig());
    $('[data-delete]').addEventListener('click', () => this.deleteWidget());
    $('[data-dialog]').addEventListener('cancel', event => { event.preventDefault(); this.closeConfig(); });
    $('[data-form]').addEventListener('submit', event => { event.preventDefault(); void this.save(); });
    $('[data-form]').addEventListener('change', () => this.queuePreview());
    $('[data-form]').addEventListener('input', () => this.queuePreview());
  }

  render() {
    const config = this.widgetConfig;
    if (!config) return;
    this.range = config.range || '24h';
    const title = this.shadowRoot.querySelector('[data-title]');
    title.textContent = config.showTitle === false ? '' : config.title || 'Graph';
    this.shadowRoot.querySelector('[data-range]').replaceChildren(...options(RANGES, this.range));
  }

  async fetchData(config, active) {
    if (typeof this.services?.history !== 'function') throw new Error('Verlaufsdienst ist nicht verfügbar');
    const results = new Array(config.series.length);
    let next = 0;
    let failed = false;
    const worker = async () => {
      try {
        while (active() && !failed && next < config.series.length) {
          const index = next++;
          const row = config.series[index];
          const result = await this.services.history(row.device, row.reading, config.range, config.granularity, row.source);
          if (!active() || failed) return;
          if (!result || !Array.isArray(result.points)
            || result.points.some(point => !Array.isArray(point) || point.length < 2
              || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) {
            throw new Error(`Ungültige Verlaufsdaten für ${row.device}: ${row.reading}`);
          }
          if (config.chartType === 'pie' && result.points.length && !result.summary) {
            throw new Error(`Auswertung für ${row.device}: ${row.reading} nicht verfügbar`);
          }
          results[index] = result;
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    };
    await Promise.all([worker(), worker()]);
    if (!active()) return null;
    return results;
  }

  async load() {
    const config = this.widgetConfig;
    if (!config?.series?.length) return;
    const request = ++this.request;
    const status = this.shadowRoot.querySelector('[data-status]');
    status.textContent = 'Daten werden geladen …';
    status.removeAttribute('data-error');
    try {
      const current = {...config, range: this.range};
      validate(current);
      const data = await this.fetchData(current, () => request === this.request && this.isConnected);
      if (request !== this.request || !this.isConnected) return;
      this.currentData = data;
      this.draw(current, data, '[data-svg]', '[data-legend]', status, this.hiddenSeries);
    } catch (error) {
      if (request !== this.request || !this.isConnected) return;
      this.shadowRoot.querySelector('[data-svg]').replaceChildren();
      this.shadowRoot.querySelector('[data-legend]').replaceChildren();
      status.textContent = `Graph konnte nicht geladen werden: ${error.message || String(error)}`;
      status.setAttribute('data-error', '');
    }
  }

  draw(config, data, selector, legendSelector, status, hidden) {
    const target = this.shadowRoot.querySelector(selector);
    const legend = this.shadowRoot.querySelector(legendSelector);
    target.replaceChildren();
    legend.replaceChildren();
    config.series.forEach((row, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(!hidden.has(index)));
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.backgroundColor = row.color;
      button.append(swatch, document.createTextNode(label(row)));
      button.addEventListener('click', () => {
        if (hidden.has(index)) hidden.delete(index); else hidden.add(index);
        try {
          this.draw(config, data, selector, legendSelector, status, hidden);
          legend.querySelectorAll('button')[index]?.focus();
        } catch (error) {
          target.replaceChildren();
          status.textContent = error.message || String(error);
          status.setAttribute('data-error', '');
        }
      });
      legend.append(button);
    });
    const visible = config.series.map((row, index) => ({row, result: data[index], index})).filter(item => !hidden.has(item.index));
    status.removeAttribute('data-error');
    const warnings = data.some(result => result.truncated) ? 'Daten gekürzt.' : '';
    if (!visible.length) { status.textContent = 'Alle Datenreihen sind ausgeblendet.'; return; }
    if (config.chartType === 'pie') {
      const values = graphPieValues(visible.map(item => item.result), config.aggregation);
      const total = values.reduce((sum, value) => sum + (value ?? 0), 0);
      if (!Number.isFinite(total)) throw new Error('Tortensumme ist zu groß');
      if (total <= 0) { status.textContent = 'Keine positiven Werte im gewählten Zeitraum.'; return; }
      let angle = -Math.PI / 2;
      visible.forEach((item, index) => {
        const value = values[index];
        if (!value) return;
        const next = angle + value / total * Math.PI * 2;
        let shape;
        if (value === total) shape = svg('circle', {cx:200, cy:110, r:95, fill:item.row.color});
        else {
          const x1 = 200 + 95 * Math.cos(angle), y1 = 110 + 95 * Math.sin(angle);
          const x2 = 200 + 95 * Math.cos(next), y2 = 110 + 95 * Math.sin(next);
          shape = svg('path', {d:`M 200 110 L ${x1} ${y1} A 95 95 0 ${next-angle > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`, fill:item.row.color});
        }
        shape.append(svg('title', {}, `${label(item.row)}: ${value}`));
        target.append(shape);
        angle = next;
      });
      status.textContent = values.some(value => value === null) ? 'Einige Datenreihen enthalten keine Werte.' : warnings;
      return;
    }
    const points = visible.map(item => item.result.points || []);
    if (!points.some(row => row.length)) { status.textContent = 'Keine Werte im gewählten Zeitraum.'; return; }
    const stacked = config.chartType === 'stack' ? stackGraphSeries(points) : null;
    const times = points.flatMap(row => row.map(point => point[0]));
    let from = Math.min(...times), to = Math.max(...times);
    if (from === to) to = from + 1;
    let low = Infinity, high = -Infinity;
    for (const row of stacked || points) {
      for (const point of row) {
        if (point[1] === null) continue;
        low = Math.min(low, point[1], stacked ? point[2] : point[1]);
        high = Math.max(high, point[1], stacked ? point[2] : point[1]);
      }
    }
    if (low === high) { low -= 1; high += 1; }
    if (!Number.isFinite(high - low)) throw new Error('Wertebereich ist zu groß');
    const x = t => 42 + (t - from) / (to - from) * 348;
    const y = v => 190 - (v - low) / (high - low) * 175;
    for (let i = 0; i <= 4; i++) {
      const v = low + (high - low) * i / 4;
      target.append(svg('line', {x1:42, x2:390, y1:y(v), y2:y(v), stroke:'currentColor', opacity:.2}));
      target.append(svg('text', {x:38, y:y(v)+3, 'text-anchor':'end'}, Number(v.toPrecision(4))));
    }
    for (const [time, anchor] of [[from, 'start'], [to, 'end']]) {
      target.append(svg('text', {x:x(time), y:211, 'text-anchor':anchor},
        new Date(time * 1000).toLocaleString('de-DE', {timeZone:'Europe/Berlin', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})));
    }
    visible.forEach((item, index) => {
      if (stacked) {
        const row = stacked[index].filter(point => point[1] !== null);
        if (!row.length) return;
        const top = [], bottom = [];
        row.forEach((point, i) => {
          if (i) { top.push(`${x(point[0])},${y(row[i-1][2])}`); bottom.push(`${x(point[0])},${y(row[i-1][1])}`); }
          top.push(`${x(point[0])},${y(point[2])}`);
          bottom.push(`${x(point[0])},${y(point[1])}`);
        });
        target.append(svg('polygon', {points:[...top, ...bottom.reverse()].join(' '), fill:item.row.color, opacity:.6}));
      } else {
        const row = points[index];
        if (!row.length) return;
        target.append(svg('polyline', {points:row.map(point => `${x(point[0])},${y(point[1])}`).join(' '),
          fill:'none', stroke:item.row.color, 'stroke-width':2}));
        for (const point of row) {
          const circle = svg('circle', {cx:x(point[0]), cy:y(point[1]), r:3, fill:item.row.color});
          circle.append(svg('title', {}, `${label(item.row)}: ${point[1]} · ${new Date(point[0]*1000).toLocaleString('de-DE')}`));
          target.append(circle);
        }
      }
    });
    status.textContent = warnings || (points.some(row => !row.length) ? 'Einige Datenreihen enthalten keine Werte.' : '');
  }

  openConfig({isNew = false} = {}) {
    this.isNew = isNew;
    this.pickerAbort = new AbortController();
    const form = this.shadowRoot.querySelector('[data-form]');
    const config = this.widgetConfig;
    form.elements.title.value = config.title || '';
    form.elements.chartType.replaceChildren(...options(TYPES, config.chartType || 'line'));
    form.elements.aggregation.replaceChildren(...options({last:'Letzter Wert', average:'Durchschnitt'}, config.aggregation || 'last'));
    form.elements.range.replaceChildren(...options(RANGES, config.range || '24h'));
    form.elements.granularity.replaceChildren(...options(GRANULARITIES, config.granularity || 'auto'));
    this.shadowRoot.querySelector('[data-rows]').replaceChildren();
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    for (const row of config.series || []) this.addRow(row);
    if (!config.series?.length) this.addRow();
    showCmsModal(this.shadowRoot.querySelector('[data-dialog]'));
    this.queuePreview();
  }

  addRow(series = {}) {
    const container = this.shadowRoot.querySelector('[data-rows]');
    if (container.children.length >= 20) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Höchstens 20 Datenreihen sind möglich.';
      return;
    }
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label>Device<input data-device readonly placeholder="Device auswählen"></label>
      <button type="button" data-pick>Device auswählen …</button>
      <label>Reading<select data-reading><option value="">Reading wählen …</option></select></label>
      <label>Reading manuell (optional)<input data-manual-reading maxlength="128" placeholder="z. B. für ältere FileLogs"></label>
      <label>Quelle<select data-source></select></label>
      <label>Legende<input data-label maxlength="64"></label>
      <label>Farbe<input data-color type="color"></label>
      <button type="button" data-remove>Datenreihe entfernen</button><p class="status" data-row-status role="status"></p>`;
    const $ = selector => row.querySelector(selector);
    $('[data-device]').value = series.device || '';
    $('[data-label]').value = series.label || '';
    $('[data-color]').value = series.color || COLORS[container.children.length % COLORS.length];
    $('[data-source]').replaceChildren(...options(SOURCES, series.source || 'auto'));
    if (series.reading) $('[data-reading]').replaceChildren(...options({[series.reading]: series.reading}, series.reading));
    const pick = async () => {
      try {
        const device = await openDevicePicker({services:this.services, signal:this.pickerAbort.signal,
          classify: async entry => {
            try {
              const info = await this.services.logReadings(entry.name, 'auto');
              return info.readings.length > 0;
            } catch (error) {
              if (/^Kein DbLog- oder FileLog-Device gefunden/.test(error.message)) return false;
              throw error;
            }
          }});
        if (!device || !row.isConnected) return;
        $('[data-device]').value = device.name;
        $('[data-manual-reading]').value = '';
        await this.loadReadings(row);
      } catch (error) {
        $('[data-row-status]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message || String(error)}`;
      }
    };
    $('[data-pick]').addEventListener('click', pick);
    $('[data-device]').addEventListener('click', pick);
    $('[data-source]').addEventListener('change', () => this.loadReadings(row, $('[data-reading]').value));
    $('[data-remove]').addEventListener('click', () => { row.remove(); this.queuePreview(); });
    container.append(row);
    if (series.device) void this.loadReadings(row, series.reading);
    this.queuePreview();
  }

  async loadReadings(row, selected = '') {
    const device = row.querySelector('[data-device]').value;
    if (!isValidName(device)) return;
    const source = row.querySelector('[data-source]').value;
    const select = row.querySelector('[data-reading]');
    const status = row.querySelector('[data-row-status]');
    const revision = row.graphRevision = (row.graphRevision || 0) + 1;
    row.setAttribute('data-loading', '');
    select.replaceChildren(...options({'':'Reading wählen …'}, ''));
    status.textContent = 'Geloggte Readings werden geladen …';
    try {
      const result = await this.services.logReadings(device, source);
      if (!row.isConnected || revision !== row.graphRevision) return;
      const names = result.readings;
      const choices = { '': 'Reading wählen …' };
      for (const reading of names) choices[reading] = reading;
      if (selected && !names.includes(selected)) choices[selected] = `${selected} (nicht verfügbar)`;
      select.replaceChildren(...options(choices, selected));
      status.textContent = names.length ? `Quelle: ${SOURCES[result.source]}; ${names.length} Readings.`
        : result.source === 'filelog'
          ? 'Keine FileLog-Readings in den letzten 7 Tagen erkannt; ältere Readings können manuell eingegeben werden.'
          : 'Keine Datenlogs für dieses Device in der gewählten Quelle.';
    } catch (error) {
      if (!row.isConnected || revision !== row.graphRevision) return;
      select.replaceChildren(...options({'':'Reading wählen …'}, ''));
      status.textContent = `Logprüfung fehlgeschlagen: ${error.message || String(error)}`;
    }
    if (revision === row.graphRevision) row.removeAttribute('data-loading');
    this.queuePreview();
  }

  collect() {
    const form = this.shadowRoot.querySelector('[data-form]');
    if (this.shadowRoot.querySelector('.row[data-loading]')) throw new Error('Bitte warten, bis die Reading-Auswahl geladen ist.');
    const series = [...this.shadowRoot.querySelectorAll('.row')].map(row => ({
      device:row.querySelector('[data-device]').value.trim(),
      reading:row.querySelector('[data-manual-reading]').value.trim() || row.querySelector('[data-reading]').value,
      source:row.querySelector('[data-source]').value, label:row.querySelector('[data-label]').value.trim(),
      color:row.querySelector('[data-color]').value,
    }));
    const config = {...this.widgetConfig, title:form.elements.title.value.trim(), series,
      chartType:form.elements.chartType.value, aggregation:form.elements.aggregation.value,
      range:form.elements.range.value, granularity:form.elements.granularity.value};
    if (!config.title) delete config.title;
    validate(config);
    return config;
  }

  queuePreview() {
    window.clearTimeout(this.previewTimer);
    const request = ++this.previewRequest;
    this.previewTimer = window.setTimeout(() => this.updatePreview(request), 300);
  }

  async updatePreview(request) {
    const status = this.shadowRoot.querySelector('[data-preview-status]');
    try {
      const config = this.collect();
      status.textContent = 'Vorschau wird geladen …';
      status.removeAttribute('data-error');
      const data = await this.fetchData(config, () => request === this.previewRequest
        && this.isConnected && this.shadowRoot.querySelector('[data-dialog]').open);
      if (request !== this.previewRequest || !this.shadowRoot.querySelector('[data-dialog]').open) return;
      this.draw(config, data, '[data-preview]', '[data-preview-legend]', status, new Set());
    } catch (error) {
      if (request !== this.previewRequest) return;
      this.shadowRoot.querySelector('[data-preview]').replaceChildren();
      this.shadowRoot.querySelector('[data-preview-legend]').replaceChildren();
      status.textContent = `Vorschau: ${error.message || String(error)}`;
      status.setAttribute('data-error', '');
    }
  }

  async save() {
    const button = this.shadowRoot.querySelector('[data-save]');
    try {
      const config = this.collect();
      button.disabled = true;
      await this.services.saveWidget(config);
      this.isNew = false;
      this.closeConfig();
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Speichern fehlgeschlagen: ${error.message || String(error)}`;
    } finally { button.disabled = false; }
  }

  async deleteWidget() {
    if (!window.confirm('Diesen Graphen entfernen?')) return;
    try {
      await this.services.deleteWidget(this.widgetConfig.id);
      this.isNew = false;
      this.closeConfig();
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Entfernen fehlgeschlagen: ${error.message || String(error)}`;
    }
  }

  closeConfig() {
    this.previewRequest++;
    window.clearTimeout(this.previewTimer);
    this.pickerAbort.abort();
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) dialog.close();
    if (this.isNew) this.dispatchEvent(new CustomEvent('cms-widget-cancel', {bubbles:true}));
  }
}

if (!customElements.get('cms-graph')) customElements.define('cms-graph', FHEMCMSGraph);
