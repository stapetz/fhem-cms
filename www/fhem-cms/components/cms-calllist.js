import { openDevicePicker } from '../js/device-picker.js';
import { widgetDesignCss } from '../js/widget-design.js';
import { isValidName } from '../js/fhem-client.js';
import { dialogGroupStyles, titleVisibilityField } from '../js/dialog-groups.js';

const COLUMNS = [
  ['state', 'Status'], ['party', 'Name oder Nummer'], ['timestamp', 'Datum / Uhrzeit'],
  ['duration', 'Dauer'], ['name', 'Name'], ['number', 'Nummer'],
  ['internal', 'Intern'], ['external', 'Extern'], ['connection', 'Verbindung'],
];
const DEFAULT_COLUMNS = ['state', 'party', 'timestamp', 'duration'];
const LABELS = new Map(COLUMNS);

function safeText(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 256) : '';
}

function stateInfo(value) {
  const states = {
    '=>': ['↘', 'Eingehend: angenommen'],
    '<=': ['↗', 'Ausgehend: abgeschlossen'],
    '=> X': ['✕', 'Eingehend: verpasst'],
    '<= X': ['✕', 'Ausgehend: nicht zustande gekommen'],
    '=> O_O': ['▣', 'Anrufbeantworter'],
    '=> [=]': ['☎', 'Eingehend: verbunden'],
    '<= [=]': ['☎', 'Ausgehend: verbunden'],
    '=> ((o))': ['◌', 'Eingehend: klingelt'],
    '<= ((o))': ['◌', 'Ausgehend: klingelt'],
  };
  return Object.hasOwn(states, value) ? states[value]
    : ['?', value ? `Unbekannter Status: ${value}` : 'Status nicht verfügbar'];
}

function callRows(snapshot, device, limit) {
  const item = Array.isArray(snapshot) ? snapshot.find(entry => entry.name === device) : null;
  const readings = item?.readings || {};
  const indexes = new Set();
  for (const key of Object.keys(readings)) {
    const match = /^([1-9][0-9]{0,3})-(?:state|name|number|timestamp|duration|internal|external|connection)$/.exec(key);
    if (match) indexes.add(Number(match[1]));
  }
  return [...indexes].sort((a, b) => a - b).slice(0, limit).map(index => {
    const row = {};
    for (const field of ['state', 'name', 'number', 'timestamp', 'duration', 'internal', 'external', 'connection']) {
      row[field] = safeText(readings[`${index}-${field}`]);
    }
    return row;
  });
}

