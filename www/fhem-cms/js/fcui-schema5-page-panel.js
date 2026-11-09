import { resizeSchema5Grid, schema5GridItems, SCHEMA5_GRID_COLUMNS } from './fcui-schema5-layout.js';

function element(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

export class Schema5PagePanel {
  #root;
  #controller;
  #browser;
  #token;
  #config;
  #columns;
  #status;
  #theme;
  #frames;
  #form;
  #save;
  #close;
  #settingsBaseline;
  #busy = false;
  #closed = false;
  #suspended = false;
  #requiresReload = false;
  #onClose;

  constructor({ root, controller, pageId, token, browser = window, onClose }) {
    if (!root || root.children.length || !controller || typeof controller.snapshot !== 'function'
      || typeof controller.saveDraft !== 'function'
      || !browser || typeof browser.confirm !== 'function' || typeof onClose !== 'function') {
      throw new Error('Dienste und leerer Container für Seiteneinstellungen erforderlich');
    }
    const state = controller.snapshot();
    if (state.token !== token) throw new Error('Zustand ist veraltet; bitte erneut laden');
    const config = state.draft || state.live;
    schema5GridItems(config, pageId);
    this.#root = root;
    this.#controller = controller;
    this.#browser = browser;
    this.#token = token;
    this.#config = config;
    this.#onClose = onClose;

    const heading = element('h2', 'Seiteneinstellungen');
    const hint = element('p',
      'Darstellung und Raster der Seite. Die Rastergröße gilt für alle Seiten und die Navigation. '
      + 'Beim Vergröbern werden Positionen und Größen gerundet und Überschneidungen nach unten aufgelöst. '
      + 'Widgets direkt im Editiermodus verschieben und skalieren. Gespeichert wird ein Entwurf.');
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
    const layoutLabel = element('label', 'Rastergröße ');
    this.#columns = element('select');
    for (const columns of SCHEMA5_GRID_COLUMNS) {
      const option = element('option', `${columns} Spalten`);
      option.value = String(columns);
      this.#columns.append(option);
    }
    this.#columns.value = String(config.settings.gridColumns);
    layoutLabel.append(this.#columns);
    this.#form.append(themeLabel, framesLabel, layoutLabel);
    this.#form.addEventListener('submit', (event) => event.preventDefault());

    this.#save = element('button', 'Speichern');
    this.#save.type = 'button';
    this.#save.className = 'cms-button cms-panel-save';
    this.#close = element('button', 'Abbrechen');
    this.#close.type = 'button';
    this.#close.className = 'cms-button cms-panel-close';
    const footer = element('div');
    footer.className = 'cms-panel-footer';
    footer.append(this.#close, this.#save);
    root.append(heading, hint, this.#status, this.#form, footer);

    this.#settingsBaseline = JSON.stringify([this.#theme.value, this.#frames.checked, this.#columns.value]);
    this.#columns.addEventListener('change', () => this.#changeColumns());
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
    return JSON.stringify([this.#theme.value, this.#frames.checked, this.#columns.value]) !== this.#settingsBaseline;
  }

  #changeColumns() {
    if (this.#busy || this.#closed || this.#requiresReload) return;
    try {
      resizeSchema5Grid(this.#config, Number(this.#columns.value));
      this.#message('Raster aller Seiten wird beim Speichern umgerechnet; noch nicht gespeichert.');
    } catch (error) {
      this.#columns.value = String(this.#config.settings.gridColumns);
      this.#message(`Raster nicht übernommen: ${error.message}`, true);
    }
  }

  async #saveDraft() {
    if (this.#busy || this.#closed || this.#requiresReload) return;
    if (!['dark', 'light'].includes(this.#theme.value)) {
      this.#message('Ungültige Darstellung', true);
      return;
    }
    let pending;
    try {
      const candidate = resizeSchema5Grid(this.#config, Number(this.#columns.value));
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
    this.#save.disabled = true;
    this.#close.disabled = true;
    this.#message('Entwurf wird gespeichert …');
    try {
      await pending;
      if (this.#suspended || this.#closed) return;
      this.#busy = false;
      this.close();
      this.#onClose({ requiresReload: false });
    } catch (error) {
      if (this.#suspended || this.#closed) return;
      this.#requiresReload = true;
      this.#message(`Entwurf nicht bestätigt: ${error.message || String(error)}. Vor weiterer Bearbeitung Zustand erneut laden.`, true);
    } finally {
      this.#busy = false;
      if (this.#suspended) this.close();
      else if (!this.#closed) {
        this.#form.inert = this.#requiresReload;
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
