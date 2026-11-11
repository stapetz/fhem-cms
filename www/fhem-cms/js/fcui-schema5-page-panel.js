import { resizeSchema5Grid, schema5GridItems, SCHEMA5_GRID_COLUMNS } from './fcui-schema5-layout.js';
import { ASSET_IMAGE } from './asset-contract.js';
import { LIQUID_DEFAULTS, setLiquidAppearance } from './fcui-schema5-appearance.js';

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
  #titleAlign;
  #form;
  #save;
  #close;
  #settingsBaseline;
  #busy = false;
  #closed = false;
  #suspended = false;
  #requiresReload = false;
  #onClose;
  #pageId;
  #background;
  #backgroundLabel;
  #sharedBackground;
  #backgroundControls;
  #intensity;
  #transparency;

  constructor({ root, controller, pageId, token, services = {}, browser = window, onClose }) {
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
    this.#pageId = pageId;
    const page = config.pages.find((entry) => entry.id === pageId);
    this.#background = page.background || '';

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
    for (const [value, title] of [['dark', 'Dunkel'], ['light', 'Hell'], ['liquid-glass', 'Liquid Glass']]) {
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
    const titleLabel = element('label', 'Widgettitel ausrichten (alle Seiten) ');
    this.#titleAlign = element('select');
    for (const [value, title] of [['left', 'Links'], ['center', 'Zentriert'], ['right', 'Rechts']]) {
      const option = element('option', title);
      option.value = value;
      this.#titleAlign.append(option);
    }
    this.#titleAlign.value = config.settings.titleAlign || 'left';
    titleLabel.append(this.#titleAlign);
    this.#form.append(themeLabel, framesLabel, layoutLabel, titleLabel);
    this.#backgroundControls = element('div');
    this.#backgroundControls.hidden = this.#theme.value !== 'liquid-glass';
    const headingBackground = element('p', `Hintergrundbild für aktuelle Seite „${page.title}“`);
    this.#backgroundLabel = element('p', this.#background || 'Kein Bild ausgewählt');
    const choose = element('button', 'Hintergrundbild auswählen');
    choose.type = 'button';
    choose.className = 'cms-button';
    const remove = element('button', 'Hintergrundbild entfernen');
    remove.type = 'button';
    remove.className = 'cms-button';
    this.#backgroundControls.append(headingBackground, this.#backgroundLabel, choose, remove);
    if (pageId === config.pages[0].id) {
      const sharedLabel = element('label', 'Bild auf allen Seiten verwenden ');
      this.#sharedBackground = element('input');
      this.#sharedBackground.type = 'checkbox';
      this.#sharedBackground.checked = config.settings.sharedBackground === true;
      sharedLabel.append(this.#sharedBackground);
      this.#backgroundControls.append(sharedLabel,
        element('p', 'Ist die Checkbox deaktiviert, kann das Hintergrundbild auf jeder Seite einzeln über die Seiteneinstellungen gewählt werden. Eigene Bilder anderer Seiten bleiben erhalten.'));
    } else if (config.settings.sharedBackground === true) {
      this.#backgroundControls.append(element('p', 'Das Bild der Startseite wird aktuell auf allen Seiten verwendet.'));
    }
    const controls = element('div');
    controls.className = 'cms-liquid-controls';
    const intensityLabel = element('label', 'Liquid-Effekt (Unschärfe und Glanz, alle Seiten) ');
    this.#intensity = element('input');
    this.#intensity.type = 'range';
    this.#intensity.min = '0';
    this.#intensity.max = '100';
    this.#intensity.step = '1';
    this.#intensity.value = String(config.settings.liquidIntensity ?? LIQUID_DEFAULTS.liquidIntensity);
    this.#intensity.setAttribute('data-liquid-intensity', '');
    const intensityValue = element('output');
    intensityLabel.append(this.#intensity, intensityValue);
    const transparencyLabel = element('label', 'Transparenz (alle Seiten) ');
    this.#transparency = element('input');
    this.#transparency.type = 'range';
    this.#transparency.min = '0';
    this.#transparency.max = '100';
    this.#transparency.step = '1';
    this.#transparency.value = String(config.settings.liquidTransparency ?? LIQUID_DEFAULTS.liquidTransparency);
    this.#transparency.setAttribute('data-liquid-transparency', '');
    const transparencyValue = element('output');
    transparencyLabel.append(this.#transparency, transparencyValue);
    const preview = element('div');
    preview.className = 'cms-liquid-preview';
    preview.setAttribute('aria-label', 'Vorschau der Widgetdarstellung');
    const card = element('div', 'Beispiel-Widget · 21 °C');
    card.className = 'cms-liquid-preview-card';
    preview.append(card);
    const updatePreview = () => {
      const intensity = Number(this.#intensity.value);
      const transparency = Number(this.#transparency.value);
      setLiquidAppearance(preview, { liquidIntensity: intensity, liquidTransparency: transparency });
      intensityValue.textContent = `${intensity} %`;
      transparencyValue.textContent = `${transparency} %`;
      const shared = this.#sharedBackground ? this.#sharedBackground.checked : config.settings.sharedBackground === true;
      const background = shared && pageId !== config.pages[0].id ? config.pages[0].background : this.#background;
      if (background && !ASSET_IMAGE.test(background)) throw new Error('Ungültiges Hintergrundbild');
      preview.style.setProperty('--cms-liquid-preview-image',
        background ? `url("${background}")` : 'linear-gradient(125deg, #446a80, #aa805d 50%, #294b68)');
    };
    this.#intensity.addEventListener('input', updatePreview);
    this.#transparency.addEventListener('input', updatePreview);
    this.#sharedBackground?.addEventListener('change', updatePreview);
    controls.append(intensityLabel, transparencyLabel, element('p', 'Vorschau'), preview);
    this.#backgroundControls.append(controls);
    updatePreview();
    this.#form.append(this.#backgroundControls);
    this.#theme.addEventListener('change', () => {
      this.#backgroundControls.hidden = this.#theme.value !== 'liquid-glass';
    });
    choose.addEventListener('click', async () => {
      if (this.#busy || this.#closed || this.#requiresReload) return;
      if (typeof services.pickAsset !== 'function') {
        this.#message('Bildauswahl ist nicht verfügbar', true);
        return;
      }
      this.#busy = true;
      this.#save.disabled = true;
      this.#close.disabled = true;
      try {
        const asset = await services.pickAsset({ mode: 'image', owner: this.#root });
        if (this.#closed || this.#suspended || !asset) return;
        if (typeof asset.href !== 'string' || !ASSET_IMAGE.test(asset.href)) {
          throw new Error('Ungültiger Bildpfad');
        }
        this.#background = asset.href;
        this.#backgroundLabel.textContent = asset.name || asset.href;
        updatePreview();
        this.#message('Bild ausgewählt; noch nicht gespeichert.');
      } catch (error) {
        this.#message(`Bildauswahl fehlgeschlagen: ${error.message || String(error)}`, true);
      } finally {
        this.#busy = false;
        this.#save.disabled = false;
        this.#close.disabled = false;
        if (this.#suspended) this.close();
      }
    });
    remove.addEventListener('click', () => {
      if (this.#busy || this.#closed || this.#requiresReload) return;
      this.#background = '';
      this.#backgroundLabel.textContent = 'Kein Bild ausgewählt';
      updatePreview();
    });
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

    this.#settingsBaseline = this.#settings();
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
    return this.#settings() !== this.#settingsBaseline;
  }

  #settings() {
    return JSON.stringify([this.#theme.value, this.#frames.checked, this.#columns.value,
      this.#titleAlign.value, this.#background, this.#sharedBackground?.checked ?? null,
      this.#intensity.value, this.#transparency.value]);
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
    if (!['dark', 'light', 'liquid-glass'].includes(this.#theme.value)) {
      this.#message('Ungültige Darstellung', true);
      return;
    }
    if (!['left', 'center', 'right'].includes(this.#titleAlign.value)) {
      this.#message('Ungültige Titelausrichtung', true);
      return;
    }
    let pending;
    try {
      const candidate = resizeSchema5Grid(this.#config, Number(this.#columns.value));
      const [originalTheme, originalFrames, , originalTitleAlign, originalBackground, originalShared,
        originalIntensity, originalTransparency] = JSON.parse(this.#settingsBaseline);
      for (const value of [this.#intensity.value, this.#transparency.value]) {
        if (!/^(?:100|[1-9]?\d)$/.test(value)) throw new Error('Ungültiger Liquid-Glass-Wert');
      }
      if (this.#theme.value !== originalTheme) candidate.theme = this.#theme.value;
      if (this.#frames.checked !== originalFrames) candidate.settings.showFrames = this.#frames.checked;
      if (this.#titleAlign.value !== originalTitleAlign) candidate.settings.titleAlign = this.#titleAlign.value;
      if (this.#background !== originalBackground) {
        const page = candidate.pages.find((entry) => entry.id === this.#pageId);
        if (this.#background) page.background = this.#background;
        else delete page.background;
      }
      if (this.#sharedBackground && this.#sharedBackground.checked !== originalShared) {
        candidate.settings.sharedBackground = this.#sharedBackground.checked;
      }
      if (this.#intensity.value !== originalIntensity) candidate.settings.liquidIntensity = Number(this.#intensity.value);
      if (this.#transparency.value !== originalTransparency) candidate.settings.liquidTransparency = Number(this.#transparency.value);
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
