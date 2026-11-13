import { applySchema5GridItems, reflowSchema5Widget, schema5GridItems } from './fcui-schema5-layout.js';
import { fitLinkWidget } from './link-widget.js';

export class WidgetLayoutError extends Error {}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sameConfig(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function validateConfig(config) {
  schema5GridItems(config, config?.pages?.[0]?.id);
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || typeof state.token !== 'string' || !/^[0-9a-f]{64}$/.test(state.token)
    || !Object.prototype.hasOwnProperty.call(state, 'draft')) {
    throw new Error('Ungültiger Schema-5-Zustand');
  }
  validateConfig(state.live);
  if (state.draft !== null) validateConfig(state.draft);
}

function requireToken(state, token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    throw new Error('Zustandskennung erforderlich');
  }
  if (state.token !== token) throw new Error('Zustand ist veraltet; bitte erneut laden');
}

function freeGridPosition(widget, occupied, columns) {
  const { col, row, w, h } = widget.grid || {};
  if (![col, row, w, h, columns].every(Number.isInteger)
    || col < 1 || row < 1 || w < 1 || h < 1 || w > columns || col + w > columns + 1) {
    throw new Error('Ungültige Rastergröße für die Widget-Kopie');
  }
  const maxColumn = columns - w + 1;
  const nearby = [
    ...Array.from({ length: Math.max(0, maxColumn - (col + w) + 1) },
      (_, index) => col + w + index),
    ...Array.from({ length: Math.max(0, Math.min(col - 1, maxColumn)) },
      (_, index) => index + 1),
  ];
  for (let targetRow = row; targetRow + h <= 1001; targetRow += 1) {
    const targetColumns = targetRow === row
      ? nearby : [...nearby, col, ...Array.from({ length: maxColumn }, (_, index) => index + 1)
        .filter((targetCol) => targetCol !== col && !nearby.includes(targetCol))];
    for (const targetCol of targetColumns) {
      const proposed = { col: targetCol, row: targetRow, w, h };
      const overlaps = occupied.some((other) => proposed.col < other.col + other.w
        && other.col < proposed.col + proposed.w
        && proposed.row < other.row + other.h
        && other.row < proposed.row + proposed.h);
      if (!overlaps) return proposed;
    }
  }
  throw new Error('Auf der Seite ist kein freier Platz für die Widget-Kopie');
}

function uniqueCopyId(sourceId, ids) {
  const baseId = `${sourceId.slice(0, 56)}-copy`;
  let id = baseId;
  for (let suffix = 2; ids.has(id); suffix += 1) {
    id = `${baseId.slice(0, 63 - String(suffix).length)}-${suffix}`;
  }
  return id;
}

export class Schema5DraftController {
  #transport;
  #state = null;
  #busy = false;

  constructor(transport) {
    if (!transport || ['read', 'save', 'publish', 'discard'].some((name) =>
      typeof transport[name] !== 'function')) {
      throw new Error('Versionierte Entwurfsdienste erforderlich');
    }
    this.#transport = transport;
  }

