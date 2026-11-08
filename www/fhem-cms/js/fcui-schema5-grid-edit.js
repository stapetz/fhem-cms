import { applySchema5GridItems, createSchema5Grid, schema5GridItems } from './fcui-schema5-layout.js';

function samePositions(expected, actual) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const byId = new Map(actual.map((item) => [item.id, item]));
  return byId.size === expected.length && expected.every((item) => {
    const found = byId.get(item.id);
    return found && ['x', 'y', 'w', 'h'].every((key) =>
      (found[key] ?? (key === 'w' || key === 'h' ? 1 : 0)) === item[key]);
  });
}

export class Schema5GridEdit {
  #controller;
  #grid;
  #root;
  #pageId;
  #token;
  #config;
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
    this.#config = config;
    this.#grid = createSchema5Grid(GridStack, root, config, pageId, (id) => {
      const label = document.createElement('span');
      label.className = 'cms-widget-drag';
      label.textContent = labels.get(id);
      return label;
    });
    try {
      this.#grid.setStatic(false);
      if (this.#grid.getColumn() !== 12 || !samePositions(positions, this.#grid.save(false))) {
        throw new Error('Raster wurde beim Aktivieren der Bearbeitung verändert');
      }
    } catch (error) {
      this.#grid.destroy(false);
      root.replaceChildren();
      throw error;
    }
  }

  get editing() {
    return this.#phase === 'editing';
  }

  positions() {
    if (!this.editing) throw new Error('Rasterbearbeitung ist nicht mehr aktiv');
    if (this.#grid.getColumn() !== 12) throw new Error('Rasterbearbeitung erfordert eine 12-Spalten-Ansicht');
    const config = applySchema5GridItems(this.#config, this.#pageId, this.#grid.save(false));
    return schema5GridItems(config, this.#pageId);
  }

  setPosition(id, position) {
    if (this.#phase !== 'editing') throw new Error('Rasterbearbeitung ist nicht mehr aktiv');
    if (this.#grid.getColumn() !== 12) throw new Error('Rasterbearbeitung erfordert eine 12-Spalten-Ansicht');
    if (!position || typeof position !== 'object' || Array.isArray(position)
      || Object.keys(position).sort().join(',') !== 'col,h,row,w'
      || !['col', 'row', 'w', 'h'].every((key) => Number.isInteger(position[key]))) {
      throw new Error('Ungültige Rasterposition');
    }
    const current = this.#grid.save(false);
    const candidate = applySchema5GridItems(this.#config, this.#pageId, current);
    const items = schema5GridItems(candidate, this.#pageId);
    const item = items.find((entry) => entry.id === id);
    if (!item) throw new Error('Unbekanntes Rasterelement');
    Object.assign(item, { x: position.col - 1, y: position.row - 1, w: position.w, h: position.h });
    applySchema5GridItems(candidate, this.#pageId, items);
    const element = Array.from(this.#root.children).find((child) => child.gridstackNode?.id === id);
    if (!element) throw new Error('Rasterelement konnte nicht gefunden werden');
    try {
      this.#grid.update(element, { x: item.x, y: item.y, w: item.w, h: item.h });
      if (this.#grid.getColumn() !== 12 || !samePositions(items, this.#grid.save(false))) {
        throw new Error('Gridstack hat weitere Rasterpositionen verändert');
      }
    } catch (error) {
      this.#phase = 'locked';
      this.#grid.setStatic(true);
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
