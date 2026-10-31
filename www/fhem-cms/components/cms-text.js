import { renderMarkdown } from '../js/markdown.js';

const MAX_TEXT = 20000;
const GRID_FIELDS = [
  { key: 'col', label: 'Spalte (1–12)', min: 1, max: 12 },
  { key: 'row', label: 'Zeile', min: 1, max: 1000 },
  { key: 'w', label: 'Breite (Spalten)', min: 1, max: 12 },
  { key: 'h', label: 'Höhe (Zeilen)', min: 1, max: 1000 }
];

class FHEMCMSText extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.isNew = false;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount > 0) {
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; }
        * { box-sizing: border-box; }
        .tile { height: 100%; padding: 1rem; border: 1px solid #43564a; border-radius: 1rem;
          background: #202e27; display: grid; gap: 0.5rem; align-content: start; }
        header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
        h3 { margin: 0; font-size: 1rem; overflow-wrap: anywhere; }
        .body { overflow-wrap: anywhere; line-height: 1.5; }
        .body > :first-child { margin-top: 0; }
        .body > :last-child { margin-bottom: 0; }
        .body h3, .body h4, .body h5 { margin: 0.8rem 0 0.4rem; }
        .body a { color: #8fd0a8; }
        .body code { background: #17211d; padding: 0 0.25rem; border-radius: 0.25rem; }
        button { font: inherit; color: inherit; cursor: pointer; border: 1px solid #43564a;
          border-radius: 0.5rem; background: #2a3b32; padding: 0.35rem 0.7rem; }
        button:hover { background: #34493e; }
        button:focus-visible, input:focus-visible, textarea:focus-visible, a:focus-visible {
          outline: 2px solid #8fd0a8; outline-offset: 2px; }
        .icon { padding: 0.2rem 0.5rem; }
        dialog { border: 1px solid #43564a; border-radius: 1rem; background: #202e27; color: #edf4ef;
          padding: 1.25rem; width: min(92vw, 36rem); }
        dialog::backdrop { background: rgb(0 0 0 / 0.6); }
        form { display: grid; gap: 0.75rem; }
        label { display: grid; gap: 0.25rem; font-size: 0.9rem; }
        input, textarea { font: inherit; color: inherit; background: #17211d; border: 1px solid #43564a;
          border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
        textarea { min-height: 10rem; resize: vertical; font-family: ui-monospace, monospace; }
        fieldset { border: 1px solid #43564a; border-radius: 0.75rem; padding: 0.75rem; margin: 0;
          display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr)); }
        legend { color: #a5c9b2; font-size: 0.8rem; }
        .hint { margin: 0; color: #a5c9b2; font-size: 0.8rem; }
        .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
        .danger { margin-right: auto; border-color: #7f3b33; }
        .error { margin: 0; color: #ffb4a8; min-height: 1.2em; }
      </style>
      <article class="tile">
        <header>
          <h3 data-title hidden></h3>
          <button type="button" class="icon" data-open-config aria-label="Textbaustein konfigurieren">⚙</button>
        </header>
        <div class="body" data-body></div>
      </article>
      <dialog data-dialog aria-labelledby="text-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="text-dialog-title">Textbaustein konfigurieren</h3>
          <label>Titel (optional)
            <input name="title" maxlength="64" autocomplete="off">
          </label>
          <label>Text (Markdown)
            <textarea name="markdown" maxlength="${MAX_TEXT}"></textarea>
          </label>
          <p class="hint">Unterstützt: # Überschrift, **fett**, *kursiv*, \`Code\`, - Listen, 1. Listen, [Text](https://…). HTML wird nicht ausgeführt.</p>
          <fieldset data-grid><legend>Position im 12-Spalten-Raster</legend></fieldset>
          <p class="error" role="alert" data-dialog-error></p>
          <div class="actions">
            <button type="button" class="danger" data-delete>Löschen</button>
            <button type="button" data-cancel>Abbrechen</button>
            <button type="submit" data-save>Speichern</button>
          </div>
        </form>
      </dialog>
    `;

    const grid = this.shadowRoot.querySelector('[data-grid]');
    for (const field of GRID_FIELDS) {
      const label = document.createElement('label');
      label.textContent = field.label;
      const input = document.createElement('input');
      input.name = `grid-${field.key}`;
      input.type = 'number';
      input.min = String(field.min);
      input.max = String(field.max);
      input.required = true;
      label.append(input);
      grid.append(label);
    }

    const $ = (selector) => this.shadowRoot.querySelector(selector);
    $('[data-open-config]').addEventListener('click', () => this.openConfig());
    $('[data-cancel]').addEventListener('click', () => this.closeDialog(true));
    $('[data-delete]').addEventListener('click', () => this.onDelete());
    $('[data-dialog]').addEventListener('cancel', () => this.closeDialog(true));
    $('[data-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      this.onSave();
    });
    this.render();
  }

  set config(value) {
    this.widgetConfig = value;
    this.render();
  }

  get config() {
    return this.widgetConfig;
  }

  set data(_value) {}

  render() {
    const body = this.shadowRoot.querySelector('[data-body]');
    if (!body || !this.widgetConfig) {
      return;
    }
    const title = this.shadowRoot.querySelector('[data-title]');
    title.textContent = this.widgetConfig.title || '';
    title.hidden = !this.widgetConfig.title;
    body.replaceChildren(renderMarkdown(this.widgetConfig.markdown || ''));
  }

  openConfig(options = {}) {
    this.isNew = Boolean(options.isNew);
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.markdown.value = this.widgetConfig.markdown || '';
    for (const field of GRID_FIELDS) {
      form.elements[`grid-${field.key}`].value = this.widgetConfig.grid[field.key];
    }
    this.shadowRoot.querySelector('[data-delete]').hidden = this.isNew;
    this.setDialogError('');
    this.shadowRoot.querySelector('[data-dialog]').showModal();
  }

  setDialogError(message) {
    this.shadowRoot.querySelector('[data-dialog-error]').textContent = message;
  }

  collectWidget() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const markdown = form.elements.markdown.value;
    if (markdown.length > MAX_TEXT) {
      throw new Error(`Der Text darf höchstens ${MAX_TEXT} Zeichen lang sein`);
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(markdown)) {
      throw new Error('Der Text enthält ungültige Steuerzeichen');
    }
    const title = form.elements.title.value.trim();
    if (/[\u0000-\u001f\u007f]/.test(title)) {
      throw new Error('Der Titel enthält ungültige Zeichen');
    }
    const grid = {};
    for (const field of GRID_FIELDS) {
      const raw = form.elements[`grid-${field.key}`].value;
      const number = Number.parseInt(raw, 10);
      if (!/^[0-9]+$/.test(raw) || number < field.min || number > field.max) {
        throw new Error(`${field.label}: Wert zwischen ${field.min} und ${field.max} erforderlich`);
      }
      grid[field.key] = number;
    }
    if (grid.col + grid.w > 13) {
      throw new Error('Spalte und Breite passen nicht in das 12-Spalten-Raster');
    }
    const widget = { id: this.widgetConfig.id, type: 'text', markdown, grid };
    if (title) {
      widget.title = title;
    }
    return widget;
  }

  async onSave() {
    const save = this.shadowRoot.querySelector('[data-save]');
    try {
      const widget = this.collectWidget();
      save.disabled = true;
      await this.services.saveWidget(widget);
      this.isNew = false;
      this.closeDialog(false);
    } catch (error) {
      this.setDialogError(error.message || 'Speichern fehlgeschlagen');
    } finally {
      save.disabled = false;
    }
  }

  async onDelete() {
    if (!window.confirm('Diesen Textbaustein wirklich löschen?')) {
      return;
    }
    try {
      await this.services.deleteWidget(this.widgetConfig.id);
      this.closeDialog(false);
    } catch (error) {
      this.setDialogError(error.message || 'Löschen fehlgeschlagen');
    }
  }

  closeDialog(cancelled) {
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) {
      dialog.close();
    }
    if (cancelled && this.isNew) {
      this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true, composed: true }));
    }
  }
}

if (!customElements.get('cms-text')) {
  customElements.define('cms-text', FHEMCMSText);
}
