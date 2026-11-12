import { WidgetLayoutError } from './fcui-schema5-draft.js';

function sameGrid(left, right) {
  const keys = ['col', 'row', 'w', 'h'];
  return left && right && typeof left === 'object' && typeof right === 'object'
    && !Array.isArray(left) && !Array.isArray(right)
    && Object.keys(left).length === keys.length && Object.keys(right).length === keys.length
    && keys.every((key) => Object.hasOwn(left, key) && Object.hasOwn(right, key) && left[key] === right[key]);
}

export class Schema5WidgetSession {
  #controller;
  #pageId;
  #token;
  #widget;
  #action;
  #status = 'ready';
  #resolve;
  #completion;

  constructor({ controller, pageId, token, widget, action }) {
    if (!controller || typeof controller.snapshot !== 'function'
      || typeof controller.saveWidget !== 'function' || typeof controller.deleteWidget !== 'function'
      || !widget || typeof widget !== 'object' || Array.isArray(widget)
      || typeof widget.id !== 'string' || typeof widget.type !== 'string'
      || !sameGrid(widget.grid, widget.grid) || !['create', 'update'].includes(action)) {
      throw new Error('Ungültige Widget-Bearbeitung');
    }
    const state = controller.snapshot();
    if (state.token !== token) throw new Error('Zustand ist veraltet; bitte erneut laden');
    const page = (state.draft || state.live).pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error('Unbekannte Seite');
    const original = page.widgets.find((entry) => entry.id === widget.id);
    if (action === 'create' && original) throw new Error('Widget-ID ist bereits vorhanden');
    if (action === 'update' && (!original || original.type !== widget.type || !sameGrid(original.grid, widget.grid))) {
      throw new Error('Widget stimmt nicht mit dem angezeigten Zustand überein');
    }
    this.#controller = controller;
    this.#pageId = pageId;
    this.#token = token;
    this.#widget = structuredClone(original || widget);
    this.#action = action;
    this.#completion = new Promise((resolve) => { this.#resolve = resolve; });
  }

  get completion() {
    return this.#completion;
  }

  get widget() {
    return structuredClone(this.#widget);
  }

  services(services) {
    if (!services || typeof services !== 'object') throw new Error('Widget-Dienste erforderlich');
    return {
      ...services,
      saveWidget: (widget) => this.#save(widget),
      deleteWidget: (id) => this.#delete(id),
    };
  }

  close() {
    if (this.#status === 'closed') return;
    this.#status = 'closed';
    this.#resolve({ cancelled: true });
  }

  async #change(operation) {
    if (this.#status !== 'ready') throw new Error('Widget-Bearbeitung ist nicht mehr aktiv');
    this.#status = 'busy';
    try {
      const state = await operation();
      if (this.#status !== 'closed') {
        this.#status = 'closed';
        this.#resolve({ state });
      }
      return state;
    } catch (error) {
      if (error instanceof WidgetLayoutError && this.#status !== 'closed') {
        this.#status = 'ready';
        throw error;
      }
      if (this.#status !== 'closed') {
        this.#status = 'closed';
        this.#resolve({ error });
      }
      throw error;
    }
  }

  #save(widget) {
    return this.#change(() => {
      if (!widget || widget.id !== this.#widget.id || widget.type !== this.#widget.type
        || !sameGrid(widget.grid, this.#widget.grid)) {
        throw new Error('Widget-Identität oder Raster wurde verändert');
      }
      const candidate = structuredClone(widget);
      if (this.#action === 'create' && candidate.type === 'fhem-calllist'
        && Number.isInteger(candidate.limit) && candidate.limit >= 1 && candidate.limit <= 20) {
        const state = this.#controller.snapshot();
        const scale = Number((state.draft || state.live).settings.gridColumns) / 12;
        candidate.grid.h = (2 + Math.ceil(candidate.limit * 0.8)) * scale;
      }
      return this.#controller.saveWidget(this.#pageId, candidate, this.#token, this.#action);
    });
  }

  #delete(id) {
    return this.#change(() => {
      if (this.#action !== 'update' || id !== this.#widget.id) {
        throw new Error('Widget kann nicht gelöscht werden');
      }
      return this.#controller.deleteWidget(this.#pageId, id, this.#token);
    });
  }
}
