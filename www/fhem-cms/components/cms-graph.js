import { isValidName, customHistoryRange as customRange } from '../js/fhem-client.js';
import { graphPieValues, linearStackBands, stackGraphSeries } from '../js/graph-data.js';
import { openDevicePicker } from '../js/device-picker.js';
import { showCmsModal } from '../js/modal-dialog.js';
import { widgetDesignCss } from '../js/widget-design.js';
import { closeButtonSvg } from '../js/close-button.js';
import { createSpacebarPan, createTimePan } from '../js/pan-gesture.js';
import { unitInputCss, unitSuggestions } from '../js/unit-input.js';
import { formatDateDisplay } from '../js/date-display.js';

const COLORS = ['#3b82f6', '#f59e0b', '#22c55e', '#e879f9', '#ef4444', '#14b8a6'];
const SVG = 'http://www.w3.org/2000/svg';
const RANGES = { '24h': '24 Stunden', '7d': '7 Tage', '30d': '30 Tage', '365d': '365 Tage', custom:'Eigener Zeitraum' };
const GRANULARITIES = { auto: 'Automatisch', raw: 'Rohdaten', '15m': '15 Minuten', '1h': '1 Stunde', '1d': '1 Tag',
  '1w':'1 Woche', '1mo':'1 Monat', '1y':'1 Jahr' };
const TYPES = { line: 'Linien', stack: 'Gestapelt', pie: 'Torte' };
const AGGREGATIONS = {last:'Letzter Wert', average:'Durchschnitt', min:'Minimum', max:'Maximum'};
const SOURCES = { auto: 'Automatisch', dblog: 'DbLog', filelog: 'FileLog' };
const LINE_STYLES = {solid:'Durchgezogen', dashed:'Gestrichelt', dotted:'Gepunktet', points:'Nur Punkte'};
const FORMATS = {'':'Unverändert', int:'Ganzzahl (abschneiden)',
  ...Object.fromEntries(Array.from({length:7}, (_, digits) =>
    [`round(${digits})`, `Runden: ${digits} Nachkommastellen`]))};

function dateInput(timestamp) {
  const date = new Date(timestamp * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
}

function readRange(selection, from, to) {
  if (selection !== 'custom') return selection;
  const start = Date.parse(from), end = Date.parse(to);
  const range = `${Math.floor(start / 1000)}_${Math.floor(end / 1000)}`;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !customRange(range)) {
    throw new Error('Bitte einen gültigen Zeitraum von höchstens zehn Jahren auswählen.');
  }
  return range;
}

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

function formatValue(value, format) {
  if (format === 'int') return String(Math.trunc(value));
  const match = /^round\(([0-6])\)$/.exec(format || '');
  return match ? value.toFixed(Number(match[1])) : String(value);
}

function measurement(value, series) {
  return `${formatValue(value, series.format)}${series.unit ? ` ${series.unit}` : ''}`;
}

function decimalPlaces(value, format) {
  if (format === 'int') return 0;
  const match = /^round\(([0-6])\)$/.exec(format || '');
  if (match) return Number(match[1]);
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  return Math.min(100, Math.max(0, (mantissa.split('.')[1]?.length || 0) - Number(exponent)));
}

function timeFormatter(config, data, from, to) {
  const bounds = customRange(config.range || '');
  const starts = data.map(result => result.from).filter(Number.isFinite);
  const ends = data.map(result => result.to).filter(Number.isFinite);
  const duration = { '24h':86400, '7d':604800, '30d':2592000, '365d':31536000 }[config.range];
  const end = bounds?.[1] ?? (ends.length ? Math.max(...ends) : to);
  const start = bounds?.[0] ?? (duration ? end - duration : starts.length ? Math.min(...starts) : from);
  const zone = {timeZone:'Europe/Berlin'};
  const year = new Intl.DateTimeFormat('de-DE', {...zone, year:'numeric'});
  const crossesYear = year.format(start * 1000) !== year.format(end * 1000);
  const date = {day:'2-digit', month:'2-digit', ...(crossesYear ? {year:'numeric'} : {})};
  const clock = {hour:'2-digit', minute:'2-digit', hourCycle:'h23'};
  const span = end - start;
  const axis = new Intl.DateTimeFormat('de-DE', {...zone,
    ...(span <= 86400 ? clock : span <= 604800 ? {...date, ...clock} : date)});
  return {axis};
}

