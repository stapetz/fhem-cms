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
  #state;
  #status;
  #controls;
  #close;
  #inputs = [];
  #busy = false;
  #closed = false;
  #suspended = false;
  #requiresReload = false;

  constructor({ root, controller, token, browser = window, onClose }) {
    if (!root || root.children.length || !controller || typeof controller.snapshot !== 'function'
      || typeof browser.confirm !== 'function' || typeof onClose !== 'function') {
      throw new Error('Dienste und leerer Container für Seitenverwaltung erforderlich');
    }
    const state = controller.snapshot();
    if (state.token !== token) throw new Error('Zustand ist veraltet; bitte erneut laden');
    this.#root = root;
    this.#controller = controller;
    this.#browser = browser;
    this.#onClose = onClose;
    this.#state = state;
    const heading = element('h2', 'Seiten verwalten');
    const hint = element('p', 'Änderungen werden sofort als Entwurf gespeichert. Nur leere Seiten können gelöscht werden.');
    this.#status = element('p');
    this.#status.setAttribute('role', 'status');
    this.#controls = element('div');
    this.#close = element('button', 'Schließen');
    this.#close.type = 'button';
    this.#close.addEventListener('click', () => {
      if (this.#inputs.some((entry) => entry.input.value !== entry.original)
        && !this.#browser.confirm('Nicht gespeicherte Eingaben verwerfen?')) return;
      const outcome = { requiresReload: this.#requiresReload };
      this.close();
      this.#onClose(outcome);
    });
    root.append(heading, hint, this.#status, this.#controls, this.#close);
    this.#render();
  }

  #message(text, error = false) {
    this.#status.textContent = text;
    if (error) this.#status.setAttribute('data-error', '');
    else this.#status.removeAttribute('data-error');
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
    this.#inputs = [];
    const pages = (this.#state.draft || this.#state.live).pages;
    const list = element('ol');
    for (const [index, page] of pages.entries()) {
      const row = element('li');
      const form = element('form');
      const label = element('label', `Titel für ${page.id} `);
      const title = element('input');
      title.value = page.title;
      title.required = true;
      title.maxLength = 128;
      label.append(title);
      this.#inputs.push({ input: title, original: page.title, group: form });
      const rename = element('button', 'Umbenennen');
      rename.type = 'submit';
      form.append(label, rename);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        return this.#change((token) => this.#controller.renamePage(page.id, title.value, token), form);
      });
      const reorder = (offset) => {
        const ids = pages.map((item) => item.id);
        const destination = index + offset;
        [ids[index], ids[destination]] = [ids[destination], ids[index]];
        return this.#change((token) => this.#controller.reorderPages(ids, token));
      };
      row.append(form,
        this.#button('Nach oben', () => reorder(-1), index === 0),
        this.#button('Nach unten', () => reorder(1), index === pages.length - 1),
        this.#button('Leere Seite löschen', () => {
          if (this.#browser.confirm(`Leere Seite „${page.title}“ (${page.id}) aus dem Entwurf löschen?`)) {
            return this.#change((token) => this.#controller.deleteEmptyPage(page.id, token));
          }
        }, pages.length === 1 || page.widgets.length > 0));
      if (pages.length > 1) {
        for (const widget of page.widgets) row.append(this.#moveForm(page, widget, pages));
      }
      list.append(row);
    }
    const add = element('form');
    const idLabel = element('label', 'Neue Seiten-ID ');
    const id = element('input');
    id.required = true;
    id.maxLength = 64;
    id.pattern = '[A-Za-z0-9_\\-]{1,64}';
    idLabel.append(id);
    const titleLabel = element('label', 'Seitentitel ');
    const title = element('input');
    title.required = true;
    title.maxLength = 128;
    titleLabel.append(title);
    this.#inputs.push({ input: id, original: '', group: add }, { input: title, original: '', group: add });
    const submit = element('button', 'Seite hinzufügen');
    submit.type = 'submit';
    add.append(idLabel, titleLabel, submit);
    add.addEventListener('submit', (event) => {
      event.preventDefault();
      return this.#change((token) => this.#controller.addPage(id.value, title.value, token), add);
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
    this.#inputs.push({ input: target, original: target.value, group: form });
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
      this.#inputs.push({ input, original: input.value, group: form });
      form.append(label);
    }
    const move = element('button', 'Widget verschieben');
    move.type = 'submit';
    form.append(move);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const grid = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.valueAsNumber]));
      return this.#change((token) => this.#controller.moveWidget(page.id, target.value, widget.id, grid, token), form);
    });
    return form;
  }

  async #change(operation, group = null) {
    if (this.#busy || this.#closed || this.#requiresReload) return;
    if (this.#inputs.some((entry) => entry.group !== group && entry.input.value !== entry.original)) {
      this.#message('Andere Eingaben zuerst speichern oder zurücksetzen.', true);
      return;
    }
    this.#busy = true;
    this.#controls.inert = true;
    this.#close.disabled = true;
    this.#message('Entwurf wird gespeichert …');
    try {
      this.#state = await operation(this.#state.token);
      if (this.#suspended) return;
      this.#render();
      this.#message('Änderung als Entwurf gespeichert.');
    } catch (error) {
      if (this.#suspended) return;
      this.#requiresReload = true;
      this.#message(`Änderung nicht bestätigt: ${error.message || String(error)}. Vor weiterer Bearbeitung Zustand erneut laden.`, true);
    } finally {
      this.#busy = false;
      if (this.#suspended) this.close();
      else {
        this.#controls.inert = this.#requiresReload;
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
