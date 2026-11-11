import { Schema5BackupPanel } from './fcui-schema5-backup-panel.js';
import { Schema5MovePanel } from './fcui-schema5-move-panel.js';
import { Schema5PagePanel } from './fcui-schema5-page-panel.js';
import { Schema5View } from './fcui-schema5-view.js';
import { Schema5WidgetPanel } from './fcui-schema5-widget-panel.js';
import { Schema5NavigationPanel } from './fcui-schema5-navigation.js';
import { Schema5DraftController } from './fcui-schema5-draft.js';
import { createSchema5Transport } from './fcui-schema5-transport.js';
import { createSchema5WidgetServices } from './widget-services.js';
import { applySchema5GridItems, arrangeSchema5Widgets, schema5GridItems } from './fcui-schema5-layout.js';
import { DevicePreview } from './device-preview.js';
import { measureSchema5Navigation } from './fcui-schema5-navigation-fit.js';
import { isSchema5InitialSetup, Schema5SetupWizard } from './fcui-schema5-setup-wizard.js';

export function createSchema5Editor({ GridStack, root, draftClient, liveClient, services, browser = window }) {
  if (!draftClient || !liveClient || draftClient === liveClient) {
    throw new Error('Getrennte FHEM-Clients für Entwurf und Live-Abonnements erforderlich');
  }
  if (!(draftClient.endpoint instanceof URL) || !(liveClient.endpoint instanceof URL)
    || draftClient.endpoint.href !== liveClient.endpoint.href || draftClient.cmsDevice !== liveClient.cmsDevice) {
    throw new Error('Entwurf und Live-Abonnements müssen dasselbe CMS-Device verwenden');
  }
  const controller = new Schema5DraftController(createSchema5Transport(draftClient));
  const widgetServices = services === undefined ? createSchema5WidgetServices(draftClient) : services;
  return new Schema5Editor({ GridStack, root, controller, client: liveClient, services: widgetServices, browser });
}

export class Schema5Editor {
  #GridStack;
  #root;
  #controller;
  #client;
  #services;
  #browser;
  #toolbar;
  #page;
  #mode;
  #widgets;
  #arrange;
  #backup;
  #assets;
  #gridToggle;
  #previewToggle;
  #publish;
  #discard;
  #reloadButton;
  #status;
  #content;
  #view = null;
  #panel = null;
  #devicePreview = null;
  #active = false;
  #generation = 0;
  #suspended = false;
  #appearance = null;
  #menus = [];
  #showGrid = false;
  #previewMode = false;
  #setupPrompted = false;
  #setupWizardStorageKey;
  #gridElement = null;
  #layoutSaving = false;
  #layoutSavePromise = Promise.resolve();

