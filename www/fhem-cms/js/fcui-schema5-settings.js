function element(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

export class Schema5SettingsPanel {
  #root;
  #controller;
  #browser;
  #state;
  #onClose;
  #status;
  #form;
  #close;
  #theme;
  #frames;
  #original;
  #busy = false;
  #closed = false;
  #requiresReload = false;

  constructor({ root, controller, token, browser = window, onClose }) {
    if (!root || root.children.length || !controller || typeof controller.snapshot !== 'function'
      || typeof controller.saveDraft !== 'function' || !browser || typeof browser.confirm !== 'function'
      || typeof onClose !== 'function') {
      throw new Error('Dienste und leerer Container für Einstellungen erforderlich');
    }
    const state = controller.snapshot();
    if (state.token !== token) throw new Error('Zustand ist veraltet; bitte erneut laden');
    const config = state.draft || state.live;
    this.#root = root;
    this.#controller = controller;
    this.#browser = browser;
    this.#state = state;
    this.#onClose = onClose;
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
    const save = element('button', 'Einstellungen als Entwurf speichern');
    save.type = 'submit';
    this.#form.append(themeLabel, framesLabel, save);
    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      return this.#save();
    });
    this.#close = element('button', 'Schließen');
    this.#close.type = 'button';
    this.#close.addEventListener('click', () => {
      if (this.#busy || this.#closed) return;
      if (!this.#requiresReload && this.#values() !== this.#original
        && !this.#browser.confirm('Nicht gespeicherte Einstellungen verwerfen?')) return;
      const outcome = { requiresReload: this.#requiresReload };
      this.close();
      this.#onClose(outcome);
    });
    this.#original = this.#values();
    root.append(element('h2', 'Darstellung einstellen'), this.#status, this.#form, this.#close);
  }

  #values() {
    return JSON.stringify([this.#theme.value, this.#frames.checked]);
  }

  async #save() {
    if (this.#closed || this.#busy || this.#requiresReload) return;
    if (!['dark', 'light'].includes(this.#theme.value)) {
      this.#status.setAttribute('data-error', '');
      this.#status.textContent = 'Ungültige Darstellung';
      return;
    }
    const candidate = structuredClone(this.#state.draft || this.#state.live);
    const [originalTheme, originalFrames] = JSON.parse(this.#original);
    if (this.#theme.value !== originalTheme) candidate.theme = this.#theme.value;
    if (this.#frames.checked !== originalFrames) candidate.settings.showFrames = this.#frames.checked;
    this.#busy = true;
    this.#form.inert = true;
    this.#close.disabled = true;
    this.#status.removeAttribute('data-error');
    this.#status.textContent = 'Entwurf wird gespeichert …';
    try {
      const state = await this.#controller.saveDraft(candidate, this.#state.token);
      if (this.#closed) return;
      this.#state = state;
      this.#original = this.#values();
      this.#status.textContent = 'Einstellungen als Entwurf gespeichert.';
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
