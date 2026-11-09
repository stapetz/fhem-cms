import { schema5GridItems } from './fcui-schema5-layout.js';
import { Schema5LivePage } from './fcui-schema5-live.js';
import { mountSchema5Widgets } from './fcui-schema5-widgets.js';
import { observeSchema5Navigation } from './fcui-schema5-navigation-fit.js';

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

  navigation(pageId) {
    const nav = document.createElement('nav');
    nav.className = 'cms-nav';
    nav.classList.toggle('is-vertical', this.config.navigation.orientation === 'vertical');
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
    for (const page of this.config.pages) {
      const item = (this.config.navigation.items || []).find((entry) => entry.page === page.id) || {};
      if (item.hidden === true && !this.editing) continue;
      const link = document.createElement('a');
      link.className = 'cms-nav-link';
      if (item.hidden === true) link.classList.add('cms-nav-hiddenpage');
      link.href = `#/${page.id}`;
      link.textContent = item.label || page.title;
      const width = this.config.navigation.itemWidth || item.width;
      const height = this.config.navigation.itemHeight || item.height;
      // Feste Größen gelten als Maximum und schrumpfen mit der Kachel mit.
      if (width) link.style.width = `min(${Number(width)}px, 100%)`;
      if (height) link.style.height = `min(${Number(height)}px, 100%)`;
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
      const navigation = this.navigation(pageId);
      this.view = mountSchema5Widgets(this.GridStack, this.root, this.config, pageId,
        navigation, this.services, new Map(), this.editing && {
          onChange: (items) => this.editing.onChange(pageId, items),
          onEdit: (id) => this.editing.onEdit(pageId, id),
          onMove: typeof this.editing.onMove === 'function'
            ? (id) => this.editing.onMove(pageId, id) : undefined,
        });
      this.stopNavigation = observeSchema5Navigation(navigation);
      const view = this.view;
      this.live = new Schema5LivePage(this.client, page.widgets,
        (snapshots, stale) => view.update(snapshots, stale),
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

  stop() {
    if (!this.active) return;
    this.active = false;
    this.browser.removeEventListener('hashchange', this.onHashChange);
    this.browser.removeEventListener('pagehide', this.onPageHide);
    this.browser.removeEventListener('pageshow', this.onPageShow);
    this.clearPage();
  }

  lock() {
    this.locked = true;
    this.view?.lock();
  }

  clearPage() {
    this.generation += 1;
    if (this.live) this.live.stop();
    this.stopNavigation?.();
    this.stopNavigation = null;
    if (this.view) this.view.destroy();
    this.live = null;
    this.view = null;
    this.current = null;
  }
}
