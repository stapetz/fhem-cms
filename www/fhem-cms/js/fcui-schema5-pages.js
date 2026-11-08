function element(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

export class Schema5PagesPanel {
  #root;
  #controller;
  #browser;
  #onClose;
  #token;
  #candidate;
  #baseline;
  #status;
  #controls;
  #save;
  #close;
  #busy = false;
  #closed = false;
  #suspended = false;
  #requiresReload = false;

  constructor({ root, controller, token, browser = window, onClose }) {
    if (!root || root.children.length || !controller || typeof controller.snapshot !== 'function'
      || typeof controller.saveDraft !== 'function'
      || typeof browser.confirm !== 'function' || typeof onClose !== 'function') {
      throw new Error('Dienste und leerer Container für Seitenverwaltung erforderlich');
    }
    const state = controller.snapshot();
    if (state.token !== token) throw new Error('Zustand ist veraltet; bitte erneut laden');
    this.#root = root;
    this.#controller = controller;
    this.#browser = browser;
    this.#onClose = onClose;
    this.#token = token;
    this.#candidate = structuredClone(state.draft || state.live);
    this.#baseline = JSON.stringify(this.#candidate);
    const heading = element('h2', 'Seiten verwalten');
    const hint = element('p', 'Änderungen werden erst mit „Speichern“ als Entwurf übernommen. Nur leere Seiten können gelöscht werden.');
    this.#status = element('p');
    this.#status.setAttribute('role', 'status');
    this.#controls = element('div');
    this.#save = element('button', 'Speichern');
    this.#save.className = 'cms-button cms-panel-save';
    this.#save.type = 'button';
    this.#save.addEventListener('click', () => this.#saveAll());
    this.#close = element('button', 'Abbrechen');
    this.#close.className = 'cms-button cms-panel-close';
    this.#close.type = 'button';
    this.#close.addEventListener('click', () => {
      if (this.#busy || this.#closed) return;
      if (!this.#requiresReload && this.#dirty()
        && !this.#browser.confirm('Nicht gespeicherte Änderungen verwerfen?')) return;
      const outcome = { requiresReload: this.#requiresReload };
      this.close();
      this.#onClose(outcome);
    });
    const footer = element('div');
    footer.className = 'cms-panel-footer';
    footer.append(this.#save, this.#close);
    root.append(heading, hint, this.#status, this.#controls, footer);
    this.#render();
  }

  #dirty() {
    return JSON.stringify(this.#candidate) !== this.#baseline;
  }

  #message(text, error = false) {
    this.#status.textContent = text;
    if (error) this.#status.setAttribute('data-error', '');
    else this.#status.removeAttribute('data-error');
  }

  #changed() {
    this.#render();
    this.#message(this.#dirty() ? 'Noch nicht gespeicherte Änderungen.' : '');
  }

  #button(text, callback, disabled = false) {
    const button = element('button', text);
    button.type = 'button';
    button.disabled = disabled;
    button.addEventListener('click', callback);
    return button;
  }

  #render() {
    this.#controls.replaceChildren();
    const pages = this.#candidate.pages;
    const list = element('ol');
    for (const [index, page] of pages.entries()) {
      const row = element('li');
      row.className = 'cms-page-card';
      const label = element('label', 'Seitentitel ');
      const title = element('input');
      title.value = page.title;
      title.required = true;
      title.maxLength = 128;
      title.addEventListener('input', () => {
        page.title = title.value;
        this.#message(this.#dirty() ? 'Noch nicht gespeicherte Änderungen.' : '');
      });
      label.append(title);
      const reorder = (offset) => {
        const destination = index + offset;
        [pages[index], pages[destination]] = [pages[destination], pages[index]];
        this.#changed();
      };
      row.append(label,
        this.#button('Nach oben', () => reorder(-1), index === 0),
        this.#button('Nach unten', () => reorder(1), index === pages.length - 1),
        this.#button('Leere Seite löschen', () => {
          pages.splice(index, 1);
          if (this.#candidate.navigation.items) {
            this.#candidate.navigation.items = this.#candidate.navigation.items
              .filter((item) => item.page !== page.id);
            if (!this.#candidate.navigation.items.length) delete this.#candidate.navigation.items;
          }
          this.#changed();
        }, pages.length === 1 || page.widgets.length > 0));
      if (pages.length > 1 && page.widgets.length) {
        const moves = element('details');
        moves.className = 'cms-page-moves';
        moves.append(element('summary', `Widgets auf andere Seiten verschieben (${page.widgets.length})`));
        for (const widget of page.widgets) moves.append(this.#moveForm(page, widget, pages));
        row.append(moves);
      }
      list.append(row);
    }
    const add = element('form');
    add.className = 'cms-page-add';
    const idLabel = element('label', 'Seitenkennung (optional) ');
    const id = element('input');
    id.placeholder = 'automatisch';
    id.maxLength = 64;
    id.pattern = '[A-Za-z0-9_\\-]{1,64}';
    idLabel.append(id);
    const titleLabel = element('label', 'Seitentitel ');
    const title = element('input');
    title.required = true;
    title.maxLength = 128;
    titleLabel.append(title);
    const submit = element('button', 'Seite hinzufügen');
    submit.type = 'submit';
    add.append(idLabel, titleLabel, submit);
    add.addEventListener('submit', (event) => {
      event.preventDefault();
      const existing = new Set(pages.map((page) => page.id));
      let number = 1;
      while (existing.has(`page${number}`)) number++;
      const pageId = id.value || `page${number}`;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(pageId) || existing.has(pageId)) {
        this.#message('Ungültige oder bereits vorhandene Seitenkennung.', true);
        return;
      }
      if (!title.value.length || title.value.length > 128 || /[\x00-\x1f\x7f]/.test(title.value)) {
        this.#message('Ungültiger Seitentitel.', true);
        return;
      }
      pages.push({ id: pageId, title: title.value, widgets: [] });
      this.#changed();
    });
    this.#controls.append(list, add);
  }

  #moveForm(page, widget, pages) {
    const form = element('form');
    const heading = element('p', `Widget ${widget.id} verschieben`);
    const targetLabel = element('label', `Zielseite für ${widget.id} `);
    const target = element('select');
    for (const other of pages.filter((entry) => entry.id !== page.id)) {
      const option = element('option', other.title);
      option.value = other.id;
      target.append(option);
    }
    targetLabel.append(target);
    form.append(heading, targetLabel);
    const fields = {};
    for (const [key, name, max] of [
      ['col', 'Spalte', 12], ['row', 'Zeile', 1000], ['w', 'Breite', 12], ['h', 'Höhe', 1000],
    ]) {
      const label = element('label', `${name} für ${widget.id} `);
      const input = element('input');
      input.type = 'number';
      input.min = '1';
      input.max = String(max);
      input.step = '1';
      input.required = true;
      input.value = String(widget.grid[key]);
      label.append(input);
      fields[key] = input;
      form.append(label);
    }
    const move = element('button', 'Widget verschieben');
    move.type = 'submit';
    form.append(move);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const destination = pages.find((entry) => entry.id === target.value);
      if (!destination || destination.id === page.id) {
        this.#message('Ungültige Zielseite.', true);
        return;
      }
      const grid = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.valueAsNumber]));
      if (!['col', 'row', 'w', 'h'].every((key) => Number.isInteger(grid[key]) && grid[key] >= 1)) {
        this.#message('Ungültige Rasterposition.', true);
        return;
      }
      const index = page.widgets.findIndex((entry) => entry.id === widget.id);
      if (index < 0 || destination.widgets.some((entry) => entry.id === widget.id)) {
        this.#message('Widget kann nicht verschoben werden.', true);
        return;
      }
      const moved = page.widgets.splice(index, 1)[0];
      moved.grid = grid;
      destination.widgets.push(moved);
      this.#changed();
    });
    return form;
  }

  async #saveAll() {
    if (this.#busy || this.#closed || this.#requiresReload) return;
    if (!this.#dirty()) {
      const outcome = { requiresReload: false };
      this.close();
      this.#onClose(outcome);
      return;
    }
    this.#busy = true;
    this.#controls.inert = true;
    this.#save.disabled = true;
    this.#close.disabled = true;
    this.#message('Entwurf wird gespeichert …');
    let pending;
    try {
      pending = this.#controller.saveDraft(structuredClone(this.#candidate), this.#token);
    } catch (error) {
      this.#busy = false;
      this.#controls.inert = false;
      this.#save.disabled = false;
      this.#close.disabled = false;
      this.#message(`Änderung ungültig: ${error.message || String(error)}`, true);
      return;
    }
    try {
      await pending;
      if (this.#suspended || this.#closed) return;
      this.#busy = false;
      const outcome = { requiresReload: false };
      this.close();
      this.#onClose(outcome);
    } catch (error) {
      if (this.#suspended || this.#closed) return;
      this.#requiresReload = true;
      this.#message(`Änderung nicht bestätigt: ${error.message || String(error)}. Vor weiterer Bearbeitung Zustand erneut laden.`, true);
    } finally {
      this.#busy = false;
      if (this.#suspended) this.close();
      else if (!this.#closed) {
        this.#controls.inert = this.#requiresReload;
        this.#save.disabled = this.#requiresReload;
        this.#close.disabled = false;
      }
    }
  }

  suspend() {
    if (this.#closed || this.#suspended) return;
    this.#suspended = true;
    this.#root.hidden = true;
    if (!this.#busy) this.close();
  }

  close() {
    if (this.#closed) return;
    if (this.#busy) throw new Error('Speichern läuft noch');
    this.#closed = true;
    this.#root.replaceChildren();
  }
}
