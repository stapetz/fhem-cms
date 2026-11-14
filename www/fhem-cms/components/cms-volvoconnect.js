import { openDevicePicker } from '../js/device-picker.js';
import { dialogGroupStyles, titleVisibilityField } from '../js/dialog-groups.js';
import { widgetDesignCss, detailCardCss } from '../js/widget-design.js';
import { updateWidgetDom } from '../js/widget-dom.js';
import { renderVehicleMaps } from '../js/vehicle-map.js';
import { isValidName } from '../js/fhem-client.js';
import { volvoGroups, volvoGroupIcons, volvoGroupOrder, validateVolvoGroups,
  volvoModel, volvoValue } from '../js/volvoconnect.js';

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
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
        [data-content], [data-detail-content] { display:grid; gap:16px; min-width:0; }
        .identity { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; }
        .identity h4 { font-size:1.45rem; margin:0; }
        .identity small { opacity:.75; }
        .badge { background:rgba(16,185,129,.12); border:1px solid rgba(16,185,129,.35);
          border-radius:20px; padding:4px 12px; font-size:.8rem; }
        .badge[data-error] { border-color:var(--cms-danger,#ef4444); }
        .top { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr)); gap:16px; }
        .card { ${detailCardCss} min-width:0; overflow-wrap:anywhere; }
        .card h4 { margin:0 0 10px; padding-bottom:6px; border-bottom:1px solid rgba(128,128,128,.2); font-size:.95rem; }
        .hero-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .hero-heading h4 { border:0; padding:0; }
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
        .gallery { background:radial-gradient(circle at 50% 65%,rgba(16,185,129,.12),rgba(128,128,128,.07) 75%); }
        .slides { display:flex; gap:12px; overflow-x:auto; scroll-snap-type:x mandatory; scrollbar-width:thin; }
        figure { flex:0 0 100%; min-width:0; margin:0; scroll-snap-align:start; text-align:center; }
        figure img { display:block; width:100%; height:180px; object-fit:contain; }
        figcaption { font-size:.8rem; opacity:.75; margin-top:6px; }
        .map { height:175px; margin-bottom:10px; border-radius:10px; overflow:hidden; }
        .actions { display:flex; flex-wrap:wrap; gap:8px; }
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
        [data-detail-body] { padding:16px; overflow:auto; overscroll-behavior:contain; min-height:0;
          container-type:inline-size; }
        [data-details][data-stale] .detail-header { border-bottom-style:dashed; }
        .group-choice { display:flex; align-items:center; gap:6px; padding:4px 0;
          border-bottom:1px solid rgba(128,128,128,.18); }
        .group-choice label { display:flex; align-items:center; gap:8px; flex:1; min-width:0; min-height:48px;
          overflow-wrap:anywhere; }
        .group-choice button { flex:none; padding:4px; }
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
      </article>
      <dialog data-details aria-label="VolvoConnect Fahrzeugdetails">
        <div class="detail-header"><h3>VolvoConnect · Fahrzeugdetails</h3>
          <button type="button" data-close-details aria-label="Fahrzeugdetails schließen" autofocus>✕</button></div>
        <div data-detail-body><div data-detail-content></div><p data-message role="status"></p></div>
      </dialog>
      <dialog data-dialog aria-label="VolvoConnect konfigurieren">
        <form data-form>
          <h3>VolvoConnect</h3>
          <details class="config-group" open><summary>Allgemein</summary><div class="config-group-fields">
            <label>Titel<input name="title" maxlength="64"></label>${titleVisibilityField}
          </div></details>
          <details class="config-group" open><summary>Modulgruppen im Popup</summary>
            <div class="config-group-fields">
              <p>Gruppen ein-/ausblenden und mit den Pfeilen sortieren. Akkustand und Reichweite der kompakten Kachel bleiben sichtbar.
                Einzelne Werte lassen sich später konfigurieren.</p>
              <div data-group-choices></div>
            </div>
          </details>
          <details class="config-group" open><summary>Fahrzeug</summary><div class="config-group-fields">
            <label>VolvoConnect-Device<span class="device"><input name="device" readonly required>
              <button type="button" data-pick>Wählen …</button></span></label>
            <p>Readings und Gruppen werden direkt aus dem VolvoConnect-Modul übernommen. Kein Mapping erforderlich.</p>
            <label class="check"><input type="checkbox" name="showGallery">Bildergalerie anzeigen</label>
          </div></details>
          <p data-error class="error" role="alert"></p>
          <div class="actions"><button type="button" data-delete>Entfernen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit">Speichern</button></div>
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
    });
    this.$('[data-close-details]').addEventListener('click', () => this.closeDetails());
    this.$('[data-details]').addEventListener('cancel', event => { event.preventDefault(); this.closeDetails(); });
    this.$('[data-details]').addEventListener('close', () => {
      if (!this.$('[data-details]').open) this.clearDetails();
    });
    this.$('[data-details]').addEventListener('click', event => {
      const dialog = this.$('[data-details]');
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) this.closeDetails();
    });
    this.$('[data-detail-content]').addEventListener('click', event => {
      const button = event.target.closest('button[data-command]');
      if (button) this.sendAction(button.dataset.command);
    });
    this.$('[data-detail-content]').addEventListener('error', event => {
      if (event.target.localName === 'img') {
        this.failedImages.add(event.target.src);
        event.target.hidden = true;
        event.target.nextElementSibling.textContent = `${event.target.alt}: Bild konnte nicht geladen werden.`;
      }
    }, true);
    this.render();
  }

  disconnectedCallback() {
    this.revision++;
    this.closeDetails(false);
  }

  clearDetails() {
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
    const dialog = this.$('[data-details]');
    const wasOpen = dialog?.open;
    if (wasOpen) dialog.close();
    this.clearDetails();
    if (wasOpen && restoreFocus && this.isConnected) this.$('[data-info]')?.focus({ preventScroll:true });
  }

  $(selector) { return this.shadowRoot.querySelector(selector); }
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
      const row = node('div', undefined, 'row');
      row.id = `reading-${entry.reading}`;
      const label = node('dt');
      const icon = node('span', entry.icon, 'reading-icon');
      icon.setAttribute('aria-hidden', 'true');
      label.append(icon, document.createTextNode(entry.label));
      const value = node('dd');
      if (entry.status) {
        const status = node('span', entry.status.icon, 'status-icon');
        status.dataset.tone = entry.status.tone;
        status.setAttribute('aria-hidden', 'true');
        value.append(status);
      }
      value.append(document.createTextNode(entry.value));
      row.append(label, value);
      list.append(row);
    }
    return list;
  }

  render() {
    if (!this.widgetConfig || !this.$('[data-content]') || !this.isConnected) return;
    const config = this.widgetConfig;
    const model = volvoModel(this.snapshot, config.device);
    const title = config.showTitle === false ? '' : config.title || '';
    this.$('[data-title]').textContent = title;
    this.$('[data-header]').hidden = !title;
    const compact = node('div');
    const hero = this.energyCard(model, true);
    const heading = node('div', undefined, 'hero-heading');
    heading.append(node('h4', '🔋 Batterie & Reichweite'));
    const info = node('button', 'ⓘ');
    info.type = 'button';
    info.dataset.info = '';
    info.setAttribute('aria-label', 'VolvoConnect Fahrzeugdetails öffnen');
    info.setAttribute('aria-haspopup', 'dialog');
    info.setAttribute('aria-expanded', String(this.$('[data-details]').open));
    heading.append(info);
    hero.prepend(heading);
    compact.append(hero);
    updateWidgetDom(this.$('[data-content]'), compact);
    if (!this.$('[data-details]').open) return;
    this.renderDetails(model);
  }

  energyCard(model, compact = false) {
    const hero = node('section', undefined, 'card hero');
    hero.id = compact ? 'compact-energy' : 'energy';
    if (!compact) hero.append(node('h4', '🔋 Energie & Akku'));
    const summary = node('div', undefined, 'summary');
    if (model.soc !== null) {
      const soc = node('div');
      const label = node('small', 'Akkustand');
      label.style.display = 'block';
      soc.append(label, node('strong', `${model.soc}%`, 'soc'));
      summary.append(soc);
    }
    if (model.range) {
      const range = node('div', undefined, 'range');
      range.append(node('small', 'Restreichweite'),
        document.createTextNode(volvoValue('state', 'electricRange', model.range,
          model.read('state_electricRange_unit') || model.read('fuel_distanceToEmptyBattery_unit'))));
      summary.append(range);
    }
    if (summary.childElementCount) hero.append(summary);
    if (model.soc !== null) {
      const bar = node('div', undefined, 'charge');
      bar.setAttribute('role', 'meter');
      bar.setAttribute('aria-label', 'Akkustand');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(model.soc));
      const fill = node('div');
      fill.style.width = `${model.soc}%`;
      bar.append(fill);
      hero.append(bar);
    }
    if (!compact) hero.append(this.rows(model.groups.get('state').filter(entry => !['state_batteryChargeLevel',
      'state_electricRange', 'fuel_distanceToEmptyBattery'].includes(entry.reading))));
    return hero;
  }

  renderDetails(model) {
    const config = this.widgetConfig;
    const content = node('div');
    for (const url of this.failedImages) {
      if (!model.images.some(image => image.url === url)) this.failedImages.delete(url);
    }
    const identity = node('div', undefined, 'identity');
    identity.id = 'identity';
    const names = node('div');
    const modelName = model.read('vehicle_descriptions_model');
    if (modelName) names.append(node('h4', modelName));
    const subtitle = ['vehicle_externalColour', 'vehicle_modelYear'].map(model.read).filter(Boolean).join(' · ');
    if (subtitle) names.append(node('small', subtitle));
    identity.append(names);
    const api = model.read('state');
    if (api) {
      const badge = node('span', `API: ${volvoValue('', 'state', api)}`, 'badge');
      badge.toggleAttribute('data-error', /^(?:error|auth_required)$/.test(api));
      identity.append(badge);
    }
    content.append(identity);
    const top = node('div', undefined, 'top');
    top.id = 'top';
    const groupLabels = new Map(volvoGroups);
    const hidden = new Set(config.hiddenGroups || []);
    for (const key of volvoGroupOrder(config)) {
      if (hidden.has(key)) continue;
      const entries = model.groups.get(key);
      if (!entries.length) continue;
      const card = key === 'state' ? this.energyCard(model) : node('section', undefined, 'card');
      card.id = `group-${key}`;
      card.dataset.group = key;
      if (key !== 'state') {
        card.append(node('h4', `${volvoGroupIcons[key]} ${groupLabels.get(key)}`));
        if (key === 'location' && model.latitude !== null && model.longitude !== null) {
          const map = node('div', undefined, 'map');
          map.id = 'volvo-location';
          map.dataset.map = 'vehicle';
          map.dataset.latitude = String(model.latitude);
          map.dataset.longitude = String(model.longitude);
          card.append(map);
        }
        card.append(this.rows(entries));
      }
      top.append(card);
    }
    if (config.showGallery !== false && model.images.length) {
      const gallery = node('section', undefined, 'card gallery');
      gallery.id = 'gallery';
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
      const energy = top.querySelector('[data-group="state"]');
      if (energy) energy.after(gallery);
      else top.prepend(gallery);
    }
    content.append(top);
    if (model.actions.length) {
      const actions = node('section', undefined, 'card');
      actions.id = 'actions';
      actions.append(node('h4', 'Aktionen'));
      const buttons = node('div', undefined, 'actions');
      for (const [command, label] of model.actions) {
        const button = node('button', label);
        button.type = 'button';
        button.dataset.command = command;
        button.disabled = !this.hasAttribute('view-only') || this.busy;
        buttons.append(button);
      }
      actions.append(buttons);
      content.append(actions);
    }
    const footer = node('footer');
    footer.id = 'footer';
    const updated = model.read('lastUpdate');
    if (updated) footer.append(node('span', `Letztes Update: ${updated}`));
    content.append(footer);
    if (!model.available) content.append(node('p', 'Keine Fahrzeugdaten verfügbar.'));
    this.renderContent(content);
  }

  renderContent(content) {
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
      updateWidgetDom(this.$('[data-detail-content]'), content);
    } else {
      this.vehicleMaps = renderVehicleMaps(this.$('[data-detail-content]'), content, this.vehicleMaps, this.mapRuntime);
    }
  }

  async sendAction(command) {
    if (!this.hasAttribute('view-only') || this.busy) return;
    const action = volvoModel(this.snapshot, this.widgetConfig.device).actions.find(([key]) => key === command);
    if (!action || !window.confirm(`VolvoConnect: „${action[1]}“ am Fahrzeug ausführen?`)) return;
    this.busy = true;
    this.render();
    const message = this.$('[data-message]');
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
    const revision = ++this.revision;
    this.isNew = isNew;
    const form = this.$('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    form.elements.device.value = this.widgetConfig.device || '';
    form.elements.showGallery.checked = this.widgetConfig.showGallery !== false;
    this.groupChoices = volvoGroupOrder(this.widgetConfig).map(key => ({
      key, visible: !(this.widgetConfig.hiddenGroups || []).includes(key),
    }));
    this.renderGroupChoices();
    this.$('[data-delete]').hidden = isNew;
    this.$('[data-error]').textContent = '';
    this.$('[data-dialog]').showModal();
    if (!form.elements.device.value && isNew) {
      try {
        const devices = await this.services.listAllDevices();
        if (revision !== this.revision || !this.$('[data-dialog]').open) return;
        const matches = devices.filter(item => item.type === 'VolvoConnect' && isValidName(item.name));
        if (matches.length === 1) form.elements.device.value = matches[0].name;
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
    const form = this.$('[data-form]');
    const title = form.elements.title.value.trim();
    const device = form.elements.device.value.trim();
    if (!isValidName(device) || title.length > 64 || /[\u0000-\u001f\u007f]/.test(title)) {
      this.$('[data-error]').textContent = 'Bitte ein gültiges VolvoConnect-Device und einen gültigen Titel auswählen.';
      return;
    }
    const next = { id: this.widgetConfig.id, type: 'fhem-volvoconnect', device,
      showGallery: form.elements.showGallery.checked, grid: { ...this.widgetConfig.grid },
      groupOrder: this.groupChoices.map(group => group.key),
      hiddenGroups: this.groupChoices.filter(group => !group.visible).map(group => group.key) };
    const groupError = validateVolvoGroups(next);
    if (groupError) { this.$('[data-error]').textContent = groupError; return; }
    if (title) next.title = title;
    if (!form.elements.showTitle.checked) next.showTitle = false;
    try { await this.services.saveWidget(next); this.closeConfig(true); }
    catch (error) { this.$('[data-error]').textContent = `Speichern fehlgeschlagen: ${error.message}`; }
  }

  async deleteWidget() {
    if (!window.confirm('Dieses VolvoConnect-Widget entfernen?')) return;
    try { await this.services.deleteWidget(this.widgetConfig.id); this.closeConfig(true); }
    catch (error) { this.$('[data-error]').textContent = `Entfernen fehlgeschlagen: ${error.message}`; }
  }

  closeConfig(saved) {
    this.revision++;
    this.$('[data-dialog]').close();
    if (!saved && this.isNew) this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true }));
  }

  renderGroupChoices(focusKey, direction) {
    const labels = new Map(volvoGroups);
    const content = this.$('[data-group-choices]');
    content.replaceChildren();
    for (const [index, choice] of this.groupChoices.entries()) {
      const row = node('div', undefined, 'group-choice');
      row.dataset.groupChoice = choice.key;
      const label = node('label');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.checked = choice.visible;
      checkbox.addEventListener('change', () => { choice.visible = checkbox.checked; });
      label.append(checkbox, document.createTextNode(`${volvoGroupIcons[choice.key]} ${labels.get(choice.key)}`));
      row.append(label);
      for (const [step, text] of [[-1, '↑'], [1, '↓']]) {
        const button = node('button', text);
        button.type = 'button';
        button.dataset.move = String(step);
        button.setAttribute('aria-label', `${labels.get(choice.key)} ${step < 0 ? 'nach oben' : 'nach unten'}`);
        button.disabled = index + step < 0 || index + step >= this.groupChoices.length;
        button.addEventListener('click', () => {
          this.groupChoices.splice(index, 1);
          this.groupChoices.splice(index + step, 0, choice);
          this.renderGroupChoices(choice.key, step);
        });
        row.append(button);
      }
      content.append(row);
    }
    if (focusKey) {
      const row = content.querySelector(`[data-group-choice="${focusKey}"]`);
      const button = row.querySelector(`[data-move="${direction}"]:not(:disabled)`)
        || row.querySelector('button:not(:disabled)');
      button?.focus({ preventScroll: true });
    }
  }
}

customElements.define('cms-volvoconnect', FHEMCMSVolvoConnect);
