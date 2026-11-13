import { schema5GridItems } from './fcui-schema5-layout.js';
import { Schema5LivePage } from './fcui-schema5-live.js';
import { mountSchema5Widgets } from './fcui-schema5-widgets.js';
import { observeSchema5Navigation } from './fcui-schema5-navigation-fit.js';
import { schema5PageBackground, setLiquidAppearance } from './fcui-schema5-appearance.js';

export class Schema5View {
  constructor({ GridStack, root, status, config, client, services, browser = window, editing }) {
    if (!GridStack || !root || !status || !config || !client || !services || !browser
      || typeof browser.addEventListener !== 'function' || typeof browser.removeEventListener !== 'function') {
      throw new Error('Ungültige Dienste für die Schema-5-Ansicht');
    }
    this.GridStack = GridStack;
    this.root = root;
    this.status = status;
    this.config = config;
    this.client = client;
    this.services = services;
    this.browser = browser;
    this.editing = editing;
    this.locked = false;
    this.current = null;
    this.live = null;
    this.view = null;
    this.stopNavigation = null;
    this.modal = null;
    this.generation = 0;
    this.active = false;
    this.suspended = false;
    this.onHashChange = () => {
      if (this.suspended || this.locked) return;
      this.showPage(this.pageFromHash()).catch((error) => this.showError(error));
    };
    this.onPageHide = () => {
      if (!this.active || this.suspended) return;
      this.suspended = true;
      this.clearPage();
    };
    this.onPageShow = (event) => {
      if (!this.active || !this.suspended || !event.persisted) return;
      this.browser.location.reload();
    };
  }

  pageFromHash() {
    const match = /^#\/([A-Za-z0-9_-]{1,64})$/.exec(this.browser.location.hash);
    return match && this.config.pages.some((page) => page.id === match[1])
      ? match[1] : this.config.pages[0].id;
  }

  setStatus(message, error = false) {
    this.status.textContent = message;
    if (error) this.status.setAttribute('data-error', '');
    else this.status.removeAttribute('data-error');
  }

  showError(error) {
    if (!this.active) return;
    this.setStatus(`Seite konnte nicht angezeigt werden: ${error.message || String(error)}`, true);
  }

