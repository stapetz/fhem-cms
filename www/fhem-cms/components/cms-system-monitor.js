import { showCmsModal } from '../js/modal-dialog.js';
import { createWidgetIconButton, widgetDesignCss, widgetIconButtonCss } from '../js/widget-design.js';
import { loadSystemMonitorDevices, systemMonitorSnapshot, systemMonitorGraphCandidates, systemMonitorMetricForGraph, systemMonitorMetricKey } from '../js/system-monitor.js';
import './cms-chart.js';
import { formatDateDisplay } from '../js/date-display.js';
import { titleVisibilityField } from '../js/dialog-groups.js';

class FHEMCMSSystemMonitor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'});
    this.widgetConfig = null;
    this.services = null;
    this.generation = 0;
    this.logDiscoveries = new Map();
    this.graphs = [];
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) { void this.refresh(); return; }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; min-width:0; min-height:0; }
        * { box-sizing:border-box; }
        ${widgetDesignCss}
        ${widgetIconButtonCss}
        .tile { padding:16px; }
        :host([view-only]) [data-open-config] { display:none; }
        .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,calc(320px / var(--cms-freeform-scale,1))),1fr)); gap:1rem; }
        .metric { min-width:0; padding:1rem; border:1px solid var(--cms-border); border-radius:.6rem; overflow-wrap:anywhere; }
        .metric span, .metric strong { display:block; }
        .metric span { color:var(--cms-muted); font-size:.8em; }
        .status { color:var(--cms-muted); }
        [data-error] { color:var(--cms-danger); }
        [data-graphs] { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr)); }
        [data-graphs] cms-chart { height:340px; min-width:0; }
        [data-inline-graphs] cms-chart { display:block; height:calc(180px / var(--cms-freeform-scale,1)); min-width:0; margin-top:.75rem; }
        [data-metric-options] { display:grid; gap:.5rem; min-width:0; }
        [data-metric-options] label { display:grid; grid-template-columns:48px minmax(0,1fr); align-items:center;
          min-height:48px; padding:.5rem; border:1px solid var(--cms-border); border-radius:.5rem; }
        [data-metric-options] input { width:24px; height:24px; margin:auto; }
        [data-metric-options] small { display:block; color:var(--cms-muted); overflow-wrap:anywhere; }
        dialog { width:min(94vw,48rem); max-height:90vh; overflow:auto; padding:1.25rem;
          border:1px solid var(--cms-border); border-radius:1rem;
          background:var(--cms-surface); color:var(--cms-text); }
        dialog::backdrop { background:var(--cms-backdrop,rgb(0 0 0 / .6)); }
        dialog h2 { margin-top:0; }
        form { display:grid; gap:1rem; }
        fieldset { min-width:0; }
        label { display:grid; gap:.3rem; }
        input, select, button { font:inherit; }
        input, select { min-width:0; padding:.5rem; color:inherit; background:var(--cms-bg); border:1px solid var(--cms-border); }
        .actions { display:flex; flex-wrap:wrap; gap:.5rem; justify-content:flex-end; }
        .actions button { min-height:48px; color:inherit; background:var(--cms-surface-raised); border:1px solid var(--cms-border); border-radius:.5rem; padding:.5rem 1rem; }
        [hidden] { display:none !important; }
      </style>
      <article class="tile" data-tile>
        <header><h3 data-title>FHEM- und Systemstatus</h3><span class="controls" data-info></span></header>
        <button type="button" data-open-config aria-label="Systemmonitor konfigurieren">⚙</button>
        <p class="status" data-status role="status">Status wird geladen …</p>
        <p class="status" data-graph-status role="status">Verläufe werden im Logcache geprüft …</p>
        <div class="metrics" data-metrics></div>
      </article>
      <dialog data-details aria-label="Systemmonitor Details">
        <h2>FHEM- und Systemstatus</h2>
        <p data-detail-status></p>
        <h3>System</h3><div data-detail-metrics></div>
        <h3>Protokollierte Verläufe</h3>
        <p data-history-status role="status"></p><div data-graphs></div>
        <h3>DbLog und FileLog</h3><div data-logs></div>
        <h3>Aktuelle Logdateien</h3><div data-sizes role="status">Loggrößen werden geladen …</div>
        <p>Gemessen wird nur die aktuelle Datei, nicht das Archiv. Datenbankgrößen werden nur aus vorhandenen Readings angezeigt; sie werden nicht selbst ermittelt.</p>
      </dialog>
      <dialog data-dialog aria-labelledby="system-monitor-config-title">
        <form data-form>
          <h2 id="system-monitor-config-title">Systemmonitor konfigurieren</h2>
          <label>Titel<input name="title" maxlength="64" autocomplete="off"></label>
          ${titleVisibilityField}
          <label>Systemquelle (SYSMON)<select name="systemDevice"><option value="">Keine Systemquelle ausgewählt</option></select></label>
          <p>Wähle ausdrücklich das SYSMON-Device des FHEM-Rechners. Ohne SYSMON bleiben Systemwerte unbekannt.</p>
          <fieldset><legend>Sichtbare Werteboxen</legend>
            <p>Erkannte Werte mit aktuellem Stand. Nicht verfügbare Werte können für später ausgewählt bleiben.</p>
            <div data-metric-options></div>
          </fieldset>
          <p data-config-error role="alert"></p>
          <div class="actions"><button type="button" data-delete>Widget löschen</button><button type="button" data-cancel>Abbrechen</button><button type="submit">Speichern</button></div>
        </form>
      </dialog>`;
    const info = createWidgetIconButton('info', 'Systemstatus Details öffnen');
    info.addEventListener('click', event => {
      event.stopPropagation();
      showCmsModal(this.shadowRoot.querySelector('[data-details]'));
      this.renderGraphs();
    });
    this.shadowRoot.querySelector('[data-info]').append(info);
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.shadowRoot.querySelector('[data-cancel]').addEventListener('click', () => this.closeConfig(false));
    this.shadowRoot.querySelector('[data-delete]').addEventListener('click', () => this.deleteWidget());
    this.shadowRoot.querySelector('[name="systemDevice"]').addEventListener('change', event => {
      this.captureMetricSelection();
      this.renderMetricOptions(this.configDevices || [], event.target.value);
    });
    this.shadowRoot.querySelector('[data-form]').addEventListener('submit', event => {
      event.preventDefault();
      void this.saveConfig();
    });
    this.shadowRoot.querySelector('[data-dialog]').addEventListener('cancel', event => {
      event.preventDefault();
      this.closeConfig(false);
    });
    this.shadowRoot.querySelector('[data-details]').addEventListener('close', () => {
      this.shadowRoot.querySelector('[data-graphs]').replaceChildren();
    });
    this.shadowRoot.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const dialog = event.composedPath().find(node => node instanceof HTMLDialogElement && node.open);
      if (!dialog) return;
      event.preventDefault();
      event.stopPropagation();
      if (dialog.dispatchEvent(new Event('cancel', {cancelable:true})) && dialog.open) dialog.close();
    });
    this.renderTitle();
    void this.refresh();
  }

  disconnectedCallback() {
    this.generation++;
    clearTimeout(this.timer);
  }

  set config(value) {
    const sourceChanged = this.widgetConfig?.systemDevice !== value?.systemDevice;
    this.widgetConfig = value;
    this.renderTitle();
    if (this.snapshot && this.isConnected && !sourceChanged) {
      this.render();
      this.renderInlineGraphs();
    }
    if (sourceChanged && this.isConnected) {
      this.graphs = [];
      this.graphStatus('Verläufe werden im Logcache geprüft …');
      this.renderGraphs();
      void this.refresh();
    }
  }
  get config() { return this.widgetConfig; }

  renderTitle() {
    const title = this.shadowRoot.querySelector('[data-title]');
    if (title) {
      title.textContent = this.widgetConfig?.title || 'FHEM- und Systemstatus';
      title.hidden = this.widgetConfig?.showTitle === false;
    }
  }

  async refresh() {
    const generation = ++this.generation;
    clearTimeout(this.timer);
    void this.refreshLogSizes(generation);
    try {
      const devices = await loadSystemMonitorDevices(this.services?.systemMonitorDevices);
      if (!this.isConnected || generation !== this.generation) return;
      this.snapshot = systemMonitorSnapshot(devices, this.widgetConfig?.systemDevice || '');
      this.render();
      void this.refreshGraphs(devices, generation);
    } catch (error) {
      if (!this.isConnected || generation !== this.generation) return;
      this.shadowRoot.querySelector('[data-status]').textContent = `FHEM-Abfrage fehlgeschlagen: ${error.message}`;
      this.shadowRoot.querySelector('[data-detail-status]').textContent = 'Daten nicht aktuell; letzte Werte werden gegebenenfalls weiter angezeigt.';
      this.graphs = [];
      this.graphStatus('Verläufe nicht aktuell: FHEM-Geräteabfrage fehlgeschlagen.');
      this.renderGraphs();
    } finally {
      if (this.isConnected && generation === this.generation) this.timer = setTimeout(() => this.refresh(), 60000);
    }
  }

  graphStatus(message) {
    this.shadowRoot.querySelector('[data-graph-status]').textContent = message;
    this.shadowRoot.querySelector('[data-history-status]').textContent = message;
  }

  async refreshGraphs(devices, generation) {
    const candidates = systemMonitorGraphCandidates(devices, this.widgetConfig?.systemDevice || '');
    const names = [...new Set(candidates.map(item => item.device))].slice(0, 12);
    this.graphs = this.graphs.filter(graph => candidates.some(item =>
      item.device === graph.device && item.reading === graph.reading));
    this.renderGraphs();
    try {
      if (typeof this.services?.logReadings !== 'function') throw new Error('Logcache-Dienst nicht verfügbar');
      const graphs = [];
      const warnings = [];
      for (const name of names) {
        if (!this.isConnected || generation !== this.generation) return;
        if (!this.logDiscoveries.has(name)) {
          const request = Promise.resolve().then(() => this.services.logReadings(name, 'auto'));
          this.logDiscoveries.set(name, request);
          request.then(() => this.logDiscoveries.delete(name), () => this.logDiscoveries.delete(name));
        }
        const result = await this.logDiscoveries.get(name);
        if (!Array.isArray(result?.readings)) throw new Error('Ungültige Reading-Liste im Logcache');
        graphs.push(...candidates.filter(item => item.device === name && result.readings.includes(item.reading)));
        warnings.push(...(result.warnings || []));
      }
      if (!this.isConnected || generation !== this.generation) return;
      this.graphs = graphs.slice(0, 24);
      this.graphStatus(`${this.graphs.length ? `${this.graphs.length} Verläufe verfügbar · Details über ⓘ`
        : 'Keine numerischen Status-Readings im Logcache gefunden.'} · Prüfung alle 60 Sekunden.`
        + (graphs.length > 24 || new Set(candidates.map(item => item.device)).size > 12
          ? ' Anzeige auf 12 Devices / 24 Verläufe begrenzt.' : '')
        + (warnings.length ? ` Hinweise: ${warnings.join(' · ')}` : ''));
      this.renderGraphs(true);
    } catch (error) {
      if (!this.isConnected || generation !== this.generation) return;
      this.graphs = [];
      this.graphStatus(`Verläufe nicht verfügbar: ${error.message}`);
      this.renderGraphs();
    }
  }

  renderGraphs(refresh = false) {
    this.renderInlineGraphs();
    const container = this.shadowRoot.querySelector('[data-graphs]');
    if (!this.shadowRoot.querySelector('[data-details]').open) {
      container.replaceChildren();
      return;
    }
    const wanted = new Set(this.graphs.map(item => `${item.device}:${item.reading}`));
    for (const chart of container.children) {
      if (!wanted.has(chart.dataset.key)) chart.remove();
    }
    for (const graph of this.graphs) {
      const key = `${graph.device}:${graph.reading}`;
      const existing = [...container.children].find(chart => chart.dataset.key === key);
      if (existing) {
        if (refresh) void existing.load();
        continue;
      }
      const chart = document.createElement('cms-chart');
      chart.dataset.key = key;
      chart.setAttribute('view-only', '');
      chart.services = {history: (...args) => this.services.history(...args)};
      chart.config = {...graph, range:'24h', granularity:'auto', source:'auto'};
      container.append(chart);
    }
  }

  renderInlineGraphs() {
    for (const row of this.shadowRoot.querySelectorAll('[data-metrics] > .metric')) {
      const container = row.querySelector('[data-inline-graphs]');
      const graphs = this.graphs.filter(graph => graph.device === this.snapshot?.selected
        && systemMonitorMetricForGraph(graph.reading) === row.dataset.metric);
      const keys = new Set(graphs.map(graph => `${graph.device}:${graph.reading}`));
      for (const chart of [...container.children]) {
        if (!keys.has(chart.dataset.key)) chart.remove();
      }
      for (const graph of graphs) {
        const key = `${graph.device}:${graph.reading}`;
        if ([...container.children].some(chart => chart.dataset.key === key)) continue;
        const chart = document.createElement('cms-chart');
        chart.dataset.key = key;
        chart.setAttribute('view-only', '');
        chart.setAttribute('compact', '');
        chart.setAttribute('aria-label', `${graph.title} · letzte 24 Stunden`);
        chart.services = {history:(...args) => this.services.history(...args)};
        chart.config = {...graph,range:'24h',granularity:'auto',source:'auto'};
        container.append(chart);
      }
    }
  }

  async refreshLogSizes(generation) {
    const container = this.shadowRoot.querySelector('[data-sizes]');
    try {
      const result = await loadSystemMonitorDevices(this.services?.systemLogSizes);
      if (!this.isConnected || generation !== this.generation) return;
      container.replaceChildren();
      if (!result.items.length) container.textContent = 'Keine zugänglichen Logdateien gefunden.';
      for (const item of result.items) {
        const row = document.createElement('p');
        row.textContent = `${item.type}: ${item.name} · ${item.error || `${item.bytes.toLocaleString('de-DE')} Bytes`
          + ` · Geändert: ${new Date(item.modifiedAt * 1000).toLocaleString('de-DE')}`}`
          + ` · Abgefragt: ${new Date(result.checkedAt * 1000).toLocaleString('de-DE')}`;
        container.append(row);
      }
    } catch (error) {
      if (!this.isConnected || generation !== this.generation) return;
      container.textContent = `Loggrößen nicht verfügbar: ${error.message}`;
    }
  }

  render() {
    const snapshot = this.snapshot;
    const status = snapshot.selected ? `FHEM-Abfrage erfolgreich · Systemquelle: ${snapshot.selected}`
      : this.widgetConfig?.systemDevice ? 'FHEM erreichbar · gewählte Systemquelle nicht verfügbar'
        : 'FHEM erreichbar · keine Systemquelle ausgewählt';
    this.shadowRoot.querySelector('[data-status]').textContent = status;
    this.shadowRoot.querySelector('[data-detail-status]').textContent = status;
    const metrics = this.shadowRoot.querySelector('[data-metrics]');
    const details = this.shadowRoot.querySelector('[data-detail-metrics]');
    details.replaceChildren();
    const hidden = new Set(this.widgetConfig?.hiddenMetrics || []);
    for (const tile of [...metrics.children]) {
      if (hidden.has(tile.dataset.metric)) tile.remove();
    }
    for (const item of snapshot.metrics) {
      const row = document.createElement('div');
      row.className = 'metric';
      const label = document.createElement('span');
      const value = document.createElement('strong');
      const timestamp = document.createElement('small');
      label.textContent = item.label;
      value.textContent = item.value ?? 'Nicht verfügbar';
      timestamp.textContent = item.value ? `Stand: ${item.timestamp ? formatDateDisplay(item.timestamp) : 'unbekannt'}` : '';
      row.append(label, value, timestamp);
      details.append(row);
      const key = systemMonitorMetricKey(item.reading);
      if (hidden.has(key)) continue;
      let tile = [...metrics.children].find(node => node.dataset.metric === key);
      if (!tile) {
        tile = row.cloneNode(true);
        tile.dataset.metric = key;
        const charts = document.createElement('div');
        charts.dataset.inlineGraphs = '';
        tile.append(charts);
        metrics.append(tile);
      } else {
        tile.querySelector('span').textContent = label.textContent;
        tile.querySelector('strong').textContent = value.textContent;
        tile.querySelector('small').textContent = timestamp.textContent;
      }
    }
    const logs = this.shadowRoot.querySelector('[data-logs]');
    logs.replaceChildren();
    for (const type of ['DbLog', 'FileLog']) {
      const group = snapshot.logs.filter(log => log.type === type);
      if (!group.length) {
        const missing = document.createElement('p');
        missing.textContent = `Keine ${type}-Devices gefunden.`;
        logs.append(missing);
      }
      for (const log of group) {
        const section = document.createElement('section');
        const heading = document.createElement('h4');
        heading.textContent = `${log.type}: ${log.name}`;
        section.append(heading);
        if (!log.readings.length) section.append(document.createTextNode('Keine Status-Readings verfügbar.'));
        for (const reading of log.readings) {
          const row = document.createElement('p');
          row.textContent = `${reading.name}: ${reading.value} · Stand: ${reading.timestamp ? formatDateDisplay(reading.timestamp) : 'unbekannt'}`;
          section.append(row);
        }
        logs.append(section);
      }
    }
  }

  async openConfig({isNew = false} = {}) {
    this.isNew = isNew;
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig?.title || '';
    form.elements.showTitle.checked = this.widgetConfig?.showTitle !== false;
    const select = form.elements.systemDevice;
    select.replaceChildren(new Option('Keine Systemquelle ausgewählt', ''));
    const error = this.shadowRoot.querySelector('[data-config-error]');
    error.textContent = '';
    this.metricSelection = new Set(this.widgetConfig?.hiddenMetrics || []);
    this.configDevices = [];
    this.renderMetricOptions([], this.widgetConfig?.systemDevice || '');
    try {
      const devices = await loadSystemMonitorDevices(this.services?.systemMonitorDevices);
      this.configDevices = devices;
      for (const device of systemMonitorSnapshot(devices).systems) {
        select.add(new Option(device.alias ? `${device.name} (${device.alias})` : device.name, device.name));
      }
      if (this.widgetConfig?.systemDevice && ![...select.options].some(option => option.value === this.widgetConfig.systemDevice)) {
        select.add(new Option(`${this.widgetConfig.systemDevice} (nicht verfügbar)`, this.widgetConfig.systemDevice));
      }
      select.value = this.widgetConfig?.systemDevice || '';
      this.renderMetricOptions(devices, select.value);
    } catch (cause) {
      error.textContent = `Systemquellen konnten nicht geladen werden: ${cause.message}`;
      if (this.widgetConfig?.systemDevice) {
        select.add(new Option(`${this.widgetConfig.systemDevice} (nicht verfügbar)`, this.widgetConfig.systemDevice));
        select.value = this.widgetConfig.systemDevice;
      }
    }
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    if (!this.isConnected) return;
    showCmsModal(this.shadowRoot.querySelector('[data-dialog]'));
  }

  captureMetricSelection() {
    for (const input of this.shadowRoot.querySelectorAll('[data-metric-options] input')) {
      if (input.checked) this.metricSelection.delete(input.value);
      else this.metricSelection.add(input.value);
    }
  }

  renderMetricOptions(devices, source) {
    const container = this.shadowRoot.querySelector('[data-metric-options]');
    container.replaceChildren();
    for (const metric of systemMonitorSnapshot(devices, source).metrics) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = systemMonitorMetricKey(metric.reading);
      input.checked = !this.metricSelection.has(input.value);
      const text = document.createElement('span');
      text.textContent = metric.label;
      const value = document.createElement('small');
      value.textContent = metric.value ?? 'Nicht verfügbar';
      text.append(value);
      label.append(input, text);
      container.append(label);
    }
  }

  async saveConfig() {
    if (this.busy) return;
    const form = this.shadowRoot.querySelector('[data-form]');
    const next = {...this.widgetConfig, systemDevice: form.elements.systemDevice.value};
    this.captureMetricSelection();
    if (this.metricSelection.size) next.hiddenMetrics = [...this.metricSelection];
    else delete next.hiddenMetrics;
    if (form.elements.showTitle.checked) delete next.showTitle;
    else next.showTitle = false;
    const title = form.elements.title.value.trim();
    if (title) next.title = title;
    else delete next.title;
    this.setBusy(true);
    try {
      await this.services.saveWidget(next);
      this.setBusy(false);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-config-error]').textContent = `Speichern fehlgeschlagen: ${error.message}`;
    } finally {
      this.setBusy(false);
    }
  }

  async deleteWidget() {
    if (this.busy) return;
    if (!window.confirm('Systemmonitor entfernen?')) return;
    this.setBusy(true);
    try {
      await this.services.deleteWidget(this.widgetConfig.id);
      this.setBusy(false);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-config-error]').textContent = `Entfernen fehlgeschlagen: ${error.message}`;
    } finally {
      this.setBusy(false);
    }
  }

  setBusy(busy) {
    this.busy = busy;
    for (const control of this.shadowRoot.querySelector('[data-dialog]').querySelectorAll('button,input,select')) {
      control.disabled = busy;
    }
  }

  closeConfig(saved) {
    if (this.busy) return;
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) dialog.close();
    if (!saved && this.isNew) this.dispatchEvent(new CustomEvent('cms-widget-cancel', {bubbles:true}));
  }
}

if (!customElements.get('cms-system-monitor')) customElements.define('cms-system-monitor', FHEMCMSSystemMonitor);
