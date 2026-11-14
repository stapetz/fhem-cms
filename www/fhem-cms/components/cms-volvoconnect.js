import { openDevicePicker } from '../js/device-picker.js';
import { dialogGroupStyles, titleVisibilityField } from '../js/dialog-groups.js';
import { widgetDesignCss, detailCardCss } from '../js/widget-design.js';
import { updateWidgetDom } from '../js/widget-dom.js';
import { renderVehicleMaps } from '../js/vehicle-map.js';
import { isValidName } from '../js/fhem-client.js';
import { formatDateDisplay } from '../js/date-display.js';
import { volvoCards, volvoGroupIcons, volvoGroupOrder, validateVolvoGroups,
  volvoModel, volvoValue } from '../js/volvoconnect.js';

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};

const wrapDialogFocus = event => {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const targets = [];
  const visit = root => {
    for (const element of root.children) {
      if (element.tabIndex >= 0 && !element.disabled && !element.closest('[inert]')
        && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden') targets.push(element);
      visit(element.shadowRoot || element);
    }
  };
  visit(event.currentTarget);
  const active = event.composedPath()[0];
  if (event.shiftKey ? active === targets[0] : active === targets.at(-1)) {
    event.preventDefault();
    (event.shiftKey ? targets.at(-1) : targets[0])?.focus({preventScroll:true});
  }
};

class FHEMCMSVolvoConnect extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.snapshot = null;
    this.services = null;
    this.revision = 0;
    this.vehicleMaps = new Map();
    this.mapRuntime = null;
    this.mapLoading = false;
    this.mapError = '';
    this.failedImages = new Set();
    this.busy = false;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) { this.render(); return; }
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; min-width:0; min-height:0; -webkit-text-size-adjust:100%; text-size-adjust:100%; }
        * { box-sizing:border-box; }
        [hidden] { display:none !important; }
        ${widgetDesignCss}
        .tile { container-type:inline-size; line-height:1.35; padding:16px; }
        .tile > * { flex-shrink:0; }
        .tile[data-stale] { opacity:.65; border-style:dashed; }
        [data-content], [data-detail-content], [data-inline-content] { display:grid; gap:16px; min-width:0; }
        .identity { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; }
        .identity h4 { font-size:1.45rem; margin:0; }
        .identity small { opacity:.75; }
        .badge { background:rgba(16,185,129,.12); border:1px solid rgba(16,185,129,.35);
          border-radius:20px; padding:4px 12px; font-size:.8rem; }
        .badge[data-error] { border-color:var(--cms-danger,#ef4444); }
        .top { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));
          gap:16px; align-items:start; }
        .card { ${detailCardCss} min-width:0; overflow-wrap:anywhere; }
        .card h4 { margin:0 0 10px; padding-bottom:6px; border-bottom:1px solid rgba(128,128,128,.2); font-size:.95rem; }
        .hero-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .hero-heading h4 { border:0; padding:0; }
        .hero-tools { display:flex; align-items:center; gap:6px; margin-left:auto; }
        .connected { color:var(--cms-success,#10b981); font-size:.9rem; }
        [data-info] { flex:none; font-size:1.3rem; }
        .hero { background:linear-gradient(135deg,rgba(16,185,129,.15),rgba(59,130,246,.12));
          border-color:rgba(16,185,129,.35); display:flex; flex-direction:column; gap:14px; }
        .hero h4 { margin:0; }
        .summary { display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:12px; }
        .soc { color:#10b981; font-size:clamp(2rem,7cqi,2.8rem); font-weight:800; line-height:1.1; }
        .range { text-align:right; color:var(--cms-accent,#3b82f6); font-size:clamp(1.3rem,5cqi,1.8rem); font-weight:700; }
        .range small { display:block; font-size:.78rem; font-weight:400; color:var(--cms-text,inherit); }
        .charge { height:14px; border-radius:99px; overflow:hidden; background:rgba(128,128,128,.22); }
        .charge div { height:100%; background:linear-gradient(90deg,#10b981,#34d399); border-radius:inherit; }
        dl { margin:0; display:grid; gap:6px; }
        .row { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:4px 10px;
          border-bottom:1px solid rgba(128,128,128,.1); padding-bottom:5px; font-size:.88rem; min-width:0; }
        .row:last-child { border-bottom:0; }
        dt { opacity:.75; } dd { margin:0; font-weight:650; text-align:right; overflow-wrap:anywhere; max-width:100%; }
        .reading-icon,.status-icon { display:inline-block; min-width:1.4em; text-align:center; margin-right:4px; }
        .status-icon[data-tone=good] { color:var(--cms-success,#10b981); }
        .status-icon[data-tone=warning] { color:var(--cms-warning,#f59e0b); }
        [data-reading-concealed] { opacity:.5; }
        [data-reading-visibility] { padding:2px 6px; margin-left:6px; }
        .gallery { background:radial-gradient(circle at 50% 65%,rgba(16,185,129,.12),rgba(128,128,128,.07) 75%); }
        .slides { display:flex; width:100%; min-width:0; overflow-x:auto;
          scroll-snap-type:x mandatory; scrollbar-width:thin; }
        figure { flex:0 0 100%; width:100%; min-width:0; margin:0; scroll-snap-align:start; text-align:center; }
        figure img { display:block; width:100%; max-width:100%; height:180px; object-fit:contain; object-position:center; }
        figcaption { font-size:.8rem; opacity:.75; margin-top:6px; }
        .map { height:175px; margin-bottom:10px; border-radius:10px; overflow:hidden; }
        .actions { display:flex; flex-wrap:wrap; gap:8px; }
        [data-actions-content] { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr)); gap:12px; }
        .card[data-concealed] { opacity:.55; border-style:dashed; }
        button { min-width:48px; min-height:48px; }
        button:active { transform:scale(.96); }
        footer { display:flex; flex-wrap:wrap; gap:8px 20px; justify-content:space-between; font-size:.76rem; opacity:.7; }
        button,input { font:inherit; color:inherit; background:var(--cms-surface-raised,#2a3b32);
          border:1px solid var(--cms-border,#43564a); border-radius:.5rem; padding:.45rem .65rem; }
        button { cursor:pointer; }
        button:disabled { cursor:default; opacity:.5; }
        :host([view-only]) [data-open-config] { display:none; }
        dialog { width:min(94vw,36rem); max-height:94vh; overflow:auto; padding:1.25rem;
          background:var(--cms-surface,#202e27); color:var(--cms-text,#edf4ef);
          border:1px solid var(--cms-border,#43564a); border-radius:1rem; }
        dialog::backdrop { background:var(--cms-backdrop,rgb(0 0 0 / .6)); }
        [data-details] { width:min(94vw,1100px); max-width:calc(100vw - 24px);
          max-height:calc(100vh - 24px); max-height:calc(100dvh - 24px); padding:0; overflow:hidden;
          -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px); }
        [data-details][open] { display:flex; flex-direction:column; }
        .detail-header { display:flex; align-items:center; justify-content:space-between; gap:12px;
          padding:12px 16px; border-bottom:1px solid rgba(128,128,128,.25); flex:none; }
        .detail-header h3 { margin:0; overflow-wrap:anywhere; }
        .detail-header { flex-wrap:wrap; }
        .detail-header h3 { flex:1; }
        [data-arrange-bar] { width:100%; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
        [data-arrange-bar] p { flex:1 1 200px; margin:0; font-size:.86rem; }
        .card-tools { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-bottom:8px; }
        [data-drag-card] { touch-action:none; cursor:grab; }
        [data-dragging] { outline:2px dashed var(--cms-accent,#3b82f6); opacity:.4; }
        .drag-preview { position:fixed; z-index:1; pointer-events:none; padding:12px;
          border:2px solid var(--cms-accent,#3b82f6); border-radius:12px;
          background:var(--cms-surface,#202e27); max-width:240px; }
        [data-detail-body] { padding:16px; overflow:auto; overscroll-behavior:contain; min-height:0;
          container-type:inline-size; }
        [data-details][data-stale] .detail-header { border-bottom-style:dashed; }
        form { display:grid; gap:.75rem; }
        ${dialogGroupStyles}
        label { display:grid; gap:.25rem; }
        .check { display:flex; align-items:center; gap:.4rem; }
        .device { display:flex; gap:.4rem; } .device input { min-width:0; flex:1; }
        .error { color:var(--cms-danger,#ffb4a8); }
        [data-error]:empty,[data-message]:empty { display:none; }
        @container (max-width:400px) { .tile { padding:10px; } .card { padding:12px; } }
      </style>
      <article class="tile" data-tile>
        <button type="button" data-open-config aria-label="VolvoConnect konfigurieren">⚙</button>
        <header data-header><h3 data-title></h3></header>
        <div data-content></div>
        <div data-inline-content hidden></div>
      </article>
      <dialog data-details aria-label="VolvoConnect Fahrzeugdetails">
        <div class="detail-header"><h3>VolvoConnect · Fahrzeugdetails</h3>
          <button type="button" data-arrange hidden>Anordnung bearbeiten</button>
          <button type="button" data-close-details aria-label="Fahrzeugdetails schließen" autofocus>✕</button>
          <div data-arrange-bar hidden><p>Am Griff ziehen. Mit dem Auge Karten ein-/ausblenden. Übernehmen speichert den Entwurf.</p>
            <button type="button" data-reset-arrange>Standardreihenfolge</button>
            <button type="button" data-cancel-arrange>Abbrechen</button>
            <button type="button" data-save-arrange>Übernehmen</button></div>
        </div>
        <div data-detail-body><div data-detail-content></div><p data-message role="status"></p></div>
      </dialog>
      <dialog data-actions-dialog aria-label="VolvoConnect Aktionen">
        <div class="detail-header"><h3>Fahrzeugaktionen</h3>
          <button type="button" data-close-actions aria-label="Fahrzeugaktionen schließen" autofocus>✕</button></div>
        <div data-actions-content></div><p data-action-message role="status"></p>
      </dialog>
      <dialog data-dialog aria-label="VolvoConnect konfigurieren">
        <form data-form>
          <h3>VolvoConnect</h3>
          <details class="config-group" open><summary>Allgemein</summary><div class="config-group-fields">
            <label>Titel<input name="title" maxlength="64"></label>
            <label>VolvoConnect-Device<span class="device"><input name="device" readonly required>
              <button type="button" data-pick>Wählen …</button></span></label>
            ${titleVisibilityField}
            <label class="check"><input type="checkbox" name="showDetails">Zeige Detaildaten im Popup</label>
            <p>Readings und Gruppen werden direkt aus dem VolvoConnect-Modul übernommen. Kein Mapping erforderlich.</p>
          </div></details>
          <p>Reihenfolge der Karten und Sichtbarkeit von Karten und Readings lassen sich direkt im Detailpopup über „Anordnung bearbeiten“ ändern.</p>
          <p data-error class="error" role="alert"></p>
          <div class="actions config-actions"><button type="button" class="danger" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit" data-save>Speichern</button></div>
        </form>
      </dialog>`;
    this.$('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.$('[data-pick]').addEventListener('click', () => this.pickDevice());
    this.$('[name=device]').addEventListener('click', () => this.pickDevice());
    this.$('[data-cancel]').addEventListener('click', () => this.closeConfig(false));
    this.$('[data-dialog]').addEventListener('cancel', event => { event.preventDefault(); this.closeConfig(false); });
    this.$('[data-form]').addEventListener('submit', event => { event.preventDefault(); this.saveConfig(); });
    this.$('[data-delete]').addEventListener('click', () => this.deleteWidget());
    this.$('[data-content]').addEventListener('click', event => {
      if (event.target.closest('[data-info]')) this.openDetails();
      if (event.target.closest('[data-open-actions]')) this.openActions();
      if (event.target.closest('[data-open-arrangement]')) { this.openDetails(); this.startArrangement(); }
    });
    this.$('[data-close-actions]').addEventListener('click', () => this.closeActions());
    this.$('[data-actions-dialog]').addEventListener('cancel', event => {
      event.preventDefault(); this.closeActions();
    });
    this.$('[data-actions-dialog]').addEventListener('keydown', wrapDialogFocus);
    this.$('[data-actions-content]').addEventListener('click', event => {
      const button = event.target.closest('[data-command]');
      if (button) this.sendAction(button.dataset.command);
    });
    this.$('[data-close-details]').addEventListener('click', () => this.closeDetails());
    this.$('[data-arrange]').addEventListener('click', () => this.startArrangement());
    this.$('[data-cancel-arrange]').addEventListener('click', () => this.cancelArrangement());
    this.$('[data-save-arrange]').addEventListener('click', () => this.saveArrangement());
    this.$('[data-reset-arrange]').addEventListener('click', () => {
      if (!this.arrangementSaving) { this.pendingCardOrder = volvoGroupOrder(); this.render(); }
    });
    const cancelDetails = event => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (this.drag) this.finishCardDrag(true);
      else if (this.pendingCardOrder) this.cancelArrangement();
      else this.closeDetails();
    };
    this.$('[data-details]').addEventListener('cancel', cancelDetails);
    this.$('[data-details]').addEventListener('keydown', event => {
      wrapDialogFocus(event);
      if (event.key === 'Escape' && !event.defaultPrevented) cancelDetails(event);
    });
    this.$('[data-details]').addEventListener('close', () => {
      if (!this.$('[data-details]').open && this.$('[data-detail-content]').childElementCount) {
        this.clearDetails();
        if (this.widgetConfig.showDetails === false && this.isConnected) this.render();
      }
    });
    this.$('[data-details]').addEventListener('click', event => {
      const dialog = this.$('[data-details]');
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) this.closeDetails();
    });
    this.$('[data-detail-content]').addEventListener('click', event => {
      const reading = event.target.closest('[data-reading-visibility]');
      if (reading) this.toggleReading(reading.dataset.readingVisibility);
      const visibility = event.target.closest('[data-card-visibility]');
      if (visibility) this.toggleCard(visibility.closest('[data-group]').dataset.group);
    });
    const detail = this.$('[data-detail-content]');
    detail.addEventListener('keydown', event => {
      const handle = event.target.closest('[data-drag-card]');
      if (!handle || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      this.moveCard(handle.closest('[data-group]').dataset.group,
        ['ArrowUp','ArrowLeft'].includes(event.key) ? -1 : 1);
    });
    detail.addEventListener('pointerdown', event => this.startCardDrag(event));
    detail.addEventListener('pointermove', event => this.moveCardDrag(event));
    detail.addEventListener('pointerup', () => this.finishCardDrag(false));
    detail.addEventListener('pointercancel', () => this.finishCardDrag(true));
    detail.addEventListener('lostpointercapture', () => this.finishCardDrag(true));
    for (const selector of ['[data-detail-content]','[data-inline-content]']) {
      this.$(selector).addEventListener('error', event => {
        if (event.target.localName === 'img') {
          this.failedImages.add(event.target.src);
          event.target.hidden = true;
          event.target.nextElementSibling.textContent = `${event.target.alt}: Bild konnte nicht geladen werden.`;
        }
      }, true);
    }
    this.render();
  }

  disconnectedCallback() {
    this.revision++;
    this.closeDetails(false);
    this.closeActions(false);
  }

  clearDetails() {
    this.finishCardDrag(true, false);
    this.pendingCardOrder = null;
    this.pendingVisibility = null;
    for (const controller of this.vehicleMaps.values()) controller.destroy();
    this.vehicleMaps.clear();
    this.$('[data-detail-content]')?.replaceChildren();
    this.$('[data-info]')?.setAttribute('aria-expanded', 'false');
  }

  openDetails() {
    const dialog = this.$('[data-details]');
    if (!this.isConnected || dialog.open || this.$('[data-dialog]').open) return;
    this.$('[data-message]').textContent = '';
    dialog.showModal();
    this.$('[data-info]')?.setAttribute('aria-expanded', 'true');
    this.render();
  }

  closeDetails(restoreFocus = true) {
    if (this.arrangementSaving && this.isConnected) return;
    const dialog = this.$('[data-details]');
    const wasOpen = dialog?.open;
    if (wasOpen) dialog.close();
    this.clearDetails();
    if (this.isConnected && this.widgetConfig?.showDetails === false) this.render();
    if (wasOpen && restoreFocus && this.isConnected) {
      (this.$('[data-info]') || this.$('[data-open-arrangement]'))?.focus({ preventScroll:true });
    }
  }

  $(selector) { return this.shadowRoot.querySelector(selector); }

  openActions() {
    if (this.$('[data-actions-dialog]').open) return;
    this.renderActions(volvoModel(this.snapshot, this.widgetConfig.device));
    this.$('[data-action-message]').textContent = '';
    this.$('[data-actions-dialog]').showModal();
  }

  closeActions(restoreFocus = true) {
    const dialog = this.$('[data-actions-dialog]');
    if (!dialog?.open) return;
    dialog.close();
    if (restoreFocus && this.isConnected) this.$('[data-open-actions]')?.focus({preventScroll:true});
  }

  toggleCard(key) {
    if (!this.pendingVisibility || this.arrangementSaving || this.drag) return;
    if (key === 'gallery') this.pendingVisibility.showGallery = this.pendingVisibility.showGallery === false;
    else {
      const hidden = new Set(this.pendingVisibility.hiddenGroups);
      if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
      this.pendingVisibility.hiddenGroups = [...hidden];
    }
    this.render();
    this.$('[data-detail-content]').querySelector(`[data-group="${key}"] [data-card-visibility]`)?.focus({preventScroll:true});
  }

  toggleReading(key) {
    if (!this.pendingVisibility || this.arrangementSaving || this.drag) return;
    const hidden = new Set(this.pendingVisibility.hiddenReadings);
    if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
    this.pendingVisibility.hiddenReadings = [...hidden];
    this.render();
    Array.from(this.$('[data-detail-content]').querySelectorAll('[data-reading-visibility]'))
      .find(button => button.dataset.readingVisibility === key)?.focus({preventScroll:true});
  }

  readingVisible(key, compact = false) {
    return !(compact ? this.widgetConfig : this.pendingVisibility || this.widgetConfig).hiddenReadings?.includes(key);
  }

  readingEye(key, label) {
    const eye = node('button', '👁');
    eye.type = 'button';
    eye.dataset.readingVisibility = key;
    const visible = this.readingVisible(key);
    eye.setAttribute('aria-label', `${label} ${visible ? 'ausblenden' : 'einblenden'}`);
    eye.setAttribute('aria-pressed', String(visible));
    if (!visible) eye.style.textDecoration = 'line-through';
    return eye;
  }

  startArrangement() {
    if (typeof this.services?.savePopupSettings !== 'function' || this.pendingCardOrder
      || !this.$('[data-details]').open) return;
    this.pendingCardOrder = volvoGroupOrder(this.widgetConfig);
    this.pendingVisibility = {showGallery:this.widgetConfig.showGallery !== false,
      hiddenGroups:[...(this.widgetConfig.hiddenGroups || [])],
      hiddenReadings:[...(this.widgetConfig.hiddenReadings || [])]};
    this.$('[data-message]').textContent = '';
    this.render();
    this.$('[data-cancel-arrange]').focus({preventScroll:true});
  }

  cancelArrangement() {
    if (this.arrangementSaving) return;
    this.finishCardDrag(true, false);
    this.pendingCardOrder = null;
    this.pendingVisibility = null;
    this.render();
    this.$('[data-arrange]').focus({preventScroll:true});
  }

  async saveArrangement() {
    if (!this.pendingCardOrder || this.arrangementSaving || this.drag) return;
    const body = this.$('[data-detail-body]');
    const scrollTop = body.scrollTop;
    const settings = {groupOrder:[...this.pendingCardOrder],
      hiddenGroups:[...this.pendingVisibility.hiddenGroups], hiddenReadings:[...this.pendingVisibility.hiddenReadings],
      showGallery:this.pendingVisibility.showGallery};
    this.arrangementSaving = true;
    for (const selector of ['[data-arrange-bar]','[data-detail-content]']) this.$(selector).inert = true;
    this.$('[data-close-details]').disabled = true;
    const message = this.$('[data-message]');
    message.textContent = 'Anordnung wird als Entwurf gespeichert …';
    try {
      await this.services.savePopupSettings(settings);
      this.widgetConfig = {...this.widgetConfig, ...settings};
      this.pendingCardOrder = null;
      this.pendingVisibility = null;
      message.textContent = 'Anordnung im Entwurf gespeichert. Veröffentlichung erfolgt separat.';
      this.$('[data-arrange]').hidden = false;
      this.$('[data-arrange]').focus({preventScroll:true});
    } catch (error) {
      message.textContent = `Anordnung nicht gespeichert: ${error.message}`;
    } finally {
      this.arrangementSaving = false;
      for (const selector of ['[data-arrange-bar]','[data-detail-content]']) this.$(selector).inert = false;
      this.$('[data-close-details]').disabled = false;
      if (this.isConnected) {
        this.render();
        body.scrollTop = scrollTop;
      }
    }
  }

  moveCard(key, step) {
    if (!this.pendingCardOrder || this.arrangementSaving || this.drag) return;
    const visible = [...this.$('[data-detail-content]').querySelector('#top').children].map(card => card.dataset.group);
    const target = visible[visible.indexOf(key) + step];
    if (!target) return;
    this.reorderCard(key, target);
    this.render();
    const card = this.$('[data-detail-content]').querySelector(`[data-group="${key}"]`);
    card.querySelector('[data-drag-card]').focus({ preventScroll:true });
    this.$('[data-message]').textContent = `${new Map(volvoCards).get(key)} verschoben. Noch nicht übernommen.`;
  }

  reorderCard(key, target, before) {
    const from = this.pendingCardOrder.indexOf(key), to = this.pendingCardOrder.indexOf(target);
    before ??= from > to;
    const insertion = to + (before ? 0 : 1) - (from < to ? 1 : 0);
    if (insertion === from) return;
    this.pendingCardOrder.splice(from, 1);
    this.pendingCardOrder.splice(insertion, 0, key);
    const top = this.$('[data-detail-content]').querySelector('#top');
    const card = [...top.children].find(entry => entry.dataset.group === key);
    const other = [...top.children].find(entry => entry.dataset.group === target);
    top.insertBefore(card, before ? other : other.nextSibling);
  }

  startCardDrag(event) {
    const handle = event.target.closest('[data-drag-card]');
    if (!handle || !this.pendingCardOrder || this.arrangementSaving || this.drag
      || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const card = handle.closest('[data-group]');
    const preview = node('div', card.querySelector('h4').textContent, 'drag-preview');
    preview.setAttribute('aria-hidden', 'true');
    this.$('[data-details]').append(preview);
    this.drag = { handle, card, preview, pointer:event.pointerId, order:[...this.pendingCardOrder],
      x:event.clientX, y:event.clientY };
    card.toggleAttribute('data-dragging', true);
    this.$('[data-detail-content]').setPointerCapture(event.pointerId);
    handle.focus({ preventScroll:true });
    const tick = () => {
      if (!this.drag) return;
      const {x, y} = this.drag;
      const body = this.$('[data-detail-body]');
      const bounds = body.getBoundingClientRect();
      if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
        if (y < bounds.top + 48) body.scrollTop -= 8;
        if (y > bounds.bottom - 48) body.scrollTop += 8;
        this.positionCardDrag();
      }
      this.dragFrame = requestAnimationFrame(tick);
    };
    this.positionCardDrag();
    this.dragFrame = requestAnimationFrame(tick);
  }

  moveCardDrag(event) {
    if (!this.drag || event.pointerId !== this.drag.pointer) return;
    event.preventDefault();
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
    this.positionCardDrag();
  }

  positionCardDrag() {
    const {x, y, card, preview} = this.drag;
    preview.style.left = `${Math.max(0, Math.min(innerWidth - 240, x + 12))}px`;
    preview.style.top = `${Math.max(0, Math.min(innerHeight - 60, y + 12))}px`;
    const target = this.shadowRoot.elementFromPoint(x, y)?.closest('#top > [data-group]');
    if (target && target !== card) {
      const bounds = target.getBoundingClientRect();
      this.reorderCard(card.dataset.group, target.dataset.group, y < bounds.top + bounds.height / 2);
    }
  }

  finishCardDrag(cancelled, render = true) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    cancelAnimationFrame(this.dragFrame);
    if (cancelled) this.pendingCardOrder = drag.order;
    drag.preview.remove();
    drag.card.removeAttribute('data-dragging');
    const capture = this.$('[data-detail-content]');
    if (capture.hasPointerCapture(drag.pointer)) capture.releasePointerCapture(drag.pointer);
    if (render && this.isConnected) {
      this.render();
      this.$('[data-detail-content]').querySelector(`[data-group="${drag.card.dataset.group}"] [data-drag-card]`)?.focus({ preventScroll:true });
    }
  }

  set config(value) { this.widgetConfig = value; this.render(); }
  get config() { return this.widgetConfig; }
  set data(value) { this.snapshot = value; this.render(); }
  set stale(value) {
    for (const selector of ['[data-tile]', '[data-details]']) {
      this.$(selector)?.toggleAttribute('data-stale', value !== null);
    }
  }

  rows(entries) {
    const list = node('dl');
    for (const entry of entries) {
      const visible = this.readingVisible(entry.visibilityKey);
      if (!visible && !this.pendingCardOrder) continue;
      const row = node('div', undefined, 'row');
      row.toggleAttribute('data-reading-concealed', !visible);
      row.id = `reading-${entry.reading}`;
      const label = node('dt');
      const icon = node('span', entry.icon, 'reading-icon');
      icon.setAttribute('aria-hidden', 'true');
      label.append(icon, document.createTextNode(entry.label));
      const value = node('dd');
      if (entry.status) {
        const status = node('span', entry.status.icon, 'status-icon');
        status.dataset.tone = entry.status.tone;
        status.setAttribute('role', 'img');
        status.setAttribute('aria-label', entry.value);
        status.title = entry.value;
        value.append(status);
      } else value.append(document.createTextNode(entry.value));
      if (this.pendingCardOrder) value.append(this.readingEye(entry.visibilityKey, entry.label));
      row.append(label, value);
      list.append(row);
    }
    return list;
  }

  render() {
    if (!this.widgetConfig || !this.$('[data-content]') || !this.isConnected) return;
    const config = this.widgetConfig;
    if (this.drag) return;
    this.$('[data-arrange]').hidden = typeof this.services?.savePopupSettings !== 'function' || Boolean(this.pendingCardOrder);
    this.$('[data-arrange-bar]').hidden = !this.pendingCardOrder;
    const model = volvoModel(this.snapshot, config.device);
    const title = config.showTitle === false ? '' : config.title || '';
    this.$('[data-title]').textContent = title;
    this.$('[data-header]').hidden = !title;
    const compact = node('div');
    const hero = this.energyCard(model, true);
    const heading = node('div', undefined, 'hero-heading');
    heading.append(node('h4', '🔋 Batterie & Reichweite'));
    const tools = node('div', undefined, 'hero-tools');
    if (model.read('state') === 'authenticated' && this.readingVisible('state', true)) {
      const connected = node('span', '✓', 'connected');
      connected.setAttribute('role', 'img');
      connected.setAttribute('aria-label', 'API: Verbunden');
      connected.title = 'API: Verbunden';
      tools.append(connected);
    }
    const info = node('button', 'ⓘ');
    info.type = 'button';
    info.dataset.info = '';
    info.setAttribute('aria-label', 'VolvoConnect Fahrzeugdetails öffnen');
    info.setAttribute('aria-haspopup', 'dialog');
    info.setAttribute('aria-expanded', String(this.$('[data-details]').open));
    if (config.showDetails !== false) tools.append(info);
    if (model.actions.length) {
      const actions = node('button', 'Ⓐ');
      actions.type = 'button';
      actions.dataset.openActions = '';
      actions.setAttribute('aria-label', 'Fahrzeugaktionen öffnen');
      actions.setAttribute('aria-haspopup', 'dialog');
      tools.append(actions);
    }
    heading.append(tools);
    if (config.showDetails !== false) {
      hero.prepend(heading);
      compact.append(hero);
    } else {
      heading.querySelector('h4').remove();
      if (this.services?.savePopupSettings) {
        const arrange = node('button', 'Anordnung bearbeiten');
        arrange.type = 'button';
        arrange.dataset.openArrangement = '';
        heading.prepend(arrange);
      }
      compact.append(heading);
    }
    updateWidgetDom(this.$('[data-content]'), compact);
    const inline = this.$('[data-inline-content]');
    inline.hidden = config.showDetails !== false;
    if (inline.hidden && inline.childElementCount) {
      for (const controller of this.vehicleMaps.values()) controller.destroy();
      this.vehicleMaps.clear();
      inline.replaceChildren();
    }
    if (this.$('[data-actions-dialog]').open) this.renderActions(model);
    if (config.showDetails === false) {
      this.renderDetails(model);
      return;
    }
    if (!this.$('[data-details]').open) return;
    this.renderDetails(model);
  }

  energyCard(model, compact = false) {
    const hero = node('section', undefined, 'card hero');
    hero.id = compact ? 'compact-energy' : 'energy';
    if (!compact) hero.append(node('h4', '🔋 Energie & Akku'));
    const summary = node('div', undefined, 'summary');
    const preview = !compact && Boolean(this.pendingCardOrder);
    const socVisible = this.readingVisible('state_batteryChargeLevel', compact);
    const rangeVisible = this.readingVisible('state_electricRange', compact);
    if (model.soc !== null && (socVisible || preview)) {
      const soc = node('div');
      soc.toggleAttribute('data-reading-concealed', !socVisible);
      const label = node('small', 'Akkustand');
      label.style.display = 'block';
      soc.append(label, node('strong', `${model.soc}%`, 'soc'));
      if (preview) soc.append(this.readingEye('state_batteryChargeLevel', 'Akkustand'));
      summary.append(soc);
    }
    if (model.range && (rangeVisible || preview)) {
      const range = node('div', undefined, 'range');
      range.toggleAttribute('data-reading-concealed', !rangeVisible);
      range.append(node('small', 'Restreichweite'),
        document.createTextNode(volvoValue('state', 'electricRange', model.range,
          model.rangeUnit)));
      if (preview) range.append(this.readingEye('state_electricRange', 'Restreichweite'));
      summary.append(range);
    }
    if (summary.childElementCount) hero.append(summary);
    if (model.soc !== null && (socVisible || preview)) {
      const bar = node('div', undefined, 'charge');
      bar.setAttribute('role', 'meter');
      bar.setAttribute('aria-label', 'Akkustand');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(model.soc));
      bar.toggleAttribute('data-reading-concealed', !socVisible);
      const fill = node('div');
      fill.style.width = `${model.soc}%`;
      bar.append(fill);
      hero.append(bar);
    }
    if (!compact) hero.append(this.rows(model.groups.get('state').filter(entry =>
      !['batteryChargeLevel', 'electricRange', 'distanceToEmptyBattery'].includes(entry.key))));
    return hero;
  }

  renderDetails(model) {
    const config = {...this.widgetConfig, ...this.pendingVisibility};
    const preview = Boolean(this.pendingCardOrder);
    const content = node('div');
    for (const url of this.failedImages) {
      if (!model.images.some(image => image.url === url)) this.failedImages.delete(url);
    }
    const identity = node('div', undefined, 'identity');
    identity.id = 'identity';
    const names = node('div');
    const modelName = this.readingVisible('vehicle_descriptions_model') ? model.read('vehicle_descriptions_model') : '';
    if (modelName) names.append(node('h4', modelName));
    const subtitle = ['vehicle_externalColour', 'vehicle_modelYear']
      .filter(key => this.readingVisible(key)).map(model.read).filter(Boolean).join(' · ');
    if (subtitle) names.append(node('small', subtitle));
    identity.append(names);
    const api = model.read('state');
    if (api && (preview || this.readingVisible('state'))) {
      const badge = node('span', api === 'authenticated' ? '✓' : '⚠', 'badge');
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', `API: ${volvoValue('', 'state', api)}`);
      badge.title = badge.getAttribute('aria-label');
      badge.toggleAttribute('data-error', /^(?:error|auth_required)$/.test(api));
      badge.toggleAttribute('data-reading-concealed', !this.readingVisible('state'));
      identity.append(badge);
      if (preview) identity.append(this.readingEye('state', 'API-Status'));
    }
    content.append(identity);
    const top = node('div', undefined, 'top');
    top.id = 'top';
    const groupLabels = new Map(volvoCards);
    const hidden = new Set(config.hiddenGroups || []);
    for (const key of this.pendingCardOrder || volvoGroupOrder(config)) {
      if (key === 'gallery') continue;
      if (!preview && hidden.has(key)) continue;
      const entries = model.groups.get(key);
      if (!preview && !entries.length) continue;
      const card = key === 'state' ? this.energyCard(model) : node('section', undefined, 'card');
      card.id = `group-${key}`;
      card.dataset.group = key;
      card.toggleAttribute('data-concealed', hidden.has(key));
      if (key !== 'state') {
        card.append(node('h4', `${volvoGroupIcons[key]} ${groupLabels.get(key)}`));
        if (key === 'location' && model.latitude !== null && model.longitude !== null
          && this.readingVisible('location_latitude') && this.readingVisible('location_longitude')) {
          const map = node('div', undefined, 'map');
          map.id = 'volvo-location';
          map.dataset.map = 'vehicle';
          map.dataset.latitude = String(model.latitude);
          map.dataset.longitude = String(model.longitude);
          card.append(map);
        }
        card.append(this.rows(entries));
      }
      if (preview && !entries.length) card.append(node('p', 'Keine Daten verfügbar.'));
      top.append(card);
    }
    if (preview || (config.showGallery !== false && model.images.length)) {
      const gallery = node('section', undefined, 'card gallery');
      gallery.id = 'gallery';
      gallery.dataset.group = 'gallery';
      gallery.toggleAttribute('data-concealed', config.showGallery === false);
      gallery.append(node('h4', model.images.length > 1 ? 'Ansicht · zum Wechseln wischen' : 'Ansicht'));
      const slides = node('div', undefined, 'slides');
      slides.setAttribute('tabindex', '0');
      slides.setAttribute('aria-label', 'Fahrzeug-Bildergalerie');
      for (const image of model.images) {
        const figure = node('figure');
        figure.id = image.key;
        const img = node('img');
        img.src = image.url;
        img.alt = image.label;
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.hidden = this.failedImages.has(image.url);
        figure.append(img, node('figcaption', img.hidden
          ? `${image.label}: Bild konnte nicht geladen werden.` : image.label));
        slides.append(figure);
      }
      gallery.append(slides);
      if (preview && !model.images.length) gallery.append(node('p', 'Keine Bilder verfügbar.'));
      top.append(gallery);
    }
    const order = this.pendingCardOrder || volvoGroupOrder(config);
    for (const key of order) {
      const card = [...top.children].find(entry => entry.dataset.group === key);
      if (!card) continue;
      if (this.pendingCardOrder) {
        const tools = node('div', undefined, 'card-tools');
        tools.id = `tools-${key}`;
        const grip = node('button', '⠿');
        grip.type = 'button';
        grip.dataset.dragCard = '';
        grip.setAttribute('aria-label', `${groupLabels.get(key)} verschieben`);
        grip.title = 'Ziehen oder mit den Pfeiltasten verschieben';
        grip.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
        tools.append(grip);
        if (preview) {
          const eye = node('button', '👁');
          eye.type = 'button';
          eye.dataset.cardVisibility = '';
          const concealed = key === 'gallery' ? config.showGallery === false : hidden.has(key);
          if (concealed) eye.style.textDecoration = 'line-through';
          eye.setAttribute('aria-label', `${groupLabels.get(key)} ${concealed ? 'einblenden' : 'ausblenden'}`);
          eye.setAttribute('aria-pressed', String(!concealed));
          tools.append(eye);
        }
        card.prepend(tools);
      }
      top.append(card);
    }
    content.append(top);
    const footer = node('footer');
    footer.id = 'footer';
    const updated = model.read('lastUpdate');
    if (updated && (preview || this.readingVisible('lastUpdate'))) {
      const stamp = node('span', `Letztes Update: ${formatDateDisplay(updated)}`);
      stamp.toggleAttribute('data-reading-concealed', !this.readingVisible('lastUpdate'));
      if (preview) stamp.append(this.readingEye('lastUpdate', 'Letztes Update'));
      footer.append(stamp);
    }
    content.append(footer);
    if (!model.available) content.append(node('p', 'Keine Fahrzeugdaten verfügbar.'));
    if (this.widgetConfig.showDetails === false && !this.$('[data-details]').open) {
      for (const element of content.querySelectorAll('[id]')) element.id = `inline-${element.id}`;
    }
    this.renderContent(content);
  }

  renderContent(content) {
    const target = this.widgetConfig.showDetails === false && !this.$('[data-details]').open
      ? this.$('[data-inline-content]') : this.$('[data-detail-content]');
    if (content.querySelector('[data-map]') && !this.mapRuntime) {
      if (!this.mapLoading && !this.mapError) {
        this.mapLoading = true;
        import('../js/fcui-map-runtime.js').then(runtime => {
          this.mapRuntime = runtime;
          this.mapLoading = false;
          if (this.isConnected) this.render();
        }, error => {
          console.error('VolvoConnect: Fahrzeugkarte konnte nicht geladen werden', error);
          this.mapLoading = false;
          this.mapError = 'Fahrzeugkarte konnte nicht geladen werden.';
          if (this.isConnected) this.render();
        });
      }
      const status = node('p', this.mapError || 'Fahrzeugkarte wird geladen …');
      status.setAttribute('role', 'status');
      content.querySelector('[data-map]').append(status);
      updateWidgetDom(target, content);
    } else {
      this.vehicleMaps = renderVehicleMaps(target, content, this.vehicleMaps, this.mapRuntime);
    }
  }

  renderActions(model) {
    const content = node('div');
    const icons = {lock:'🔒', unlock:'🔓', climate:'❄', climate_stop:'⏹',
      charge_start:'⚡', charge_stop:'⏹', precondition:'♨', horn:'📣'};
    for (const [command, label] of model.actions) {
      const button = node('button', `${icons[command]} ${label}`);
      button.type = 'button';
      button.dataset.command = command;
      button.disabled = !this.hasAttribute('view-only') || Boolean(this.services?.editing)
        || this.busy;
      content.append(button);
    }
    if (!model.actions.length) content.append(node('p', 'Keine Fahrzeugaktionen verfügbar.'));
    updateWidgetDom(this.$('[data-actions-content]'), content);
  }

  async sendAction(command) {
    if (!this.hasAttribute('view-only') || this.services?.editing || this.pendingCardOrder
      || this.$('[data-dialog]').open || this.busy
      || !this.$('[data-actions-dialog]').open) return;
    const action = volvoModel(this.snapshot, this.widgetConfig.device).actions.find(([key]) => key === command);
    if (!action) return;
    this.busy = true;
    this.render();
    const message = this.$('[data-action-message]');
    message.textContent = '';
    try {
      await this.services.setCommand(this.widgetConfig.device, command);
      message.textContent = 'Befehl gesendet. Die Bestätigung erfolgt über die Fahrzeug-Readings.';
    } catch (error) {
      message.textContent = `Befehl fehlgeschlagen: ${error.message}`;
    } finally { this.busy = false; if (this.isConnected) this.render(); }
  }

  async openConfig({ isNew = false } = {}) {
    this.closeDetails();
    this.closeActions();
    const revision = ++this.revision;
    this.isNew = isNew;
    const form = this.$('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    form.elements.device.value = this.widgetConfig.device || '';
    form.elements.showDetails.checked = this.widgetConfig.showDetails !== false;
    this.$('[data-delete]').hidden = isNew;
    this.$('[data-error]').textContent = '';
    this.$('[data-dialog]').showModal();
    if (!form.elements.device.value && isNew) {
      try {
        const devices = await this.services.listAllDevices();
        if (revision !== this.revision || !this.$('[data-dialog]').open) return;
        const matches = devices.filter(item => item.type === 'VolvoConnect' && isValidName(item.name));
        if (matches.length === 1) {
          form.elements.device.value = matches[0].name;
        }
      } catch (error) {
        if (revision === this.revision) this.$('[data-error]').textContent = `Device-Erkennung fehlgeschlagen: ${error.message}`;
      }
    }
  }

  async pickDevice() {
    const revision = ++this.revision;
    try {
      const selected = await openDevicePicker({ services: this.services, title: 'VolvoConnect auswählen',
        accept: item => item.type === 'VolvoConnect' });
      if (selected && revision === this.revision && this.$('[data-dialog]').open) {
        this.$('[name=device]').value = selected.name;
      }
    } catch (error) {
      if (revision === this.revision) this.$('[data-error]').textContent = `Device-Auswahl fehlgeschlagen: ${error.message}`;
    }
  }

  async saveConfig() {
    if (this.configBusy) return;
    const form = this.$('[data-form]');
    const title = form.elements.title.value.trim();
    const device = form.elements.device.value.trim();
    if (!isValidName(device) || title.length > 64 || /[\u0000-\u001f\u007f]/.test(title)) {
      this.$('[data-error]').textContent = 'Bitte ein gültiges VolvoConnect-Device und einen gültigen Titel auswählen.';
      return;
    }
    const next = { id: this.widgetConfig.id, type: 'fhem-volvoconnect', device,
      showDetails: form.elements.showDetails.checked,
      showGallery: this.widgetConfig.showGallery !== false, grid: { ...this.widgetConfig.grid },
      groupOrder: volvoGroupOrder(this.widgetConfig),
      hiddenGroups: [...(this.widgetConfig.hiddenGroups || [])],
      hiddenReadings: [...(this.widgetConfig.hiddenReadings || [])] };
    const groupError = validateVolvoGroups(next);
    if (groupError) { this.$('[data-error]').textContent = groupError; return; }
    if (title) next.title = title;
    if (!form.elements.showTitle.checked) next.showTitle = false;
    this.configBusy = true;
    form.inert = true;
    try { await this.services.saveWidget(next); this.closeConfig(true); }
    catch (error) { this.$('[data-error]').textContent = `Speichern fehlgeschlagen: ${error.message}`; }
    finally { this.configBusy = false; form.inert = false; }
  }

  async deleteWidget() {
    if (this.configBusy) return;
    if (!window.confirm('Dieses VolvoConnect-Widget entfernen?')) return;
    this.configBusy = true;
    this.$('[data-form]').inert = true;
    try { await this.services.deleteWidget(this.widgetConfig.id); this.closeConfig(true); }
    catch (error) { this.$('[data-error]').textContent = `Entfernen fehlgeschlagen: ${error.message}`; }
    finally { this.configBusy = false; this.$('[data-form]').inert = false; }
  }

  closeConfig(saved) {
    if (this.configBusy && !saved) return;
    this.revision++;
    this.$('[data-dialog]').close();
    if (!saved && this.isNew) this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true }));
  }

}

customElements.define('cms-volvoconnect', FHEMCMSVolvoConnect);
