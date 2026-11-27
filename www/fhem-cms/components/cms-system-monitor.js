import { showCmsModal } from '../js/modal-dialog.js';
import { createWidgetIconButton, widgetDesignCss, widgetIconButtonCss } from '../js/widget-design.js';
import { loadSystemMonitorDevices, systemMonitorSnapshot } from '../js/system-monitor.js';
import { formatDateDisplay } from '../js/date-display.js';
import { titleVisibilityField } from '../js/dialog-groups.js';

class FHEMCMSSystemMonitor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'});
    this.widgetConfig = null;
    this.services = null;
    this.generation = 0;
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
        .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr)); gap:.5rem; }
        .metric { padding:.65rem; border:1px solid var(--cms-border); border-radius:.6rem; overflow-wrap:anywhere; }
        .metric span, .metric strong { display:block; }
        .metric span { color:var(--cms-muted); font-size:.8em; }
        .status { color:var(--cms-muted); }
        [data-error] { color:var(--cms-danger); }
        dialog { width:min(94vw,48rem); max-height:90vh; overflow:auto; padding:1.25rem;
          border:1px solid var(--cms-border); border-radius:1rem;
          background:var(--cms-surface); color:var(--cms-text); }
        dialog::backdrop { background:var(--cms-backdrop,rgb(0 0 0 / .6)); }
        dialog h2 { margin-top:0; }
        form { display:grid; gap:1rem; }
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
        <div class="metrics" data-metrics></div>
      </article>
      <dialog data-details aria-label="Systemmonitor Details">
        <h2>FHEM- und Systemstatus</h2>
        <p data-detail-status></p>
        <h3>System</h3><div data-detail-metrics></div>
        <h3>DbLog und FileLog</h3><div data-logs></div>
        <p>Datei- und Datenbankgrößen werden nur angezeigt, wenn passende Readings vorhanden sind; sie werden nicht selbst ermittelt.</p>
      </dialog>
      <dialog data-dialog aria-labelledby="system-monitor-config-title">
        <form data-form>
          <h2 id="system-monitor-config-title">Systemmonitor konfigurieren</h2>
          <label>Titel<input name="title" maxlength="64" autocomplete="off"></label>
          ${titleVisibilityField}
          <label>Systemquelle (SYSMON)<select name="systemDevice"><option value="">Keine Systemquelle ausgewählt</option></select></label>
          <p>Wähle ausdrücklich das SYSMON-Device des FHEM-Rechners. Ohne SYSMON bleiben Systemwerte unbekannt.</p>
          <p data-config-error role="alert"></p>
          <div class="actions"><button type="button" data-delete>Widget löschen</button><button type="button" data-cancel>Abbrechen</button><button type="submit">Speichern</button></div>
        </form>
      </dialog>`;
    const info = createWidgetIconButton('info', 'Systemstatus Details öffnen');
    info.addEventListener('click', () => showCmsModal(this.shadowRoot.querySelector('[data-details]')));
    this.shadowRoot.querySelector('[data-info]').append(info);
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.shadowRoot.querySelector('[data-cancel]').addEventListener('click', () => this.closeConfig(false));
    this.shadowRoot.querySelector('[data-delete]').addEventListener('click', () => this.deleteWidget());
    this.shadowRoot.querySelector('[data-form]').addEventListener('submit', event => {
      event.preventDefault();
      void this.saveConfig();
    });
    this.shadowRoot.querySelector('[data-dialog]').addEventListener('cancel', event => {
      event.preventDefault();
      this.closeConfig(false);
    });
    this.renderTitle();
    void this.refresh();
  }

  disconnectedCallback() {
    this.generation++;
    clearTimeout(this.timer);
  }

  set config(value) { this.widgetConfig = value; this.renderTitle(); }
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
    try {
      const devices = await loadSystemMonitorDevices(this.services?.systemMonitorDevices);
      if (!this.isConnected || generation !== this.generation) return;
      this.snapshot = systemMonitorSnapshot(devices, this.widgetConfig?.systemDevice || '');
      this.render();
    } catch (error) {
      if (!this.isConnected || generation !== this.generation) return;
      this.shadowRoot.querySelector('[data-status]').textContent = `FHEM-Abfrage fehlgeschlagen: ${error.message}`;
      this.shadowRoot.querySelector('[data-detail-status]').textContent = 'Daten nicht aktuell; letzte Werte werden gegebenenfalls weiter angezeigt.';
    } finally {
      if (this.isConnected && generation === this.generation) this.timer = setTimeout(() => this.refresh(), 60000);
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
    metrics.replaceChildren();
    details.replaceChildren();
    for (const [index, item] of snapshot.metrics.entries()) {
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
      if ([0, 2, 5].includes(index)) metrics.append(row.cloneNode(true));
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
    try {
      const devices = await loadSystemMonitorDevices(this.services?.systemMonitorDevices);
      for (const device of systemMonitorSnapshot(devices).systems) {
        select.add(new Option(device.alias ? `${device.name} (${device.alias})` : device.name, device.name));
      }
      if (this.widgetConfig?.systemDevice && ![...select.options].some(option => option.value === this.widgetConfig.systemDevice)) {
        select.add(new Option(`${this.widgetConfig.systemDevice} (nicht verfügbar)`, this.widgetConfig.systemDevice));
      }
      select.value = this.widgetConfig?.systemDevice || '';
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

  async saveConfig() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const next = {...this.widgetConfig, systemDevice: form.elements.systemDevice.value};
    if (form.elements.showTitle.checked) delete next.showTitle;
    else next.showTitle = false;
    const title = form.elements.title.value.trim();
    if (title) next.title = title;
    else delete next.title;
    try {
      await this.services.saveWidget(next);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-config-error]').textContent = `Speichern fehlgeschlagen: ${error.message}`;
    }
  }

  async deleteWidget() {
    if (!window.confirm('Systemmonitor entfernen?')) return;
    try {
      await this.services.deleteWidget(this.widgetConfig.id);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-config-error]').textContent = `Entfernen fehlgeschlagen: ${error.message}`;
    }
  }

  closeConfig(saved) {
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) dialog.close();
    if (!saved && this.isNew) this.dispatchEvent(new CustomEvent('cms-widget-cancel', {bubbles:true}));
  }
}

if (!customElements.get('cms-system-monitor')) customElements.define('cms-system-monitor', FHEMCMSSystemMonitor);