  constructor({ GridStack, root, controller, client, services, browser = window }) {
    if (!GridStack || !root || root.children.length || !controller
      || typeof controller.reload !== 'function' || typeof controller.snapshot !== 'function'
      || typeof controller.publishDraft !== 'function' || typeof controller.discardDraft !== 'function'
      || !client || !services || !browser || typeof browser.addEventListener !== 'function'
      || typeof browser.removeEventListener !== 'function' || typeof browser.confirm !== 'function') {
      throw new Error('Dienste und leerer Container für Schema-5-Editor erforderlich');
    }
    this.#GridStack = GridStack;
    this.#root = root;
    root.className = 'cms-schema5-editor';
    this.#controller = controller;
    this.#client = client;
    this.#services = {
      ...services,
      setCommand: async () => { throw new Error('Geräteaktionen sind im Bearbeitungsmodus deaktiviert'); },
      setTarget: async () => { throw new Error('Geräteaktionen sind im Bearbeitungsmodus deaktiviert'); },
    };
    this.#browser = browser;
    this.#setupWizardStorageKey = `fhem-cms:setup-wizard:${client.endpoint?.pathname || ''}:${client.cmsDevice || ''}`;
    this.#toolbar = document.createElement('div');
    this.#toolbar.className = 'cms-toolbar';
    this.#toolbar.setAttribute('role', 'toolbar');
    this.#toolbar.setAttribute('aria-label', 'Bearbeiten');
    this.#page = document.createElement('button');
    this.#page.type = 'button';
    this.#page.textContent = 'Seiteneinstellungen';
    this.#page.disabled = true;
    this.#mode = document.createElement('span');
    this.#publish = document.createElement('button');
    this.#publish.type = 'button';
    this.#publish.textContent = 'Entwurf veröffentlichen';
    this.#discard = document.createElement('button');
    this.#discard.type = 'button';
    this.#discard.textContent = 'Entwurf verwerfen';
    this.#reloadButton = document.createElement('button');
    this.#reloadButton.type = 'button';
    this.#reloadButton.textContent = 'Zustand erneut laden';
    this.#reloadButton.hidden = true;
    this.#widgets = document.createElement('button');
    this.#widgets.type = 'button';
    this.#widgets.textContent = 'Widget hinzufügen';
    this.#arrange = document.createElement('button');
    this.#arrange.type = 'button';
    this.#arrange.textContent = 'Widgets automatisch anordnen';
    for (const button of [this.#page, this.#publish, this.#discard, this.#reloadButton, this.#widgets, this.#arrange]) {
      button.className = 'cms-button';
    }
    this.#publish.className = 'cms-button cms-publish';
    this.#mode.className = 'cms-editor-mode';
    this.#backup = document.createElement('button');
    this.#backup.type = 'button';
    this.#backup.textContent = 'Sicherungen / Wiederherstellung';
    this.#backup.className = 'cms-button';
    this.#assets = document.createElement('button');
    this.#assets.type = 'button';
    this.#assets.textContent = 'Assetmanager';
    this.#assets.className = 'cms-button';
    this.#gridToggle = document.createElement('button');
    this.#gridToggle.type = 'button';
    this.#gridToggle.textContent = 'Raster anzeigen';
    this.#gridToggle.className = 'cms-button cms-grid-toggle';
    this.#gridToggle.setAttribute('aria-pressed', 'false');
    this.#previewToggle = document.createElement('button');
    this.#previewToggle.type = 'button';
    this.#previewToggle.textContent = 'Vorschau';
    this.#previewToggle.className = 'cms-button cms-grid-toggle';
    this.#previewToggle.setAttribute('aria-pressed', 'false');
    this.#menu('Datei', [this.#publish, this.#discard, this.#backup, this.#assets]);
    this.#menu('Bearbeiten', [this.#page, this.#widgets, this.#arrange]);
    this.#menu('Ansicht', [this.#previewToggle, this.#gridToggle]);
    this.#toolbar.append(this.#mode, this.#reloadButton);
    this.#setActions(false, false);
    this.#status = document.createElement('p');
    this.#status.className = 'cms-status';
    this.#status.setAttribute('role', 'status');
    this.#content = document.createElement('div');
    this.#content.className = 'cms-schema5-workspace';
    this.#page.addEventListener('click', () => this.#openPage());
    this.#widgets.addEventListener('click', () => this.#openWidgets());
    this.#arrange.addEventListener('click', () => this.#arrangeWidgets());
    this.#backup.addEventListener('click', () => this.#openBackup());
    this.#assets.addEventListener('click', async () => {
      if (!this.#active || this.#suspended || this.#assets.disabled) return;
      this.#setActions(false, false);
      try { await this.#services.pickAsset({ owner: this.#root }); }
      catch (error) { this.#status.textContent = error.message || 'Assetmanager konnte nicht geöffnet werden'; }
      finally {
        if (this.#active && !this.#suspended) this.#setActions(Boolean(this.#view), Boolean(this.#controller.snapshot().draft));
      }
    });
    this.#previewToggle.addEventListener('click', () => {
      this.#previewMode = !this.#previewMode;
      this.#previewToggle.setAttribute('aria-pressed', this.#previewMode ? 'true' : 'false');
      if (!this.#active || this.#suspended || !this.#view) return;
      this.#generation += 1;
      this.#display(this.#controller.snapshot(), this.#generation).catch((error) => this.#error(error));
    });
    this.#gridToggle.addEventListener('click', () => {
      this.#showGrid = !this.#showGrid;
      this.#gridToggle.setAttribute('aria-pressed', this.#showGrid ? 'true' : 'false');
      this.#applyGridGuides();
    });
    this.#publish.addEventListener('click', () => this.#draftAction('publish'));
    this.#discard.addEventListener('click', () => this.#draftAction('discard'));
    this.#reloadButton.addEventListener('click', () => this.#reload().catch((error) => this.#error(error)));
  }

  #menu(label, buttons) {
    const menu = document.createElement('details');
    menu.className = 'cms-menu';
    const summary = document.createElement('summary');
    summary.className = 'cms-button';
    summary.textContent = label;
    const items = document.createElement('div');
    items.className = 'cms-menu-items';
    items.setAttribute('role', 'group');
    items.setAttribute('aria-label', label);
    for (const button of buttons) {
      button.addEventListener('click', () => this.#closeMenus());
    }
    items.append(...buttons);
    menu.append(summary, items);
    menu.addEventListener('toggle', () => {
      if (menu.open) this.#closeMenus(menu);
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        menu.open = false;
        summary.focus();
      }
    });
    menu.addEventListener('focusout', (event) => {
      // Safari/WebKit fokussiert Buttons beim Klick nicht: relatedTarget ist dann null,
      // obwohl der Klick im Menü landet. Nur bei echtem Fokuswechsel schließen.
      if (event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false;
    });
    this.#menus.push(menu);
    this.#toolbar.append(menu);
    return items;
  }

  #closeMenus(except) {
    for (const menu of this.#menus) if (menu !== except) menu.open = false;
  }

  #onPointer = (event) => {
    if (!this.#toolbar.contains(event.target)) this.#closeMenus();
  };

  #panelContainer(name) {
    this.#closeMenus();
    const container = document.createElement('dialog');
    container.className = 'cms-editor-panel cms-editor-dialog';
    container.setAttribute('data-panel', name);
    this.#content.append(container);
    container.addEventListener('cancel', (event) => {
      event.preventDefault();
      const close = container.querySelector('.cms-panel-close');
      if (close && !close.disabled) close.click();
    });
    container.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const close = container.querySelector('.cms-panel-close');
      if (close && !close.disabled) {
        event.preventDefault();
        close.click();
      }
    });
    container.showModal();
    return container;
  }

  #setActions(enabled, hasDraft) {
    this.#page.disabled = !enabled;
    this.#widgets.disabled = !enabled;
    this.#arrange.disabled = !enabled;
    this.#backup.disabled = !enabled;
    this.#assets.disabled = !enabled;
    this.#gridToggle.disabled = !enabled;
    this.#previewToggle.disabled = !enabled;
    this.#publish.disabled = !enabled || !hasDraft;
    this.#discard.disabled = !enabled || !hasDraft;
  }

  #onHide = () => {
    if (!this.#active || this.#suspended) return;
    this.#suspended = true;
    this.#generation += 1;
    this.#devicePreview?.destroy();
    this.#devicePreview = null;
    this.#setActions(false, false);
    this.#reloadButton.hidden = true;
    this.#mode.textContent = '';
    if (this.#view) this.#view.stop();
    this.#view = null;
    if (this.#panel) this.#panel.suspend();
    this.#panel = null;
    this.#content.replaceChildren();
    this.#restoreAppearance();
  };

  #onShow = (event) => {
    if (this.#active && this.#suspended && event.persisted) this.#browser.location.reload();
  };

  async start() {
    if (this.#active) throw new Error('Schema-5-Editor ist bereits gestartet');
    this.#active = true;
    this.#suspended = false;
    this.#devicePreview = new DevicePreview({
      getUrl: () => {
        const url = new URL(this.#browser.location.href);
        url.search = '?mode=preview';
        url.hash = this.#browser.location.hash;
        return url.href;
      },
      beforeOpen: () => this.#layoutSavePromise,
    });
    this.#appearance = ['data-cms-theme', 'data-cms-frames'].map((name) =>
      [name, document.documentElement.getAttribute(name)]);
    this.#root.append(this.#toolbar, this.#status, this.#content);
    this.#browser.addEventListener('pagehide', this.#onHide);
    this.#browser.addEventListener('pageshow', this.#onShow);
    this.#browser.addEventListener('pointerdown', this.#onPointer);
    try {
      await this.#reload();
    } catch (error) {
      if (!this.#active || this.#suspended) return;
      this.stop();
      throw error;
    }
  }

  async #reload() {
    if (!this.#active || this.#suspended) return;
    const generation = ++this.#generation;
    this.#setActions(false, false);
    this.#reloadButton.hidden = true;
    const state = await this.#controller.reload();
    if (!this.#active || this.#suspended || generation !== this.#generation) return;
    await this.#display(state, generation);
  }

  async #display(state, generation) {
    if (!this.#active || this.#suspended || generation !== this.#generation) return;
    const scrollLeft = this.#content.scrollLeft;
    const scrollTop = this.#content.scrollTop;
    if (this.#view) this.#view.stop();
    const config = state.draft || state.live;
    document.documentElement.setAttribute('data-cms-theme', config.theme || 'dark');
    document.documentElement.setAttribute('data-cms-frames', config.settings?.showFrames === false ? 'off' : 'on');
    document.documentElement.style.setProperty('--cms-widget-title-align', config.settings?.titleAlign || 'left');
    this.#mode.textContent = state.draft ? 'Entwurf' : 'Live';
    this.#content.replaceChildren();
    const grid = document.createElement('div');
    grid.className = 'grid-stack cms-schema5-grid';
    this.#gridElement = grid;
    this.#content.append(grid);
    const view = new Schema5View({ GridStack: this.#GridStack, root: grid, status: this.#status,
      config, client: this.#client, services: this.#services, browser: this.#browser,
      editing: this.#previewMode ? undefined : {
        onChange: (pageId, items) => {
          this.#layoutSavePromise = this.#saveLayout(pageId, items);
          return this.#layoutSavePromise;
        },
        onEdit: (pageId, id) => id === '__nav' ? this.#openNavigation() : this.#openWidgets(id),
        onMove: (pageId, id) => this.#openMove(id),
      } });
    this.#view = view;
    await view.start();
    this.#applyGridGuides();
    if (this.#active && !this.#suspended && generation === this.#generation && this.#view === view) {
      this.#content.scrollLeft = scrollLeft;
      this.#content.scrollTop = scrollTop;
      this.#setActions(true, state.draft !== null);
      this.#reloadButton.hidden = true;
      if (!this.#setupPrompted && !state.draft && isSchema5InitialSetup(state.live)) {
        this.#setupPrompted = true;
        if (!this.#hasSeenSetupWizard(state)) this.#openSetupWizard();
      }
    }
  }

  #arrangeWidgets() {
    if (!this.#active || this.#suspended || !this.#view || this.#arrange.disabled) return;
    try {
      const state = this.#controller.snapshot();
      const pageId = this.#view.current;
      const candidate = arrangeSchema5Widgets(state.draft || state.live, pageId);
      this.#layoutSavePromise = this.#saveLayout(pageId, schema5GridItems(candidate, pageId));
      return this.#layoutSavePromise;
    } catch (error) {
      this.#status.setAttribute('data-error', 'true');
      this.#status.textContent = `Widgets nicht angeordnet: ${error.message}`;
    }
  }

  async #saveLayout(pageId, items) {
    if (!this.#active || this.#suspended || !this.#view || this.#page.disabled) return;
    if (this.#layoutSaving) return this.#layoutSavePromise;
    this.#layoutSaving = true;
    const generation = ++this.#generation;
    this.#view.lock();
    this.#setActions(false, false);
    this.#status.removeAttribute('data-error');
    this.#status.textContent = 'Position wird als Entwurf gespeichert …';
    try {
      await Promise.resolve();
      if (!this.#active || this.#suspended || generation !== this.#generation) return;
      const state = this.#controller.snapshot();
      let candidate;
      try {
        candidate = applySchema5GridItems(state.draft || state.live, pageId, items);
      } catch (error) {
        await this.#display(state, generation);
        if (generation === this.#generation) {
          this.#status.setAttribute('data-error', 'true');
          this.#status.textContent = `Position nicht übernommen: ${error.message}`;
        }
        return;
      }
      if (JSON.stringify(schema5GridItems(candidate, pageId))
        === JSON.stringify(schema5GridItems(state.draft || state.live, pageId))) {
        await this.#display(state, generation);
        return;
      }
      const result = await this.#controller.saveLayout(pageId, items, state.token);
      await this.#display(result, generation);
    } catch (error) {
      if (generation === this.#generation) this.#error(error);
    } finally {
      this.#layoutSaving = false;
    }
  }

  #error(error) {
    if (!this.#active || this.#suspended) return;
    this.#setActions(false, false);
    this.#reloadButton.hidden = false;
    if (this.#view) this.#view.stop();
    this.#view = null;
    this.#content.replaceChildren();
    this.#status.setAttribute('data-error', '');
    this.#status.textContent = `Editor konnte nicht fortgesetzt werden: ${error.message || String(error)}. Bitte Zustand erneut laden.`;
  }

  async #draftAction(action) {
    if (!this.#active || this.#suspended || !this.#view
      || (action === 'publish' ? this.#publish.disabled : this.#discard.disabled)) return;
    let actionGeneration = this.#generation;
    try {
      const state = this.#controller.snapshot();
      if (!state.draft) throw new Error('Es gibt keinen Entwurf');
      const generation = this.#generation;
      const prompt = action === 'publish'
        ? 'Den angezeigten Entwurf veröffentlichen und den bisherigen Live-Stand sichern?'
        : 'Den angezeigten Entwurf unwiderruflich verwerfen? Der Live-Stand bleibt erhalten.';
      if (!this.#browser.confirm(prompt)) return;
      if (!this.#active || this.#suspended || generation !== this.#generation) return;
      this.#generation += 1;
      actionGeneration = this.#generation;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      this.#status.removeAttribute('data-error');
      this.#status.textContent = action === 'publish' ? 'Entwurf wird veröffentlicht …' : 'Entwurf wird verworfen …';
      const result = await (action === 'publish'
        ? this.#controller.publishDraft(state.token) : this.#controller.discardDraft(state.token));
      await this.#display(result, actionGeneration);
    } catch (error) {
      if (actionGeneration === this.#generation) this.#error(error);
    }
  }

  #applyGridGuides() {
    if (this.#gridElement) {
      const state = this.#controller.snapshot();
      this.#gridElement.style.setProperty('--cms-grid-columns', String((state.draft || state.live).settings.gridColumns));
      this.#gridElement.classList.toggle('cms-grid-guides', this.#showGrid);
    }
  }

  #openMove(widgetId) {
    if (!this.#active || this.#suspended || !this.#view || this.#widgets.disabled) return;
    try {
      const pageId = this.#view.current;
      const state = this.#controller.snapshot();
      this.#generation += 1;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      const container = this.#panelContainer('move');
      this.#panel = new Schema5MovePanel({
        root: container, controller: this.#controller, pageId, widgetId, token: state.token,
        onClose: ({ requiresReload }) => {
          this.#panel = null;
          Promise.resolve().then(() => requiresReload
            ? this.#reload() : this.#display(this.#controller.snapshot(), this.#generation))
            .catch((error) => this.#error(error));
        },
      });
    } catch (error) {
      this.#content.replaceChildren();
      this.#error(error);
    }
  }

  #openBackup() {
    if (!this.#active || this.#suspended || !this.#view || this.#backup.disabled) return;
    try {
      this.#generation += 1;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      const container = this.#panelContainer('backup');
      this.#panel = new Schema5BackupPanel({
        root: container, client: this.#client, browser: this.#browser,
        onClose: ({ requiresReload }) => {
          this.#panel = null;
          Promise.resolve().then(() => requiresReload
            ? this.#reload() : this.#display(this.#controller.snapshot(), this.#generation))
            .catch((error) => this.#error(error));
        },
      });
    } catch (error) {
      this.#content.replaceChildren();
      this.#error(error);
    }
  }

  #openSetupWizard() {
    if (!this.#active || this.#suspended || !this.#view) return;
    try {
      const view = this.#view;
      this.#generation += 1;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      const container = this.#panelContainer('setup');
      this.#panel = new Schema5SetupWizard({
        root: container,
        controller: this.#controller,
        client: this.#client,
        fitNavigation: (config) => this.#fitNavigation(config, view),
        onComplete: () => this.#markSetupWizardSeen(this.#controller.snapshot()),
        onDismiss: () => this.#markSetupWizardSeen(this.#controller.snapshot()),
        onClose: ({ requiresReload, saved, state }) => {
          this.#panel = null;
          if (saved && state?.draft?.pages?.[0]) {
            this.#browser.location.hash = `#/${state.draft.pages[0].id}`;
          }
          Promise.resolve().then(() => requiresReload
            ? this.#reload() : this.#display(this.#controller.snapshot(), this.#generation))
            .catch((error) => this.#error(error));
        },
      });
    } catch (error) {
      this.#content.replaceChildren();
      this.#error(error);
    }
  }

  #hasSeenSetupWizard(state) {
    try {
      const storage = this.#browser.localStorage;
      if (!storage) throw new Error('localStorage nicht verfügbar');
      return storage.getItem(this.#setupWizardStorageKey) === (state.setupIdentity || '1');
    } catch {
      this.#status.textContent = 'Der Einrichtungsstatus kann nicht im Browser gelesen werden. Der Assistent wird möglicherweise erneut angeboten.';
      return false;
    }
  }

  #markSetupWizardSeen(state) {
    try {
      const storage = this.#browser.localStorage;
      if (!storage) throw new Error('localStorage nicht verfügbar');
      storage.setItem(this.#setupWizardStorageKey, state.setupIdentity || '1');
    } catch {
      this.#status.textContent = 'Der Einrichtungsstatus konnte nicht im Browser gespeichert werden. Der Assistent wird möglicherweise erneut angeboten.';
    }
  }

  #openPage() {
    if (!this.#active || this.#suspended || !this.#view || this.#page.disabled) return;
    try {
      const pageId = this.#view.current;
      const state = this.#controller.snapshot();
      this.#generation += 1;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      const container = this.#panelContainer('page');
      this.#panel = new Schema5PagePanel({
        root: container, controller: this.#controller, pageId, services: this.#services,
        token: state.token, browser: this.#browser,
        onClose: ({ requiresReload }) => {
          this.#panel = null;
          Promise.resolve().then(() => requiresReload
            ? this.#reload() : this.#display(this.#controller.snapshot(), this.#generation))
            .catch((error) => this.#error(error));
        },
      });
    } catch (error) {
      this.#content.replaceChildren();
      this.#error(error);
    }
  }

  #openWidgets(widgetId) {
    if (!this.#active || this.#suspended || !this.#view || this.#widgets.disabled) return;
    try {
      const pageId = this.#view.current;
      const state = this.#controller.snapshot();
      this.#generation += 1;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      const container = this.#panelContainer('widgets');
      this.#panel = new Schema5WidgetPanel({
        root: container, controller: this.#controller, services: this.#services, pageId, token: state.token, widgetId,
        onClose: ({ requiresReload }) => {
          this.#panel = null;
          Promise.resolve().then(() => requiresReload
            ? this.#reload() : this.#display(this.#controller.snapshot(), this.#generation))
            .catch((error) => this.#error(error));
        },
      });
    } catch (error) {
      this.#content.replaceChildren();
      this.#error(error);
    }
  }

  #openNavigation() {
    if (!this.#active || this.#suspended || !this.#view || this.#widgets.disabled) return;
    try {
      const state = this.#controller.snapshot();
      const view = this.#view;
      this.#generation += 1;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      const container = this.#panelContainer('navigation');
      this.#panel = new Schema5NavigationPanel({
        root: container, controller: this.#controller, token: state.token, browser: this.#browser,
        fitNavigation: (config) => this.#fitNavigation(config, view),
        onClose: ({ requiresReload }) => {
          this.#panel = null;
          Promise.resolve().then(() => requiresReload
            ? this.#reload() : this.#display(this.#controller.snapshot(), this.#generation))
            .catch((error) => this.#error(error));
        },
      });
    } catch (error) {
      this.#content.replaceChildren();
      this.#error(error);
    }
  }

  #fitNavigation(config, view) {
    const host = document.createElement('div');
    host.className = 'cms-schema5-grid cms-grid-editable';
    Object.assign(host.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
      width: 'calc(var(--cms-view-width) + var(--cms-view-gap))' });
    const pageId = config.pages[0].id;
    const nav = view.navigation(pageId, config, true);
    nav.setAttribute('data-adaptive', '');
    nav.style.marginRight = 'var(--cms-view-gap)';
    host.append(nav);
    this.#content.append(host);
    try {
      const columns = Number(config.settings.gridColumns);
      const cell = host.getBoundingClientRect().width / columns;
      const gap = Number.parseFloat(nav.ownerDocument.defaultView.getComputedStyle(nav).marginRight);
      if (!Number.isFinite(cell) || cell <= 0 || !Number.isFinite(gap)) {
        throw new Error('Navigationsgröße konnte nicht gemessen werden');
      }
      const required = measureSchema5Navigation(nav);
      const items = schema5GridItems(config, pageId);
      const item = items.find((entry) => entry.id === '__nav');
      item.w = Math.min(columns, Math.max(1, Math.ceil((required.width + gap) / cell)));
      item.h = Math.max(1, Math.ceil((required.height + gap) / cell));
      item.x = Math.min(item.x, columns - item.w);
      return applySchema5GridItems(config, pageId, items);
    } finally {
      host.remove();
    }
  }

  #restoreAppearance() {
    if (!this.#appearance) return;
    for (const [name, value] of this.#appearance) {
      if (value === null) document.documentElement.removeAttribute(name);
      else document.documentElement.setAttribute(name, value);
    }
    this.#appearance = null;
  }

  stop() {
    if (!this.#active) return;
    this.#active = false;
    this.#generation += 1;
    this.#devicePreview?.destroy();
    this.#devicePreview = null;
    this.#browser.removeEventListener('pagehide', this.#onHide);
    this.#browser.removeEventListener('pageshow', this.#onShow);
    this.#browser.removeEventListener('pointerdown', this.#onPointer);
    if (this.#view) this.#view.stop();
    if (this.#panel) this.#panel.suspend();
    this.#view = null;
    this.#panel = null;
    this.#root.replaceChildren();
    this.#restoreAppearance();
  }
}
