import { Schema5WidgetSession } from './fcui-schema5-widget-session.js';
import { schema5GridItems } from './fcui-schema5-layout.js';
import { createWidgetElement } from './widget-factory.js';

const WIDGET_TYPES = [
  ['thermostat', 'Thermostat', 't', 4, 2, { device: '', readings: { actual: '', target: '' } }],
  ['fhem-value', 'Wert-Anzeige', 'v', 3, 2, { device: '', reading: '' }],
  ['fhem-switch', 'Schalter', 's', 3, 2, { device: '', reading: 'state', on: 'on', off: 'off' }],
  ['fhem-button', 'Taster', 'b', 3, 2, { device: '', command: '' }],
  ['fhem-html', 'Freies HTML', 'h', 4, 3, { html: '', devices: [] }],
  ['fhem-clock', 'Uhr / Datum', 'c', 3, 4, { style: 'digital', showSeconds: false, showDate: false, showWeekday: false }],
  ['fhem-icon', 'Status-Symbol', 'i', 2, 4, { device: '', reading: '', states: [] }],
  ['fhem-table', 'Tabelle', 'r', 6, 8, { rows: [] }],
  ['fhem-slider', 'Schieberegler', 'l', 4, 6, { device: '', command: '', reading: '' }],
  ['fhem-chart', 'Diagramm', 'g', 6, 10, { device: '', reading: '' }],
  ['fhem-solarflow', 'SolarFlow', 'f', 5, 14, { readings: {} }],
  ['text', 'Textbaustein', 'x', 6, 2, { html: '' }],
];

