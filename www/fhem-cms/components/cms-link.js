import { LINK_COLUMNS, MAX_LINKS, LINK_MEDIA, linkBounds, linkHref, validateLinkItems } from '../js/link-widget.js';
import { dialogGroupStyles, titleVisibilityField } from '../js/dialog-groups.js';

function node(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

class FHEMCMSLink extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.links = [];
    this.selected = null;
    this.grid = null;
    this.generation = 0;
    this.busy = false;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) return;
    const sheet = node('link');
    sheet.rel = 'stylesheet';
    sheet.href = new URL('../css/fcui-gridstack.css', import.meta.url).href;
    this.stylesReady = new Promise((resolve, reject) => {
      sheet.addEventListener('load', resolve, { once: true });
      sheet.addEventListener('error', () => reject(new Error('Linkraster-Styles konnten nicht geladen werden')), { once: true });
    });
    // A view never opens the dialog, but must still expose stylesheet failures.
    this.stylesReady.catch(error => this.message(error.message));
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; min-width:0; min-height:0; }
        * { box-sizing:border-box; }
        .tile { height:100%; min-height:0; overflow:hidden; padding:8px; gap:14px;
          border:1px solid var(--cms-frame,#7f8c84); border-radius:1.4rem; background:var(--cms-surface,#202e27);
          display:flex; flex-direction:column; container-type:size; color:inherit;
          font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
        header { flex:none; padding:0 0 8px; display:flex; align-items:center;
          gap:8px; border-bottom:1px solid rgba(128,128,128,.25); }
        header[hidden] { display:none; }
        [data-title] { margin:0; width:100%; min-width:0; font-size:1.4rem; font-weight:700;
          color:inherit; overflow-wrap:anywhere;
          text-align:var(--cms-widget-title-align,left); }
        .links { flex:1; min-height:0; display:grid; gap:8px; grid-template-columns:repeat(12,minmax(0,1fr)); }
        .link-tile { position:relative; min-width:0; min-height:0; overflow:hidden; display:flex; flex-direction:column;
          border:1px solid rgba(128,128,128,.18); border-radius:14px; color:inherit;
          background:rgba(128,128,128,.08); text-decoration:none; container-type:size; }
        .link-tile:hover { border-color:currentColor; }
        .link-tile:active { transform:scale(.96); }
        .link-tile img { display:block; flex:1; min-height:0; width:100%; object-fit:cover; }
        .link-text { flex:none; margin:0; padding:.25em .4em; text-align:center; overflow-wrap:anywhere;
          font-size:clamp(10px, min(15cqh,8cqw),32px); line-height:1.15; }
        .link-tile[data-position="below"] .link-text { order:1; }
        .link-tile[data-position="overlay"] .link-text { position:absolute; z-index:1; top:0; left:0; right:0;
          background:rgb(0 0 0 / .6); color:#fff; }
        .link-tile:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
          outline:2px solid var(--cms-accent,#8fd0a8); outline-offset:-2px; }
        :host([view-only]) [data-open-config] { display:none; }
        [data-open-config] { flex:none; min-width:48px; min-height:48px; }
        button,input,select { font:inherit; color:inherit; border:1px solid var(--cms-border,#43564a);
          border-radius:.4rem; background:var(--cms-bg,#17211d); padding:.4rem .5rem; }
        button { cursor:pointer; }
        dialog { width:min(96vw,64rem); max-height:94vh; overflow:auto; padding:1rem;
          border:1px solid var(--cms-border,#43564a); border-radius:1rem;
          color:var(--cms-text,#edf4ef); background:var(--cms-surface,#202e27); }
        dialog::backdrop { background:var(--cms-backdrop,rgb(0 0 0 / .6)); }
        form,.settings { display:grid; gap:.6rem; }
        ${dialogGroupStyles}
        label { display:grid; gap:.2rem; }
        .check { display:flex; align-items:center; gap:.4rem; }
        .check input { width:auto; }
        .editor { display:grid; grid-template-columns:minmax(0,2fr) minmax(12rem,1fr); gap:1rem; }
        .canvas { min-width:0; max-height:50vh; overflow:auto; border:1px solid var(--cms-border,#43564a); }
        .grid-stack { min-height:12rem;
          background-image:linear-gradient(to right, var(--cms-border,#43564a) 1px, transparent 1px),
            linear-gradient(to bottom, var(--cms-border,#43564a) 1px, transparent 1px);
          background-size:calc(100% / 12) var(--gs-cell-height,3rem); }
        .grid-stack-item-content { display:flex; flex-direction:column; gap:.25rem; padding:.3rem;
          border:1px solid var(--cms-border,#43564a); background:var(--cms-surface-raised,#2a3b32); border-radius:.5rem; }
        .grid-stack-item-content[data-image] { background-size:cover; background-position:center; }
        .grid-stack-item-content[data-image] .handle,
        .grid-stack-item-content[data-image] .choose { background:rgb(0 0 0 / .65); color:white; }
        .grid-stack-item[data-selected] .grid-stack-item-content { outline:2px solid var(--cms-accent,#8fd0a8); outline-offset:-2px; }
        .handle { touch-action:none; cursor:move; padding:.1rem; }
        .choose { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .media { display:flex; gap:.3rem; flex-wrap:wrap; max-height:8rem; overflow:auto; }
        .media img { width:3rem; height:2.5rem; object-fit:cover; }
        .preview-image { max-width:100%; max-height:6rem; object-fit:contain; }
        .actions { display:flex; gap:.5rem; flex-wrap:wrap; justify-content:flex-end; }
        .error { margin:.2rem 0; color:var(--cms-danger,#ffb4a8); min-height:1.2em; }
        .hint { margin:0; color:var(--cms-muted,#a5c9b2); font-size:.85rem; }
        [hidden] { display:none !important; }
        .layout-comparison { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; }
        .layout-board { position:relative; width:100%; min-height:10rem; max-height:24rem;
          border:1px solid var(--cms-border,#43564a); background:var(--cms-bg,#17211d); }
        .layout-box { position:absolute; overflow:hidden; padding:.15rem; font-size:.75rem;
          border:1px solid var(--cms-border,#43564a); background:var(--cms-surface-raised,#2a3b32); }
        .layout-box[data-moving] { border:2px dashed var(--cms-accent,#8fd0a8); }
        .layout-box[data-anchor] { border:2px solid var(--cms-accent,#8fd0a8); font-weight:bold; }
        .layout-preview { display:grid; gap:.6rem; }
        .layout-preview h4,.layout-preview p { margin:0; }
        @media (max-width:650px) {
          .editor,.layout-comparison { grid-template-columns:minmax(0,1fr); }
        }
      </style>
      <article class="tile">
        <header><h3 data-title></h3><button type="button" data-open-config aria-label="LinkWidget konfigurieren">⚙</button></header>
        <div class="links" data-links></div>
        <p class="error" role="alert" data-view-error hidden></p>
      </article>
      <dialog data-dialog aria-labelledby="link-dialog-title">
        <form data-form novalidate>
          <h3 id="link-dialog-title">LinkWidget konfigurieren</h3>
          <div class="settings" data-edit-content>
            <details class="config-group"><summary>Widgettitel</summary>
              <div class="config-group-fields">
                <label>Widgettitel (optional)<input name="title" maxlength="64"></label>
                ${titleVisibilityField}
              </div>
            </details>
            <details class="config-group" open><summary>Links und Layout</summary>
              <div class="config-group-fields">
                <p class="hint">Linkkacheln am Griff ziehen, an der Ecke skalieren. Eigenes Raster mit 12 Spalten.
                Die Widgetgröße folgt beim Speichern der belegten Linkfläche; ein sichtbarer Widgettitel
                benötigt eine zusätzliche Rasterzeile. Änderungen werden erst als Entwurf übernommen.
                Braucht das Widget mehr Platz, zeigen wir dir vor dem Speichern, welche anderen Widgets
                dafür nach unten rücken. Du entscheidest, ob du das übernehmen möchtest.</p>
                <div class="editor"><div><div class="canvas"><div class="grid-stack" data-grid></div></div>
                  <button type="button" data-add>Link hinzufügen</button></div>
                  <div class="settings" data-settings></div></div>
                <p class="hint">Neue Fenster werden angefordert; Browser können sie stattdessen als Tab öffnen.
                Bilder und Dokumente werden gemeinsam im Assetmanager verwaltet. Bild entfernen löscht nur den Verweis.</p>
              </div>
            </details>
          </div>
          <section class="layout-preview" data-layout-preview hidden aria-labelledby="link-layout-title">
            <h4 id="link-layout-title">Platz für deine Links schaffen</h4>
            <p>Deine Links sind im Linkraster richtig angeordnet. Auf der Seite braucht das
            LinkWidget dafür mehr Platz. Die markierten Widgets rücken nach unten;
            ihre Inhalte und Größen bleiben erhalten. Noch wurde nichts gespeichert.</p>
            <div class="layout-comparison" data-layout-comparison></div>
            <ul data-layout-moves></ul>
            <p class="hint">Nur diese Seite wird im Entwurf angepasst. Die veröffentlichte Seite bleibt unverändert.</p>
            <div class="actions">
              <button type="button" data-layout-back>Zurück zur Linkbearbeitung</button>
              <button type="button" data-layout-confirm>Platz schaffen und speichern</button>
            </div>
          </section>
          <p class="error" role="alert" data-error></p>
          <div class="actions">
            <button type="button" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button>
            <button type="submit" data-save>Speichern</button>
          </div>
        </form>
      </dialog>`;
    this.shadowRoot.prepend(sheet);
    this.$('[data-open-config]').addEventListener('click', () => {
      this.openConfig().catch(error => this.message(error.message));
    });
    this.$('[data-form]').addEventListener('submit', event => { event.preventDefault(); this.save(); });
    this.$('[data-layout-back]').addEventListener('click', () => { if (!this.busy) this.clearLayoutPreview(); });
    this.$('[data-layout-confirm]').addEventListener('click', () => this.confirmLayout());
    this.$('[data-cancel]').addEventListener('click', () => { if (!this.busy) this.closeDialog(); });
    this.$('[data-dialog]').addEventListener('cancel', event => {
      if (this.busy) event.preventDefault();
    });
    this.$('[data-dialog]').addEventListener('close', () => {
      if (!this.$('[data-dialog]').open) this.stopGrid();
    });
    this.$('[data-add]').addEventListener('click', () => this.addLink());
    this.$('[data-delete]').addEventListener('click', () => this.removeWidget());
    this.render();
  }

  $(selector) { return this.shadowRoot.querySelector(selector); }
  set config(value) { this.widgetConfig = value; this.render(); }
  get config() { return this.widgetConfig; }
  get pages() { return this.services?.pages || []; }

  disconnectedCallback() {
    this.stopGrid();
    this.$('[data-dialog]')?.close();
  }

  message(text) {
    const dialogError = this.$('[data-error]');
    if (dialogError) dialogError.textContent = text;
    if (!this.$('[data-dialog]')?.open) {
      const error = this.$('[data-view-error]');
      if (error) { error.textContent = text; error.hidden = !text; }
    }
  }

  render() {
    const box = this.$('[data-links]');
    if (!box || !this.config) return;
    const title = this.$('[data-title]');
    title.textContent = this.config.title || '';
    title.hidden = !this.config.title || this.config.showTitle === false;
    this.$('header').hidden = title.hidden && this.hasAttribute('view-only');
    box.replaceChildren();
    try {
      validateLinkItems(this.config.links, this.pages);
      const bounds = linkBounds(this.config.links);
      box.style.gridTemplateColumns = `repeat(${bounds.w},minmax(0,1fr))`;
      box.style.gridTemplateRows = `repeat(${bounds.h},minmax(0,1fr))`;
      for (const link of this.config.links) {
        const anchor = node('a');
        anchor.className = 'link-tile';
        anchor.href = linkHref(link);
        anchor.target = link.target === 'self' ? '_self' : '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.setAttribute('aria-label', link.text);
        anchor.dataset.position = link.textPosition;
        anchor.style.gridColumn = `${link.grid.col - bounds.col + 1} / span ${link.grid.w}`;
        anchor.style.gridRow = `${link.grid.row - bounds.row + 1} / span ${link.grid.h}`;
        if (link.showText) {
          const text = node('span', link.text);
          text.className = 'link-text';
          anchor.append(text);
        }
        if (link.image) {
          const image = node('img');
          image.src = link.image;
          image.alt = '';
          anchor.append(image);
        }
        if (link.target === 'window') anchor.addEventListener('click', event => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          this.ownerDocument.defaultView.open(linkHref(link), '_blank', 'noopener,noreferrer,popup,width=1000,height=800');
        });
        if (link.kind === 'internal' && link.targetMode === 'modal') anchor.addEventListener('click', event => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (typeof this.services?.openPageModal !== 'function') {
            this.message('Popup-Ansicht ist hier nicht verfügbar.'); return;
          }
          Promise.resolve().then(() => this.services.openPageModal(link.page, link.modalSize || 'md'))
            .catch(error => this.message(error.message || 'Popup konnte nicht geöffnet werden.'));
        });
        box.append(anchor);
      }
      this.message('');
    } catch (error) { this.message(error.message); }
  }

  async openConfig(options = {}) {
    if (this.$('[data-dialog]').open) return;
    this.isNew = Boolean(options.isNew);
    this.clearLayoutPreview();
    this.links = structuredClone(this.config.links);
    this.selected = this.links[0]?.id;
    this.$('[name=title]').value = this.config.title || '';
    this.$('[name=showTitle]').checked = this.config.showTitle !== false;
    this.$('[data-delete]').hidden = this.isNew;
    this.message('');
    this.$('[data-dialog]').showModal();
    const generation = ++this.generation;
    try {
      const [{ GridStack }] = await Promise.all([import('../js/fcui-runtime.js'), this.stylesReady]);
      if (generation !== this.generation || !this.$('[data-dialog]').open) return;
      this.grid = GridStack.init({ column: LINK_COLUMNS, cellHeight: 'auto', margin: 4, minRow: 4,
        maxRow: 1000, float: true, alwaysShowResizeHandle: true, draggable: { handle: '.handle' },
        resizable: { handles: 'se' } }, this.$('[data-grid]'));
      this.grid.on('dragstop resizestop', () => {
        try {
          this.syncGrid();
          this.message('');
        }
        catch (error) { this.message(error.message); }
      });
      for (const link of this.links) this.addGridItem(link);
      this.editSelected();
    } catch (error) {
      this.message(error.message);
      this.stopGrid();
      throw error;
    }
  }

  stopGrid() {
    this.generation++;
    this.grid?.destroy(false);
    this.grid = null;
    this.$('[data-grid]')?.replaceChildren();
  }

  closeDialog() {
    this.clearLayoutPreview();
    this.stopGrid();
    this.$('[data-dialog]').close();
  }

  addGridItem(link) {
    const wrapper = node('div');
    wrapper.className = 'grid-stack-item';
    wrapper.dataset.selected = '';
    const content = node('div');
    content.className = 'grid-stack-item-content';
    const handle = node('button', '⠿');
    handle.type = 'button';
    handle.className = 'handle';
    handle.setAttribute('aria-label', `${link.text} verschieben`);
    const choose = node('button', link.text);
    choose.type = 'button';
    choose.className = 'choose';
    choose.addEventListener('click', () => { this.selected = link.id; this.editSelected(); });
    content.append(handle, choose);
    wrapper.append(content);
    this.$('[data-grid]').append(wrapper);
    this.grid.makeWidget(wrapper, { id: link.id, x: link.grid.col - 1, y: link.grid.row - 1, w: link.grid.w, h: link.grid.h });
  }

  syncGrid() {
    if (!this.grid) throw new Error('Linkraster ist nicht verfügbar');
    const positions = new Map(this.grid.save(false).map(item => [item.id, item]));
    if (positions.size !== this.links.length) throw new Error('Linkraster ist unvollständig');
    for (const link of this.links) {
      const item = positions.get(link.id);
      if (!item) throw new Error('Link fehlt im Raster');
      link.grid = { col: (item.x ?? 0) + 1, row: (item.y ?? 0) + 1, w: item.w ?? 1, h: item.h ?? 1 };
    }
  }

  addLink() {
    if (this.busy || !this.grid) return;
    if (this.links.length >= MAX_LINKS) { this.message(`Höchstens ${MAX_LINKS} Links pro Widget`); return; }
    try { this.syncGrid(); }
    catch (error) { this.message(error.message); return; }
    const ids = new Set(this.links.map(link => link.id));
    let number = 1;
    while (ids.has(`link${number}`)) number++;
    const row = Math.max(1, ...this.links.map(link => link.grid.row + link.grid.h));
    if (row + 3 > 1001) { this.message('Das Linkraster hat keinen Platz mehr'); return; }
    const link = { id: `link${number}`, kind: 'internal', page: this.pages[0].id,
      text: `Link ${number}`, showText: true, textPosition: 'overlay', target: 'self',
      grid: { col: 1, row, w: 4, h: 3 } };
    this.links.push(link);
    this.selected = link.id;
    this.addGridItem(link);
    this.editSelected();
  }

  editSelected() {
    const settings = this.$('[data-settings]');
    settings.replaceChildren();
    const link = this.links.find(item => item.id === this.selected);
    if (!link) return;
    for (const wrapper of this.$('[data-grid]').children) {
      const item = this.links.find(item => item.id === wrapper.gridstackNode.id);
      wrapper.toggleAttribute('data-selected', item.id === link.id);
      const content = wrapper.querySelector('.grid-stack-item-content');
      const hasImage = typeof item.image === 'string' && LINK_MEDIA.test(item.image);
      content.toggleAttribute('data-image', hasImage);
      content.style.backgroundImage = hasImage ? `url("${item.image}")` : '';
    }
    const field = (labelText, key, choices, onChange) => {
      const label = node('label', labelText);
      const input = node(choices ? 'select' : 'input');
      input.dataset.field = key;
      if (choices) for (const [value, text] of choices) {
        const option = node('option', text); option.value = value; input.append(option);
      }
      else { input.type = 'text'; input.maxLength = key === 'text' ? 256 : 2000; }
      input.value = link[key] ?? '';
      input.addEventListener(choices ? 'change' : 'input', () => {
        link[key] = input.value;
        if (key === 'text') {
          const item = [...this.$('[data-grid]').children].find(item => item.gridstackNode.id === link.id);
          item.querySelector('.choose').textContent = input.value;
          item.querySelector('.handle').setAttribute('aria-label', `${input.value} verschieben`);
        }
        onChange?.();
      });
      label.append(input); settings.append(label); return input;
    };
    field('Linktext (auch bei ausgeblendetem Text erforderlich)', 'text');
    field('Linkziel', 'kind', [['internal', 'Interne CMS-Seite'], ['external', 'Externe Webseite'], ['asset', 'Dokument aus Assetmanager']], () => {
      delete link.page; delete link.url; delete link.asset;
      delete link.targetMode; delete link.modalSize;
      if (link.kind === 'internal') { link.page = this.pages[0].id; link.target = 'self'; }
      else if (link.kind === 'external') { link.url = ''; link.target = 'tab'; }
      else { link.asset = ''; link.target = 'self'; }
      this.editSelected();
    });
    if (link.kind === 'internal') {
      field('CMS-Seite', 'page', this.pages.map(page => [page.id, page.title]));
      const targetMode = field('Öffnen als', 'targetMode', [['page', 'Seitenwechsel'], ['modal', 'Popup (Modal)']], () => {
        if (link.targetMode === 'modal') link.modalSize = 'md';
        else { delete link.targetMode; delete link.modalSize; }
        this.editSelected();
      });
      targetMode.value = link.targetMode || 'page';
      if (link.targetMode === 'modal') {
        const modalSize = field('Popupgröße', 'modalSize', [['sm', 'Klein'], ['md', 'Mittel'], ['lg', 'Groß']]);
        modalSize.value = link.modalSize || 'md';
      }
    }
    else {
      if (link.kind === 'external') field('URL (http:// oder https://)', 'url');
      else {
        const documentButton = node('button', link.asset ? 'Dokument ändern …' : 'Dokument auswählen …');
        documentButton.type = 'button'; documentButton.dataset.document = '';
        documentButton.addEventListener('click', () => this.chooseAsset(link, 'document'));
        settings.append(documentButton, node('small', link.asset || 'Noch kein Dokument ausgewählt.'));
      }
      field('Öffnen in', 'target', [['self', 'Gleiches Fenster'], ['tab', 'Neuer Tab'], ['window', 'Neues Browserfenster']]);
    }
    const label = node('label', ' Linktext anzeigen');
    label.className = 'check';
    const show = node('input'); show.type = 'checkbox'; show.checked = link.showText; show.dataset.field = 'showText';
    show.addEventListener('change', () => { link.showText = show.checked; this.editSelected(); });
    label.prepend(show); settings.append(label);
    const position = field('Textposition', 'textPosition', [['above', 'Oberhalb des Bildes'], ['overlay', 'Im Bild'], ['below', 'Unterhalb des Bildes']]);
    position.disabled = !link.showText;
    const image = node('img');
    image.className = 'preview-image'; image.alt = 'Ausgewähltes Linkbild';
    image.hidden = !link.image;
    if (link.image) image.src = link.image;
    settings.append(image);
    const mediaButton = node('button', 'Bild hinzufügen …');
    mediaButton.type = 'button'; mediaButton.dataset.media = '';
    mediaButton.addEventListener('click', () => this.chooseAsset(link, 'image'));
    const clear = node('button', 'Bild entfernen'); clear.type = 'button'; clear.dataset.clearImage = '';
    clear.disabled = !link.image;
    clear.addEventListener('click', () => { delete link.image; this.editSelected(); });
    settings.append(mediaButton, clear);
    const remove = node('button', 'Link entfernen'); remove.type = 'button'; remove.dataset.removeLink = '';
    remove.disabled = this.links.length === 1;
    remove.addEventListener('click', () => {
      const wrapper = [...this.$('[data-grid]').children].find(item => item.gridstackNode.id === link.id);
      this.grid.removeWidget(wrapper);
      this.links = this.links.filter(item => item !== link);
      this.selected = this.links[0].id; this.syncGrid(); this.editSelected();
    });
    settings.append(remove);
  }

  async operation(action) {
    if (this.busy) return;
    this.busy = true;
    this.$('[data-form]').inert = true;
    try { await action(); }
    catch (error) { this.message(error.message || 'LinkWidget-Aktion fehlgeschlagen'); }
    finally {
      this.busy = false;
      this.$('[data-form]').inert = false;
      if (this.layoutPending) this.$('[data-layout-back]').focus();
    }
  }

  async chooseAsset(link, mode) {
    const generation = this.generation;
    await this.operation(async () => {
      const asset = await this.services.pickAsset({ mode, owner: this.shadowRoot });
      if (generation !== this.generation) return;
      if (!asset) return;
      if (mode === 'image') link.image = asset.href;
      else link.asset = asset.href;
      this.editSelected();
      this.message('');
    });
  }

  async save() {
    if (this.busy || this.layoutPending) return;
    await this.operation(async () => {
      this.syncGrid();
      validateLinkItems(this.links, this.pages);
      const title = this.$('[name=title]').value;
      if (title.length > 64 || /[\x00-\x1f\x7f]/.test(title)) throw new Error('Ungültiger Widgettitel');
      const value = { ...this.config, title, showTitle: this.$('[name=showTitle]').checked,
        links: structuredClone(this.links) };
      if (typeof this.services.previewWidget === 'function') {
        const preview = await this.services.previewWidget(value);
        if (preview.moved.length) {
          this.showLayoutPreview(value, preview);
          return;
        }
      }
      await this.services.saveWidget(value);
      this.closeDialog();
    });
  }

  clearLayoutPreview() {
    this.layoutPending = null;
    this.$('[data-layout-preview]').hidden = true;
    this.$('[data-edit-content]').hidden = false;
    this.$('[data-save]').hidden = false;
    this.$('[data-delete]').hidden = Boolean(this.isNew);
    this.$('[data-layout-comparison]').replaceChildren();
    this.$('[data-layout-moves]').replaceChildren();
    this.message('');
  }

  showLayoutPreview(value, preview) {
    const height = Math.max(...preview.before.concat(preview.after).map(entry => Number(entry.grid.row) - 1 + Number(entry.grid.h)));
    const names = { thermostat: 'Thermostat', 'fhem-value': 'Wert-Anzeige', 'fhem-switch': 'Schalter',
      'fhem-button': 'Taster', 'fhem-html': 'Freies HTML', 'fhem-clock': 'Uhr / Datum',
      'fhem-icon': 'Status-Symbol', 'fhem-table': 'Tabelle', 'fhem-slider': 'Schieberegler',
      'fhem-chart': 'Diagramm', 'fhem-calllist': 'Anrufliste', 'fhem-solarflow': 'SolarFlow',
      text: 'Textbaustein', 'fhem-link': 'LinkWidget', navigation: 'Navigation' };
    const label = entry => entry.title || `${names[entry.type] || 'Widget'} (${entry.id})`;
    const comparison = this.$('[data-layout-comparison]');
    comparison.replaceChildren();
    for (const [heading, entries] of [['Bisher', preview.before], ['Nach dem Platzschaffen', preview.after]]) {
      const column = node('div');
      const board = node('div');
      board.className = 'layout-board';
      board.style.aspectRatio = `${preview.columns} / ${height}`;
      board.setAttribute('role', 'img');
      board.setAttribute('aria-label', `${heading}: Seitenanordnung`);
      for (const entry of entries) {
        const box = node('div', label(entry));
        box.className = 'layout-box';
        box.title = label(entry);
        box.dataset.widgetId = entry.id;
        box.toggleAttribute('data-moving', preview.moved.includes(entry.id));
        box.toggleAttribute('data-anchor', entry.id === value.id);
        Object.assign(box.style, { left: `${(Number(entry.grid.col) - 1) / preview.columns * 100}%`,
          top: `${(Number(entry.grid.row) - 1) / height * 100}%`,
          width: `${Number(entry.grid.w) / preview.columns * 100}%`,
          height: `${Number(entry.grid.h) / height * 100}%` });
        board.append(box);
      }
      column.append(node('h4', heading), board);
      comparison.append(column);
    }
    this.$('[data-layout-moves]').replaceChildren(...preview.moved.map(id => {
      const entry = preview.after.find(item => item.id === id);
      return node('li', `${label(entry)} wird nach unten verschoben.`);
    }));
    this.layoutPending = { value: structuredClone(value), preview: structuredClone(preview) };
    this.$('[data-edit-content]').hidden = true;
    this.$('[data-save]').hidden = true;
    this.$('[data-delete]').hidden = true;
    this.$('[data-layout-preview]').hidden = false;
    this.message('');
    this.$('[data-layout-preview]').scrollIntoView({ block: 'nearest' });
  }

  async confirmLayout() {
    if (this.busy || !this.layoutPending) return;
    const { value, preview } = this.layoutPending;
    await this.operation(async () => {
      await this.services.saveWidget(value, preview);
      this.closeDialog();
    });
  }

  async removeWidget() {
    if (this.isNew || this.busy) return;
    await this.operation(async () => { await this.services.deleteWidget(this.config.id); this.closeDialog(); });
  }
}

customElements.define('cms-link', FHEMCMSLink);