  async start() {
    if (this.active) throw new Error('Schema-5-Ansicht ist bereits gestartet');
    schema5GridItems(this.config, this.config.pages?.[0]?.id);
    this.active = true;
    this.suspended = false;
    this.browser.addEventListener('hashchange', this.onHashChange);
    this.browser.addEventListener('pagehide', this.onPageHide);
    this.browser.addEventListener('pageshow', this.onPageShow);
    try {
      await this.showPage(this.pageFromHash());
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  navigation(pageId, config = this.config, editing = this.editing) {
    const nav = document.createElement('nav');
    nav.className = 'cms-nav';
    nav.classList.toggle('is-vertical', config.navigation.orientation === 'vertical');
    nav.setAttribute('aria-label', 'Seiten');
    const burger = document.createElement('button');
    burger.type = 'button';
    burger.className = 'cms-nav-burger';
    burger.textContent = '☰';
    burger.title = 'Navigation anzeigen';
    burger.setAttribute('aria-label', 'Navigation anzeigen');
    burger.setAttribute('aria-expanded', 'false');
    burger.addEventListener('click', () => {
      const open = nav.toggleAttribute('data-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.append(burger);
    for (const page of config.pages) {
      const item = (config.navigation.items || []).find((entry) => entry.page === page.id) || {};
      if (item.hidden === true && !editing) continue;
      const link = document.createElement('a');
      link.className = 'cms-nav-link';
      if (item.hidden === true) link.classList.add('cms-nav-hiddenpage');
      link.href = `#/${page.id}`;
      link.textContent = item.label || page.title;
      const width = config.navigation.itemWidth || item.width;
      const height = config.navigation.itemHeight || item.height;
      if (width) link.style.width = `min(calc(var(--cms-view-width) * ${Number(width) / 1200}), 100%)`;
      if (height) link.style.height = `calc(var(--cms-view-width) * ${Number(height) / 1200})`;
      if (page.id === pageId) link.setAttribute('aria-current', 'page');
      nav.append(link);
    }
    return nav;
  }

  async showPage(pageId) {
    if (!this.active || this.suspended) throw new Error('Schema-5-Ansicht ist nicht aktiv');
    schema5GridItems(this.config, pageId);
    if (pageId === this.current) return;
    const generation = ++this.generation;
    this.closeModal(false);
    if (this.live) this.live.stop();
    this.stopNavigation?.();
    this.stopNavigation = null;
    if (this.view) this.view.destroy();
    this.live = null;
    this.view = null;
    this.current = null;
    this.setStatus('Seite wird geladen …');
    try {
      const page = this.config.pages.find((entry) => entry.id === pageId);
      const background = schema5PageBackground(this.config, pageId);
      const image = background
        ? `url("${new URL(background, this.browser.location.href).href}")` : 'none';
      document.documentElement.style.setProperty('--cms-page-image', image);
      setLiquidAppearance(document.documentElement, this.config.settings);
      const navigation = this.navigation(pageId);
      const services = { ...this.services, openPageModal: (id, size) => this.openModal(id, size) };
      this.view = mountSchema5Widgets(this.GridStack, this.root, this.config, pageId,
        navigation, services, new Map(), this.editing && {
          onChange: (items) => this.editing.onChange(pageId, items),
          onEdit: (id) => this.editing.onEdit(pageId, id),
          onMove: typeof this.editing.onMove === 'function'
            ? (id) => this.editing.onMove(pageId, id) : undefined,
          onDuplicate: typeof this.editing.onDuplicate === 'function'
            ? (id) => this.editing.onDuplicate(pageId, id) : undefined,
          onDelete: typeof this.editing.onDelete === 'function'
            ? (id) => this.editing.onDelete(pageId, id) : undefined,
        });
      this.stopNavigation = observeSchema5Navigation(navigation,
        () => Boolean(this.editing) || getComputedStyle(this.root).display !== 'flex');
      const view = this.view;
      this.live = new Schema5LivePage(this.client, page.widgets,
        (snapshots, stale) => {
          view.update(snapshots, stale);
          this.modal?.view.update(snapshots, stale);
        },
        ({ connection, error, lastSuccess }) => {
          if (!this.active || generation !== this.generation) return;
          if (error) {
            const since = lastSuccess === null ? '' : ` · Anzeige veraltet seit ${new Date(lastSuccess).toLocaleTimeString('de-DE')}`;
            this.setStatus(`Daten nicht verfügbar: ${error}${since}`, true);
          } else {
            this.setStatus(`Konfiguration geladen · ${connection === 'live' ? 'Live-Updates aktiv' : 'Aktualisierung alle 30 s'}`);
          }
        });
      this.current = pageId;
      await this.live.start();
    } catch (error) {
      if (generation !== this.generation || !this.active) return;
      if (this.live) this.live.stop();
      this.stopNavigation?.();
      this.stopNavigation = null;
      if (this.view) this.view.destroy();
      this.live = null;
      this.view = null;
      this.current = null;
      throw error;
    }
  }

  async openModal(pageId, size = 'md') {
    if (!this.active || this.suspended || !this.live || !this.current) throw new Error('Seitenansicht ist nicht aktiv');
    if (this.modal) throw new Error('Bitte das geöffnete Popup zuerst schließen.');
    if (!['sm', 'md', 'lg'].includes(size)) throw new Error('Ungültige Popupgröße');
    schema5GridItems(this.config, pageId);
    const page = this.config.pages.find(entry => entry.id === pageId);
    const originalFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'cms-page-modal';
    dialog.dataset.size = size;
    dialog.setAttribute('aria-labelledby', 'cms-modal-title');
    const background = schema5PageBackground(this.config, pageId);
    if (background) dialog.style.backgroundImage = `url("${new URL(background, this.browser.location.href).href}")`;
    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.id = 'cms-modal-title'; title.textContent = page.title;
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = '×';
    close.setAttribute('aria-label', 'Popup schließen');
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);
    const shell = document.createElement('div'); shell.className = 'cms-shell';
    const workspace = document.createElement('div'); workspace.className = 'cms-schema5-workspace';
    const grid = document.createElement('div'); grid.className = 'grid-stack cms-schema5-grid';
    workspace.append(grid); shell.append(workspace); dialog.append(header, shell);
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (this.modal?.dialog === dialog) this.closeModal(true);
    });
    document.body.append(dialog);
    let view;
    try {
      const navigation = this.navigation(pageId, this.config, false);
      view = mountSchema5Widgets(this.GridStack, grid, this.config, pageId, navigation,
        { ...this.services, openPageModal: (id, nextSize) => this.openModal(id, nextSize) },
        this.live.snapshots);
      const stopNavigation = observeSchema5Navigation(navigation, () => getComputedStyle(grid).display !== 'flex');
      this.modal = { dialog, view, stopNavigation, originalFocus };
      dialog.showModal();
      close.focus();
      const current = this.config.pages.find(entry => entry.id === this.current);
      await this.live.setWidgets([...current.widgets, ...page.widgets]);
    } catch (error) {
      if (this.modal?.dialog === dialog) this.closeModal(true);
      else { view?.destroy(); dialog.remove(); }
      throw error;
    }
  }

  closeModal(restoreLive = true) {
    const modal = this.modal;
    if (!modal) return;
    this.modal = null;
    modal.stopNavigation();
    modal.view.destroy();
    if (modal.dialog.open) modal.dialog.close();
    modal.dialog.remove();
    modal.originalFocus?.focus?.();
    if (restoreLive && this.live && this.current && this.active && !this.suspended) {
      const page = this.config.pages.find(entry => entry.id === this.current);
      this.live.setWidgets(page.widgets).catch(error => this.showError(error));
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.browser.removeEventListener('hashchange', this.onHashChange);
    this.browser.removeEventListener('pagehide', this.onPageHide);
    this.browser.removeEventListener('pageshow', this.onPageShow);
    this.clearPage();
    document.documentElement.style.setProperty('--cms-page-image', 'none');
  }

  lock() {
    this.locked = true;
    this.view?.lock();
  }

  clearPage() {
    this.generation += 1;
    this.closeModal(false);
    if (this.live) this.live.stop();
    this.stopNavigation?.();
    this.stopNavigation = null;
    if (this.view) this.view.destroy();
    this.live = null;
    this.view = null;
    this.current = null;
  }
}
