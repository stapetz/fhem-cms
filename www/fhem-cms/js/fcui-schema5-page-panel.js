import { Schema5GridEdit } from './fcui-schema5-grid-edit.js';
import { applySchema5GridItems, schema5GridItems } from './fcui-schema5-layout.js';

function element(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

function samePosition(left, right) {
  return left && right && ['id', 'x', 'y', 'w', 'h'].every((key) => left[key] === right[key]);
}

/* Seite bearbeiten: Theme, Rahmen und Rasterart zusammen mit der Rastervorschau
   und der präzisen Positionseingabe. Gespeichert wird alles in einem Entwurf. */
export class Schema5PagePanel {
  #root;
  #controller;
  #browser;
  #token;
  #state;
  #pageId;
  #editor;
  #status;
  #theme;
  #frames;
  #form;
  #positionForm;
  #select;
  #fields = {};
  #save;
  #close;
  #baseline = null;
  #selected = '';
  #layoutBaseline;
  #settingsBaseline;
  #dirty = false;
  #busy = false;
  #closed = false;
  #suspended = false;
  #requiresReload = false;
  #onClose;

  constructor({ GridStack, root, controller, pageId, token, browser = window, onClose }) {
    if (!root || root.children.length || !controller || typeof controller.snapshot !== 'function'
      || typeof controller.saveDraft !== 'function'
      || !browser || typeof browser.confirm !== 'function' || typeof onClose !== 'function') {
      throw new Error('Dienste und leerer Container für Seite bearbeiten erforderlich');
    }
    const state = controller.snapshot();
    if (state.token !== token) throw new Error('Zustand ist veraltet; bitte erneut laden');
    const config = state.draft || state.live;
    const page = config.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error('Unbekannte Seite');
    this.#root = root;
    this.#controller = controller;
    this.#browser = browser;
    this.#token = token;
    this.#state = state;
    this.#pageId = pageId;
    this.#onClose = onClose;

    const heading = element('h2', 'Seite bearbeiten');
    const hint = element('p',
      'Darstellung und Raster der Seite. Positionen in der Vorschau ziehen oder unten eingeben; gespeichert wird ein Entwurf.');
    this.#status = element('p');
    this.#status.setAttribute('role', 'status');

    this.#form = element('form');
    const themeLabel = element('label', 'Darstellung ');
    this.#theme = element('select');
    for (const [value, title] of [['dark', 'Dunkel'], ['light', 'Hell']]) {
      const option = element('option', title);
      option.value = value;
      this.#theme.append(option);
    }
    this.#theme.value = config.theme || 'dark';
    themeLabel.append(this.#theme);
    const framesLabel = element('label', 'Rahmen anzeigen ');
    this.#frames = element('input');
    this.#frames.type = 'checkbox';
    this.#frames.checked = config.settings.showFrames !== false;
    framesLabel.append(this.#frames);
    const layoutLabel = element('label', 'Rasterart ');
    const layout = element('select');
    const gridOption = element('option', 'Gitter (12 Spalten)');
    gridOption.value = 'grid';
    layout.append(gridOption);
    layout.value = 'grid';
    layout.disabled = true;
    layout.title = 'Weitere Rasterarten folgen in einer späteren Version.';
    layoutLabel.append(layout);
    this.#form.append(themeLabel, framesLabel, layoutLabel);
    this.#form.addEventListener('submit', (event) => event.preventDefault());

    const grid = element('div');
    grid.className = 'grid-stack cms-position-grid';

    this.#positionForm = element('form');
    const selectLabel = element('label', 'Element ');
    this.#select = element('select');
    for (const [id, label] of [['__nav', 'Navigation'], ...page.widgets.map((widget) =>
      [widget.id, `${widget.title || widget.id} (${widget.type})`])]) {
      const option = element('option', label);
      option.value = id;
      this.#select.append(option);
    }
    selectLabel.append(this.#select);
    this.#select.value = '__nav';
    this.#positionForm.append(selectLabel);
    for (const [key, label, max] of [
      ['col', 'Spalte', 12], ['row', 'Zeile', 1000], ['w', 'Breite', 12], ['h', 'Höhe', 1000],
    ]) {
      const wrapper = element('label', `${label} `);
      const input = element('input');
      input.type = 'number';
      input.min = '1';
      input.max = String(max);
      input.step = '1';
      input.required = true;
      wrapper.append(input);
      this.#positionForm.append(wrapper);
      this.#fields[key] = input;
      input.addEventListener('input', () => { this.#dirty = true; });
    }
    const load = element('button', 'Aktuelle Position laden');
    load.type = 'button';
    const apply = element('button', 'Position übernehmen');
    apply.type = 'submit';
    this.#positionForm.append(load, apply);

    this.#save = element('button', 'Speichern');
    this.#save.type = 'button';
    this.#save.className = 'cms-button cms-panel-save';
    this.#close = element('button', 'Abbrechen');
    this.#close.type = 'button';
    this.#close.className = 'cms-button cms-panel-close';
    const footer = element('div');
    footer.className = 'cms-panel-footer';
    footer.append(this.#save, this.#close);

    root.append(heading, hint, this.#status, this.#form, grid, this.#positionForm, footer);

    try {
      this.#editor = new Schema5GridEdit({ GridStack, root: grid, controller, pageId, token });
      this.#layoutBaseline = JSON.stringify(schema5GridItems(config, pageId));
      this.#settingsBaseline = JSON.stringify([this.#theme.value, this.#frames.checked]);
      this.#loadPosition();
    } catch (error) {
      if (this.#editor) this.#editor.close();
      root.replaceChildren();
      throw error;
    }
    this.#select.addEventListener('change', () => {
      if (this.#dirty) {
        this.#select.value = this.#selected;
        this.#message('Position zuerst übernehmen oder erneut laden.', true);
        return;
      }
      this.#tryLoad();
    });
    load.addEventListener('click', () => this.#tryLoad());
    this.#positionForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#applyPosition();
    });
    this.#save.addEventListener('click', () => this.#saveDraft());
    this.#close.addEventListener('click', () => {
      if (this.#busy || this.#closed) return;
      if (!this.#requiresReload && this.#changed()
        && !this.#browser.confirm('Nicht gespeicherte Änderungen verwerfen?')) return;
      const outcome = { requiresReload: this.#requiresReload };
      this.close();
      this.#onClose(outcome);
    });
  }

  #message(text, error = false) {
    this.#status.textContent = text;
    if (error) this.#status.setAttribute('data-error', '');
    else this.#status.removeAttribute('data-error');
  }

  #changed() {
    if (this.#dirty) return true;
    if (JSON.stringify([this.#theme.value, this.#frames.checked]) !== this.#settingsBaseline) return true;
    if (!this.#editor.editing) return false;
    try {
      return JSON.stringify(this.#editor.positions()) !== this.#layoutBaseline;
    } catch {
      return false;
    }
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
        this.#positionForm.hidden = true;
        this.#save.disabled = true;
      }
      this.#message(`Position nicht übernommen: ${error.message}`, true);
    }
  }

  async #saveDraft() {
    if (this.#busy || this.#closed || this.#requiresReload) return;
    if (this.#dirty) {
      this.#message('Position zuerst übernehmen oder erneut laden.', true);
      return;
    }
    if (!['dark', 'light'].includes(this.#theme.value)) {
      this.#message('Ungültige Darstellung', true);
      return;
    }
    let pending;
    try {
      const positions = this.#editor.positions();
      const candidate = applySchema5GridItems(this.#state.draft || this.#state.live, this.#pageId, positions);
      const [originalTheme, originalFrames] = JSON.parse(this.#settingsBaseline);
      if (this.#theme.value !== originalTheme) candidate.theme = this.#theme.value;
      if (this.#frames.checked !== originalFrames) candidate.settings.showFrames = this.#frames.checked;
      pending = this.#controller.saveDraft(candidate, this.#token);
    } catch (error) {
      this.#message(`Änderung ungültig: ${error.message || String(error)}`, true);
      return;
    }
    this.#busy = true;
    this.#form.inert = true;
    this.#positionForm.inert = true;
    this.#save.disabled = true;
    this.#close.disabled = true;
    this.#message('Entwurf wird gespeichert …');
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
      this.#message(`Entwurf nicht bestätigt: ${error.message || String(error)}. Vor weiterer Bearbeitung Zustand erneut laden.`, true);
    } finally {
      this.#busy = false;
      if (this.#suspended) this.close();
      else if (!this.#closed) {
        this.#form.inert = this.#requiresReload;
        this.#positionForm.inert = this.#requiresReload;
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
    if (this.#editor) this.#editor.close();
    this.#closed = true;
    this.#root.replaceChildren();
  }
}
