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

  saveDraft(config) {
    const candidate = structuredClone(config);
    validateConfig(candidate);
    return this.#change('save', candidate);
  }

  saveLayout(pageId, items) {
    const state = this.snapshot();
    const candidate = applySchema5GridItems(state.draft || state.live, pageId, items);
    return this.saveDraft(candidate);
  }

  publishDraft() {
    return this.#change('publish');
  }

  discardDraft() {
    return this.#change('discard');
  }

  #change(action, candidate) {
    return this.#run(async () => {
      const before = this.snapshot();
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
