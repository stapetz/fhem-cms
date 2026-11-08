import { Schema5GridEdit } from './fcui-schema5-grid-edit.js';

function make(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

function samePosition(left, right) {
  return left && right && ['id', 'x', 'y', 'w', 'h'].every((key) => left[key] === right[key]);
}

export class Schema5GridPanel {
  #editor;
  #root;
  #status;
  #form;
  #select;
  #fields = {};
  #save;
  #cancel;
  #baseline = null;
  #selected = '';
  #closed = false;
  #saving = false;
  #suspended = false;
  #dirty = false;
  #requiresReload = false;
  #onSaved;
  #onCancel;

  constructor({ GridStack, root, controller, pageId, token, onSaved, onCancel }) {
    if (!root || root.children.length || typeof onSaved !== 'function' || typeof onCancel !== 'function') {
      throw new Error('Leerer Container und Abschlussfunktionen erforderlich');
    }
    const state = controller.snapshot();
    const config = state.draft || state.live;
    const page = config.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error('Unbekannte Seite');
    this.#root = root;
    this.#onSaved = onSaved;
    this.#onCancel = onCancel;

    const heading = make('h2', 'Raster bearbeiten');
    const hint = make('p', 'Positionen ziehen oder unten eingeben. Gespeichert wird nur ein Entwurf.');
    const status = make('p');
    status.setAttribute('role', 'status');
    this.#status = status;
    const grid = make('div');
    grid.className = 'grid-stack cms-position-grid';
    const form = make('form');
    this.#form = form;
    const selectLabel = make('label', 'Element ');
    const select = make('select');
    this.#select = select;
    for (const [id, label] of [['__nav', 'Navigation'], ...page.widgets.map((widget) =>
      [widget.id, `${widget.type}: ${widget.id}`])]) {
      const option = make('option', label);
      option.value = id;
      select.append(option);
    }
    selectLabel.append(select);
    form.append(selectLabel);
    for (const [key, label, max] of [
      ['col', 'Spalte', 12], ['row', 'Zeile', 1000], ['w', 'Breite', 12], ['h', 'Höhe', 1000],
    ]) {
      const wrapper = make('label', `${label} `);
      const input = make('input');
      input.type = 'number';
      input.min = '1';
      input.max = String(max);
      input.step = '1';
      input.required = true;
      wrapper.append(input);
      form.append(wrapper);
      this.#fields[key] = input;
      input.addEventListener('input', () => { this.#dirty = true; });
    }
    const load = make('button', 'Aktuelle Position laden');
    load.type = 'button';
    const apply = make('button', 'Position übernehmen');
    apply.type = 'submit';
    form.append(load, apply);
    const save = make('button', 'Raster als Entwurf speichern');
    save.type = 'button';
    this.#save = save;
    const cancel = make('button', 'Abbrechen');
    cancel.type = 'button';
    this.#cancel = cancel;
    cancel.className = 'cms-button cms-panel-close';
    root.append(heading, hint, status, grid, form, save, cancel);

    try {
      this.#editor = new Schema5GridEdit({ GridStack, root: grid, controller, pageId, token });
      this.#loadPosition();
    } catch (error) {
      if (this.#editor) this.#editor.close();
      root.replaceChildren();
      throw error;
    }
    select.addEventListener('change', () => {
      if (this.#dirty) {
        select.value = this.#selected;
        this.#message('Position zuerst übernehmen oder erneut laden.', true);
        return;
      }
      this.#tryLoad();
    });
    load.addEventListener('click', () => this.#tryLoad());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#applyPosition();
    });
    save.addEventListener('click', () => this.#saveDraft());
    cancel.addEventListener('click', () => {
      this.close();
      this.#onCancel({ requiresReload: this.#requiresReload });
    });
  }

  #message(text, error = false) {
    this.#status.textContent = text;
    if (error) this.#status.setAttribute('data-error', '');
    else this.#status.removeAttribute('data-error');
  }

  #loadPosition() {
    const item = this.#editor.positions().find((entry) => entry.id === this.#select.value);
    if (!item) throw new Error('Unbekanntes Rasterelement');
    this.#baseline = item;
    this.#selected = item.id;
    this.#dirty = false;
    for (const [key, value] of Object.entries({ col: item.x + 1, row: item.y + 1, w: item.w, h: item.h })) {
      this.#fields[key].value = String(value);
    }
    this.#message('Aktuelle Position geladen.');
  }

  #tryLoad() {
    try {
      this.#loadPosition();
    } catch (error) {
      this.#baseline = null;
      this.#message(`Position konnte nicht geladen werden: ${error.message}`, true);
    }
  }

  #applyPosition() {
    try {
      const current = this.#editor.positions().find((entry) => entry.id === this.#select.value);
      if (!samePosition(current, this.#baseline)) {
        this.#baseline = null;
        throw new Error('Position wurde verändert; bitte aktuelle Position erneut laden');
      }
      const position = Object.fromEntries(Object.entries(this.#fields).map(([key, input]) => [key, input.valueAsNumber]));
      this.#editor.setPosition(this.#select.value, position);
      this.#loadPosition();
      this.#message('Position übernommen; noch nicht gespeichert.');
    } catch (error) {
      if (!this.#editor.editing) {
        this.#form.hidden = true;
        this.#save.disabled = true;
      }
      this.#message(`Position nicht übernommen: ${error.message}`, true);
    }
  }

  async #saveDraft() {
    if (this.#saving || this.#closed) return;
    if (this.#dirty) {
      this.#message('Position zuerst übernehmen oder erneut laden.', true);
      return;
    }
    this.#saving = true;
    this.#form.hidden = true;
    this.#save.disabled = true;
    this.#cancel.disabled = true;
    this.#message('Entwurf wird gespeichert …');
    let result;
    try {
      result = await this.#editor.save();
    } catch (error) {
      this.#saving = false;
      if (this.#suspended) {
        this.close();
        return;
      }
      this.#requiresReload = true;
      this.#cancel.disabled = false;
      this.#cancel.textContent = 'Schließen';
      this.#message(`Entwurf nicht bestätigt: ${error.message}. Vor weiterer Bearbeitung Zustand erneut laden.`, true);
      return;
    }
    this.#saving = false;
    this.close();
    if (!this.#suspended) this.#onSaved(result);
  }

  suspend() {
    if (this.#closed || this.#suspended) return;
    this.#suspended = true;
    this.#root.hidden = true;
    if (!this.#saving) this.close();
  }

  close() {
    if (this.#closed) return;
    if (this.#saving) throw new Error('Speichern läuft noch');
    this.#editor.close();
    this.#closed = true;
    this.#root.replaceChildren();
  }
}
