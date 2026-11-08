function element(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

export class Schema5NavigationPanel {
  #root;
  #controller;
  #browser;
  #token;
  #navigation;
  #onClose;
  #status;
  #form;
  #close;
  #orientation;
  #fields = new Map();
  #original;
  #busy = false;
  #closed = false;
  #requiresReload = false;

  constructor({ root, controller, token, browser = window, onClose }) {
    if (!root || root.children.length || !controller || typeof controller.snapshot !== 'function'
      || typeof controller.saveNavigation !== 'function' || !browser || typeof browser.confirm !== 'function'
      || typeof onClose !== 'function') {
      throw new Error('Dienste und leerer Container für Navigation erforderlich');
    }
    const state = controller.snapshot();
    if (state.token !== token) throw new Error('Zustand ist veraltet; bitte erneut laden');
    const config = state.draft || state.live;
    this.#root = root;
    this.#controller = controller;
    this.#browser = browser;
    this.#token = token;
    this.#navigation = structuredClone(config.navigation);
    this.#onClose = onClose;
    this.#status = element('p');
    this.#status.setAttribute('role', 'status');
    this.#form = element('form');
    const orientationLabel = element('label', 'Ausrichtung ');
    this.#orientation = element('select');
    for (const [value, text] of [['horizontal', 'Horizontal'], ['vertical', 'Vertikal']]) {
      const option = element('option', text);
      option.value = value;
      this.#orientation.append(option);
    }
    this.#orientation.value = this.#navigation.orientation;
    orientationLabel.append(this.#orientation);
    this.#form.append(orientationLabel);
    for (const page of config.pages) {
      const original = (this.#navigation.items || []).find((item) => item.page === page.id) || {};
      const group = element('fieldset');
      group.append(element('legend', page.title));
      const fields = {};
      for (const [key, title, min, max] of [
        ['label', 'Beschriftung', null, 64], ['width', 'Breite in Pixeln', 40, 600], ['height', 'Höhe in Pixeln', 24, 200],
      ]) {
        const label = element('label', `${title} `);
        const input = element('input');
        input.value = original[key] === undefined ? '' : String(original[key]);
        if (min === null) input.maxLength = max;
        else {
          input.type = 'number';
          input.min = String(min);
          input.max = String(max);
          input.step = '1';
        }
        fields[key] = input;
        label.append(input);
        group.append(label);
      }
      this.#fields.set(page.id, fields);
      this.#form.append(group);
    }
    const save = element('button', 'Navigation als Entwurf speichern');
    save.type = 'submit';
    this.#form.append(save);
    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      return this.#save();
    });
    this.#close = element('button', 'Schließen');
    this.#close.className = 'cms-button cms-panel-close';
    this.#close.type = 'button';
    this.#close.addEventListener('click', () => {
      if (this.#busy || this.#closed) return;
      if (!this.#requiresReload && this.#values() !== this.#original
        && !this.#browser.confirm('Nicht gespeicherte Navigationseingaben verwerfen?')) return;
      const result = { requiresReload: this.#requiresReload };
      this.close();
      this.#onClose(result);
    });
    this.#original = this.#values();
    root.append(element('h2', 'Navigation bearbeiten'),
      element('p', 'Leere Felder verwenden die Seitentitel beziehungsweise Standardgrößen. Die Rasterposition bleibt unverändert.'),
      this.#status, this.#form, this.#close);
  }

  #values() {
    return JSON.stringify([this.#orientation.value, [...this.#fields.values()].map((fields) =>
      [fields.label.value, fields.width.value, fields.height.value])]);
  }

  #candidate() {
    if (!['horizontal', 'vertical'].includes(this.#orientation.value)) throw new Error('Ungültige Ausrichtung');
    const result = structuredClone(this.#navigation);
    result.orientation = this.#orientation.value;
    const items = new Map((result.items || []).map((item) => [item.page, item]));
    for (const [page, fields] of this.#fields) {
      const existed = items.has(page);
      const item = items.get(page) || { page };
      const label = fields.label.value;
      if (label.length > 64 || /[\x00-\x1f\x7f]/.test(label)) throw new Error(`Ungültige Beschriftung für ${page}`);
      if (label) item.label = label;
      else delete item.label;
      for (const [key, min, max] of [['width', 40, 600], ['height', 24, 200]]) {
        const value = fields[key].value;
        if (!value) delete item[key];
        else {
          if (!/^[0-9]+$/.test(value) || Number(value) < min || Number(value) > max) {
            throw new Error(`Ungültige ${key === 'width' ? 'Breite' : 'Höhe'} für ${page}`);
          }
          if (item[key] === undefined || String(item[key]) !== value) item[key] = Number(value);
        }
      }
      if (existed || Object.keys(item).length > 1) items.set(page, item);
    }
    if (items.size || Object.hasOwn(result, 'items')) result.items = [...items.values()];
    else delete result.items;
    return result;
  }

  async #save() {
    if (this.#busy || this.#closed || this.#requiresReload) return;
    let candidate;
    try {
      candidate = this.#candidate();
    } catch (error) {
      this.#status.setAttribute('data-error', '');
      this.#status.textContent = error.message || String(error);
      return;
    }
    this.#busy = true;
    this.#form.inert = true;
    this.#close.disabled = true;
    this.#status.removeAttribute('data-error');
    this.#status.textContent = 'Entwurf wird gespeichert …';
    try {
      const state = await this.#controller.saveNavigation(candidate, this.#token);
      if (this.#closed) return;
      this.#navigation = structuredClone((state.draft || state.live).navigation);
      this.#token = state.token;
      this.#original = this.#values();
      this.#status.textContent = 'Navigation als Entwurf gespeichert.';
    } catch (error) {
      if (this.#closed) return;
      this.#requiresReload = true;
      this.#status.setAttribute('data-error', '');
      this.#status.textContent = `Änderung nicht bestätigt: ${error.message || String(error)}. Bitte Zustand erneut laden.`;
    } finally {
      this.#busy = false;
      if (!this.#closed) {
        this.#form.inert = this.#requiresReload;
        this.#close.disabled = false;
      }
    }
  }

  suspend() {
    this.close();
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#root.replaceChildren();
  }
}
