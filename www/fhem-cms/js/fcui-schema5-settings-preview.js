import { deviceSize, previewDeviceType } from './device-preview.js';
import { schema5GridItems } from './fcui-schema5-layout.js';
import { navigationStyle, schema5PageBackground, setLiquidAppearance } from './fcui-schema5-appearance.js';

const READY = 'fhem-cms-settings-preview-ready';
const UPDATE = 'fhem-cms-settings-preview-update';
const ERROR = 'fhem-cms-settings-preview-error';
const UPDATED = 'fhem-cms-settings-preview-updated';
const THEMES = ['dark', 'light', 'liquid-glass', 'oled-black', 'catppuccin-mocha'];

export class Schema5SettingsPreview {
  constructor({ browser, pageId }) {
    this.browser = browser;
    this.pageId = pageId;
    this.origin = new URL(browser.location.href).origin;
    this.ready = false;
    this.closed = false;
    this.element = document.createElement('section');
    this.element.className = 'cms-settings-preview';
    const heading = document.createElement('p');
    heading.textContent = 'Vorschau';
    this.status = document.createElement('p');
    this.status.setAttribute('role', 'status');
    this.status.textContent = 'Seitenvorschau wird geladen …';
    this.stage = document.createElement('div');
    this.stage.className = 'cms-settings-preview-stage';
    this.frame = document.createElement('iframe');
    this.frame.title = 'Vorschau der aktuellen Seite im Smartphone-Querformat';
    this.frame.inert = true;
    this.frame.tabIndex = -1;
    this.stage.append(this.frame);
    this.element.append(heading, this.stage, this.status);
    this.onMessage = (event) => {
      if (this.closed || event.origin !== this.origin || event.source !== this.frame.contentWindow) return;
      if (event.data?.type === READY) {
        this.ready = true;
        this.status.textContent = '';
        this.status.removeAttribute('data-error');
        browser.clearTimeout(this.timeout);
        this.send();
      } else if (event.data?.type === ERROR) {
        this.status.textContent = `Seitenvorschau nicht verfügbar: ${event.data.message}`;
        this.status.setAttribute('data-error', '');
      } else if (event.data?.type === UPDATED) {
        this.status.textContent = '';
        this.status.removeAttribute('data-error');
      }
    };
    browser.addEventListener('message', this.onMessage);
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this.stage);
  }

  fit() {
    if (!this.width) return;
    const scale = Math.min(1, this.stage.clientWidth / this.width, this.browser.innerHeight * 0.48 / this.height);
    this.frame.style.transform = `scale(${scale})`;
    this.stage.style.height = `${this.height * scale}px`;
  }

  update(config, preset) {
    this.config = config;
    const canvas = config.settings.pageCanvas ?? config.pages.find(page => page.id === this.pageId)?.canvas;
    const size = canvas ? deviceSize(preset, false) || canvas : deviceSize('iphone-se', true);
    const type = canvas ? previewDeviceType(preset) : 'mobile';
    this.width = size.width;
    this.height = size.height;
    this.frame.style.width = `${size.width}px`;
    this.frame.style.height = `${size.height}px`;
    this.frame.title = `Seitenvorschau (${size.width} × ${size.height} px)`;
    this.fit();
    if (type !== this.type) {
      this.type = type;
      this.ready = false;
      const url = new URL(this.browser.location.href);
      url.search = '?mode=preview&cms-page-settings-preview=1';
      url.searchParams.set('cms-device', type);
      url.hash = `#/${this.pageId}`;
      this.status.textContent = 'Seitenvorschau wird geladen …';
      this.status.removeAttribute('data-error');
      this.browser.clearTimeout(this.timeout);
      this.timeout = this.browser.setTimeout(() => {
        this.status.textContent = 'Seitenvorschau konnte nicht geladen werden.';
        this.status.setAttribute('data-error', '');
      }, 15000);
      this.frame.src = url.href;
    }
    this.send();
  }

  send() {
    if (this.closed || !this.ready || !this.config) return;
    this.frame.contentWindow.postMessage({ type: UPDATE, pageId: this.pageId, config: this.config }, this.origin);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.browser.clearTimeout(this.timeout);
    this.browser.removeEventListener('message', this.onMessage);
    this.observer.disconnect();
    this.frame.remove();
  }
}

export function listenForSettingsPreview({ view, browser = window }) {
  const origin = new URL(browser.location.href).origin;
  let pending;
  let running = false;
  let closed = false;
  const report = error => browser.parent.postMessage({
    type: ERROR, message: error.message || String(error),
  }, origin);
  const apply = async () => {
    if (running) return;
    running = true;
    try {
      while (pending && !closed) {
        const { config, pageId } = pending;
        pending = null;
        schema5GridItems(config, pageId);
        if (!THEMES.includes(config.theme || 'dark')) throw new Error('Ungültiges Theme');
        const background = schema5PageBackground(config, pageId);
        const image = background ? `url("${new URL(background, browser.location.href).href}")` : 'none';
        const root = document.documentElement;
        root.setAttribute('data-cms-theme', config.theme || 'dark');
        root.setAttribute('data-cms-frames', config.settings.showFrames === false ? 'off' : 'on');
        root.style.setProperty('--cms-widget-title-align', config.settings.titleAlign || 'left');
        root.style.setProperty('--cms-page-image', image);
        setLiquidAppearance(root, config.settings);
        view.root.style.setProperty('--cms-widget-title-align', config.settings.titleAlign || 'left');
        const page = config.pages.find(entry => entry.id === pageId);
        const previous = view.config.pages.find(entry => entry.id === pageId);
        const sharedFrameChanged = ['pageCanvas', 'pageNavigationRect'].some(key =>
          JSON.stringify(view.config.settings[key]) !== JSON.stringify(config.settings[key]));
        const sharedBackgroundChanged = config.settings.pageCanvas && background !== schema5PageBackground(view.config, pageId);
        if (view.current !== pageId || view.config.settings.gridColumns !== config.settings.gridColumns
          || sharedFrameChanged || sharedBackgroundChanged
          || ((page?.layoutMode === 'freeform' || previous?.layoutMode === 'freeform')
            && (JSON.stringify(page) !== JSON.stringify(previous)
              || background !== schema5PageBackground(view.config, pageId)))) {
          view.clearPage();
          view.config = config;
          await view.showPage(pageId);
        } else {
          view.config = config;
          if (config.settings.pageCanvas || page?.layoutMode === 'freeform') root.style.setProperty('--cms-page-image', 'none');
        }
        for (const nav of view.root.querySelectorAll('.cms-nav')) {
          nav.setAttribute('data-nav-style', navigationStyle(config.navigation));
        }
        if (!pending && !closed) browser.parent.postMessage({ type: UPDATED }, origin);
      }
    } catch (error) {
      report(error);
    } finally {
      running = false;
      if (pending && !closed) void apply();
    }
  };
  const onMessage = event => {
    if (closed || event.origin !== origin || event.source !== browser.parent || event.data?.type !== UPDATE) return;
    pending = { config: event.data.config, pageId: event.data.pageId };
    void apply();
  };
  const close = () => {
    closed = true;
    browser.removeEventListener('message', onMessage);
    browser.removeEventListener('pagehide', close);
  };
  browser.addEventListener('message', onMessage);
  browser.addEventListener('pagehide', close);
  browser.parent.postMessage({ type: READY }, origin);
  return close;
}