class FHEMCMSCallList extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.snapshot = null;
    this.services = null;
    this.isNew = false;
    this.deviceLookupRevision = 0;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) return;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; min-width:0; min-height:0; }
        * { box-sizing:border-box; }
        .tile { height:100%; overflow:auto; container-type:size; border:1px solid var(--cms-frame,#7f8c84);
          border-radius:1.2rem; background:var(--cms-surface,#202e27); padding:.6rem; }
        .tile[data-stale] { opacity:.65; border-style:dashed; }
        header { padding:0 2rem .4rem .2rem; }
        h3 { margin:0; color:var(--cms-muted,#a5c9b2); font-weight:400; }
        [data-title] { text-align:var(--cms-widget-title-align,left); font-size:max(6px,min(8cqh,4cqw)); }
        table { width:100%; border-collapse:collapse; font-size:clamp(.875rem,3cqh,1rem); }
        th,td { text-align:left; padding:.3rem .4rem; border-bottom:1px solid var(--cms-border-subtle,#3a4d42); overflow-wrap:anywhere; }
        th { color:var(--cms-muted-strong,#c4d0c8); font-weight:500; }
        .status { font-size:1.15em; font-weight:bold; }
        .gear { float:right; }
        :host([view-only]) .gear { display:none; }
        dialog { width:min(94vw,36rem); max-height:94vh; overflow:auto; padding:1.25rem;
          border:1px solid var(--cms-border,#43564a); border-radius:1rem;
          background:var(--cms-surface,#202e27); color:var(--cms-text,#edf4ef); }
        dialog::backdrop { background:var(--cms-backdrop,rgb(0 0 0 / .6)); }
        form { display:grid; gap:.75rem; }
        ${dialogGroupStyles}
        label { display:grid; gap:.25rem; }
        fieldset { display:flex; flex-wrap:wrap; gap:.6rem; }
        fieldset label, .check { display:flex; align-items:center; gap:.35rem; }
        button,input { font:inherit; color:inherit; border:1px solid var(--cms-border,#43564a);
          border-radius:.5rem; background:var(--cms-surface-raised,#2a3b32); padding:.35rem .55rem; }
        button { cursor:pointer; }
        input[type=text],input[type=number] { background:var(--cms-bg,#17211d); }
        .device { display:flex; gap:.4rem; } .device input { min-width:0; flex:1; }
        .actions { display:flex; flex-wrap:wrap; gap:.5rem; justify-content:flex-end; }
        .error { color:var(--cms-danger,#ffb4a8); }
        .hint { color:var(--cms-muted,#a5c9b2); font-size:.8rem; }
        [data-message]:empty { display:none; }
        [hidden] { display:none !important; }
        ${widgetDesignCss}
        .tile table { font-size: .875rem; table-layout: fixed; color: inherit;
          border: 1px solid rgba(128,128,128,.18); border-radius: 14px;
          background: rgba(128,128,128,.08); border-spacing: 0; border-collapse: separate; }
        .tile th, .tile td { padding: 6px 8px; border-bottom: 1px solid rgba(128,128,128,.1); }
        .tile th { color: inherit; font-weight: 700; }
      </style>
      <article class="tile" data-tile>
        <button type="button" class="gear" data-open-config aria-label="Anrufliste konfigurieren">⚙</button>
        <header data-header><h3 data-title></h3></header>
        <p data-message class="hint"></p>
        <table data-table><thead><tr data-head></tr></thead><tbody data-rows></tbody></table>
      </article>
      <dialog data-dialog aria-labelledby="calllist-title">
        <form data-form novalidate>
          <h3 id="calllist-title">Anrufliste konfigurieren</h3>
          <details class="config-group" open><summary>Allgemein</summary>
            <div class="config-group-fields">
              <label>Titel (optional)<input name="title" type="text" maxlength="64" autocomplete="off"></label>
              ${titleVisibilityField}
            </div>
          </details>
          <details class="config-group" open><summary>Datenquelle</summary>
            <div class="config-group-fields">
              <label>FB_CALLLIST-Device<span class="device"><input name="device" type="text" readonly>
                <button type="button" data-pick>Wählen …</button></span></label>
              <p class="hint" data-detection role="status"></p>
            </div>
          </details>
          <details class="config-group"><summary>Tabellenanzeige</summary>
            <div class="config-group-fields">
              <label>Anzahl Anrufe (1–20)<input name="limit" type="number" min="1" max="20" step="1" required></label>
              <fieldset><legend>Sichtbare Spalten</legend><div data-columns></div></fieldset>
            </div>
          </details>
          <p class="hint">Das Device benötigt create-readings 1 und passende visible-columns.
            Es werden höchstens die dort bereitgestellten Anrufe angezeigt.</p>
          <p class="error" data-error role="alert"></p>
          <div class="actions"><button type="button" data-delete>Entfernen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit">Speichern</button></div>
        </form>
      </dialog>`;
    const columns = this.shadowRoot.querySelector('[data-columns]');
    for (const [key, label] of COLUMNS) {
      const wrapper = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = key;
      checkbox.dataset.column = key;
      wrapper.append(checkbox, document.createTextNode(` ${label}`));
      columns.append(wrapper);
    }
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.shadowRoot.querySelector('[data-pick]').addEventListener('click', () => this.pickDevice());
    this.shadowRoot.querySelector('[name="device"]').addEventListener('click', () => this.pickDevice());
    this.shadowRoot.querySelector('[data-cancel]').addEventListener('click', () => this.closeConfig(false));
    this.shadowRoot.querySelector('[data-delete]').addEventListener('click', () => this.deleteWidget());
    this.shadowRoot.querySelector('[data-form]').addEventListener('submit', event => { event.preventDefault(); this.saveConfig(); });
    this.shadowRoot.querySelector('[data-dialog]').addEventListener('cancel', event => { event.preventDefault(); this.closeConfig(false); });
    this.render();
  }

  set config(value) { this.widgetConfig = value; this.render(); }
  get config() { return this.widgetConfig; }
  set data(value) { this.snapshot = value; this.render(); }
  set stale(value) { this.shadowRoot.querySelector('[data-tile]')?.toggleAttribute('data-stale', value !== null); }

  async openConfig({ isNew = false } = {}) {
    const revision = ++this.deviceLookupRevision;
    this.isNew = isNew;
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    form.elements.device.value = this.widgetConfig.device || '';
    form.elements.limit.value = String(this.widgetConfig.limit ?? 5);
    for (const checkbox of form.querySelectorAll('[data-column]')) {
      checkbox.checked = (this.widgetConfig.columns || DEFAULT_COLUMNS).includes(checkbox.value);
    }
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    const detection = this.shadowRoot.querySelector('[data-detection]');
    detection.textContent = isNew && !form.elements.device.value ? 'Suche nach FB_CALLLIST-Devices …' : '';
    this.shadowRoot.querySelector('[data-dialog]').showModal();
    if (isNew && !form.elements.device.value) {
      try {
        const devices = await this.services.listAllDevices();
        const matches = devices.filter(device => device.type === 'FB_CALLLIST' && isValidName(device.name));
        if (revision === this.deviceLookupRevision && this.shadowRoot.querySelector('[data-dialog]').open
          && !form.elements.device.value) {
          if (matches.length === 1) {
            form.elements.device.value = matches[0].name;
            detection.textContent = 'FB_CALLLIST-Device automatisch ausgewählt.';
          } else {
            detection.textContent = matches.length ? 'Mehrere FB_CALLLIST-Devices gefunden. Bitte eines auswählen.'
              : 'Kein FB_CALLLIST-Device gefunden.';
          }
        }
      } catch (error) {
        if (revision === this.deviceLookupRevision && this.shadowRoot.querySelector('[data-dialog]').open) {
          detection.textContent = '';
          this.shadowRoot.querySelector('[data-error]').textContent = `Device-Erkennung fehlgeschlagen: ${error.message}`;
        }
      }
    }
  }

  async pickDevice() {
    this.deviceLookupRevision++;
    this.shadowRoot.querySelector('[data-detection]').textContent = '';
    try {
      const selected = await openDevicePicker({ services: this.services, title: 'FB_CALLLIST auswählen',
        accept: item => item.type === 'FB_CALLLIST' });
      if (selected) this.shadowRoot.querySelector('[name=device]').value = selected.name;
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
    }
  }

  async saveConfig() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const title = form.elements.title.value.trim();
    const device = form.elements.device.value.trim();
    const rawLimit = form.elements.limit.value;
    const limit = Number(rawLimit);
    const columns = [...form.querySelectorAll('[data-column]:checked')].map(input => input.value);
    const error = this.shadowRoot.querySelector('[data-error]');
    if (!isValidName(device)) { error.textContent = 'Bitte ein gültiges FB_CALLLIST-Device auswählen.'; return; }
    if (!/^(?:[1-9]|1[0-9]|20)$/.test(rawLimit)) { error.textContent = 'Die Anzahl muss zwischen 1 und 20 liegen.'; return; }
    if (!columns.length) { error.textContent = 'Bitte mindestens eine Spalte auswählen.'; return; }
    if (title.length > 64 || /[\u0000-\u001f\u007f]/.test(title)) { error.textContent = 'Der Titel ist ungültig.'; return; }
    const next = { id: this.widgetConfig.id, type: 'fhem-calllist', device, limit, columns, grid: { ...this.widgetConfig.grid } };
    if (title) next.title = title;
    if (!form.elements.showTitle.checked) next.showTitle = false;
    try { await this.services.saveWidget(next); this.closeConfig(true); }
    catch (failure) { error.textContent = `Speichern fehlgeschlagen: ${failure.message}`; }
  }

  async deleteWidget() {
    if (!window.confirm('Diese Anrufliste entfernen?')) return;
    try { await this.services.deleteWidget(this.widgetConfig.id); this.closeConfig(true); }
    catch (error) { this.shadowRoot.querySelector('[data-error]').textContent = `Entfernen fehlgeschlagen: ${error.message}`; }
  }

  closeConfig(saved) {
    this.deviceLookupRevision++;
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) dialog.close();
    if (!saved && this.isNew) this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true }));
  }

  render() {
    if (!this.widgetConfig || !this.shadowRoot.querySelector('[data-rows]')) return;
    const title = this.shadowRoot.querySelector('[data-title]');
    title.textContent = this.widgetConfig.title || '';
    this.shadowRoot.querySelector('[data-header]').hidden = !this.widgetConfig.title || this.widgetConfig.showTitle === false;
    const columns = this.widgetConfig.columns || DEFAULT_COLUMNS;
    const rows = callRows(this.snapshot, this.widgetConfig.device, this.widgetConfig.limit ?? 5);
    const head = this.shadowRoot.querySelector('[data-head]');
    head.replaceChildren(...columns.map(column => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = LABELS.get(column) || column;
      return th;
    }));
    this.shadowRoot.querySelector('[data-rows]').replaceChildren(...rows.map(row => {
      const tr = document.createElement('tr');
      for (const column of columns) {
        const td = document.createElement('td');
        if (column === 'state') {
          const [symbol, label] = stateInfo(row.state);
          td.className = 'status';
          td.textContent = symbol;
          td.title = label;
          td.setAttribute('aria-label', label);
        } else if (column === 'party') {
          td.textContent = row.name && row.name !== '-' ? row.name : (row.number || '–');
        } else {
          td.textContent = row[column] || '–';
        }
        tr.append(td);
      }
      return tr;
    }));
    this.shadowRoot.querySelector('[data-table]').hidden = rows.length === 0;
    const readings = Array.isArray(this.snapshot)
      ? this.snapshot.find(entry => entry.name === this.widgetConfig.device)?.readings : null;
    const present = new Set(Object.keys(readings || {}).map(key => {
      const match = /^[1-9][0-9]{0,3}-(.+)$/.exec(key);
      return match?.[1];
    }));
    const missing = columns.some(column => column === 'party'
      ? !present.has('name') && !present.has('number') : !present.has(column));
    this.shadowRoot.querySelector('[data-message]').textContent = rows.length
      ? (missing ? 'Einige Spalten fehlen in den Readings. visible-columns am Device prüfen.' : '')
      : readings?.['count-all'] === '0' ? 'Keine Anrufe vorhanden.'
        : 'Keine Anruf-Readings verfügbar. create-readings und visible-columns am Device prüfen.';
  }
}

if (!customElements.get('cms-calllist')) customElements.define('cms-calllist', FHEMCMSCallList);
