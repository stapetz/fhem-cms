import { deviceSize } from './device-preview.js';
import { schema5GridItems } from './fcui-schema5-layout.js';
import { schema5PageBackground, setLiquidAppearance } from './fcui-schema5-appearance.js';

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
    const size = deviceSize('iphone-se', true);
    this.frame.style.width = `${size.width}px`;
    this.frame.style.height = `${size.height}px`;
    const url = new URL(browser.location.href);
    url.search = '?mode=preview&cms-device=mobile&cms-page-settings-preview=1';
    url.hash = `#/${pageId}`;
    this.frame.src = url.href;
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
    this.timeout = browser.setTimeout(() => {
      if (!this.closed && !this.ready) {
        this.status.textContent = 'Seitenvorschau konnte nicht geladen werden.';
        this.status.setAttribute('data-error', '');
      }
    }, 15000);
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this.stage);
    this.width = size.width;
    this.height = size.height;
  }

  fit() {
    const scale = Math.min(1, this.stage.clientWidth / this.width);
    this.frame.style.transform = `scale(${scale})`;
    this.stage.style.height = `${this.height * scale}px`;
  }

  update(config) {
    this.config = config;
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
        if (view.current !== pageId || view.config.settings.gridColumns !== config.settings.gridColumns) {
          view.clearPage();
          view.config = config;
          await view.showPage(pageId);
        } else {
          view.config = config;
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
