import { openDevicePicker } from '../js/device-picker.js';
import { dialogGroupStyles, titleVisibilityField } from '../js/dialog-groups.js';
import { widgetDesignCss, detailCardCss } from '../js/widget-design.js';
import { createManualFieldTracker } from '../js/device-suggestions.js';
import { solarEnergySuggestions, suggestedSolarSource } from '../js/solar-energy-suggestions.js';
import {
  solarEnergyFields, solarYieldFields, MAX_SOLAR_SECTIONS, validateSolarEnergy,
  solarEnergyModel, solarNumber,
} from '../js/solar-energy.js';

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const EDGES = [
  ['pv', 'home', 'M450 95V225'], ['pv', 'bat', 'M450 155Q150 155 150 215'],
  ['pv', 'grid', 'M450 155Q750 155 750 215'], ['bat', 'home', 'M240 265H360'],
  ['home', 'grid', 'M540 265H660'], ['grid', 'bat', 'M750 155H150'],
];
const format = (value, digits = 1) => value === null ? '–'
  : value.toLocaleString('de-DE', { maximumFractionDigits: digits });
const compact = (value, digits) => value === null ? '–'
  : value.toLocaleString('en-US', { useGrouping: false, minimumFractionDigits: digits, maximumFractionDigits: digits });

