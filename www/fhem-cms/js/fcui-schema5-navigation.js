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
  #sharedEnabled;
  #shared = {};
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
    const shared = element('fieldset');
    shared.append(element('legend', 'Größe für alle Navigationspunkte'));
    const sharedToggleLabel = element('label', ' Für alle verwenden');
    this.#sharedEnabled = element('input');
    this.#sharedEnabled.type = 'checkbox';
    this.#sharedEnabled.checked = this.#navigation.itemWidth !== undefined
      || this.#navigation.itemHeight !== undefined;
    sharedToggleLabel.prepend ? sharedToggleLabel.prepend(this.#sharedEnabled)
      : sharedToggleLabel.append(this.#sharedEnabled);
    shared.append(sharedToggleLabel);
    for (const [key, title, min, max] of [
      ['itemWidth', 'Breite in Pixeln', 40, 600], ['itemHeight', 'Höhe in Pixeln', 24, 200],
    ]) {
      const label = element('label', `${title} `);
      const input = element('input');
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
      input.value = this.#navigation[key] === undefined ? '' : String(this.#navigation[key]);
      this.#shared[key] = input;
      label.append(input);
      shared.append(label);
    }
    shared.append(element('p',
      'Aktiv überstimmen diese Werte die Einzelgrößen; deaktiviert gelten wieder die individuellen Werte.'));
    this.#form.append(shared);
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
    const save = element('button', 'Speichern');
    save.type = 'submit';
    save.className = 'cms-button cms-panel-save';
    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      return this.#save();
    });
    this.#close = element('button', 'Abbrechen');
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
    const footer = element('div');
    footer.className = 'cms-panel-footer';
    save.addEventListener('click', (event) => {
      event.preventDefault();
      return this.#save();
    });
    footer.append(save, this.#close);
    this.#original = this.#values();
    root.append(element('h2', 'Navigation bearbeiten'),
      element('p', 'Leere Felder verwenden die Seitentitel beziehungsweise Standardgrößen. Die Rasterposition bleibt unverändert.'),
      this.#status, this.#form, footer);
  }

  #values() {
    return JSON.stringify([this.#orientation.value,
      this.#sharedEnabled.checked, this.#shared.itemWidth.value, this.#shared.itemHeight.value,
      [...this.#fields.values()].map((fields) =>
        [fields.label.value, fields.width.value, fields.height.value])]);
  }

  #candidate() {
    if (!['horizontal', 'vertical'].includes(this.#orientation.value)) throw new Error('Ungültige Ausrichtung');
    const result = structuredClone(this.#navigation);
    result.orientation = this.#orientation.value;
    delete result.itemWidth;
    delete result.itemHeight;
    if (this.#sharedEnabled.checked) {
      for (const [key, name, min, max] of [
        ['itemWidth', 'gemeinsame Breite', 40, 600], ['itemHeight', 'gemeinsame Höhe', 24, 200],
      ]) {
        const value = this.#shared[key].value;
        if (!value) continue;
        if (!/^[0-9]+$/.test(value) || Number(value) < min || Number(value) > max) {
          throw new Error(`Ungültige ${name} (${min}–${max} Pixel)`);
        }
        result[key] = Number(value);
      }
      if (result.itemWidth === undefined && result.itemHeight === undefined) {
        throw new Error('Für „alle Navigationspunkte“ Breite oder Höhe angeben oder die Option deaktivieren');
      }
    }
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
      if (this.#closed || !state) return;
      this.#busy = false;
      this.close();
      this.#onClose({ requiresReload: false });
      return;
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
