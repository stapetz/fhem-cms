import { applySchema5GridItems, schema5GridItems } from './fcui-schema5-layout.js';

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

  saveWidget(pageId, widget, expectedToken, action) {
    const state = this.snapshot();
    requireToken(state, expectedToken);
    const candidate = state.draft || state.live;
    const page = candidate.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error('Unbekannte Seite');
    if (!widget || typeof widget !== 'object' || Array.isArray(widget)
      || typeof widget.id !== 'string') throw new Error('Ungültiges Widget');
    if (action !== 'create' && action !== 'update') throw new Error('Widget-Aktion erforderlich');
    const copy = structuredClone(widget);
    const index = page.widgets.findIndex((entry) => entry.id === copy.id);
    if (action === 'create' && index >= 0) throw new Error('Widget-ID ist bereits vorhanden');
    if (action === 'update' && index < 0) throw new Error('Unbekanntes Widget');
    if (action === 'create') page.widgets.push(copy);
    else page.widgets[index] = copy;
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
