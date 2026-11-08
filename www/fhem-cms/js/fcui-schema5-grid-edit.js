import { createSchema5Grid, schema5GridItems } from './fcui-schema5-layout.js';

export class Schema5GridEdit {
  #controller;
  #grid;
  #root;
  #pageId;
  #token;
  #phase = 'editing';

  constructor({ GridStack, root, controller, pageId, token }) {
    if (!controller || typeof controller.snapshot !== 'function'
      || typeof controller.saveLayout !== 'function') {
      throw new Error('Schema-5-Entwurfscontroller erforderlich');
    }
    const state = controller.snapshot();
    if (typeof token !== 'string' || state.token !== token) {
      throw new Error('Zustand ist veraltet; bitte erneut laden');
    }
    const config = state.draft || state.live;
    const positions = schema5GridItems(config, pageId);
    const page = config.pages.find((entry) => entry.id === pageId);
    const labels = new Map(page.widgets.map((widget) => [widget.id, `${widget.type}: ${widget.id}`]));
    labels.set('__nav', 'Navigation');
    this.#controller = controller;
    this.#root = root;
    this.#pageId = pageId;
    this.#token = token;
    this.#grid = createSchema5Grid(GridStack, root, config, pageId, (id) => {
      const label = document.createElement('span');
      label.textContent = labels.get(id);
      return label;
    });
    try {
      this.#grid.setStatic(false);
      const actual = this.#grid.save(false);
      const byId = new Map(Array.isArray(actual) ? actual.map((item) => [item.id, item]) : []);
      if (this.#grid.getColumn() !== 12 || byId.size !== positions.length
        || actual.length !== positions.length || positions.some((expected) => {
          const item = byId.get(expected.id);
          return !item || ['x', 'y', 'w', 'h'].some((key) =>
            (item[key] ?? (key === 'w' || key === 'h' ? 1 : 0)) !== expected[key]);
        })) {
        throw new Error('Raster wurde beim Aktivieren der Bearbeitung verändert');
      }
    } catch (error) {
      this.#grid.destroy(false);
      root.replaceChildren();
      throw error;
    }
  }

  async save() {
    if (this.#phase !== 'editing') throw new Error('Rasterbearbeitung ist nicht mehr aktiv');
    this.#phase = 'saving';
    try {
      this.#grid.setStatic(true);
      if (this.#grid.getColumn() !== 12) {
        throw new Error('Rasterbearbeitung erfordert eine 12-Spalten-Ansicht');
      }
      const items = this.#grid.save(false);
      return await this.#controller.saveLayout(this.#pageId, items, this.#token);
    } finally {
      this.#phase = 'locked';
    }
  }

  close() {
    if (this.#phase === 'saving') throw new Error('Speichern läuft noch');
    if (this.#phase === 'closed') return;
    this.#phase = 'closed';
    try {
      this.#grid.destroy(false);
    } finally {
      this.#root.replaceChildren();
    }
  }
}