function validate(config) {
  if (!Array.isArray(config.series) || config.series.length < 1 || config.series.length > 20) {
    throw new Error('Bitte eine bis 20 Datenreihen auswählen.');
  }
  if (!Object.hasOwn(TYPES, config.chartType) || (!Object.hasOwn(RANGES, config.range) && !customRange(config.range))
    || config.range === 'custom'
    || !Object.hasOwn(GRANULARITIES, config.granularity) || !Object.hasOwn(AGGREGATIONS, config.aggregation)) {
    throw new Error('Ungültige Diagrammeinstellung');
  }
  if ((config.title || '').length > 64 || /[\u0000-\u001f\u007f]/.test(config.title || '')) throw new Error('Ungültiger Titel');
  if (config.showPieLabels !== undefined && typeof config.showPieLabels !== 'boolean') {
    throw new Error('Ungültige Tortenbeschriftung');
  }
  if (config.stackLinear !== undefined && typeof config.stackLinear !== 'boolean') {
    throw new Error('Ungültige Stapeldarstellung');
  }
  for (const [index, row] of config.series.entries()) {
    const name = isValidName(row.device) ? row.device : `Datenreihe ${index + 1}`;
    if (!isValidName(row.device)) throw new Error(`${name}: Bitte ein gültiges Device auswählen.`);
    if (!isValidName(row.reading)) throw new Error(`${name}: Bitte ein verfügbares geloggtes Reading auswählen.`);
    if (!Object.hasOwn(SOURCES, row.source)) throw new Error(`${name}: Ungültige Logquelle.`);
    if (typeof row.label !== 'string' || row.label.length > 64 || /[\u0000-\u001f\u007f]/.test(row.label))
      throw new Error(`${name}: Ungültiger Legendentext.`);
    if (row.unit !== undefined && (typeof row.unit !== 'string' || row.unit.length < 1
      || row.unit.length > 16 || /[\u0000-\u001f\u007f]/.test(row.unit)))
      throw new Error(`${name}: Ungültige Einheit (höchstens 16 Zeichen, keine Steuerzeichen).`);
    if (!/^#[a-fA-F0-9]{6}$/.test(row.color)) throw new Error(`${name}: Ungültige Farbe.`);
    if (!['left','right'].includes(row.axis || 'left')) throw new Error(`${name}: Ungültige Achse.`);
    if (!Object.hasOwn(LINE_STYLES, row.lineStyle || 'solid')) throw new Error(`${name}: Ungültiger Linientyp.`);
    if (!Number.isInteger(row.lineWidth ?? 4) || (row.lineWidth ?? 4) < 1 || (row.lineWidth ?? 4) > 10)
      throw new Error(`${name}: Linienstärke muss zwischen 1 und 10 liegen.`);
    if (row.format !== undefined && (typeof row.format !== 'string' || !/^(?:|int|round\([0-6]\))$/.test(row.format)))
      throw new Error(`${name}: Ungültiges Werteformat.`);
    if (row.fill !== undefined && typeof row.fill !== 'boolean') throw new Error(`${name}: Ungültige Flächenfüllung.`);
  }
}

class FHEMCMSGraph extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'});
    this.request = 0;
    this.previewRequest = 0;
    this.hiddenSeries = new Set();
    this.drawStates = new Map();
    this.pickerAbort = new AbortController();
    this.rowSequence = 0;
  }

  connectedCallback() {
    if (!this.shadowRoot.childElementCount) this.initialize();
    this.render();
    void this.load();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          const selector = entry.target.hasAttribute('data-svg') ? '[data-svg]' : '[data-preview]';
          const state = this.drawStates.get(selector);
          if (state && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            this.draw(state.config, state.data, selector, state.legendSelector, state.status, state.hidden);
          }
        }
      });
      this.resizeObserver.observe(this.shadowRoot.querySelector('[data-svg]'));
      this.resizeObserver.observe(this.shadowRoot.querySelector('[data-preview]'));
    }
    this.panController = createSpacebarPan(this.shadowRoot.querySelector('[data-svg]').parentElement);
    this.timer = window.setInterval(() => this.load(), 300000);
  }

  disconnectedCallback() {
    this.timePan?.dispose();
    this.timePan = null;
    this.request++;
    this.previewRequest++;
    this.pickerAbort.abort();
    this.resizeObserver?.disconnect();
    this.drawStates.clear();
    this.panController?.dispose();
    this.panController = null;
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
        [data-grid] svg { width:20px; height:20px; display:block; fill:none; stroke:currentColor; stroke-width:1.6; }
        :host([view-only]) [data-open-config] { display:none; }
        .plot { position:relative; flex:1; min-height:10rem; border-radius:.75rem; background:rgba(128,128,128,.08); }
        .plot svg { width:100%; height:100%; position:absolute; inset:0; touch-action:pan-y;
          -webkit-user-select:none; user-select:none; }
        .plot.pan-ready svg { cursor:grab; }
        .plot.panning svg { cursor:grabbing; }
        .plot .spinner { position:absolute; inset:0; display:grid; place-items:center; pointer-events:none; }
        .plot .spinner::after { content:''; width:2.2rem; height:2.2rem; border-radius:50%;
          border:4px solid var(--cms-border); border-top-color:var(--cms-accent);
          animation:cms-graph-spin .8s linear infinite; }
        @keyframes cms-graph-spin { to { transform:rotate(360deg); } }
        svg text { fill:currentColor; font-size:10px; }
        .legend { display:flex; flex-wrap:wrap; gap:.25rem; }
        .legend button { display:flex; align-items:center; gap:.35rem; min-height:36px; border:0; background:transparent; }
        .legend button[aria-pressed="false"] { opacity:.5; text-decoration:line-through; }
        .swatch { width:2rem; height:.4rem; border-radius:1rem; flex:none; }
        header .controls { display:flex; flex-wrap:wrap; justify-content:flex-end; align-items:center;
          gap:.5rem; min-width:0; margin-left:auto; }
        header select { max-width:100%; min-width:0; }
        header .controls select { font-size:.85rem; }
        .graph-tooltip { position:absolute; z-index:2; pointer-events:none; padding:.4rem .6rem; border:1px solid var(--cms-border);
          border-radius:.6rem; background:var(--cms-surface); color:var(--cms-text); font-size:.8rem; line-height:1.3;
          max-width:100%; overflow-wrap:anywhere; }
        .graph-tooltip div { display:flex; align-items:center; gap:.55rem; }
        .graph-tooltip i { width:.9rem; height:.9rem; border-radius:.2rem; flex:none; }
        [data-tooltip] { font-size:max(.8rem, calc(.8rem / var(--cms-freeform-scale, 1)));
          padding:max(.4rem, calc(.4rem / var(--cms-freeform-scale, 1)))
            max(.6rem, calc(.6rem / var(--cms-freeform-scale, 1))); }
        .status { margin:0; color:var(--cms-muted); }
        .status[data-error] { color:var(--cms-danger); }
        .updated { margin:0; color:var(--cms-muted); font-size:.8rem; overflow-wrap:anywhere; }
        dialog { width:min(94vw,48rem); max-height:94vh; overflow:auto; padding:1rem; color:var(--cms-text);
          background:var(--cms-surface); border:1px solid var(--cms-border); border-radius:1rem; }
        dialog::backdrop { background:var(--cms-backdrop); }
        form { display:grid; gap:.7rem; }
        label { display:grid; gap:.2rem; }
        .settings { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:.75rem; }
        .granularity-grid { grid-column:span 2; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.75rem; }
        .axis-settings { grid-template-columns:repeat(3,minmax(0,1fr)); }
        @media (max-width:600px) {
          .settings { grid-template-columns:repeat(2,minmax(0,1fr)); }
          .axis-settings { grid-template-columns:1fr; }
        }
        form label { min-width:0; }
        [data-stack-linear] { grid-column:1 / -1; }
        [data-stack-linear] label { display:flex; align-items:center; gap:.5rem; }
        [data-stack-linear] small { display:block; margin-top:.25rem; }
        form input:not([type=checkbox]), form select { width:100%; min-width:0; height:40px; }
        form input[type=checkbox] { width:24px; height:24px; justify-self:start; }
        .row { display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:.5rem;
          position:relative; align-items:start; padding:.7rem 3.8rem .7rem .7rem; border:1px solid var(--cms-border); border-radius:.5rem; }
        .row .device-group { grid-column:1 / -1; display:grid;
          grid-template-columns:repeat(auto-fit,minmax(min(9rem,100%),1fr)); gap:.3rem .5rem; }
        .row [data-pick], form input[data-device] { height:44px; }
        .row [data-pick] { min-width:0; width:100%; align-self:end; }
        .row input[type=color] { padding:.2rem; }
        .row input[type=color]::-webkit-color-swatch-wrapper { padding:0; }
        .row input[type=color]::-webkit-color-swatch { border:0; border-radius:.3rem; }
        .row [data-remove] { position:absolute; right:.35rem; top:.35rem; width:48px; height:48px; padding:0; display:grid; place-items:center; }
        .row [data-remove] svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; }
        .row [data-row-status] { grid-column:1 / -1; min-width:0; white-space:normal; overflow-wrap:anywhere; }
        .row .line-controls { grid-column:1 / -1; display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:.5rem; }
        .row .line-controls label:has([data-color]) { max-width:12rem; }
        .row .unit-field { grid-column:1 / -1; min-width:0; }
        .row .unit-entry { display:flex; align-items:start; gap:.5rem; }
        .row .unit-entry input { flex:0 1 9rem; width:auto; }
        .row .unit-entry [data-unit-choices] { flex:1; min-width:0; }
        .actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.5rem; }
        .preview { height:16rem; flex:none; }
        [hidden] { display:none !important; }
        ${unitInputCss}
        ${widgetDesignCss}
      </style>
      <article class="tile" data-tile><header><h3 data-title></h3>
        <div class="controls"><select data-range aria-label="Zeitraum"></select>
        <select data-granularity aria-label="Granularität"></select>
        <select data-live-aggregation aria-label="Tortenwerte"></select>
        <button type="button" data-grid aria-label="Raster ein- oder ausblenden" title="Raster ein- oder ausblenden"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18"/></svg></button></div>
        <button type="button" data-open-config>Konfigurieren</button></header>
        <div data-live-custom hidden><input type="datetime-local" step="1" data-live-from aria-label="Zeitraum von">
          <input type="datetime-local" step="1" data-live-to aria-label="Zeitraum bis"><button type="button" data-live-apply>Übernehmen</button></div>
        <div class="plot"><svg data-svg viewBox="0 0 400 220" preserveAspectRatio="none" role="img" aria-label="Graph"></svg><div class="graph-tooltip" data-tooltip hidden></div><div class="spinner" data-spinner hidden></div></div>
        <div class="legend" data-legend></div><p class="status" data-status role="status"></p>
        <p class="updated" data-updated>Letzte Aktualisierung: –</p></article>
      <dialog data-dialog aria-label="Graph konfigurieren"><form data-form novalidate>
        <h3>Graph konfigurieren</h3>
        <label>Titel<input name="title" maxlength="64"></label>
        <div class="settings">
          <label>Diagrammtyp<select name="chartType"></select></label>
          <label>Zeitraum<select name="range"></select></label>
          <div class="granularity-grid">
            <label>Granularität<select name="granularity"></select></label>
            <label>Raster anzeigen<input type="checkbox" name="showGrid"></label>
          </div>
          <label data-aggregation>Tortenwerte<select name="aggregation"></select></label>
          <label data-pie-labels>Bezeichner und Wert im Tortenstück einblenden<input type="checkbox" name="showPieLabels"></label>
          <div data-stack-linear><label><input type="checkbox" name="stackLinear">Messpunkte linear verbinden</label>
            <small>Zum dauerhaften Speichern ist das aktuelle FHEMCMS-Backend erforderlich.</small></div>
          <label data-config-from hidden>Von<input type="datetime-local" step="1" name="from"></label>
          <label data-config-to hidden>Bis<input type="datetime-local" step="1" name="to"></label>
        </div>
        <div class="settings axis-settings">
          <label>X-Achse<input name="axisLabelX" maxlength="64"></label>
          <label>Y-Achse links<input name="axisLabelLeft" maxlength="64"></label>
          <label>Y-Achse rechts<input name="axisLabelRight" maxlength="64"></label>
        </div>
        <section data-rows></section>
        <button type="button" data-add>Datenreihe hinzufügen</button>
        <strong>Vorschau</strong><div class="plot preview"><svg data-preview viewBox="0 0 400 220" preserveAspectRatio="none" role="img" aria-label="Graph-Vorschau"></svg><div class="graph-tooltip" data-preview-tooltip hidden></div><div class="spinner" data-preview-spinner hidden></div></div>
        <div class="legend" data-preview-legend></div><p class="status" data-preview-status role="status"></p>
        <p class="updated" data-preview-updated>Letzte Aktualisierung: –</p>
        <p class="status" data-error role="alert"></p>
        <div class="actions"><button type="button" data-delete>Widget löschen</button><button type="button" data-cancel>Abbrechen</button>
          <button type="submit" data-save>Speichern</button></div>
      </form></dialog>`;
    const $ = selector => this.shadowRoot.querySelector(selector);
    $('[data-open-config]').addEventListener('click', () => this.openConfig());
    $('[data-range]').addEventListener('change', event => {
      $('[data-live-custom]').hidden = event.target.value !== 'custom';
      if (event.target.value !== 'custom') { this.range = event.target.value; void this.load(); }
    });
    $('[data-live-apply]').addEventListener('click', () => {
      try {
        this.range = readRange('custom', $('[data-live-from]').value, $('[data-live-to]').value);
        void this.load();
      } catch (error) {
        $('[data-status]').textContent = error.message;
        $('[data-status]').setAttribute('data-error', '');
      }
    });
    $('[data-granularity]').addEventListener('change', event => { this.granularity = event.target.value; void this.load(); });
    $('[data-live-aggregation]').addEventListener('change', event => {
      this.aggregation = event.target.value;
      void this.load();
    });
    $('[data-grid]').addEventListener('click', () => {
      this.showGrid = !this.showGrid;
      $('[data-grid]').setAttribute('aria-pressed', String(this.showGrid));
      void this.load();
    });
    $('[data-add]').addEventListener('click', () => this.addRow());
    $('[data-cancel]').addEventListener('click', () => this.closeConfig());
    $('[data-delete]').addEventListener('click', () => this.deleteWidget());
    $('[data-dialog]').addEventListener('cancel', event => { event.preventDefault(); this.closeConfig(); });
    $('[data-form]').addEventListener('submit', event => { event.preventDefault(); void this.save(); });
    $('[data-form]').addEventListener('change', () => {
      $('[data-aggregation]').hidden = $('[data-form]').elements.chartType.value !== 'pie';
      $('[data-pie-labels]').hidden = $('[data-form]').elements.chartType.value !== 'pie';
      $('[data-stack-linear]').hidden = $('[data-form]').elements.chartType.value !== 'stack';
      this.updateRowControls();
      $('[data-config-from]').hidden = $('[data-config-to]').hidden = $('[data-form]').elements.range.value !== 'custom';
      this.queuePreview();
    });
    $('[data-form]').addEventListener('input', () => this.queuePreview());
  }

  render() {
    const config = this.widgetConfig;
    if (!config) return;
    this.range = config.range || '24h';
    this.granularity = config.granularity || 'auto';
    this.aggregation = config.aggregation || 'last';
    this.showGrid = config.showGrid !== false;
    const title = this.shadowRoot.querySelector('[data-title]');
    title.textContent = config.showTitle === false ? '' : config.title || '';
    title.hidden = !title.textContent;
    const bounds = customRange(this.range);
    this.shadowRoot.querySelector('[data-range]').replaceChildren(...options(RANGES, bounds ? 'custom' : this.range));
    this.shadowRoot.querySelector('[data-granularity]').replaceChildren(...options(GRANULARITIES, this.granularity));
    const aggregation = this.shadowRoot.querySelector('[data-live-aggregation]');
    aggregation.replaceChildren(...options(AGGREGATIONS, this.aggregation));
    aggregation.hidden = config.chartType !== 'pie';
    this.shadowRoot.querySelector('[data-grid]').setAttribute('aria-pressed', String(this.showGrid));
    this.shadowRoot.querySelector('[data-live-custom]').hidden = !bounds;
    if (bounds) {
      this.shadowRoot.querySelector('[data-live-from]').value = dateInput(bounds[0]);
      this.shadowRoot.querySelector('[data-live-to]').value = dateInput(bounds[1]);
    }
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
    const spinner = this.shadowRoot.querySelector('[data-spinner]');
    status.textContent = 'Daten werden geladen …';
    status.removeAttribute('data-error');
    spinner.hidden = false;
    try {
      const current = {...config, range:this.range, granularity:this.granularity,
        aggregation:this.aggregation, showGrid:this.showGrid};
      validate(current);
      const data = await this.fetchData(current, () => request === this.request && this.isConnected);
      if (request !== this.request || !this.isConnected) return;
      this.currentData = data;
      this.draw(current, data, '[data-svg]', '[data-legend]', status, this.hiddenSeries);
      this.markUpdated('[data-updated]');
    } catch (error) {
      if (request !== this.request || !this.isConnected) return;
      this.shadowRoot.querySelector('[data-svg]').replaceChildren();
      this.shadowRoot.querySelector('[data-legend]').replaceChildren();
      this.drawStates.delete('[data-svg]');
      status.textContent = `Graph konnte nicht geladen werden: ${error.message || String(error)}`;
      status.setAttribute('data-error', '');
    } finally {
      if (request === this.request) spinner.hidden = true;
    }
  }

  markUpdated(selector) {
    const timestamp = formatDateDisplay(new Date().toISOString()).replace(' ', ' - ');
    this.shadowRoot.querySelector(selector).textContent = `Letzte Aktualisierung: ${timestamp}`;
  }

  draw(config, data, selector, legendSelector, status, hidden) {
    const target = this.shadowRoot.querySelector(selector);
    const legend = this.shadowRoot.querySelector(legendSelector);
    this.drawStates.set(selector, {config, data, legendSelector, status, hidden});
    const width = Math.max(120, Math.min(5000, target.clientHeight ? 220 * target.clientWidth / target.clientHeight : 400));
    target.setAttribute('viewBox', `0 0 ${width} 220`);
    target.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    target.onpointermove = target.onpointerleave = target.onpointerdown = target.onpointerup = target.onpointercancel = null;
    target.style.transform = '';
    if (selector === '[data-svg]') {
      this.timePan?.dispose();
      this.timePan = null;
      this.panController?.stop();
    }
    const tooltip = target.parentElement.querySelector('.graph-tooltip');
    tooltip.hidden = true;
    const positionTooltip = event => {
      tooltip.hidden = false;
      const box = target.getBoundingClientRect();
      const localX = (event.clientX - box.left) * target.clientWidth / box.width;
      // Left plot half: tooltip right of the crosshair; right half: left of it.
      const preferred = localX < target.clientWidth / 2 ? localX + 12 : localX - 12 - tooltip.offsetWidth;
      tooltip.style.left = `${Math.max(0, Math.min(target.clientWidth - tooltip.offsetWidth, preferred))}px`;
      tooltip.style.top = '8px';
    };
    target.replaceChildren();
    legend.replaceChildren();
    config.series.forEach((row, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(!hidden.has(index)));
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.backgroundColor = row.color;
      button.append(swatch, document.createTextNode(`${label(row)}${row.unit ? ` (${row.unit})` : ''}`));
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
      if (values.every(value => value === null || value <= 0)) {
        target.append(svg('circle', {cx:width/2, cy:110, r:Math.min(95, width / 2 - 5),
          fill:'none', stroke:'currentColor', 'stroke-width':2, 'data-empty-pie':''}));
        status.textContent = 'Keine positiven Werte im gewählten Zeitraum.';
        return;
      }
      if (values.some(value => value !== null && value < 0)) throw new Error('Tortendiagramme benötigen nichtnegative Werte');
      const total = values.reduce((sum, value) => sum + (value ?? 0), 0);
      if (!Number.isFinite(total)) throw new Error('Tortensumme ist zu groß');
      if (total <= 0) { status.textContent = 'Keine positiven Werte im gewählten Zeitraum.'; return; }
      let angle = -Math.PI / 2;
      const radius = Math.min(95, width / 2 - 5);
      const labels = [];
      visible.forEach((item, index) => {
        const value = values[index];
        if (!value) return;
        const next = angle + value / total * Math.PI * 2;
        let shape;
        if (value === total) shape = svg('circle', {cx:width/2, cy:110, r:radius, fill:item.row.color});
        else {
          const x1 = width/2 + radius * Math.cos(angle), y1 = 110 + radius * Math.sin(angle);
          const x2 = width/2 + radius * Math.cos(next), y2 = 110 + radius * Math.sin(next);
          shape = svg('path', {d:`M ${width/2} 110 L ${x1} ${y1} A ${radius} ${radius} 0 ${next-angle > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`, fill:item.row.color});
        }
        const description = `${label(item.row)}: ${measurement(value, item.row)}`;
        shape.setAttribute('aria-label', description);
        const showSlice = event => {
          tooltip.textContent = description;
          positionTooltip(event);
        };
        shape.onpointermove = showSlice;
        shape.onpointerup = event => { if (event.pointerType === 'touch') showSlice(event); };
        shape.onpointerleave = event => { if (event?.pointerType !== 'touch') tooltip.hidden = true; };
        shape.onpointercancel = () => { tooltip.hidden = true; };
        target.append(shape);
        if (config.showPieLabels !== false) {
          const middle = (angle + next) / 2;
          const full = value === total;
          const sine = Math.sin(Math.min((next - angle) / 2, Math.PI / 2));
          // An inscribed circle keeps both text lines inside even narrow segments.
          const distance = full ? 0 : radius / (1 + sine);
          const available = full ? radius : radius * sine / (1 + sine);
          const cx = width / 2 + distance * Math.cos(middle);
          const cy = 110 + distance * Math.sin(middle);
          const text = svg('text', {'text-anchor':'middle', 'dominant-baseline':'central',
            'data-pie-label':'', 'pointer-events':'none', 'aria-hidden':'true'});
          const channels = item.row.color.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
            .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
          text.style.fill = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? '#000' : '#fff';
          text.append(svg('tspan', {x:0, y:-6}, label(item.row)),
            svg('tspan', {x:0, y:6}, measurement(value, item.row)));
          labels.push({text, cx, cy, available});
        }
        angle = next;
      });
      for (const {text, cx, cy, available} of labels) {
        target.append(text);
        const box = text.getBBox();
        const scale = Math.min(1, available * 1.8 / Math.hypot(box.width, box.height));
        text.setAttribute('transform', `translate(${cx} ${cy}) scale(${scale}) translate(${-box.x-box.width/2} ${-box.y-box.height/2})`);
      }
      status.textContent = values.some(value => value === null) ? 'Einige Datenreihen enthalten keine Werte.' : warnings;
      return;
    }
    const points = visible.map(item => item.result.points || []);
    if (!points.some(row => row.length)) {
      status.textContent = 'Keine Werte im gewählten Zeitraum.';
      const bounds = customRange(config.range);
      if (selector === '[data-svg]' && bounds) this.timePan = createTimePan(target, {
        controller:this.panController,
        bounds:() => bounds,
        plotWidth:() => target.getBoundingClientRect().width * (width - 48) / width,
        commit:(start, end) => this.applyCustomRange(`${start}_${end}`),
      });
      return;
    }
    let stacked = null;
    let stackBands = null;
    if (config.chartType === 'stack') {
      stacked = new Array(points.length);
      if (config.stackLinear) stackBands = new Array(points.length);
      for (const axis of ['left', 'right']) {
        const indexes = visible.map((item, index) => (item.row.axis || 'left') === axis ? index : -1).filter(index => index >= 0);
        const groups = stackGraphSeries(indexes.map(index => points[index]), config.stackLinear === true);
        indexes.forEach((index, i) => {
          stacked[index] = groups[i];
          if (stackBands) stackBands[index] = linearStackBands(groups, i);
        });
      }
    }
    const times = points.flatMap(row => row.map(point => point[0]));
    let from = Math.min(...times), to = Math.max(...times);
    const requested = customRange(config.range);
    const starts = data.map(result => result.from).filter(Number.isFinite);
    const ends = data.map(result => result.to).filter(Number.isFinite);
    if (requested) [from, to] = requested;
    else if (starts.length && ends.length && Math.max(...ends) > Math.min(...starts)) {
      from = Math.min(...starts);
      to = Math.max(...ends);
    }
    if (from === to) to = from + 1;
    const timeFormat = timeFormatter(config, data, from, to);
    const formatAxisTime = time => timeFormat.axis.format(time * 1000);
    const tooltipTime = new Intl.DateTimeFormat('de-DE', {timeZone:'Europe/Berlin',
      day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
    const formatTime = time => tooltipTime.format(time * 1000);
    const limits = {left:{low:Infinity, high:-Infinity}, right:{low:Infinity, high:-Infinity}};
    (stacked || points).forEach((row, index) => {
      const axis = limits[visible[index].row.axis || 'left'];
      for (const point of row) {
        if (point[1] === null) continue;
        axis.low = Math.min(axis.low, point[1], stacked ? point[2] : point[1]);
        axis.high = Math.max(axis.high, point[1], stacked ? point[2] : point[1]);
      }
    });
    for (const axis of Object.values(limits)) {
      if (axis.low === Infinity) continue;
      if (axis.low === axis.high) { axis.low -= 1; axis.high += 1; }
      if (!Number.isFinite(axis.high - axis.low)) throw new Error('Wertebereich ist zu groß');
    }
    const axisFormats = Object.fromEntries(['left','right'].map(axis =>
      [axis, visible.find(item => (item.row.axis || 'left') === axis)?.row.format || '']));
    const ticks = {left:[], right:[]};
    for (const axis of ['left','right']) {
      if (limits[axis].low === Infinity) continue;
      for (let i = 0; i <= 4; i++) {
        const v = limits[axis].low + (limits[axis].high - limits[axis].low) * i / 4;
        const text = svg('text', {y:193 - 175 * i / 4, 'text-anchor':axis === 'left' ? 'end' : 'start',
          'data-axis-tick':axis}, axisFormats[axis] ? formatValue(v, axisFormats[axis]) : Number(v.toPrecision(4)));
        target.append(text);
        ticks[axis].push(text);
      }
    }
    const tickWidth = axis => Math.max(0, ...ticks[axis].map(text => text.getComputedTextLength()));
    const leftMargin = Math.max(44, tickWidth('left') + 8) + (config.axisLabelLeft ? 16 : 0);
    const rightMargin = (ticks.right.length ? Math.max(44, tickWidth('right') + 8) : 4)
      + (config.axisLabelRight ? 16 : 0);
    const marginScale = Math.min(1, (width - 20) / (leftMargin + rightMargin));
    const left = leftMargin * marginScale, right = width - rightMargin * marginScale;
    for (const axis of ['left','right']) {
      for (const text of ticks[axis]) {
        text.setAttribute('x', axis === 'left' ? left-4 : right+4);
        if (marginScale < 1) text.style.fontSize = `${10 * marginScale}px`;
      }
    }
    const x = t => left + (t - from) / (to - from) * (right - left);
    const y = (v, axis = 'left') => 190 - (v - limits[axis].low) / (limits[axis].high - limits[axis].low) * 175;
    for (let i = 0; i <= 4; i++) {
      const position = 190 - 175 * i / 4;
      if (config.showGrid !== false) target.append(svg('line', {x1:left, x2:right, y1:position, y2:position, stroke:'currentColor', opacity:.2}));
    }
    if (config.showGrid !== false) {
      for (let i = 0; i <= 4; i++) {
        const px = left + (right-left) * i / 4;
        target.append(svg('line', {x1:px, x2:px, y1:15, y2:190, stroke:'currentColor', opacity:.2}));
      }
    }
    for (const [axis, title, px, angle] of [
      ['left', config.axisLabelLeft, 10 * marginScale, -90],
      ['right', config.axisLabelRight, width - 10 * marginScale, 90],
    ]) {
      if (!title) continue;
      const text = svg('text', {x:px, y:102.5, 'text-anchor':'middle',
        transform:`rotate(${angle} ${px} 102.5)`, 'data-axis-label':axis}, title);
      if (marginScale < 1) text.style.fontSize = `${10 * marginScale}px`;
      target.append(text);
      if (text.getComputedTextLength() > 175) {
        text.setAttribute('textLength', '175');
        text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
    }
    if (config.axisLabelX) target.append(svg('text', {x:(left+right)/2, y:219, 'text-anchor':'middle'}, config.axisLabelX));
    const tickCount = Math.max(2, Math.min(5, Math.floor((right - left) / 80) + 1));
    for (let i = 0; i < tickCount; i++) {
      const time = from + (to - from) * i / (tickCount - 1);
      target.append(svg('text', {x:x(time), y:211, 'text-anchor':i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle',
        'data-time-tick':''}, formatAxisTime(time)));
    }
    visible.forEach((item, index) => {
      const axis = item.row.axis || 'left';
      const valueY = value => y(value, axis);
      if (stacked) {
        for (const row of stackBands ? stackBands[index] : [stacked[index].filter(point => point[1] !== null)]) {
          if (!row.length) continue;
          const top = [], bottom = [];
          row.forEach((point, i) => {
            if (i && !config.stackLinear) { top.push(`${x(point[0])},${valueY(row[i-1][2])}`); bottom.push(`${x(point[0])},${valueY(row[i-1][1])}`); }
            top.push(`${x(point[0])},${valueY(point[2])}`);
            bottom.push(`${x(point[0])},${valueY(point[1])}`);
          });
          target.append(svg('polygon', {points:[...top, ...bottom.reverse()].join(' '), fill:item.row.color, opacity:.6}));
        }
      } else {
        const row = points[index];
        if (!row.length) return;
        if (item.row.fill) {
          const base = Math.max(limits[axis].low, Math.min(0, limits[axis].high));
          target.append(svg('polygon', {points:`${x(row[0][0])},${valueY(base)} ${row.map(point => `${x(point[0])},${valueY(point[1])}`).join(' ')} ${x(row[row.length-1][0])},${valueY(base)}`,
            fill:item.row.color, opacity:.22}));
        }
        const style = item.row.lineStyle || 'solid';
        if (style !== 'points') target.append(svg('polyline', {points:row.map(point => `${x(point[0])},${valueY(point[1])}`).join(' '),
          fill:'none', stroke:item.row.color, 'stroke-width':item.row.lineWidth ?? 4, 'vector-effect':'non-scaling-stroke',
          ...(style === 'dashed' ? {'stroke-dasharray':'8 5'} : style === 'dotted' ? {'stroke-dasharray':'2 4'} : {})}));
        for (const point of row) {
          const circle = svg('circle', {cx:x(point[0]), cy:valueY(point[1]), r:style === 'points' ? 3 : 1, fill:item.row.color,
            'aria-label':`${label(item.row)}: ${measurement(point[1], item.row)} · ${formatTime(point[0])}`});
          target.append(circle);
        }
      }
    });
    const crosshair = svg('line', {y1:15, y2:190, stroke:'currentColor', 'stroke-dasharray':'3 3', hidden:''});
    const selection = svg('rect', {y:15, height:175, fill:'currentColor', opacity:.15, hidden:''});
    target.append(crosshair, selection);
    const live = selector === '[data-svg]';
    const panController = live ? this.panController : null;
    let dragStart = null, dragStartX = null;
    const position = event => {
      const box = target.getBoundingClientRect();
      return Math.max(left, Math.min(right, (event.clientX - box.left) * width / box.width));
    };
    const timestamp = px => from + (px-left) / (right-left) * (to-from);
    const rangeWindow = () => {
      const bounds = customRange(config.range);
      if (bounds) return bounds;
      const starts = data.map(result => result.from).filter(Number.isFinite);
      const ends = data.map(result => result.to).filter(Number.isFinite);
      if (starts.length && ends.length && Math.max(...ends) > Math.min(...starts)) {
        return [Math.min(...starts), Math.max(...ends)];
      }
      const duration = {'24h':86400, '7d':604800, '30d':2592000, '365d':31536000}[config.range] || (to - from);
      const end = Math.floor(Date.now() / 1000);
      return [end - duration, end];
    };
    const showValues = event => {
      const px = position(event);
      crosshair.removeAttribute('hidden');
      crosshair.setAttribute('x1', px);
      crosshair.setAttribute('x2', px);
      tooltip.replaceChildren();
      const header = document.createElement('strong');
      tooltip.append(header);
      const totals = new Map();
      let latest = -Infinity;
      visible.forEach((item, index) => {
        const row = points[index];
        if (!row.length) return;
        const nearest = row.reduce((best, point) => Math.abs(point[0] - timestamp(px)) < Math.abs(best[0] - timestamp(px)) ? point : best);
        const entry = document.createElement('div'), swatch = document.createElement('i');
        swatch.style.backgroundColor = item.row.color;
        latest = Math.max(latest, nearest[0]);
        entry.append(swatch, document.createTextNode(`${label(item.row)}: ${measurement(nearest[1], item.row)}`));
        tooltip.append(entry);
        const axis = item.row.axis || 'left', unit = item.row.unit || '';
        const key = JSON.stringify([axis, unit]);
        const group = totals.get(key) || {unit, value:0, digits:0, truncate:true};
        group.value += nearest[1];
        group.digits = Math.max(group.digits, decimalPlaces(nearest[1], item.row.format));
        group.truncate &&= item.row.format === 'int';
        totals.set(key, group);
      });
      if (Number.isFinite(latest)) header.textContent = formatTime(latest);
      for (const group of totals.values()) {
        const sum = document.createElement('div');
        sum.dataset.graphTotal = '';
        const value = Number.isFinite(group.value)
          ? group.truncate ? String(Math.trunc(group.value)) : group.value.toFixed(group.digits)
          : 'zu groß';
        sum.textContent = `∑: ${value}${group.unit ? ` ${group.unit}` : ''}`;
        tooltip.append(sum);
      }
      positionTooltip(event);
    };
    target.onpointermove = event => {
      if (dragStart !== null) {
        const px = position(event);
        selection.removeAttribute('hidden');
        selection.setAttribute('x', Math.min(px, dragStart));
        selection.setAttribute('width', Math.abs(px-dragStart));
        return;
      }
      showValues(event);
    };
    target.onpointerleave = event => {
      if (dragStart === null && event?.pointerType !== 'touch') {
        crosshair.setAttribute('hidden', '');
        tooltip.hidden = true;
      }
    };
    target.onpointerdown = live ? event => {
      if (event.button !== 0) return;
      dragStart = position(event);
      dragStartX = event.clientX;
      target.setPointerCapture(event.pointerId);
      tooltip.hidden = true;
    } : null;
    target.onpointerup = event => {
      if (dragStart === null) {
        if (selector !== '[data-svg]' && event.pointerType === 'touch') showValues(event);
        return;
      }
      const end = position(event), start = dragStart;
      const touchTap = event.pointerType === 'touch' && Math.abs(event.clientX - dragStartX) < 6;
      dragStart = null;
      dragStartX = null;
      selection.setAttribute('hidden', '');
      if (touchTap || Math.abs(end-start) < 3) {
        if (event.pointerType === 'touch') showValues(event);
        return;
      }
      const range = `${Math.floor(timestamp(Math.min(start,end)))}_${Math.ceil(timestamp(Math.max(start,end)))}`;
      if (!customRange(range)) return;
      this.applyCustomRange(range);
    };
    target.onpointercancel = event => {
      dragStart = null;
      dragStartX = null;
      selection.setAttribute('hidden', '');
      crosshair.setAttribute('hidden', '');
      tooltip.hidden = true;
    };
    if (live) this.timePan = createTimePan(target, {
      controller:panController,
      bounds:rangeWindow,
      plotWidth:() => target.getBoundingClientRect().width * (right - left) / width,
      start:() => {
        dragStart = dragStartX = null;
        selection.setAttribute('hidden', '');
        crosshair.setAttribute('hidden', '');
        tooltip.hidden = true;
      },
      commit:(start, end) => this.applyCustomRange(`${start}_${end}`),
    });
    status.textContent = warnings || (points.some(row => !row.length) ? 'Einige Datenreihen enthalten keine Werte.' : '');
  }

  applyCustomRange(range) {
    const bounds = customRange(range);
    if (!bounds) return;
    this.range = range;
    this.shadowRoot.querySelector('[data-range]').value = 'custom';
    this.shadowRoot.querySelector('[data-live-custom]').hidden = false;
    this.shadowRoot.querySelector('[data-live-from]').value = dateInput(bounds[0]);
    this.shadowRoot.querySelector('[data-live-to]').value = dateInput(bounds[1]);
    void this.load();
  }

  openConfig({isNew = false} = {}) {
    this.isNew = isNew;
    this.pickerAbort = new AbortController();
    const form = this.shadowRoot.querySelector('[data-form]');
    const config = this.widgetConfig;
    form.elements.title.value = config.title || '';
    form.elements.chartType.replaceChildren(...options(TYPES, config.chartType || 'line'));
    form.elements.aggregation.replaceChildren(...options(AGGREGATIONS, config.aggregation || 'last'));
    this.shadowRoot.querySelector('[data-aggregation]').hidden = form.elements.chartType.value !== 'pie';
    this.shadowRoot.querySelector('[data-pie-labels]').hidden = form.elements.chartType.value !== 'pie';
    this.shadowRoot.querySelector('[data-stack-linear]').hidden = form.elements.chartType.value !== 'stack';
    form.elements.showPieLabels.checked = config.showPieLabels !== false;
    form.elements.stackLinear.checked = config.stackLinear === true;
    const bounds = customRange(config.range || '');
    form.elements.range.replaceChildren(...options(RANGES, bounds ? 'custom' : config.range || '24h'));
    form.elements.granularity.replaceChildren(...options(GRANULARITIES, config.granularity || 'auto'));
    for (const field of ['axisLabelX', 'axisLabelLeft', 'axisLabelRight']) form.elements[field].value = config[field] || '';
    form.elements.showGrid.checked = config.showGrid !== false;
    this.shadowRoot.querySelector('[data-config-from]').hidden = this.shadowRoot.querySelector('[data-config-to]').hidden = !bounds;
    form.elements.from.value = bounds ? dateInput(bounds[0]) : '';
    form.elements.to.value = bounds ? dateInput(bounds[1]) : '';
    this.shadowRoot.querySelector('[data-rows]').replaceChildren();
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    for (const row of config.series || []) this.addRow(row);
    if (!config.series?.length) this.addRow();
    showCmsModal(this.shadowRoot.querySelector('[data-dialog]'));
    this.queuePreview();
  }

  updateRowControls() {
    const line = this.shadowRoot.querySelector('[data-form]').elements.chartType.value === 'line';
    for (const control of this.shadowRoot.querySelectorAll('[data-line-only]')) control.hidden = !line;
  }

  addRow(series = {}) {
    const container = this.shadowRoot.querySelector('[data-rows]');
    if (container.children.length >= 20) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Höchstens 20 Datenreihen sind möglich.';
      return;
    }
    const row = document.createElement('div');
    row.className = 'row';
    const unitId = `unit-${++this.rowSequence}`;
    row.innerHTML = `<div class="device-group"><label>Device<input data-device readonly placeholder="Device auswählen"></label>
      <button type="button" data-pick>Device auswählen …</button>
      <p class="status" data-row-status role="status"></p></div>
      <label>Reading<select data-reading><option value="">Reading wählen …</option></select></label>
      <label>Quelle<select data-source></select></label>
      <label>Legende<input data-label maxlength="64"></label>
      <label data-line-only>Y-Achse<select data-axis></select></label>
      <label data-line-only>Linientyp<select data-line-style></select></label>
      <label>Format<select data-format></select></label>
      <div class="unit-field"><label for="${unitId}">Einheit (optional)</label>
        <div class="unit-entry"><input id="${unitId}" data-unit maxlength="16" autocomplete="off">
        <div data-unit-choices></div></div></div>
      <div class="line-controls">
        <label data-line-only>Linienstärke<input data-line-width type="number" min="1" max="10" step="1"></label>
        <label>Farbe<input data-color type="color"></label>
        <label data-line-only>Fläche füllen<input data-fill type="checkbox"></label>
      </div>
      <button type="button" data-remove aria-label="Datenreihe entfernen" title="Datenreihe entfernen">${closeButtonSvg}</button>`;
    const $ = selector => row.querySelector(selector);
    $('[data-device]').value = series.device || '';
    $('[data-label]').value = series.label || '';
    $('[data-format]').replaceChildren(...options(FORMATS, series.format || ''));
    $('[data-unit]').value = series.unit || '';
    $('[data-unit-choices]').append(unitSuggestions($('[data-unit]'), {compact:true}));
    $('[data-color]').value = series.color || COLORS[container.children.length % COLORS.length];
    $('[data-axis]').replaceChildren(...options({left:'Links',right:'Rechts'}, series.axis || 'left'));
    $('[data-line-style]').replaceChildren(...options(LINE_STYLES, series.lineStyle || 'solid'));
    $('[data-line-width]').value = series.lineWidth ?? 4;
    $('[data-fill]').checked = series.fill === true;
    $('[data-source]').replaceChildren(...options(SOURCES, series.source || 'auto'));
    const pick = async () => {
      try {
        const source = $('[data-source]').value;
        const device = await openDevicePicker({services:this.services, signal:this.pickerAbort.signal,
          loadCandidates: this.services.logDevices ? signal => this.services.logDevices(source, signal) : undefined,
          classify: async entry => {
            const result = await this.services.logReadings(entry.name, source);
            if (!result.readings.length && result.warnings?.length) {
              throw new Error(result.warnings.join(' '));
            }
            if (!result.readings.length && result.truncated) {
              throw new Error('Logprüfung unvollständig; keine Aussage über vorhandene Readings möglich');
            }
            return result.readings.length > 0;
          }});
        if (!device || !row.isConnected) return;
        $('[data-device]').value = device.name;
        $('[data-label]').value = device.alias || device.name;
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
    this.updateRowControls();
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
    select.disabled = true;
    select.replaceChildren(...options({'':'Reading wählen …'}, ''));
    status.textContent = 'Geloggte Readings werden geladen …';
    try {
      const result = await this.services.logReadings(device, source);
      if (!row.isConnected || revision !== row.graphRevision) return;
      const names = result.readings;
      const choices = { '': 'Reading wählen …' };
      for (const reading of names) choices[reading] = reading;
      select.replaceChildren(...options(choices, names.includes(selected) ? selected : ''));
      status.textContent = names.length ? `Quelle: ${result.source === 'mixed' ? 'DbLog und FileLog' : SOURCES[result.source]}; ${names.length} Readings.`
        : result.source === 'filelog'
          ? 'Keine FileLog-Readings im untersuchten Zeitraum erkannt.'
          : 'Keine Datenlogs für dieses Device in der gewählten Quelle.';
      if (result.truncated) status.textContent += ' Die Logprüfung wurde begrenzt; die Liste kann unvollständig sein.';
      if (result.warnings?.length) status.textContent += ` ${result.warnings.join(' ')}`;
      if (selected && !names.includes(selected)) status.textContent += ` Das gespeicherte Reading ${selected} ist nicht verfügbar; bitte ein geloggtes Reading auswählen.`;
    } catch (error) {
      if (!row.isConnected || revision !== row.graphRevision) return;
      select.replaceChildren(...options({'':'Reading wählen …'}, ''));
      status.textContent = `Logprüfung fehlgeschlagen: ${error.message || String(error)}`;
    }
    if (revision === row.graphRevision) {
      row.removeAttribute('data-loading');
      select.disabled = false;
    }
    this.queuePreview();
  }

  collect() {
    const form = this.shadowRoot.querySelector('[data-form]');
    if (this.shadowRoot.querySelector('.row[data-loading]')) throw new Error('Bitte warten, bis die Reading-Auswahl geladen ist.');
    const series = [...this.shadowRoot.querySelectorAll('.row')].map(row => ({
      device:row.querySelector('[data-device]').value.trim(),
      reading:row.querySelector('[data-reading]').value,
      source:row.querySelector('[data-source]').value, label:row.querySelector('[data-label]').value.trim(),
      color:row.querySelector('[data-color]').value,
      axis:row.querySelector('[data-axis]').value, lineStyle:row.querySelector('[data-line-style]').value,
      lineWidth:Number(row.querySelector('[data-line-width]').value), fill:row.querySelector('[data-fill]').checked,
      format:row.querySelector('[data-format]').value.trim(),
      ...(row.querySelector('[data-unit]').value.trim() ? {unit:row.querySelector('[data-unit]').value.trim()} : {}),
    }));
    const config = {...this.widgetConfig, title:form.elements.title.value.trim(), series,
      chartType:form.elements.chartType.value, aggregation:form.elements.aggregation.value,
      range:readRange(form.elements.range.value, form.elements.from.value, form.elements.to.value),
      granularity:form.elements.granularity.value, showGrid:form.elements.showGrid.checked,
      showPieLabels:form.elements.showPieLabels.checked,
      axisLabelX:form.elements.axisLabelX.value.trim(), axisLabelLeft:form.elements.axisLabelLeft.value.trim(),
      axisLabelRight:form.elements.axisLabelRight.value.trim()};
    if (!config.title) delete config.title;
    if (form.elements.stackLinear.checked) config.stackLinear = true;
    else delete config.stackLinear;
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
    const spinner = this.shadowRoot.querySelector('[data-preview-spinner]');
    try {
      const config = this.collect();
      status.textContent = 'Vorschau wird geladen …';
      status.removeAttribute('data-error');
      spinner.hidden = false;
      const data = await this.fetchData(config, () => request === this.previewRequest
        && this.isConnected && this.shadowRoot.querySelector('[data-dialog]').open);
      if (request !== this.previewRequest || !this.shadowRoot.querySelector('[data-dialog]').open) return;
      this.draw(config, data, '[data-preview]', '[data-preview-legend]', status, new Set());
      this.markUpdated('[data-preview-updated]');
    } catch (error) {
      if (request !== this.previewRequest) return;
      this.shadowRoot.querySelector('[data-preview]').replaceChildren();
      this.shadowRoot.querySelector('[data-preview-legend]').replaceChildren();
      this.drawStates.delete('[data-preview]');
      status.textContent = `Vorschau: ${error.message || String(error)}`;
      status.setAttribute('data-error', '');
    } finally {
      if (request === this.previewRequest) spinner.hidden = true;
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
    this.drawStates.delete('[data-preview]');
    this.pickerAbort.abort();
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) dialog.close();
    if (this.isNew) this.dispatchEvent(new CustomEvent('cms-widget-cancel', {bubbles:true}));
  }
}

if (!customElements.get('cms-graph')) customElements.define('cms-graph', FHEMCMSGraph);
