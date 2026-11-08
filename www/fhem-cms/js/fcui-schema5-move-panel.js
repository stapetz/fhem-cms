function element(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

/* Kompakter Dialog am Widget: auf eine andere Seite verschieben.
   Das Widget wird auf der Zielseite unterhalb der vorhandenen Inhalte eingeordnet. */
export class Schema5MovePanel {
  #root;
  #controller;
  #token;
  #pageId;
  #widgetId;
  #onClose;
  #status;
  #select;
  #move;
  #close;
  #busy = false;
  #closed = false;
  #requiresReload = false;

  constructor({ root, controller, pageId, widgetId, token, onClose }) {
    if (!root || root.children.length || !controller || typeof controller.snapshot !== 'function'
      || typeof controller.moveWidget !== 'function' || typeof onClose !== 'function') {
      throw new Error('Dienste und leerer Container für das Verschieben erforderlich');
    }
    const state = controller.snapshot();
    if (state.token !== token) throw new Error('Zustand ist veraltet; bitte erneut laden');
    const config = state.draft || state.live;
    const page = config.pages.find((entry) => entry.id === pageId);
    const widget = page?.widgets.find((entry) => entry.id === widgetId);
    if (!page || !widget) throw new Error('Unbekanntes Widget');
    this.#root = root;
    this.#controller = controller;
    this.#token = token;
    this.#pageId = pageId;
    this.#widgetId = widgetId;
    this.#onClose = onClose;
    const name = widget.title || widget.id;
    const heading = element('h2', 'Widget auf andere Seite verschieben');
    const hint = element('p', `„${name}“ wird auf der Zielseite unterhalb der vorhandenen Inhalte eingeordnet und als Entwurf gespeichert.`);
    this.#status = element('p');
    this.#status.setAttribute('role', 'status');
    const targets = config.pages.filter((entry) => entry.id !== pageId);
    const selectLabel = element('label', 'Zielseite ');
    this.#select = element('select');
    for (const target of targets) {
      const option = element('option', target.title);
      option.value = target.id;
      this.#select.append(option);
    }
    if (targets.length) this.#select.value = targets[0].id;
    selectLabel.append(this.#select);
    this.#move = element('button', 'Verschieben');
    this.#move.type = 'button';
    this.#move.className = 'cms-button cms-panel-save';
    this.#move.disabled = targets.length === 0;
    this.#close = element('button', 'Abbrechen');
    this.#close.type = 'button';
    this.#close.className = 'cms-button cms-panel-close';
    const footer = element('div');
    footer.className = 'cms-panel-footer';
    footer.append(this.#move, this.#close);
    root.append(heading, hint, this.#status, selectLabel, footer);
    if (!targets.length) this.#statusText('Es gibt keine weitere Seite.', true);
    this.#move.addEventListener('click', () => this.#commit());
    this.#close.addEventListener('click', () => {
      if (this.#busy || this.#closed) return;
      const outcome = { requiresReload: this.#requiresReload };
      this.close();
      this.#onClose(outcome);
    });
  }

  #statusText(text, error = false) {
    this.#status.textContent = text;
    if (error) this.#status.setAttribute('data-error', '');
    else this.#status.removeAttribute('data-error');
  }

  async #commit() {
    if (this.#busy || this.#closed || this.#requiresReload || !this.#select.value) return;
    const state = this.#controller.snapshot();
    const config = state.draft || state.live;
    const source = config.pages.find((entry) => entry.id === this.#pageId);
    const target = config.pages.find((entry) => entry.id === this.#select.value);
    const widget = source?.widgets.find((entry) => entry.id === this.#widgetId);
    if (!target || !widget) {
      this.#statusText('Zielseite oder Widget nicht mehr vorhanden.', true);
      return;
    }
    // Unterhalb aller Inhalte der Zielseite einreihen (wie beim Anlegen neuer Widgets).
    const row = Math.max(Number(config.navigation.grid.row) + Number(config.navigation.grid.h),
      ...target.widgets.map((entry) => Number(entry.grid.row) + Number(entry.grid.h)));
    const grid = { col: 1, row, w: Number(widget.grid.w), h: Number(widget.grid.h) };
    this.#busy = true;
    this.#move.disabled = true;
    this.#close.disabled = true;
    this.#select.disabled = true;
    this.#statusText('Widget wird verschoben …');
    try {
      await this.#controller.moveWidget(this.#pageId, target.id, this.#widgetId, grid, this.#token);
      if (this.#closed) return;
      this.#busy = false;
      const outcome = { requiresReload: false };
      this.close();
      this.#onClose(outcome);
    } catch (error) {
      if (this.#closed) return;
      this.#requiresReload = true;
      this.#statusText(`Verschieben nicht bestätigt: ${error.message || String(error)}. Bitte Zustand erneut laden.`, true);
    } finally {
      this.#busy = false;
      if (!this.#closed) this.#close.disabled = false;
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
