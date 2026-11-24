import { resizeSchema5Grid, schema5GridItems, SCHEMA5_GRID_COLUMNS } from './fcui-schema5-layout.js';
import { changePageLayout } from './fcui-schema5-layout.js';
import { DEFAULT_CANVAS, applyCmsPageCanvas, cmsPageCanvas, isFreeform, validateFreeformCanvas } from './fcui-freeform-layout.js';
import { schema5PageBackground } from './fcui-schema5-appearance.js';
import { ASSET_IMAGE, assetPathText, validateAssetState } from './asset-contract.js';
import { LIQUID_DEFAULTS } from './fcui-schema5-appearance.js';
import { FREEFORM_DEVICE_GROUPS, deviceSize } from './device-preview.js';

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
  #backgroundLabelRevision = 0;
  #preview;
  #backgroundDim;
  #renderAsPins;

  #freeform;

  constructor({ root, controller, pageId, token, services = {}, browser = window, onClose,
    freeformSupported = false, measurements }) {
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

    const heading = element('h2', `Seiteneinstellungen „${page.title}“`);
    const hint = element('p',
      'Darstellung und Raster der Seite. Die Rastergröße gilt für alle Seiten und die Navigation. '
      + 'Beim Vergröbern werden Positionen und Größen gerundet und Überschneidungen nach unten aufgelöst. '
      + 'Widgets direkt im Editiermodus verschieben und skalieren. Gespeichert wird ein Entwurf.');
    this.#status = element('p');
    this.#status.setAttribute('role', 'status');

    this.#form = element('form');
    const urlLabel = element('label', 'Direkte Live-URL dieser Seite ');
    const urlInput = element('input');
    urlInput.type = 'text';
    urlInput.readOnly = true;
    const href = browser.location?.href;
    if (href) {
      const url = new URL(href);
      url.searchParams.delete('mode');
      url.searchParams.delete('cms-device');
      url.hash = `/${page.id}`;
      urlInput.value = url.href;
    } else {
      urlInput.value = 'Live-URL nicht verfügbar';
    }
    urlLabel.append(urlInput);
    const copyUrl = element('button', 'Live-URL kopieren');
    copyUrl.type = 'button';
    copyUrl.addEventListener('click', async () => {
      try {
        if (!href || typeof browser.navigator?.clipboard?.writeText !== 'function') {
          throw new Error('Zwischenablage nicht verfügbar');
        }
        await browser.navigator.clipboard.writeText(urlInput.value);
        this.#message('Live-URL kopiert.');
      } catch {
        this.#message('Kopieren fehlgeschlagen. Bitte die Live-URL manuell kopieren.', true);
      }
    });
    if (freeformSupported) this.#addFreeformControls(page, measurements);
    const themeLabel = element('label', 'Darstellung ');
    this.#theme = element('select');
    for (const [value, title] of [['dark', 'Forest Green'], ['light', 'Hell'], ['liquid-glass', 'Liquid Glass'],
      ['oled-black', 'OLED Black'], ['catppuccin-mocha', 'Catppuccin Mocha']]) {
      const option = element('option', title);
      option.value = value;
      this.#theme.append(option);
    }
    this.#theme.value = config.theme || 'dark';
    themeLabel.append(this.#theme);
    const framesLabel = element('label', 'Rahmen anzeigen ');
    this.#frames = element('input');
    this.#frames.type = 'checkbox';
    this.#frames.setAttribute('data-show-frames', '');
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
    const titleLabel = element('label', 'Widgettitel ausrichten ');
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
    this.#backgroundControls.className = 'cms-page-background-controls';
    const headingBackground = element('p', `Hintergrundbild für aktuelle Seite „${page.title}“: `);
    headingBackground.className = 'cms-page-background-description';
    this.#backgroundLabel = element('span', this.#background ? 'Bildname wird geladen …' : 'Kein Bild ausgewählt');
    headingBackground.append(this.#backgroundLabel);
    const choose = element('button', 'Hintergrundbild auswählen');
    choose.type = 'button';
    choose.className = 'cms-button';
    const remove = element('button', 'Hintergrundbild entfernen');
    remove.type = 'button';
    remove.className = 'cms-button';
    const inheritsBackground = pageId !== config.pages[0].id && config.settings.sharedBackground === true;
    if (!inheritsBackground) this.#backgroundControls.append(choose);
    if (pageId === config.pages[0].id) {
      const sharedLabel = element('label', 'Bild auf allen Seiten verwenden ');
      this.#sharedBackground = element('input');
      this.#sharedBackground.type = 'checkbox';
      this.#sharedBackground.checked = config.settings.sharedBackground === true;
      sharedLabel.append(this.#sharedBackground);
      this.#backgroundControls.append(sharedLabel);
    }
    if (!inheritsBackground) this.#backgroundControls.append(remove, headingBackground);
    if (this.#sharedBackground) {
      this.#backgroundControls.append(element('p', 'Ist die Checkbox deaktiviert, kann das Hintergrundbild auf jeder Seite einzeln über die Seiteneinstellungen gewählt werden. Eigene Bilder anderer Seiten bleiben erhalten.'));
    } else if (inheritsBackground) {
      this.#backgroundControls.append(element('p', 'Bild wird von der Startseite geerbt.'));
    }
    if (freeformSupported) {
      const pinOptions = element('div');
      const pinLabel = element('label', 'Widgets als Pins darstellen ');
      this.#renderAsPins = element('input');
      this.#renderAsPins.type = 'checkbox';
      this.#renderAsPins.checked = page.renderAsPins === true;
      this.#renderAsPins.setAttribute('data-render-as-pins', '');
      this.#renderAsPins.addEventListener('change', () => this.#updateSettingsPreview());
      pinLabel.append(this.#renderAsPins);
      pinOptions.append(pinLabel, element('p',
        'Vorschau und Live zeigen kompakte Pins; Tippen öffnet die normale Karte. Im mobilen Hochformat werden vollständige Karten gestapelt. Der Editor arbeitet vorerst mit normalen Kacheln; Reading-Auswahl und direktes Schalten vom Pin folgen.'));
      this.#freeform.section.append(pinOptions);
      const dimLabel = element('label', 'Hintergrund-Abdunklung ');
      this.#backgroundDim = element('input');
      Object.assign(this.#backgroundDim, {
        type: 'range', min: '0', max: '50', step: '1', value: String((page.backgroundDim ?? 0) * 100),
      });
      this.#backgroundDim.setAttribute('data-background-dim', '');
      const dimValue = element('output');
      const updateDim = () => {
        dimLabel.hidden = this.#freeform.mode.value !== 'freeform';
        pinOptions.hidden = this.#freeform.mode.value !== 'freeform';
        dimValue.textContent = `${this.#backgroundDim.value} %`;
      };
      this.#backgroundDim.addEventListener('input', () => {
        updateDim();
        this.#updateSettingsPreview();
      });
      this.#freeform.mode.addEventListener('change', updateDim);
      dimLabel.append(this.#backgroundDim, dimValue);
      this.#backgroundControls.append(dimLabel);
      updateDim();
    }
    const controls = element('div');
    controls.className = 'cms-liquid-controls';
    controls.hidden = this.#theme.value !== 'liquid-glass';
    const intensityLabel = element('label', 'Liquid-Effekt (Unschärfe und Glanz) ');
    this.#intensity = element('input');
    this.#intensity.type = 'range';
    this.#intensity.min = '0';
    this.#intensity.max = '100';
    this.#intensity.step = '1';
    this.#intensity.value = String(config.settings.liquidIntensity ?? LIQUID_DEFAULTS.liquidIntensity);
    this.#intensity.setAttribute('data-liquid-intensity', '');
    const intensityValue = element('output');
    intensityLabel.append(this.#intensity, intensityValue);
    const transparencyLabel = element('label', 'Transparenz ');
    this.#transparency = element('input');
    this.#transparency.type = 'range';
    this.#transparency.min = '0';
    this.#transparency.max = '100';
    this.#transparency.step = '1';
    this.#transparency.value = String(config.settings.liquidTransparency ?? LIQUID_DEFAULTS.liquidTransparency);
    this.#transparency.setAttribute('data-liquid-transparency', '');
    const transparencyValue = element('output');
    transparencyLabel.append(this.#transparency, transparencyValue);
    const updateValues = () => {
      intensityValue.textContent = `${this.#intensity.value} %`;
      transparencyValue.textContent = `${this.#transparency.value} %`;
    };
    const updateLiquidPreview = () => {
      updateValues();
      this.#updateSettingsPreview();
    };
    this.#intensity.addEventListener('input', updateLiquidPreview);
    this.#transparency.addEventListener('input', updateLiquidPreview);
    this.#sharedBackground?.addEventListener('change', updateLiquidPreview);
    controls.append(intensityLabel, transparencyLabel);
    this.#backgroundControls.append(controls);
    updateValues();
    this.#form.append(this.#backgroundControls);
    this.#theme.addEventListener('change', () => {
      controls.hidden = this.#theme.value !== 'liquid-glass';
      this.#updateSettingsPreview();
    });
    this.#frames.addEventListener('change', () => this.#updateSettingsPreview());
    this.#titleAlign.addEventListener('change', () => this.#updateSettingsPreview());
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
        if (this.#closed || this.#suspended) return;
        if (!asset) {
          await this.#updateBackgroundLabel(services);
          return;
        }
        if (typeof asset.href !== 'string' || !ASSET_IMAGE.test(asset.href)) {
          throw new Error('Ungültiger Bildpfad');
        }
        this.#background = asset.href;
        this.#updateSettingsPreview();
        await this.#updateBackgroundLabel(services);
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
      this.#backgroundLabelRevision += 1;
      this.#backgroundLabel.textContent = 'Kein Bild ausgewählt';
      this.#updateSettingsPreview();
    });
    this.#form.append(urlLabel, copyUrl);
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
    if (typeof services.createSettingsPreview === 'function') {
      this.#preview = services.createSettingsPreview({ pageId });
      this.#form.append(this.#preview.element);
      this.#updateSettingsPreview();
    }
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
    if (this.#background && !inheritsBackground) void this.#updateBackgroundLabel(services);
  }

  async #updateBackgroundLabel(services) {
    const revision = ++this.#backgroundLabelRevision;
    const background = this.#background;
    if (!background) {
      this.#backgroundLabel.textContent = 'Kein Bild ausgewählt';
      return;
    }
    this.#backgroundLabel.textContent = 'Bildname wird geladen …';
    try {
      if (typeof services.assetAction !== 'function') throw new Error('Assetkatalog nicht verfügbar');
      const state = validateAssetState(await services.assetAction({ op: 'list' }));
      if (revision !== this.#backgroundLabelRevision || this.#closed || this.#suspended) return;
      const asset = state.assets.find(entry => entry.image && entry.href === background);
      this.#backgroundLabel.textContent = asset
        ? assetPathText(state, asset)
        : 'Hintergrundbild nicht im Assetmanager gefunden';
    } catch (error) {
      if (revision !== this.#backgroundLabelRevision || this.#closed || this.#suspended) return;
      this.#backgroundLabel.textContent = `Bildname nicht verfügbar: ${error.message || String(error)}`;
    }
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
      this.#intensity.value, this.#transparency.value, this.#freeform?.values(), this.#backgroundDim?.value,
      this.#renderAsPins?.checked]);
  }

  #addFreeformControls(page, measurements) {
    const section = element('fieldset');
    section.className = 'cms-freeform-settings';
    section.append(element('legend', 'Seitenlayout'));
    const select = (parent, title, entries, value, labelClass = '') => {
      const label = element('label', `${title} `);
      if (labelClass) label.className = labelClass;
      const control = element('select');
      for (const [key, text] of entries) {
        const option = element('option', text);
        option.value = key;
        control.append(option);
      }
      control.value = value;
      label.append(control);
      parent.append(label);
      return control;
    };
    const mode = select(section, 'Modus', [['grid', 'Raster (Standard)'], ['freeform', 'Frei (Pixelgenau)']],
      page.layoutMode || 'grid', 'cms-freeform-mode');
    const extras = element('div');
    extras.className = 'cms-freeform-options';
    section.append(extras);
    const start = this.#config.pages[0];
    const inherited = page !== start;
    const common = cmsPageCanvas(this.#config);
    const initial = {...DEFAULT_CANVAS, ...common};
    if (!common && !inherited && measurements?.width && measurements?.height) {
      initial.width = Math.max(200, Math.min(7680, Math.round(measurements.width)));
      initial.height = Math.max(200, Math.min(7680, Math.round(measurements.height)));
    }
    const size = (labelText, value) => {
      const label = element('label', `${labelText} `);
      const input = element('input');
      label.className = 'cms-freeform-dimension';
      Object.assign(input, {type: 'number', min: 200, max: 7680, step: 1, value: String(value)});
      label.append(input);
      if (!inherited) extras.append(label);
      return input;
    };
    const presetLabel = element('label', 'Gerätegröße ');
    presetLabel.className = 'cms-freeform-preset';
    const preset = element('select');
    const customSize = element('option', 'Eigene Größe');
    customSize.value = '';
    preset.append(customSize);
    for (const [groupName, devices] of FREEFORM_DEVICE_GROUPS) {
      const group = element('optgroup');
      group.label = groupName;
      for (const [id, name, , , landscape] of devices) {
        const dimensions = deviceSize(id, false);
        const orientation = landscape ? 'Querformat' : 'Hochformat';
        const option = element('option', `${name} (${dimensions.width} × ${dimensions.height} px, ${orientation})`);
        option.value = id;
        group.append(option);
      }
      preset.append(group);
    }
    const exactPreset = FREEFORM_DEVICE_GROUPS.flatMap(([, devices]) => devices)
      .find(([id]) => {
        const dimensions = deviceSize(id, false);
        return dimensions.width === initial.width && dimensions.height === initial.height;
      })?.[0] || '';
    preset.value = exactPreset;
    preset.setAttribute('aria-label', 'Freeform-Größe nach Gerät');
    presetLabel.append(preset);
    if (!inherited) extras.append(presetLabel);
    else extras.append(element('p', `Seite erbt Größeneinstellungen von der Startseite (${common
      ? `${initial.width} × ${initial.height} px` : 'automatische Browserbreite'}).`));
    const width = size('Breite (px)', initial.width);
    const height = size('Höhe (px)', initial.height);
    const advanced = inherited ? element('div') : extras;
    const scaling = select(advanced, 'Skalierung', [['fit', 'Automatisch (Browserbreite nutzen)'], ['width', 'Breite füllen'], ['none', '1:1, bei Platzmangel verkleinern']], initial.scaling, 'cms-freeform-advanced');
    const snap = select(advanced, 'Fangraster', [1, 5, 10].map(n => [n, `${n} px`]), initial.snapGrid, 'cms-freeform-advanced');
    const mobile = select(advanced, 'Smartphone und Tablet', [['stack', 'Stapeln'], ['scale', 'Layout behalten']], initial.mobileBehavior, 'cms-freeform-advanced');
    const button = (text, fn) => {
      const control = element('button', text);
      control.type = 'button';
      control.addEventListener('click', fn);
      extras.append(control);
    };
    const setSize = (w, h, presetId = '') => {
      width.value = String(w);
      height.value = String(h);
      preset.value = presetId;
      this.#updateSettingsPreview();
    };
    preset.addEventListener('change', () => {
      const dimensions = deviceSize(preset.value, false);
      if (dimensions) setSize(dimensions.width, dimensions.height, preset.value);
    });
    const update = () => {
      this.#updateSettingsPreview();
    };
    width.addEventListener('change', () => {
      preset.value = '';
      update();
    });
    height.addEventListener('change', () => {
      preset.value = '';
      update();
    });
    if (!inherited) button('Größe aus Hintergrundbild übernehmen', () => {
      const background = page !== start && this.#config.settings.sharedBackground === true
        ? start.background : this.#background;
      if (!background) { this.#message('Kein Hintergrundbild ausgewählt.', true); return; }
      const image = new this.#browser.Image();
      image.onload = () => {
        if (this.#closed || this.#suspended || this.#busy) return;
        try {
          validateFreeformCanvas({width: image.naturalWidth, height: image.naturalHeight});
          setSize(image.naturalWidth, image.naturalHeight);
        } catch (error) {
          this.#message(`Bildmaße nicht übernommen: ${error.message}`, true);
        }
      };
      image.onerror = () => this.#message('Hintergrundbild konnte nicht geladen werden.', true);
      image.src = new URL(background, this.#browser.location.href).href;
    });
    if (!inherited) extras.append(element('p', 'Diese Einstellungen gelten für alle Seiten dieses CMS.'));
    section.addEventListener('change', update);
    this.#form.append(section);
    this.#freeform = {
      mode, measurements, preset, section,
      values: () => [mode.value, width.value, height.value, scaling.value, snap.value, mobile.value],
    };
  }

  #changeColumns() {
    if (this.#busy || this.#closed || this.#requiresReload) return;
    try {
      resizeSchema5Grid(this.#config, Number(this.#columns.value));
      this.#updateSettingsPreview();
      this.#message('Raster aller Seiten wird beim Speichern umgerechnet; noch nicht gespeichert.');
    } catch (error) {
      this.#columns.value = String(this.#config.settings.gridColumns);
      this.#updateSettingsPreview();
      this.#message(`Raster nicht übernommen: ${error.message}`, true);
    }
  }

  #updateSettingsPreview() {
    if (!this.#preview || this.#closed || this.#suspended) return;
    try {
      this.#preview.update(this.#candidate(), this.#freeform?.preset.value);
    } catch (error) {
      this.#message(`Seitenvorschau nicht aktualisiert: ${error.message || String(error)}`, true);
    }
  }

  #candidate() {
    if (!['dark', 'light', 'liquid-glass', 'oled-black', 'catppuccin-mocha'].includes(this.#theme.value)) {
      throw new Error('Ungültige Darstellung');
    }
    if (!['left', 'center', 'right'].includes(this.#titleAlign.value)) {
      throw new Error('Ungültige Titelausrichtung');
    }
    const candidate = resizeSchema5Grid(this.#config, Number(this.#columns.value));
    const [originalTheme, originalFrames, , originalTitleAlign, originalBackground, originalShared,
      originalIntensity, originalTransparency, originalLayout, originalDim, originalPins] = JSON.parse(this.#settingsBaseline);
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
    if (this.#freeform) {
      const [mode, width, height, scaling, snapGrid, mobileBehavior] = this.#freeform.values();
      const canvas = {width: Number(width), height: Number(height), scaling, snapGrid: Number(snapGrid), mobileBehavior};
      const isStart = this.#pageId === candidate.pages[0].id;
      if (isStart && (cmsPageCanvas(candidate) || mode === 'freeform'
        || this.#freeform.values().slice(1).some((value, index) => value !== originalLayout[index + 1]))) {
        applyCmsPageCanvas(candidate, canvas);
      }
      if (!isStart && !candidate.settings.pageCanvas && mode !== (candidate.pages.find(page => page.id === this.#pageId).layoutMode || 'grid')) {
        applyCmsPageCanvas(candidate, cmsPageCanvas(candidate) ?? canvas);
      }
      changePageLayout(candidate, this.#pageId, mode, cmsPageCanvas(candidate) ?? canvas,
        this.#freeform.measurements?.boxes);
      if (mode === 'freeform' && this.#backgroundDim.value !== originalDim) {
        if (!/^(?:[0-4]?\d|50)$/.test(this.#backgroundDim.value)) {
          throw new Error('Ungültige Hintergrund-Abdunklung');
        }
        candidate.pages.find(page => page.id === this.#pageId).backgroundDim = Number(this.#backgroundDim.value) / 100;
      }
      if (mode === 'freeform' && this.#renderAsPins.checked !== originalPins) {
        candidate.pages.find(page => page.id === this.#pageId).renderAsPins = this.#renderAsPins.checked;
      }
    }
    return candidate;
  }

  async #saveDraft() {
    if (this.#busy || this.#closed || this.#requiresReload) return;
    if (!['dark', 'light', 'liquid-glass', 'oled-black', 'catppuccin-mocha'].includes(this.#theme.value)) {
      this.#message('Ungültige Darstellung', true);
      return;
    }
    if (!['left', 'center', 'right'].includes(this.#titleAlign.value)) {
      this.#message('Ungültige Titelausrichtung', true);
      return;
    }
    let pending;
    try {
      const page = this.#config.pages.find(entry => entry.id === this.#pageId);
      if (isFreeform(page) && this.#freeform?.mode.value === 'grid'
        && !this.#browser.confirm('Beim Rückwechsel gehen die Pixelpositionen verloren. Zum Raster wechseln?')) return;
      pending = this.#controller.saveDraft(this.#candidate(), this.#token);
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
    this.#preview?.close();
    this.#root.replaceChildren();
  }
}