  snapshot() {
    if (!this.#state) throw new Error('Zustand ist nicht geladen; bitte erneut laden');
    return structuredClone(this.#state);
  }

  async #run(operation) {
    if (this.#busy) throw new Error('Eine Entwurfsaktion läuft bereits');
    this.#busy = true;
    try {
      return await operation();
    } finally {
      this.#busy = false;
    }
  }

  async #read() {
    const state = await this.#transport.read();
    validateState(state);
    return structuredClone(state);
  }

  reload() {
    return this.#run(async () => {
      this.#state = null;
      this.#state = await this.#read();
      return this.snapshot();
    });
  }

  saveDraft(config, expectedToken) {
    const candidate = structuredClone(config);
    validateConfig(candidate);
    return this.#change('save', candidate, expectedToken);
  }

  saveLayout(pageId, items, expectedToken) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    const candidate = applySchema5GridItems(state.draft || state.live, pageId, items);
    return this.saveDraft(candidate, expectedToken);
  }

  saveNavigation(navigation, expectedToken) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    if (!navigation || typeof navigation !== 'object' || Array.isArray(navigation)) {
      throw new Error('Ungültige Navigation');
    }
    const candidate = state.draft || state.live;
    candidate.navigation = structuredClone(navigation);
    return this.saveDraft(candidate, expectedToken);
  }

  #prepareWidget(pageId, widget, expectedToken, action, reflow) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    let candidate = state.draft || state.live;
    const page = candidate.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error('Unbekannte Seite');
    if (!widget || typeof widget !== 'object' || Array.isArray(widget)
      || typeof widget.id !== 'string') throw new Error('Ungültiges Widget');
    if (action !== 'create' && action !== 'update') throw new Error('Widget-Aktion erforderlich');
    const index = page.widgets.findIndex((entry) => entry.id === widget.id);
    if (action === 'create' && index >= 0) throw new Error('Widget-ID ist bereits vorhanden');
    if (action === 'update' && index < 0) throw new Error('Unbekanntes Widget');
    const before = [{ id: '__nav', type: 'navigation', title: 'Navigation', grid: candidate.navigation.grid },
      ...page.widgets.map(({ id, type, title, grid }) => ({ id, type, title: title || '', grid }))];
    let copy = structuredClone(widget);
    if (widget.type === 'fhem-link') {
      try {
        copy = fitLinkWidget(widget, Number(candidate.settings.gridColumns), candidate.pages,
          action === 'update' ? page.widgets[index] : null);
      } catch (error) {
        throw new WidgetLayoutError(error.message, { cause: error });
      }
    }
    if (action === 'create') page.widgets.push(copy);
    else page.widgets[index] = copy;
    if (copy.type === 'fhem-link') {
      try {
        if (reflow) candidate = reflowSchema5Widget(candidate, pageId, copy.id);
        validateConfig(candidate);
      } catch (error) {
        throw new WidgetLayoutError(reflow
          ? `Für diese Anordnung lässt sich kein Platz schaffen. Es wurde nichts gespeichert. ${error.message}`
          : `Das LinkWidget benötigt mehr Platz. Bitte zuerst die Platzvorschau öffnen. Es wurde nichts gespeichert. (${error.message})`,
        { cause: error });
      }
    }
    const after = [{ id: '__nav', type: 'navigation', title: 'Navigation', grid: candidate.navigation.grid },
      ...candidate.pages.find(entry => entry.id === pageId).widgets
        .map(({ id, type, title, grid }) => ({ id, type, title: title || '', grid }))];
    const moved = after.filter(entry => entry.id !== copy.id && before.some(original =>
      original.id === entry.id && !sameConfig(original.grid, entry.grid))).map(entry => entry.id);
    return { candidate, preview: { pageId, token: expectedToken, columns: Number(candidate.settings.gridColumns),
      widget: copy, before, after, moved } };
  }

  previewWidget(pageId, widget, expectedToken, action) {
    if (widget?.type !== 'fhem-link') throw new Error('Platzvorschau ist nur für LinkWidgets verfügbar');
    return this.#prepareWidget(pageId, widget, expectedToken, action, true).preview;
  }

  saveWidget(pageId, widget, expectedToken, action, approvedLayout = null) {
    if (approvedLayout && widget?.type !== 'fhem-link') throw new Error('Ungültige Layoutbestätigung');
    const { candidate, preview } = this.#prepareWidget(pageId, widget, expectedToken, action, Boolean(approvedLayout));
    if (approvedLayout && !sameConfig(preview, approvedLayout)) {
      throw new WidgetLayoutError('Die Platzvorschau passt nicht mehr zu den Änderungen. Bitte erneut prüfen und bestätigen.');
    }
    return this.saveDraft(candidate, expectedToken);
  }

  deleteWidget(pageId, widgetId, expectedToken) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    const candidate = state.draft || state.live;
    const page = candidate.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error('Unbekannte Seite');
    const index = page.widgets.findIndex((entry) => entry.id === widgetId);
    if (index < 0) throw new Error('Unbekanntes Widget');
    page.widgets.splice(index, 1);
    return this.saveDraft(candidate, expectedToken);
  }

  duplicateWidget(pageId, widgetId, expectedToken) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    const config = state.draft || state.live;
    const page = config.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error('Unbekannte Seite');
    if (page.widgets.length >= 200) throw new Error('Die Seite enthält bereits 200 Widgets');
    const source = page.widgets.find((entry) => entry.id === widgetId);
    if (!source) throw new Error('Unbekanntes Widget');
    return this.insertWidget(pageId, source, expectedToken, widgetId);
  }

  insertWidget(pageId, widget, expectedToken, afterWidgetId = null) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    const candidate = structuredClone(state.draft || state.live);
    const page = candidate.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error('Unbekannte Seite');
    if (page.widgets.length >= 200) throw new Error('Die Seite enthält bereits 200 Widgets');
    if (!widget || typeof widget !== 'object' || Array.isArray(widget)
      || typeof widget.id !== 'string' || !widget.grid) throw new Error('Ungültige Widget-Vorlage');
    const ids = new Set(page.widgets.map((entry) => entry.id));
    let copy = structuredClone(widget);
    copy.id = uniqueCopyId(copy.id, ids);
    const columns = Number(candidate.settings.gridColumns);
    if (copy.type === 'fhem-link') {
      copy = fitLinkWidget(copy, columns, candidate.pages, null);
    }
    copy.grid = freeGridPosition(copy, [candidate.navigation.grid, ...page.widgets.map((entry) => entry.grid)], columns);
    const prepared = this.#prepareWidget(pageId, copy, expectedToken, 'create', false);
    if (afterWidgetId !== null) {
      const preparedPage = prepared.candidate.pages.find((entry) => entry.id === pageId);
      const copyIndex = preparedPage.widgets.findIndex((entry) => entry.id === copy.id);
      const sourceIndex = preparedPage.widgets.findIndex((entry) => entry.id === afterWidgetId);
      if (sourceIndex < 0) throw new Error('Unbekanntes Widget für die Kopie');
      const [inserted] = preparedPage.widgets.splice(copyIndex, 1);
      preparedPage.widgets.splice(sourceIndex + 1, 0, inserted);
    }
    return this.saveDraft(prepared.candidate, expectedToken);
  }

  addPage(id, title, expectedToken) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Ungültige Seiten-ID');
    this.#validateTitle(title);
    const candidate = state.draft || state.live;
    if (candidate.pages.some((page) => page.id === id)) throw new Error('Seiten-ID ist bereits vorhanden');
    candidate.pages.push({ id, title, widgets: [] });
    return this.saveDraft(candidate, expectedToken);
  }

  renamePage(pageId, title, expectedToken) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    this.#validateTitle(title);
    const candidate = state.draft || state.live;
    const page = candidate.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error('Unbekannte Seite');
    page.title = title;
    return this.saveDraft(candidate, expectedToken);
  }

  reorderPages(ids, expectedToken) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    const candidate = state.draft || state.live;
    if (!Array.isArray(ids) || ids.length !== candidate.pages.length) throw new Error('Unvollständige Seitenreihenfolge');
    const pages = new Map(candidate.pages.map((page) => [page.id, page]));
    if (new Set(ids).size !== ids.length || ids.some((id) => !pages.has(id))) {
      throw new Error('Ungültige Seitenreihenfolge');
    }
    candidate.pages = ids.map((id) => pages.get(id));
    return this.saveDraft(candidate, expectedToken);
  }

  deleteEmptyPage(pageId, expectedToken) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    const candidate = state.draft || state.live;
    const index = candidate.pages.findIndex((page) => page.id === pageId);
    if (index < 0) throw new Error('Unbekannte Seite');
    if (candidate.pages.length === 1) throw new Error('Die letzte Seite darf nicht gelöscht werden');
    if (candidate.pages[index].widgets.length) throw new Error('Seite enthält Widgets');
    candidate.pages.splice(index, 1);
    if (candidate.navigation.items) {
      candidate.navigation.items = candidate.navigation.items.filter((item) => item.page !== pageId);
      if (!candidate.navigation.items.length) delete candidate.navigation.items;
    }
    return this.saveDraft(candidate, expectedToken);
  }

  moveWidget(sourceId, targetId, widgetId, grid, expectedToken) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    const candidate = state.draft || state.live;
    const source = candidate.pages.find((page) => page.id === sourceId);
    const target = candidate.pages.find((page) => page.id === targetId);
    if (!source || !target) throw new Error('Unbekannte Seite');
    if (sourceId === targetId) throw new Error('Zielseite muss verschieden sein');
    const index = source.widgets.findIndex((widget) => widget.id === widgetId);
    if (index < 0) throw new Error('Unbekanntes Widget');
    if (target.widgets.some((widget) => widget.id === widgetId)) throw new Error('Widget-ID ist auf der Zielseite vorhanden');
    const widget = source.widgets.splice(index, 1)[0];
    widget.grid = structuredClone(grid);
    target.widgets.push(widget);
    return this.saveDraft(candidate, expectedToken);
  }

  #validateTitle(title) {
    if (typeof title !== 'string' || !title.length || title.length > 128 || /[\x00-\x1f\x7f]/.test(title)) {
      throw new Error('Ungültiger Seitentitel');
    }
  }

  publishDraft(expectedToken) {
    return this.#change('publish', undefined, expectedToken);
  }

  discardDraft(expectedToken) {
    return this.#change('discard', undefined, expectedToken);
  }

  #change(action, candidate, expectedToken) {
    return this.#run(async () => {
      const before = this.snapshot();
      requireToken(before, expectedToken);
      if (action !== 'save' && before.draft === null) {
        throw new Error('Es gibt keinen Entwurf');
      }
      this.#state = null;
      if (action === 'save') await this.#transport.save(structuredClone(candidate), before.token);
      else await this.#transport[action](before.token);
      const after = await this.#read();
      const expectedLive = action === 'publish' ? before.draft : before.live;
      const expectedDraft = action === 'save' ? candidate : null;
      if (!sameConfig(after.live, expectedLive) || !sameConfig(after.draft, expectedDraft)) {
        throw new Error('Zustand nach der Entwurfsaktion geändert; bitte erneut laden');
      }
      this.#state = after;
      return this.snapshot();
    });
  }
}
