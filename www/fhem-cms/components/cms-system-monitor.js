import { showCmsModal } from '../js/modal-dialog.js';
import { createWidgetIconButton, widgetDesignCss, widgetIconButtonCss } from '../js/widget-design.js';
import { loadSystemMonitorDevices, systemMonitorSnapshot, systemMonitorGraphCandidates, systemMonitorMetricForGraph, systemMonitorMetricKey,
  systemMonitorMetricMappings, SYSTEM_METRIC_UNITS, validateSystemMetricMappings, systemMonitorAdditionalReadings } from '../js/system-monitor.js';
import './cms-chart.js';
import './cms-graph.js';
import { formatDateDisplay } from '../js/date-display.js';
import { titleVisibilityField, titleVisibilityStyles } from '../js/dialog-groups.js';

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
        .source-notice { padding:1.5rem; border:1px solid var(--cms-border); border-radius:.75rem;
          line-height:1.6; background:var(--cms-surface); }
        .source-notice h3 { margin:0 0 .75rem; }
        .source-notice p { margin:.5rem 0; }
        [data-error] { color:var(--cms-danger); }
        [data-graphs] { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr)); }
        [data-graphs] cms-chart { height:340px; min-width:0; }
        [data-details] { width:min(96vw,80rem); padding:1.5rem; }
        [data-detail-metrics] { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr)); gap:1rem; }
        [data-details] > h3 { margin:1.75rem 0 .75rem; }
        [data-details] .metric > strong { margin:.5rem 0; font-size:1.3rem; line-height:1.4; }
        [data-details] small { display:block; color:var(--cms-muted); line-height:1.5; }
        .raw-details { margin-top:.75rem; color:var(--cms-muted); font-size:.85rem; }
        .raw-details p { white-space:pre-wrap; margin:.5rem 0; }
        [data-inline-graphs] cms-chart, [data-inline-graphs] cms-graph { display:block; height:calc(180px / var(--cms-freeform-scale,1)); min-width:0; margin-top:.75rem; }
        .metric > strong { font-size:1.25em; font-variant-numeric:tabular-nums; }
        .metric progress { display:block; width:100%; height:.5rem; margin:.65rem 0; accent-color:var(--cms-accent); }
        [data-mapping-row] { display:grid; gap:.5rem; border:1px solid var(--cms-border); padding:.75rem; margin:.5rem 0; }
        [data-mapping-row] .mapping-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.75rem; align-items:stretch; }
        .mapping-fields label { display:flex; flex-direction:column; justify-content:space-between; gap:.4rem; min-width:0; }
        .mapping-fields input, .mapping-fields select { width:100%; height:48px; flex:none; }
        [data-mapping-row] .mapping-visibility { display:flex; align-items:center; gap:.6rem; min-height:48px; }
        .mapping-visibility input { width:24px; height:24px; margin:0; flex:none; }
        [data-mapping-row] small { color:var(--cms-muted); overflow-wrap:anywhere; }
        [data-series-row] { border-top:1px solid var(--cms-border); padding-top:.75rem; margin-top:.75rem; }
        [data-mapping-controls] { display:grid; gap:.75rem; }
        [data-mapping-controls][hidden] { display:none; }
        [data-mapping-row] button { min-height:48px; }
        @media (max-width:520px) { [data-mapping-row] .mapping-fields { grid-template-columns:minmax(0,1fr); } }
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
        ${titleVisibilityStyles}
        .actions { display:flex; flex-wrap:wrap; gap:.5rem; justify-content:flex-end; }
        .actions button { min-height:48px; color:inherit; background:var(--cms-surface-raised); border:1px solid var(--cms-border); border-radius:.5rem; padding:.5rem 1rem; }
        [hidden] { display:none !important; }
      </style>
      <article class="tile" data-tile>
        <header><h3 data-title>FHEM- und Systemstatus</h3><span class="controls" data-info></span></header>
        <button type="button" data-open-config aria-label="Systemmonitor konfigurieren">⚙</button>
        <p class="status" data-status role="status">Status wird geladen …</p>
        <section class="source-notice" data-missing-source hidden role="status">
          <h3>Kein SYSMON-Device vorhanden</h3>
          <p>Es wurde kein zugängliches SYSMON-Device in FHEM gefunden. Bitte lege zuerst im FHEM-Backend ein SYSMON-Device an und wähle es anschließend in der Widgetkonfiguration aus.</p>
          <p>Das Widget legt keine Devices an und ändert keine SYSMON-Konfiguration.</p>
        </section>
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
          <section class="source-notice" data-config-missing-source hidden role="status">
            <h3>Kein SYSMON-Device vorhanden</h3>
            <p>Bitte lege zuerst im FHEM-Backend ein SYSMON-Device an. Öffne danach diese Konfiguration erneut und wähle die Systemquelle aus. Das Widget legt selbst keine Devices an.</p>
            <p>Bei eingeschränkten Berechtigungen muss ein vorhandenes Device für diesen FHEMWEB-Zugang freigegeben sein.</p>
          </section>
          <label data-source-field>Systemquelle (SYSMON)<select name="systemDevice"><option value="">Keine Systemquelle ausgewählt</option></select></label>
          <p data-source-help>Wähle ausdrücklich das SYSMON-Device des FHEM-Rechners. Ohne SYSMON bleiben Systemwerte unbekannt.</p>
          <fieldset data-mapping-section><legend>Reading-Zuordnung und Einheiten</legend>
            <p>Erkannte Readings sind vorbelegt. Einheiten müssen zu den Quelldaten passen; es erfolgt keine automatische Umrechnung.
              Gesamt-Reading verwendet dieselbe Einheit wie der Wert. Das Häkchen je Box schaltet Anzeige und Eingaben frei.
              Weitere Readings vergleichen mehrere Werte im selben Graphen (z. B. Empfang und Versand).
              Große Listen und mehr als zwei Einheiten werden in Teilgraphen aufgeteilt.</p>
            <div data-mappings></div>
            <button type="button" data-add-metric>Weitere Wertebox hinzufügen</button>
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
      try {
        this.captureMetricSelection();
        this.captureMappings();
        this.renderMappingOptions(this.configDevices || [], event.target.value);
        this.renderMetricOptions(this.configDevices || [], event.target.value);
      } catch (error) { this.shadowRoot.querySelector('[data-config-error]').textContent = error.message; }
    });
    this.shadowRoot.querySelector('[data-add-metric]').addEventListener('click', () => {
      try {
        this.captureMappings();
        if (this.mappingDraft.filter(item => item.key.startsWith('custom-')).length >= 12) {
          throw new Error('Höchstens zwölf zusätzliche Werteboxen erlaubt.');
        }
        this.mappingDraft.push({key:`custom-${crypto.randomUUID()}`,label:'Weitere Kennzahl',reading:'',unit:''});
        const source = this.shadowRoot.querySelector('[name="systemDevice"]').value;
        this.renderMappingOptions(this.configDevices || [], source);
        this.renderMetricOptions(this.configDevices || [], source);
      } catch (error) { this.shadowRoot.querySelector('[data-config-error]').textContent = error.message; }
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
    const sourceChanged = this.widgetConfig?.systemDevice !== value?.systemDevice
      || JSON.stringify(this.widgetConfig?.metricMappings) !== JSON.stringify(value?.metricMappings);
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
      this.snapshot = systemMonitorSnapshot(devices, this.widgetConfig?.systemDevice || '', this.widgetConfig?.metricMappings || []);
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
    const candidates = systemMonitorGraphCandidates(devices, this.widgetConfig?.systemDevice || '', this.widgetConfig?.metricMappings || []);
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
      this.graphs = [...graphs.filter(graph=>!graph.metric).slice(0,24),...graphs.filter(graph=>graph.metric)];
      this.graphStatus(`${this.graphs.length ? `${this.graphs.length} Verläufe verfügbar · Details über ⓘ`
        : 'Keine numerischen Status-Readings im Logcache gefunden.'} · Prüfung alle 60 Sekunden.`
        + (graphs.filter(graph=>!graph.metric).length > 24 || new Set(candidates.map(item => item.device)).size > 12
          ? ' Automatische Anzeige auf 12 Devices / 24 Verläufe begrenzt; konfigurierte Reihen bleiben erhalten.' : '')
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
    const graphKey = item => `${item.device}:${item.reading}:${item.unit}:${item.metric || ''}`;
    const wanted = new Set(this.graphs.map(graphKey));
    for (const chart of container.children) {
      if (!wanted.has(chart.dataset.key)) chart.remove();
    }
    for (const graph of this.graphs) {
      const key = graphKey(graph);
      const existing = [...container.children].find(chart => chart.dataset.key === key);
      if (existing) {
        if (refresh) void existing.load();
        continue;
      }
      const chart = document.createElement('cms-chart');
      chart.dataset.key = key;
      chart.setAttribute('view-only', '');
      chart.setAttribute('system-detail', '');
      chart.services = {history: (...args) => this.services.history(...args)};
      chart.config = {...graph, title:graph.device === this.snapshot?.selected
        ? graph.title.replace(`${graph.device} · `,'') : graph.title,
        range:'24h', granularity:'auto', source:'auto'};
      container.append(chart);
    }
  }

  renderInlineGraphs() {
    for (const row of this.shadowRoot.querySelectorAll('[data-metrics] > .metric')) {
      const container = row.querySelector('[data-inline-graphs]');
      const graphs = this.graphs.filter(graph => graph.device === this.snapshot?.selected
        && (graph.metric || systemMonitorMetricForGraph(graph.reading)) === row.dataset.metric);
      const mapping = this.widgetConfig?.metricMappings?.find(item => item.key === row.dataset.metric);
      const additions = mapping ? systemMonitorAdditionalReadings(mapping) : [];
      if (mapping) {
        const order = [mapping.reading,...additions.map(item=>item.reading)];
        graphs.sort((a,b)=>order.indexOf(a.reading)-order.indexOf(b.reading));
      }
      if (row.dataset.metric === 'network' || additions.length) {
        const key = graphs.map(graph => `${graph.device}:${graph.reading}:${graph.unit}`).join('|');
        if (container.dataset.graphKey === key) continue;
        container.replaceChildren();
        container.dataset.graphKey = key;
        if (!graphs.length) continue;
        const chart = document.createElement('cms-graph');
        chart.dataset.key = key;
        chart.setAttribute('view-only', '');
        chart.setAttribute('compact', '');
        chart.setAttribute('aria-label',`${mapping?.label || 'Netzwerk Empfang und Versand'} · letzte 24 Stunden`);
        chart.services = {history:(...args) => this.services.history(...args)};
        const units = [...new Set(graphs.map(graph=>graph.unit))];
        if (units.length > 2 || graphs.length > 20) {
          const colors = ['#3b82f6','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4'];
          for (const unit of units) {
            const sameUnit = graphs.filter(graph=>graph.unit === unit);
            for (let offset=0;offset<sameUnit.length;offset+=20) {
              const group = sameUnit.slice(offset,offset+20);
              const chart = document.createElement(group.length === 1 ? 'cms-chart' : 'cms-graph');
              chart.setAttribute('view-only','');
              chart.setAttribute('compact','');
              chart.dataset.key = group.map(graph=>`${graph.device}:${graph.reading}:${graph.unit}`).join('|');
              chart.services = {history:(...args)=>this.services.history(...args)};
              chart.config = group.length === 1 ? {...group[0],range:'24h',granularity:'auto',source:'auto'}
                : {range:'24h',granularity:'auto',aggregation:'last',chartType:'line',
                  series:group.map((graph,index)=>({device:graph.device,reading:graph.reading,
                    source:'auto',label:graph.reading,...(unit ? {unit} : {}),
                    color:colors[index%colors.length],lineWidth:2}))};
              container.append(chart);
            }
          }
          continue;
        }
        const colors = ['#3b82f6','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4'];
        chart.config = {range:'24h',granularity:'auto',aggregation:'last',chartType:'line',
          series:graphs.map((graph,index) => ({device:graph.device,reading:graph.reading,source:'auto',
            label:row.dataset.metric === 'network' && graph.reading === (mapping?.reading || 'net_rx_kbs')
              ? '↓ Empfang' : row.dataset.metric === 'network'
                && graph.reading === (additions[0]?.reading || 'net_tx_kbs') ? '↑ Versand' : graph.reading,
            ...(graph.unit ? {unit:graph.unit} : {}),
            color:colors[index % colors.length],
            axis:graph.unit === units[0] ? 'left' : 'right',
            lineWidth:2}))};
        container.append(chart);
        continue;
      }
      delete container.dataset.graphKey;
      const keys = new Set(graphs.map(graph => `${graph.device}:${graph.reading}:${graph.unit}`));
      for (const chart of [...container.children]) {
        if (!keys.has(chart.dataset.key)) chart.remove();
      }
      for (const graph of graphs) {
        const key = `${graph.device}:${graph.reading}:${graph.unit}`;
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
    const missing = snapshot.systems.length === 0;
    this.shadowRoot.querySelector('[data-missing-source]').hidden = !missing;
    for (const selector of ['[data-metrics]','[data-graph-status]','[data-info]']) {
      this.shadowRoot.querySelector(selector).hidden = missing;
    }
    if (missing && this.shadowRoot.querySelector('[data-details]').open) {
      this.shadowRoot.querySelector('[data-details]').close();
      this.renderGraphs();
    }
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
      if (hidden.has(tile.dataset.metric) || !snapshot.metrics.some(item => item.key === tile.dataset.metric)) tile.remove();
    }
    for (const item of snapshot.metrics) {
      const row = document.createElement('div');
      row.className = 'metric';
      const label = document.createElement('span');
      const value = document.createElement('strong');
      const timestamp = document.createElement('small');
      label.textContent = item.label;
      value.textContent = item.displayValue ?? item.value ?? 'Nicht verfügbar';
      const currentTimestamp = item.displayTimestamp ?? item.timestamp;
      timestamp.textContent = item.displayValue || item.value
        ? `Stand: ${currentTimestamp ? formatDateDisplay(currentTimestamp) : 'unbekannt'}` : '';
      row.append(label, value, timestamp);
      details.append(row);
      const key = item.key;
      if (hidden.has(key)) {
        this.decorateDetailMetric(row,item);
        continue;
      }
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
      tile.querySelector('strong').textContent = item.displayValue ?? value.textContent;
      tile.querySelector('small').textContent = item.displayValue || item.value
        ? `Stand: ${currentTimestamp ? formatDateDisplay(currentTimestamp) : 'unbekannt'}` : '';
      let progress = tile.querySelector('progress');
      if (Number.isFinite(item.progress)) {
        if (!progress) {
          progress = document.createElement('progress');
          progress.max = 100;
          progress.setAttribute('aria-label',`${item.label} belegt`);
          tile.querySelector('strong').after(progress);
        }
        progress.value = item.progress;
        progress.textContent = `${item.progress.toLocaleString('de-DE',{maximumFractionDigits:1})} %`;
      } else progress?.remove();
      this.decorateDetailMetric(row,item);
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

  decorateDetailMetric(row, item) {
    if (Number.isFinite(item.progress)) {
      const progress = document.createElement('progress');
      progress.max = 100;
      progress.value = item.progress;
      progress.setAttribute('aria-label',`${item.label} belegt`);
      row.querySelector('strong').after(progress);
    }
    if (item.value && item.value !== item.displayValue) {
      const raw = document.createElement('details');
      raw.className = 'raw-details';
      const summary = document.createElement('summary');
      summary.textContent = 'Originalwert anzeigen';
      const text = document.createElement('p');
      text.textContent = item.value;
      raw.append(summary,text);
      row.append(raw);
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
    this.mappingDraft = structuredClone(this.widgetConfig?.metricMappings || []);
    this.configDevices = [];
    this.showMissingConfigSource(false);
    this.renderMetricOptions([], this.widgetConfig?.systemDevice || '');
    this.renderMappingOptions([], this.widgetConfig?.systemDevice || '');
    try {
      const devices = await loadSystemMonitorDevices(this.services?.systemMonitorDevices);
      this.configDevices = devices;
      this.showMissingConfigSource(systemMonitorSnapshot(devices).systems.length === 0);
      for (const device of systemMonitorSnapshot(devices).systems) {
        select.add(new Option(device.alias ? `${device.name} (${device.alias})` : device.name, device.name));
      }
      if (this.widgetConfig?.systemDevice && ![...select.options].some(option => option.value === this.widgetConfig.systemDevice)) {
        select.add(new Option(`${this.widgetConfig.systemDevice} (nicht verfügbar)`, this.widgetConfig.systemDevice));
      }
      select.value = this.widgetConfig?.systemDevice || '';
      this.renderMappingOptions(devices, select.value);
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
    for (const input of this.shadowRoot.querySelectorAll('[data-visible]')) {
      if (input.checked) this.metricSelection.delete(input.value);
      else this.metricSelection.add(input.value);
    }

  }

  showMissingConfigSource(missing) {
    this.shadowRoot.querySelector('[data-config-missing-source]').hidden = !missing;
    for (const selector of ['[data-source-field]','[data-source-help]','[data-mapping-section]']) {
      this.shadowRoot.querySelector(selector).hidden = missing;
    }
  }

  renderMetricOptions(devices, source) {
    for (const metric of systemMonitorSnapshot(devices, source, this.mappingDraft || []).metrics) {
      const row = [...this.shadowRoot.querySelectorAll('[data-mapping-row]')].find(row=>row.dataset.mappingRow === metric.key);
      if (!row) continue;
      const value = row.querySelector('[data-current-value]');
      value.textContent = metric.displayValue ?? metric.value ?? 'Nicht verfügbar';
    }
  }

  renderMappingOptions(devices, source) {
    const container = this.shadowRoot.querySelector('[data-mappings]');
    container.replaceChildren();
    const selected = devices.find(item => item.type === 'SYSMON' && item.name === source);
    const readings = Object.keys(selected?.readings || {}).sort((a,b) => a.localeCompare(b));
    for (const mapping of systemMonitorMetricMappings(devices, source, this.mappingDraft)) {
      const row = document.createElement('div');
      row.dataset.mappingRow = mapping.key;
      row.dataset.automatic = String(!this.mappingDraft.some(item => item.key === mapping.key));
      const heading = document.createElement('strong');
      heading.textContent = mapping.label;
      const visibility = document.createElement('label');
      visibility.className = 'mapping-visibility';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.visible = '';
      checkbox.value = mapping.key;
      checkbox.checked = !this.metricSelection.has(mapping.key);
      visibility.append(checkbox, heading);
      const current = document.createElement('small');
      current.dataset.currentValue = '';
      row.append(visibility,current);
      const controls = document.createElement('div');
      controls.dataset.mappingControls = '';
      const fields = document.createElement('div');
      fields.className = 'mapping-fields';
      const markEdited = () => {
        try {
          this.captureMetricSelection();
          row.dataset.automatic = 'false';
          this.captureMappings();
          this.renderMetricOptions(this.configDevices || [], this.shadowRoot.querySelector('[name="systemDevice"]').value);
          this.shadowRoot.querySelector('[data-config-error]').textContent = '';
        } catch (error) { this.shadowRoot.querySelector('[data-config-error]').textContent = error.message; }
      };
      const appendField = (parent,key,label,value,series = false) => {
        const wrapper = document.createElement('label');
        const caption = document.createElement('span');
        caption.textContent = label;
        wrapper.append(caption);
        const input = document.createElement(key === 'label' ? 'input' : 'select');
        if (series) input.dataset.seriesField = key;
        else input.dataset.field = key;
        if (key === 'label') { input.maxLength = 64; input.value = value; }
        else {
          const options = ['unit','secondaryUnit'].includes(key) ? [...SYSTEM_METRIC_UNITS] : ['',...readings];
          const current = value || '';
          if (!options.includes(current)) options.push(current);
          for (const name of options) input.add(new Option(name || 'Keine / unbekannt', name));
          input.value = current;
        }
        input.addEventListener('change', markEdited);
        wrapper.append(input);
        parent.append(wrapper);
      };
      for (const [key,label] of [['label','Bezeichnung'],['reading','Wert-Reading'],['unit','Einheit'],
        ['totalReading','Gesamt-Reading (optional)']]) {
        appendField(fields,key,label,mapping[key]);
      }
      controls.append(fields);
      const series = document.createElement('div');
      series.dataset.additionalSeries = '';
      const addSeries = entry => {
        const seriesRow = document.createElement('div');
        seriesRow.dataset.seriesRow = '';
        const fields = document.createElement('div');
        fields.className = 'mapping-fields';
        appendField(fields,'reading','Weiteres Reading',entry.reading,true);
        appendField(fields,'unit','Einheit',entry.unit,true);
        seriesRow.append(fields);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.removeSeries = '';
        remove.textContent = 'Reading entfernen';
        remove.addEventListener('click',()=>{seriesRow.remove();markEdited();});
        seriesRow.append(remove);
        series.append(seriesRow);
      };
      for (const entry of systemMonitorAdditionalReadings(mapping)) addSeries(entry);
      controls.append(series);
      const add = document.createElement('button');
      add.type = 'button';
      add.dataset.addSeries = '';
      add.textContent = 'Weiteres Reading hinzufügen';
      add.addEventListener('click',()=>{
        addSeries({reading:'',unit:mapping.unit});
        markEdited();
      });
      controls.append(add);
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.dataset.resetMapping = '';
      reset.textContent = mapping.key.startsWith('custom-') ? 'Wertebox entfernen' : 'Automatische Erkennung verwenden';
      reset.addEventListener('click', () => {
        this.captureMappings();
        this.captureMetricSelection();
        this.mappingDraft = this.mappingDraft.filter(item => item.key !== mapping.key);
        if (mapping.key.startsWith('custom-')) this.metricSelection.delete(mapping.key);
        const source = this.shadowRoot.querySelector('[name="systemDevice"]').value;
        this.renderMappingOptions(this.configDevices || [], source);
        this.renderMetricOptions(this.configDevices || [], source);
      });
      controls.append(reset);
      row.append(controls);
      const updateVisibility = () => {
        controls.hidden = !checkbox.checked;
        for (const input of controls.querySelectorAll('input,select,button')) input.disabled = !checkbox.checked;
      };
      checkbox.addEventListener('change',()=>{this.captureMetricSelection();updateVisibility();});
      updateVisibility();
      container.append(row);
    }
    this.renderMetricOptions(devices,source);
  }

  captureMappings() {
    this.mappingDraft = [...this.shadowRoot.querySelectorAll('[data-mapping-row]')]
      .filter(row => row.dataset.automatic !== 'true')
      .map(row => ({key:row.dataset.mappingRow,...Object.fromEntries(
        [...row.querySelectorAll('[data-field]')].map(field => [field.dataset.field,field.value.trim()])),
        additionalReadings:[...row.querySelectorAll('[data-series-row]')].map(series => Object.fromEntries(
          [...series.querySelectorAll('[data-series-field]')].map(field=>[field.dataset.seriesField,field.value.trim()])))
      }));
  }

  async saveConfig() {
    if (this.busy) return;
    const form = this.shadowRoot.querySelector('[data-form]');
    const next = {...this.widgetConfig, systemDevice: form.elements.systemDevice.value};
    this.captureMappings();
    try { validateSystemMetricMappings(this.mappingDraft); }
    catch (error) { this.shadowRoot.querySelector('[data-config-error]').textContent = error.message; return; }
    if (this.mappingDraft.length) next.metricMappings = structuredClone(this.mappingDraft);
    else delete next.metricMappings;
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
      control.disabled = busy || !!control.closest('[data-mapping-controls][hidden]');
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
