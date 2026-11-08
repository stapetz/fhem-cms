import { Schema5GridPanel } from './fcui-schema5-grid-panel.js';
import { Schema5PagesPanel } from './fcui-schema5-pages.js';
import { Schema5View } from './fcui-schema5-view.js';
import { Schema5WidgetPanel } from './fcui-schema5-widget-panel.js';
import { Schema5NavigationPanel } from './fcui-schema5-navigation.js';
import { Schema5SettingsPanel } from './fcui-schema5-settings.js';
import { Schema5DraftController } from './fcui-schema5-draft.js';
import { createSchema5Transport } from './fcui-schema5-transport.js';
import { createSchema5WidgetServices } from './widget-services.js';

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
  #edit;
  #mode;
  #pages;
  #widgets;
  #navigation;
  #settings;
  #publish;
  #discard;
  #reloadButton;
  #status;
  #content;
  #view = null;
  #panel = null;
  #active = false;
  #generation = 0;
  #suspended = false;
  #appearance = null;

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
    this.#controller = controller;
    this.#client = client;
    this.#services = {
      ...services,
      setCommand: async () => { throw new Error('Geräteaktionen sind im Bearbeitungsmodus deaktiviert'); },
      setTarget: async () => { throw new Error('Geräteaktionen sind im Bearbeitungsmodus deaktiviert'); },
    };
    this.#browser = browser;
    this.#toolbar = document.createElement('div');
    this.#edit = document.createElement('button');
    this.#edit.type = 'button';
    this.#edit.textContent = 'Raster bearbeiten';
    this.#edit.disabled = true;
    this.#toolbar.append(this.#edit);
    this.#mode = document.createElement('span');
    this.#toolbar.append(this.#mode);
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
    this.#toolbar.append(this.#publish, this.#discard, this.#reloadButton);
    this.#pages = document.createElement('button');
    this.#pages.type = 'button';
    this.#pages.textContent = 'Seiten verwalten';
    this.#toolbar.append(this.#pages);
    this.#widgets = document.createElement('button');
    this.#widgets.type = 'button';
    this.#widgets.textContent = 'Widgets bearbeiten';
    this.#toolbar.append(this.#widgets);
    this.#navigation = document.createElement('button');
    this.#navigation.type = 'button';
    this.#navigation.textContent = 'Navigation bearbeiten';
    this.#toolbar.append(this.#navigation);
    this.#settings = document.createElement('button');
    this.#settings.type = 'button';
    this.#settings.textContent = 'Darstellung einstellen';
    this.#toolbar.append(this.#settings);
    this.#setActions(false, false);
    this.#status = document.createElement('p');
    this.#status.setAttribute('role', 'status');
    this.#content = document.createElement('div');
    this.#edit.addEventListener('click', () => this.#openGrid());
    this.#pages.addEventListener('click', () => this.#openPages());
    this.#widgets.addEventListener('click', () => this.#openWidgets());
    this.#navigation.addEventListener('click', () => this.#openNavigation());
    this.#settings.addEventListener('click', () => this.#openSettings());
    this.#publish.addEventListener('click', () => this.#draftAction('publish'));
    this.#discard.addEventListener('click', () => this.#draftAction('discard'));
    this.#reloadButton.addEventListener('click', () => this.#reload().catch((error) => this.#error(error)));
  }

  #setActions(enabled, hasDraft) {
    this.#edit.disabled = !enabled;
    this.#pages.disabled = !enabled;
    this.#widgets.disabled = !enabled;
    this.#navigation.disabled = !enabled;
    this.#settings.disabled = !enabled;
    this.#publish.disabled = !enabled || !hasDraft;
    this.#discard.disabled = !enabled || !hasDraft;
  }

  #onHide = () => {
    if (!this.#active || this.#suspended) return;
    this.#suspended = true;
    this.#generation += 1;
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
    this.#appearance = ['data-cms-theme', 'data-cms-frames'].map((name) =>
      [name, document.documentElement.getAttribute(name)]);
    this.#root.append(this.#toolbar, this.#status, this.#content);
    this.#browser.addEventListener('pagehide', this.#onHide);
    this.#browser.addEventListener('pageshow', this.#onShow);
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
    if (this.#view) this.#view.stop();
    const config = state.draft || state.live;
    document.documentElement.setAttribute('data-cms-theme', config.theme === 'light' ? 'light' : 'dark');
    document.documentElement.setAttribute('data-cms-frames', config.settings?.showFrames === false ? 'off' : 'on');
    this.#mode.textContent = state.draft ? 'Entwurf' : 'Live';
    this.#content.replaceChildren();
    const grid = document.createElement('div');
    grid.className = 'grid-stack cms-schema5-grid';
    this.#content.append(grid);
    const view = new Schema5View({ GridStack: this.#GridStack, root: grid, status: this.#status,
      config, client: this.#client, services: this.#services, browser: this.#browser });
    this.#view = view;
    await view.start();
    if (this.#active && !this.#suspended && generation === this.#generation && this.#view === view) {
      this.#setActions(true, state.draft !== null);
      this.#reloadButton.hidden = true;
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

  #openGrid() {
    if (!this.#active || this.#suspended || !this.#view || this.#edit.disabled) return;
    try {
      const pageId = this.#view.current;
      const state = this.#controller.snapshot();
      this.#generation += 1;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      const container = document.createElement('section');
      this.#content.append(container);
      this.#panel = new Schema5GridPanel({
        GridStack: this.#GridStack, root: container, controller: this.#controller, pageId, token: state.token,
        onSaved: (result) => {
          this.#panel = null;
          this.#display(result, this.#generation).catch((error) => this.#error(error));
        },
        onCancel: ({ requiresReload }) => {
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

  #openPages() {
    if (!this.#active || this.#suspended || !this.#view || this.#pages.disabled) return;
    try {
      const state = this.#controller.snapshot();
      this.#generation += 1;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      const container = document.createElement('section');
      this.#content.append(container);
      this.#panel = new Schema5PagesPanel({
        root: container, controller: this.#controller, token: state.token, browser: this.#browser,
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

  #openWidgets() {
    if (!this.#active || this.#suspended || !this.#view || this.#widgets.disabled) return;
    try {
      const pageId = this.#view.current;
      const state = this.#controller.snapshot();
      this.#generation += 1;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      const container = document.createElement('section');
      this.#content.append(container);
      this.#panel = new Schema5WidgetPanel({
        root: container, controller: this.#controller, services: this.#services, pageId, token: state.token,
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
    if (!this.#active || this.#suspended || !this.#view || this.#navigation.disabled) return;
    try {
      const state = this.#controller.snapshot();
      this.#generation += 1;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      const container = document.createElement('section');
      this.#content.append(container);
      this.#panel = new Schema5NavigationPanel({
        root: container, controller: this.#controller, token: state.token, browser: this.#browser,
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

  #openSettings() {
    if (!this.#active || this.#suspended || !this.#view || this.#settings.disabled) return;
    try {
      const state = this.#controller.snapshot();
      this.#generation += 1;
      this.#setActions(false, false);
      this.#view.stop();
      this.#view = null;
      this.#content.replaceChildren();
      const container = document.createElement('section');
      this.#content.append(container);
      this.#panel = new Schema5SettingsPanel({
        root: container, controller: this.#controller, token: state.token, browser: this.#browser,
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
    this.#browser.removeEventListener('pagehide', this.#onHide);
    this.#browser.removeEventListener('pageshow', this.#onShow);
    if (this.#view) this.#view.stop();
    if (this.#panel) this.#panel.suspend();
    this.#view = null;
    this.#panel = null;
    this.#root.replaceChildren();
    this.#restoreAppearance();
  }
}
