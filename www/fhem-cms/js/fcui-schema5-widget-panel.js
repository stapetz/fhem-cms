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
  #session = null;
  #busy = false;
  #closed = false;
  #requiresReload = false;
  #createElement;

  constructor({ root, controller, services, pageId, token, onClose, createElement = createWidgetElement }) {
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
    this.#status = element('p');
    this.#status.setAttribute('role', 'status');
    this.#list = element('div');
    this.#host = element('div');
    this.#close = element('button', 'Schließen');
    this.#close.type = 'button';
    this.#close.addEventListener('click', () => {
      if (this.#busy || this.#session || this.#closed) return;
      const outcome = { requiresReload: this.#requiresReload };
      this.close();
      this.#onClose(outcome);
    });
    root.append(element('h2', `Widgets auf ${page.title} bearbeiten`),
      element('p', 'Änderungen werden als Entwurf gespeichert.'), this.#status, this.#list, this.#host, this.#close);
    this.#render();
  }

  #render() {
    this.#list.replaceChildren();
    const page = (this.#state.draft || this.#state.live).pages.find((entry) => entry.id === this.#page);
    if (!page.widgets.length) this.#list.append(element('p', 'Diese Seite enthält noch keine Widgets.'));
    for (const widget of page.widgets) {
      const button = element('button', `${widget.title || widget.id} (${widget.type}) bearbeiten`);
      button.type = 'button';
      button.addEventListener('click', () => this.#open(widget));
      this.#list.append(button);
    }
    const form = element('form');
    const label = element('label', 'Widget-Typ ');
    const select = element('select');
    for (const [type, name] of WIDGET_TYPES) {
      const option = element('option', name);
      option.value = type;
      select.append(option);
    }
    label.append(select);
    const add = element('button', 'Widget hinzufügen');
    add.type = 'submit';
    form.append(label, add);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.#closed || this.#busy || this.#session || this.#requiresReload) return;
      try {
        this.#open(this.#newWidget(select.value), 'create');
      } catch (error) {
        this.#status.setAttribute('data-error', '');
        this.#status.textContent = `Widget kann nicht angelegt werden: ${error.message || String(error)}`;
      }
    });
    this.#list.append(form);
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
    const widget = { id: `${prefix}${number}`, type, ...structuredClone(fields), grid: { col: 1, row, w, h } };
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
      this.#status.textContent = '';
    } catch (error) {
      if (this.#closed) return;
      if (session) session.close();
      this.#session = null;
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
    this.#host.replaceChildren();
    this.#close.disabled = false;
    if (outcome.error) {
      this.#requiresReload = true;
      this.#list.inert = true;
      this.#status.setAttribute('data-error', '');
      this.#status.textContent = `Änderung nicht bestätigt: ${outcome.error.message || String(outcome.error)}. Bitte Zustand erneut laden.`;
    } else {
      if (outcome.state) this.#state = outcome.state;
      this.#render();
      this.#list.inert = false;
      this.#status.removeAttribute('data-error');
      this.#status.textContent = outcome.state ? 'Änderung als Entwurf gespeichert.' : 'Widgetdialog abgebrochen.';
    }
  }

  suspend() {
    this.close();
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#session) this.#session.close();
    this.#session = null;
    this.#root.replaceChildren();
  }
}
