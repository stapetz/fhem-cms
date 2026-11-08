import { lookupValue, substituteIn } from '../js/freehtml.js';
import { renderMarkdown } from '../js/markdown.js';
import { MAX_HTML, contentCss, createEditor, editorCss, markdownToHtml, renderHtml } from '../js/richtext.js';

class FHEMCMSText extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.isNew = false;
    this.editor = null;
    this.groups = null;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount > 0) {
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; }
        * { box-sizing: border-box; }
        .tile { height: 100%; padding: 1rem; border: 1px solid var(--cms-border, #43564a); border-radius: 1rem;
          background: var(--cms-surface, #202e27); display: grid; gap: 0.5rem; align-content: start; }
        header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
        h3 { margin: 0; font-size: max(6px, min(10cqh, 4.5cqw)); overflow-wrap: anywhere; }
        ${contentCss('.body')}
        .body h4, .body h5 { margin: 0.8rem 0 0.4rem; }
        ${editorCss()}
        .tile[data-stale] { opacity: 0.65; border-style: dashed; }
        button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.35rem 0.7rem; }
        button:hover { background: var(--cms-surface-hover, #34493e); }
        button:focus-visible, input:focus-visible, textarea:focus-visible, a:focus-visible {
          outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        .icon { padding: 0.2rem 0.5rem; }
        :host([view-only]) [data-open-config] { display: none; }
        dialog { border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef);
          padding: 1.25rem; width: min(94vw, 52rem); max-height: 94vh; overflow: auto; }
        dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
        form { display: grid; gap: 0.75rem; }
        label { display: grid; gap: 0.25rem; font-size: 0.9rem; }
        input, textarea { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
        textarea { min-height: 10rem; resize: vertical; font-family: ui-monospace, monospace; }
        fieldset { border: 1px solid var(--cms-border, #43564a); border-radius: 0.75rem; padding: 0.75rem; margin: 0;
          display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr)); }
        legend { color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { margin: 0; color: var(--cms-danger, #ffb4a8); min-height: 1.2em; }
      </style>
      <article class="tile">
        <header>
          <h3 data-title hidden></h3>
          <button type="button" class="icon" data-open-config title="Widget konfigurieren" aria-label="Textbaustein konfigurieren">⚙</button>
        </header>
        <div class="body" data-body></div>
      </article>
      <dialog data-dialog aria-labelledby="text-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="text-dialog-title">Textbaustein konfigurieren</h3>
          <label>Titel (optional)
            <input name="title" maxlength="64" autocomplete="off">
          </label>
          <div data-editor></div>
          <p class="error" role="alert" data-dialog-error></p>
          <div class="actions">
            <button type="button" class="danger" data-delete>Löschen</button>
            <button type="button" data-cancel>Abbrechen</button>
            <button type="submit" data-save>Speichern</button>
          </div>
        </form>
      </dialog>
    `;

    const $ = (selector) => this.shadowRoot.querySelector(selector);
    $('[data-open-config]').addEventListener('click', () => this.openConfig());
    $('[data-cancel]').addEventListener('click', () => this.closeDialog(true));
    $('[data-delete]').addEventListener('click', () => this.onDelete());
    $('[data-dialog]').addEventListener('cancel', () => this.closeDialog(true));
    $('[data-form]').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'submit'
        && event.target.closest('.rt')) {
        event.preventDefault();
      }
    });
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

  // Map Device -> [Hauptdevice, Kanäle …] für Platzhalter im Text
  set data(value) {
    this.groups = value instanceof Map ? value : null;
    this.render();
  }

  set stale(value) {
    this.shadowRoot.querySelector('.tile')?.toggleAttribute('data-stale', Boolean(value));
  }

  render() {
    const body = this.shadowRoot.querySelector('[data-body]');
    if (!body || !this.widgetConfig) {
      return;
    }
    const title = this.shadowRoot.querySelector('[data-title]');
    title.textContent = this.widgetConfig.title || '';
    title.hidden = !this.widgetConfig.title;
    if (typeof this.widgetConfig.html === 'string') {
      const fragment = renderHtml(this.widgetConfig.html);
      substituteIn(fragment, (device, reading) => lookupValue(this.groups, device, reading));
      body.replaceChildren(fragment);
    } else {
      body.replaceChildren(renderMarkdown(this.widgetConfig.markdown || ''));
    }
  }

  openConfig(options = {}) {
    this.isNew = Boolean(options.isNew);
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    const initial = typeof this.widgetConfig.html === 'string'
      ? this.widgetConfig.html
      : markdownToHtml(renderMarkdown(this.widgetConfig.markdown || ''));
    this.destroyEditor();
    this.editor = createEditor({
      root: this.shadowRoot,
      services: this.services,
      html: initial,
      onError: (message) => this.setDialogError(message)
    });
    this.shadowRoot.querySelector('[data-editor]').replaceChildren(this.editor.element);
    this.shadowRoot.querySelector('[data-delete]').hidden = this.isNew;
    this.setDialogError('');
    this.shadowRoot.querySelector('[data-dialog]').showModal();
  }

  setDialogError(message) {
    this.shadowRoot.querySelector('[data-dialog-error]').textContent = message;
  }

  collectWidget() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const html = this.editor ? this.editor.getHtml() : '';
    if (html.length > MAX_HTML) {
      throw new Error(`Der Text darf höchstens ${MAX_HTML} Zeichen lang sein (aktuell ${html.length})`);
    }
    const title = form.elements.title.value.trim();
    if (/[\u0000-\u001f\u007f]/.test(title)) {
      throw new Error('Der Titel enthält ungültige Zeichen');
    }
    // Position und Größe ändert der Layout-Modus der Seite.
    const widget = { id: this.widgetConfig.id, type: 'text', html, grid: { ...this.widgetConfig.grid } };
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

  destroyEditor() {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  }

  closeDialog(cancelled) {
    this.destroyEditor();
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