function element(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

export class Schema5WidgetPanel {
  #root;
  #controller;
  #services;
  #page;
  #state;
  #onClose;
  #list;
  #status;
  #close;
  #host;
  #mode;
  #search;
  #searchLabel;
  #session = null;
  #busy = false;
  #closed = false;
  #requiresReload = false;
  #createElement;

  constructor({ root, controller, services, pageId, token, onClose, widgetId, createElement = createWidgetElement }) {
    if (!root || root.children.length || !controller || typeof controller.snapshot !== 'function'
      || !services || typeof onClose !== 'function' || typeof createElement !== 'function') {
      throw new Error('Dienste und leerer Container für Widget-Verwaltung erforderlich');
    }
    const state = controller.snapshot();
    if (state.token !== token) throw new Error('Zustand ist veraltet; bitte erneut laden');
    const page = (state.draft || state.live).pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error('Unbekannte Seite');
    this.#root = root;
    this.#controller = controller;
    this.#services = services;
    this.#state = state;
    this.#page = pageId;
    this.#onClose = onClose;
    this.#createElement = createElement;
    this.#mode = widgetId ? 'edit' : 'add';
    this.#status = element('p');
    this.#status.setAttribute('role', 'status');
    this.#searchLabel = element('label', 'Suche ');
    this.#search = element('input');
    this.#search.type = 'search';
    this.#search.placeholder = 'Widget-Typ suchen …';
    this.#search.addEventListener('input', () => this.#render());
    this.#searchLabel.append(this.#search);
    this.#searchLabel.className = 'cms-widget-search';
    this.#list = element('div');
    this.#list.className = 'cms-widget-add-list';
    this.#host = element('div');
    this.#host.className = 'cms-widget-dialog-host';
    this.#close = element('button', 'Abbrechen');
    this.#close.className = 'cms-button cms-panel-close';
    this.#close.type = 'button';
    this.#close.addEventListener('click', () => {
      if (this.#busy || this.#session || this.#closed) return;
      const outcome = { requiresReload: this.#requiresReload };
      this.close();
      this.#onClose(outcome);
    });
    const footer = element('div');
    footer.className = 'cms-panel-footer';
    footer.append(this.#close);
    const heading = this.#mode === 'edit' ? 'Widget bearbeiten' : 'Widget hinzufügen';
    const hint = this.#mode === 'edit'
      ? 'Änderungen werden als Entwurf gespeichert.'
      : 'Widget-Typ wählen; das neue Widget wird als Entwurf gespeichert.';
    if (this.#mode === 'edit') {
      this.#searchLabel.hidden = true;
      this.#list.hidden = true;
    }
    root.append(element('h2', heading), element('p', hint),
      this.#status, this.#searchLabel, this.#list, this.#host, footer);
    this.#render();
    if (widgetId) {
      const widget = page.widgets.find((entry) => entry.id === widgetId);
      if (!widget) throw new Error('Unbekanntes Widget');
      this.#open(widget);
    }
  }

  #render() {
    this.#list.replaceChildren();
    if (this.#mode === 'edit') return;
    const query = this.#search.value.trim().toLowerCase();
    let matches = 0;
    for (const [type, name] of WIDGET_TYPES) {
      if (query && !name.toLowerCase().includes(query)) continue;
      matches += 1;
      const button = element('button', name);
      button.className = 'cms-button cms-widget-choice';
      button.type = 'button';
      button.addEventListener('click', () => {
        if (this.#closed || this.#busy || this.#session || this.#requiresReload) return;
        try {
          this.#open(this.#newWidget(type), 'create');
        } catch (error) {
          this.#status.setAttribute('data-error', '');
          this.#status.textContent = `Widget kann nicht angelegt werden: ${error.message || String(error)}`;
        }
      });
      this.#list.append(button);
    }
    if (!matches) this.#list.append(element('p', 'Kein Widget-Typ gefunden.'));
  }

  #newWidget(type) {
    const specification = WIDGET_TYPES.find((entry) => entry[0] === type);
    if (!specification) throw new Error('Unbekannter Widget-Typ');
    const config = this.#state.draft || this.#state.live;
    const page = config.pages.find((entry) => entry.id === this.#page);
    if (page.widgets.length >= 200) throw new Error('Die Seite enthält bereits 200 Widgets');
    const [, , prefix, w, h, fields] = specification;
    const ids = new Set(page.widgets.map((widget) => widget.id));
    let number = 1;
    while (ids.has(`${prefix}${number}`)) number += 1;
    const row = Math.max(Number(config.navigation.grid.row) + Number(config.navigation.grid.h),
      ...page.widgets.map((widget) => Number(widget.grid.row) + Number(widget.grid.h)));
    const scale = Number(config.settings.gridColumns) / 12;
    const widget = { id: `${prefix}${number}`, type, ...structuredClone(fields),
      grid: { col: 1, row, w: w * scale, h: h * scale } };
    const candidate = structuredClone(config);
    candidate.pages.find((entry) => entry.id === this.#page).widgets.push(widget);
    schema5GridItems(candidate, this.#page);
    return widget;
  }

  async #open(widget, action = 'update') {
    if (this.#closed || this.#busy || this.#session || this.#requiresReload) return;
    let session;
    try {
      session = new Schema5WidgetSession({ controller: this.#controller, pageId: this.#page,
        token: this.#state.token, widget, action });
      this.#session = session;
      this.#list.inert = true;
      this.#close.disabled = true;
      this.#status.textContent = 'Widgetdialog wird geöffnet …';
      const rejectCommand = async () => { throw new Error('Geräteaktionen sind im Widgetdialog gesperrt'); };
      const services = session.services({ ...this.#services, setCommand: rejectCommand, setTarget: rejectCommand });
      const invoke = (name) => async (...args) => {
        if (this.#closed || this.#busy) throw new Error('Widget-Bearbeitung ist nicht mehr aktiv');
        this.#busy = true;
        const dialog = item.shadowRoot.querySelector('[data-dialog]');
        const form = dialog?.querySelector('form');
        if (form) form.inert = true;
        try {
          return await services[name](...args);
        } finally {
          this.#busy = false;
          if (form) form.inert = false;
        }
      };
      const item = this.#createElement(session.widget, {
        ...services, saveWidget: invoke('saveWidget'), deleteWidget: invoke('deleteWidget'),
      }, new Map(), false);
      this.#host.append(item);
      const dialog = item.shadowRoot?.querySelector('[data-dialog]');
      const tile = item.shadowRoot?.querySelector('article');
      if (!dialog || !tile || typeof item.openConfig !== 'function') {
        throw new Error('Widget unterstützt keinen Konfigurationsdialog');
      }
      tile.inert = true;
      tile.hidden = true;
      tile.style.display = 'none';
      dialog.addEventListener('cancel', (event) => {
        if (this.#busy) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      dialog.addEventListener('close', () => {
        if (!this.#busy) session.close();
      });
      session.completion.then((outcome) => this.#finish(session, outcome));
      await item.openConfig({ isNew: action === 'create' });
      if (this.#closed || this.#session !== session) return;
      if (!dialog.open) throw new Error('Widgetdialog wurde nicht geöffnet');
      this.#root.setAttribute('data-widget-open', '');
      this.#status.textContent = '';
    } catch (error) {
      if (this.#closed) return;
      if (session) session.close();
      this.#session = null;
      this.#root.removeAttribute('data-widget-open');
      this.#host.replaceChildren();
      this.#list.inert = true;
      this.#requiresReload = true;
      this.#close.disabled = false;
      this.#status.setAttribute('data-error', '');
      this.#status.textContent = `Widgetdialog fehlgeschlagen: ${error.message || String(error)}. Bitte Zustand erneut laden.`;
    }
  }

  #finish(session, outcome) {
    if (this.#closed || this.#session !== session) return;
    this.#session = null;
    this.#root.removeAttribute('data-widget-open');
    this.#host.replaceChildren();
    this.#close.disabled = false;
    if (outcome.error) {
      this.#requiresReload = true;
      this.#list.inert = true;
      this.#status.setAttribute('data-error', '');
      this.#status.textContent = `Änderung nicht bestätigt: ${outcome.error.message || String(outcome.error)}. Bitte Zustand erneut laden.`;
      return;
    }
    if (outcome.state || this.#mode === 'edit') {
      // Gespeichert oder Direktbearbeitung beendet: Dialog schließen, Editor zeigt den Stand.
      const result = { requiresReload: false };
      this.close();
      this.#onClose(result);
      return;
    }
    this.#render();
    this.#list.inert = false;
    this.#status.removeAttribute('data-error');
    this.#status.textContent = 'Widgetdialog abgebrochen.';
  }

  suspend() {
    this.close();
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#session) this.#session.close();
    this.#session = null;
    this.#root.removeAttribute('data-widget-open');
    this.#root.replaceChildren();
  }
}