class FHEMCMSSolarEnergy extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.snapshot = null;
    this.services = null;
    this.devices = [];
    this.isNew = false;
    this.dialogRevision = 0;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) return;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; min-height: 0; }
        * { box-sizing: border-box; }
        h3, p { margin: 0; }
        [hidden] { display: none !important; }
        ${widgetDesignCss}
        .tile { container-type: inline-size; padding: 16px; line-height: 1.3; }
        .tile > * { flex-shrink: 0; }
        .tile header h3[data-title] { line-height: 1.3; }
        .tile[data-stale] { opacity: .65; border-style: dashed; }
        header { flex-wrap: wrap; }
        .badge { padding: 3px 10px; border-radius: 20px; font-size: .8rem; font-weight: 600;
          color: #10b981; background: rgba(16,185,129,.16); border: 1px solid rgba(16,185,129,.35); }
        .flow { ${detailCardCss} display: grid; grid-template-columns: repeat(3,minmax(0,1fr));
          grid-template-rows: auto 80px auto; position: relative; flex: none;
          align-items: center; justify-items: center; padding: 16px 10px; }
        .node { min-width: 0; width: 100%; max-width: 180px; padding: 10px 12px; border: 1.5px solid var(--station-color);
          border-radius: 12px; text-align: center; position: relative; z-index: 1;
          background: rgba(128,128,128,.08); overflow-wrap: anywhere; }
        .pv { grid-column: 2; grid-row: 1; --station-color: #f59e0b; }
        .bat { grid-column: 1; grid-row: 3; --station-color: #10b981; }
        .home { grid-column: 2; grid-row: 3; --station-color: #3b82f6; }
        .grid { grid-column: 3; grid-row: 3; --station-color: #8b5cf6; }
        .node strong { display: block; font-size: 1.4rem; margin: 3px 0; color: var(--station-color); }
        .node small { display: block; font-size: .74rem; opacity: .78; }
        .node .label { display: block; font-size: .74rem; text-transform: uppercase; opacity: .8; }
        .paths { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .wire { fill: none; stroke: rgba(128,128,128,.22); stroke-width: 3; stroke-linecap: round; }
        .energy { fill: none; stroke: #f59e0b; stroke-width: 3.5; stroke-linecap: round; stroke-dasharray: 8 10;
          animation: energy-flow 1.1s linear infinite; }
        .energy[data-source="bat"] { stroke: #10b981; }
        .energy[data-source="grid"] { stroke: #ef4444; }
        .energy[data-reverse] { animation-direction: reverse; }
        @keyframes energy-flow { to { stroke-dashoffset: -18; } }
        @media (prefers-reduced-motion: reduce) { .energy { animation: none; } }
        progress { display: block; width: 100%; height: 5px; margin-top: 5px; accent-color: #10b981; }
        .sections { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,200px),1fr)); gap: 12px; }
        .yield { ${detailCardCss} min-width: 0; border-radius: 12px; padding: 12px; }
        .yield h4 { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0;
          margin: 0 0 5px; padding-bottom: 5px; border-bottom: 1px solid rgba(128,128,128,.2);
          overflow-wrap: anywhere; }
        .yield h4 small { font-size: .8em; opacity: .7; white-space: nowrap; }
        .yield dl { margin: 0; display: grid; gap: 5px; }
        .yield .row { display: flex; justify-content: space-between; gap: 8px; font-size: .86rem;
          border-bottom: 1px solid rgba(128,128,128,.1); padding: 2px 0; overflow-wrap: anywhere; }
        .yield .row:last-child { border: 0; }
        dt { opacity: .75; }
        dd { margin: 0; font-weight: 700; text-align: right; }
        .totals { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,140px),1fr)); gap: 10px;
          padding: 10px; border-radius: 12px; border: 1px solid rgba(245,158,11,.3); background: rgba(245,158,11,.1); text-align: center; }
        .total { padding: 8px 4px; border-radius: 8px; background: rgba(128,128,128,.08); overflow-wrap: anywhere; }
        .total span { display: block; opacity: .8; font-size: .74rem; text-transform: uppercase; }
        .total strong { display: block; font-size: 1.25rem; margin-top: 2px; color: #f59e0b; }
        .total:last-child { border: 1px solid rgba(245,158,11,.4); background: rgba(245,158,11,.12); }
        @container (max-width: 600px) {
          .flow { padding: 12px 4px; grid-template-rows: auto 60px auto; }
          .node { padding: 8px 3px; }
          .node strong { font-size: clamp(.85rem, 5cqi, 1.4rem); }
          .node .label, .node small { font-size: .65rem; }
          .tile header { flex-wrap: wrap; }
        }
        button, input, select { font: inherit; color: inherit; border: 1px solid var(--cms-border,#43564a);
          background: var(--cms-surface-raised,#2a3b32); border-radius: .5rem; padding: .4rem .6rem; }
        button { cursor: pointer; min-height: 48px; }
        button:focus-visible, input:focus-visible, select:focus-visible {
          outline: 2px solid var(--cms-accent,#8fd0a8); outline-offset: 2px; }
        :host([view-only]) [data-open-config] { display: none; }
        dialog { width: min(94vw,48rem); max-height: 94vh; overflow: auto; padding: 1.25rem;
          color: var(--cms-text,#edf4ef); background: var(--cms-surface,#202e27);
          border: 1px solid var(--cms-border,#43564a); border-radius: 1rem; }
        dialog::backdrop { background: var(--cms-backdrop,rgb(0 0 0 / .6)); }
        form { display: grid; gap: .75rem; }
        ${dialogGroupStyles}
        label { display: grid; gap: .25rem; min-width: 0; }
        input, select { width: 100%; min-width: 0; }
        input[type="checkbox"] { width: auto; }
        .check { display: flex; align-items: center; gap: .5rem; }
        .device-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: .5rem; }
        .source { display: grid; gap: .4rem; padding: .5rem 0; border-top: 1px solid var(--cms-border,#43564a); }
        .hint { margin: 0; font-size: .86rem; color: var(--cms-muted,#a5c9b2); overflow-wrap: anywhere; }
        .actions { display: flex; flex-wrap: wrap; gap: .5rem; justify-content: flex-end; }
        .error { min-height: 1em; color: var(--cms-danger,#ffb4a8); overflow-wrap: anywhere; }
      </style>
      <article class="tile">
        <button type="button" data-open-config aria-label="Solar und Energiefluss konfigurieren">⚙</button>
        <header><h3 data-title></h3><span class="badge" data-system hidden></span></header>
        <div class="flow" data-flow>
          <svg class="paths" viewBox="0 0 900 320" preserveAspectRatio="none" aria-hidden="true">
            ${EDGES.map(([a, b, d]) => `<g data-edge="${a}-${b}"><path class="wire" d="${d}"/>
              <path class="energy" d="${d}" hidden/></g>`).join('')}
          </svg>
          ${[['pv', '☀️ PV Erzeugung'], ['bat', '🔋 Speicher'], ['home', '🏠 Hausverbrauch'], ['grid', '⚡ Stromnetz']]
    .map(([key, label]) => `<div class="node ${key}" data-station="${key}"><span class="label">${label}</span>
              <strong data-power="${key}">–</strong><small data-note="${key}"></small>
              ${key === 'bat' ? '<progress max="100" aria-label="Speicher-Ladestand" hidden></progress>' : ''}</div>`).join('')}
        </div>
        <div class="sections" data-sections></div><div class="totals" data-totals hidden></div>
      </article>
      <dialog data-dialog aria-labelledby="solar-energy-title">
        <form data-form novalidate>
          <h3 id="solar-energy-title">Solar und Energiefluss konfigurieren</h3>
          <details class="config-group" open><summary>Allgemein</summary><div class="config-group-fields">
            <label>Titel<input name="title" maxlength="64" autocomplete="off"></label>${titleVisibilityField}
            <label>Einheit der Leistungs-Readings<select name="powerUnit"><option>W</option><option>kW</option></select></label>
            <label>Einheit der Ertrags-Readings<select name="energyUnit"><option>kWh</option><option>Wh</option><option>MWh</option></select></label>
            <label>Schwellwert in Watt<input name="threshold" type="number" min="0" max="1000" step="1"></label>
            <label class="check"><input name="deriveHome" type="checkbox">Fehlenden Hausverbrauch berechnen</label>
          </div></details>
          <details class="config-group" open><summary>Datenquellen</summary><div class="config-group-fields">
            <p class="hint">Jede Zuordnung darf ein anderes Device verwenden (höchstens 20).
              Netz: + Einspeisung / − Bezug. Speicher: + Laden / − Entladen.
              Fehlende Werte bleiben unbekannt. Das Widget sendet keine FHEM-Befehle.</p>
            <button type="button" data-shared-device>Gemeinsames Device für alle Felder wählen …</button>
            <button type="button" data-detect>Freie Felder automatisch zuordnen</button>
            <p class="hint" data-detection role="status"></p>
            <div data-sources></div>
          </div></details>
          <details class="config-group"><summary>Ertragskarten je Anlagenteil</summary><div class="config-group-fields">
            <div data-section-fields></div><button type="button" data-add-section>Ertragskarte hinzufügen</button>
          </div></details>
          <p class="error" data-error role="alert"></p>
          <div class="actions"><button type="button" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit" data-save>Speichern</button></div>
        </form>
      </dialog>`;
    this.$('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.$('[data-cancel]').addEventListener('click', () => this.closeConfig(false));
    this.$('[data-dialog]').addEventListener('cancel', event => { event.preventDefault(); this.closeConfig(false); });
    this.$('[data-form]').addEventListener('submit', event => { event.preventDefault(); this.saveConfig(); });
    this.$('[data-add-section]').addEventListener('click', () => this.addSection());
    this.$('[data-shared-device]').addEventListener('click', () => this.pickSource(null));
    this.manualFields = createManualFieldTracker(this.$('[data-form]'));
    this.$('[data-detect]').addEventListener('click', () => this.suggestSources());
    this.$('[data-delete]').addEventListener('click', async () => {
      if (!window.confirm('Dieses Widget entfernen?')) return;
      try { await this.services.deleteWidget(this.config.id); this.closeConfig(true); }
      catch (error) { this.error(`Entfernen fehlgeschlagen: ${error.message}`); }
    });
    this.render();
  }

  $(selector) { return this.shadowRoot.querySelector(selector); }
  set config(value) { this.widgetConfig = value; this.render(); }
  get config() { return this.widgetConfig; }
  set data(value) { this.snapshot = value; this.render(); }
  set stale(value) { this.$('.tile')?.toggleAttribute('data-stale', value !== null); }
  disconnectedCallback() { this.dialogRevision++; }
  error(message) { this.$('[data-error]').textContent = message; }

  render() {
    if (!this.config || !this.$('[data-flow]')) return;
    const config = this.config;
    const model = solarEnergyModel(config, this.snapshot);
    this.$('[data-title]').textContent = config.title || 'Solar und Energiefluss';
    this.$('[data-title]').hidden = config.showTitle === false;
    const badge = this.$('[data-system]');
    badge.hidden = !config.readings?.status;
    badge.textContent = `System: ${model.status || '–'}`;
    const energyUnit = config.energyUnit || 'kWh';
    const energy = (source, digits) => compact(solarNumber(source, this.snapshot), digits);
    for (const [key, value] of Object.entries(model.values)) {
      const sourceKey = key === 'bat' ? 'battery' : key;
      const station = this.$(`[data-station="${key}"]`);
      station.hidden = ['grid', 'bat'].includes(key) && !config.readings?.[sourceKey];
      this.$(`[data-power="${key}"]`).textContent = `${compact(value, ['pv', 'home'].includes(key) ? 1 : 0)} W`;
      station.dataset.state = value !== null && value < 0 ? 'negative' : 'neutral';
      const note = this.$(`[data-note="${key}"]`);
      if (key === 'pv') note.textContent = config.readings?.hour ? `Std: ${energy(config.readings.hour, 2)} ${energyUnit}` : '';
      if (key === 'home') note.textContent = 'Gesamtlast aktuell';
      if (key === 'bat') {
        station.querySelector('.label').textContent = `🔋 Speicher${config.readings?.soc ? ` (${model.soc === null ? '–' : format(model.soc, 0)}%)` : ''}`;
        note.textContent = '− Entladen / + Laden';
      }
      if (key === 'grid') note.textContent = '+ Einspeisung / − Bezug';
    }
    const progress = this.$('progress');
    progress.hidden = model.soc === null;
    if (model.soc === null) progress.removeAttribute('value');
    else progress.value = model.soc;
    for (const [a, b] of EDGES) {
      const group = this.$(`[data-edge="${a}-${b}"]`);
      group.hidden = this.$(`[data-station="${a}"]`).hidden || this.$(`[data-station="${b}"]`).hidden;
      // SVG g does not implement the HTML hidden property.
      group.style.display = group.hidden ? 'none' : '';
      const forward = model.flows[`${a}>${b}`] || 0;
      const reverse = model.flows[`${b}>${a}`] || 0;
      const line = group.querySelector('.energy');
      line.toggleAttribute('hidden', Math.max(forward, reverse) < Math.max(1, config.threshold ?? 10));
      group.querySelector('.wire').toggleAttribute('hidden', a === 'grid' && b === 'bat' && line.hasAttribute('hidden'));
      line.toggleAttribute('data-reverse', reverse > forward);
      line.dataset.source = reverse > forward ? b : a;
    }
    const sections = this.$('[data-sections]');
    sections.replaceChildren(...(config.sections || []).map(section => {
      const card = node('section', undefined, 'yield');
      const emoji = { dach: '🏠', garage: '🚗', gartenhaus: '🏡' }[section.label.toLocaleLowerCase('de-DE')];
      const heading = node('h4');
      heading.append(node('span', `${emoji ? `${emoji} ` : ''}${section.label} (${energyUnit})`));
      if (section.readings.total) heading.append(node('small', `∑ ${energy(section.readings.total, 0)}`));
      card.append(heading);
      const list = node('dl');
      for (const [key, label] of solarYieldFields.slice(1)) {
        if (!section.readings[key]) continue;
        const row = node('div', undefined, 'row');
        row.append(node('dt', label), node('dd', energy(section.readings[key], key === 'year' ? 0 : ['hour', 'day'].includes(key) ? 2 : 1)));
        list.append(row);
      }
      card.append(list);
      return card;
    }));
    const totals = this.$('[data-totals]');
    totals.replaceChildren(...[['day', 'Heute Gesamt'], ['month', 'Monat Gesamt'], ['year', 'Jahr Gesamt'], ['total', 'Gesamt seit Start']]
      .filter(([key]) => config.readings?.[key]).map(([key, label]) => {
        const box = node('div', undefined, 'total');
        box.append(node('span', label), node('strong', `${energy(config.readings[key], key === 'day' ? 2 : key === 'month' ? 1 : 0)} ${energyUnit}`));
        return box;
      }));
    totals.hidden = !totals.children.length;
  }

  sourceField(key, label, source) {
    const row = node('div', undefined, 'source');
    row.dataset.sourceKey = key;
    const deviceLabel = node('label', `${label}: Device`);
    const deviceRow = node('span', undefined, 'device-row');
    const input = node('input');
    input.readOnly = true;
    input.dataset.device = '';
    input.placeholder = 'Kein Device gewählt';
    const pick = node('button', 'Auswählen …');
    pick.type = 'button';
    const choose = () => this.pickSource(row);
    input.addEventListener('click', choose);
    pick.addEventListener('click', choose);
    deviceRow.append(input, pick);
    deviceLabel.append(deviceRow);
    const readingLabel = node('label', `${label}: Reading${key === 'pv' ? ' (Pflicht)' : ' (optional)'}`);
    const select = node('select');
    select.dataset.reading = '';
    readingLabel.append(select);
    row.append(deviceLabel, readingLabel);
    this.setSource(row, source?.device || '', source?.reading || '');
    return row;
  }

  setSource(row, device, reading) {
    row.querySelector('[data-device]').value = device;
    const select = row.querySelector('[data-reading]');
    const names = Object.keys(this.devices.find(entry => entry.name === device)?.readings || {}).sort();
    if (reading && !names.includes(reading)) names.unshift(reading);
    select.replaceChildren(new Option('– nicht verwenden –', ''), ...names.map(name => new Option(name, name)));
    select.value = reading;
    select.disabled = !device;
  }

  async pickSource(row) {
    const revision = this.dialogRevision;
    try {
      const device = await openDevicePicker({ services: this.services, owner: this.shadowRoot });
      if (!device || revision !== this.dialogRevision) return;
      if (!this.devices.some(entry => entry.name === device.name)) this.devices.push(device);
      for (const field of row ? [row] : this.shadowRoot.querySelectorAll('.source')) {
        const previous = field.querySelector('[data-reading]').value;
        const label = field.closest('[data-section]')?.querySelector('[data-section-label]').value;
        const reading = Object.hasOwn(device.readings || {}, previous) ? previous
          : suggestedSolarSource(device, field.dataset.sourceKey, label)?.reading || '';
        this.setSource(field, device.name, reading);
      }
      if (!row || (row.parentElement === this.$('[data-sources]') && row.dataset.sourceKey === 'pv')) {
        this.suggestSources(device.name);
      }
    } catch (error) { this.error(`Device-Auswahl fehlgeschlagen: ${error.message}`); }
  }

  suggestSources(preferredDevice) {
    const pv = this.$('[data-sources] [data-source-key="pv"] [data-device]').value;
    const suggestion = solarEnergySuggestions(this.devices, preferredDevice || pv);
    let count = 0;
    for (const row of this.$('[data-sources]').children) {
      const input = row.querySelector('[data-device]');
      const select = row.querySelector('[data-reading]');
      const candidate = suggestion.readings[row.dataset.sourceKey];
      if (!candidate || select.value || this.manualFields.isEdited(select)) continue;
      if (input.value && input.value !== candidate.device) continue;
      this.setSource(row, candidate.device, candidate.reading);
      count++;
    }
    if (!this.$('[data-section-fields]').children.length && !this.manualSections) {
      for (const section of suggestion.sections) { this.addSection(section); count++; }
    }
    const anchor = preferredDevice || pv || suggestion.readings.pv?.device;
    for (const section of this.$('[data-section-fields]').children) {
      const label = section.querySelector('[data-section-label]').value.trim();
      if (!label) continue;
      for (const row of section.querySelectorAll('.source')) {
        const select = row.querySelector('[data-reading]');
        if (select.value || this.manualFields.isEdited(select)) continue;
        const name = row.querySelector('[data-device]').value || anchor;
        const device = this.devices.find(entry => entry.name === name);
        const candidate = suggestedSolarSource(device, row.dataset.sourceKey, label);
        if (!candidate) continue;
        this.setSource(row, candidate.device, candidate.reading);
        count++;
      }
    }
    this.$('[data-detection]').textContent = suggestion.ambiguous
      ? 'Mehrere PV-Devices erkannt. Bitte zuerst das PV-Device oder ein gemeinsames Device wählen.'
      : count ? `${count} Zuordnungen/Ertragskarten vorgeschlagen. Bitte Quellen, Einheiten und Vorzeichen prüfen.`
        : 'Keine weiteren eindeutigen Zuordnungen gefunden. Vorhandene und manuelle Eingaben bleiben erhalten.';
  }

  addSection(section = { label: '', readings: {} }) {
    const box = this.$('[data-section-fields]');
    if (box.children.length >= MAX_SOLAR_SECTIONS) { this.error(`Höchstens ${MAX_SOLAR_SECTIONS} Ertragskarten.`); return; }
    const details = node('details', undefined, 'config-group');
    details.dataset.section = '';
    details.open = true;
    details.append(node('summary', 'Ertragskarte'));
    const fields = node('div', undefined, 'config-group-fields');
    const label = node('label', 'Name des Anlagenteils');
    const input = node('input');
    input.maxLength = 64;
    input.dataset.sectionLabel = '';
    input.value = section.label;
    label.append(input);
    fields.append(label, ...solarYieldFields.map(([key, name]) => this.sourceField(key, name, section.readings[key])));
    const remove = node('button', 'Ertragskarte entfernen');
    remove.type = 'button';
    remove.addEventListener('click', () => { this.manualSections = true; details.remove(); });
    fields.append(remove);
    details.append(fields);
    box.append(details);
  }

  async openConfig({ isNew = false } = {}) {
    this.isNew = isNew;
    const revision = ++this.dialogRevision;
    const config = this.config;
    const form = this.$('[data-form]');
    form.elements.title.value = config.title || '';
    form.elements.showTitle.checked = config.showTitle !== false;
    form.elements.powerUnit.value = config.powerUnit || 'W';
    form.elements.energyUnit.value = config.energyUnit || 'kWh';
    form.elements.threshold.value = config.threshold ?? 10;
    form.elements.deriveHome.checked = config.deriveHome !== false;
    this.$('[data-delete]').hidden = isNew;
    this.error('');
    this.$('[data-detection]').textContent = '';
    this.$('[data-save]').disabled = true;
    for (const selector of ['[data-detect]', '[data-shared-device]', '[data-add-section]']) {
      this.$(selector).disabled = true;
    }
    this.$('[data-dialog]').showModal();
    try {
      this.devices = await this.services.listAllDevices();
      if (revision !== this.dialogRevision || !this.isConnected) return;
      this.$('[data-sources]').replaceChildren(...solarEnergyFields.map(([key, label]) => this.sourceField(key, label, config.readings?.[key])));
      this.$('[data-section-fields]').replaceChildren();
      for (const section of config.sections || []) this.addSection(section);
      this.manualFields.reset();
      this.manualSections = false;
      if (isNew) this.suggestSources();
      this.$('[data-save]').disabled = false;
      for (const selector of ['[data-detect]', '[data-shared-device]', '[data-add-section]']) {
        this.$(selector).disabled = false;
      }
    } catch (error) { if (revision === this.dialogRevision) this.error(`Devices konnten nicht geladen werden: ${error.message}`); }
  }

  async saveConfig() {
    if (this.$('[data-save]').disabled) return;
    const form = this.$('[data-form]');
    const collect = box => Object.fromEntries([...box.querySelectorAll('.source')].flatMap(row => {
      const device = row.querySelector('[data-device]').value;
      const reading = row.querySelector('[data-reading]').value;
      return device && reading ? [[row.dataset.sourceKey, { device, reading }]] : [];
    }));
    const next = {
      id: this.config.id, type: 'fhem-solar-energy', grid: { ...this.config.grid },
      readings: collect(this.$('[data-sources]')),
      sections: [...this.$('[data-section-fields]').children].map(section => ({
        label: section.querySelector('[data-section-label]').value.trim(), readings: collect(section),
      })),
      powerUnit: form.elements.powerUnit.value, energyUnit: form.elements.energyUnit.value,
      threshold: Number(form.elements.threshold.value), deriveHome: form.elements.deriveHome.checked,
    };
    const title = form.elements.title.value.trim();
    if (title) next.title = title;
    if (!form.elements.showTitle.checked) next.showTitle = false;
    try {
      if (title.length > 64 || /[\u0000-\u001f\u007f]/.test(title)) throw new Error('Ungültiger Titel.');
      if (!form.elements.threshold.value.trim()) throw new Error('Bitte einen Schwellwert eingeben.');
      validateSolarEnergy(next);
      this.$('[data-save]').disabled = true;
      await this.services.saveWidget(next);
      this.closeConfig(true);
    } catch (error) { this.error(`Speichern fehlgeschlagen: ${error.message}`); }
    finally { this.$('[data-save]').disabled = false; }
  }

  closeConfig(saved) {
    this.dialogRevision++;
    this.$('[data-dialog]').close();
    if (!saved && this.isNew) this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true }));
  }
}

if (!customElements.get('cms-solar-energy')) customElements.define('cms-solar-energy', FHEMCMSSolarEnergy);
