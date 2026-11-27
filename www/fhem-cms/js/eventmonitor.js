import { FhemClient, isValidName } from './fhem-client.js';
import { EventMonitor } from './event-monitor.js';
import { applyCmsAdminAppearance } from './cms-admin-link.js';
import { installCloseStyles, styleCloseButton, requestWindowClose } from './close-button.js?v=1.41.0-dev-3';

export async function initializeEventMonitor(root, {
  Client = FhemClient,
  location = window.location,
  browser = window,
} = {}) {
  const status = root.querySelector('[data-connection]');
  const params = new URLSearchParams(location.search);
  const cmsDevice = params.get('device') || '';
  const embedded = params.get('embedded') === '1';
  const closeButton = root.querySelector('[data-close]');
  const closeStatus = root.querySelector('[data-close-status]');
  installCloseStyles(root.ownerDocument.head);
  styleCloseButton(closeButton, 'Fenster schließen');
  closeButton.hidden = embedded;
  const closeWindow = () => {
    if (embedded) browser.parent.postMessage('cms-eventmonitor-close', browser.location.origin);
    else requestWindowClose(browser, text => { closeStatus.textContent = text; });
  };
  closeButton.addEventListener('click', closeWindow);
  let closed = false;
  let monitor;
  const onKeydown = (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      closeWindow();
    }
  };
  const onPageHide = () => {
    closed = true;
    monitor?.stop();
    browser.removeEventListener('keydown', onKeydown);
    closeButton.removeEventListener('click', closeWindow);
  };
  browser.addEventListener('keydown', onKeydown);
  browser.addEventListener('pagehide', onPageHide, { once: true });
  browser.addEventListener('pageshow', (event) => {
    if (event.persisted) browser.location.reload();
  });
  if (!isValidName(cmsDevice)) {
    throw new Error('CMS-Device fehlt oder ist ungültig.');
  }
  applyCmsAdminAppearance(root.ownerDocument.documentElement, location.hash || '');

  const cmsPage = new URL(`${encodeURIComponent(cmsDevice)}/index.html`, location.href);
  const endpoint = new URL('../../', cmsPage);
  if (embedded) root.dataset.embedded = '';
  root.querySelector('[data-device]').textContent = cmsDevice;
  status.textContent = 'Geräteliste wird geladen …';

  const client = new Client(cmsDevice, endpoint);
  const devices = await client.jsonlist('.*');
  if (closed) return null;
  monitor = new EventMonitor(root, client, devices.map((device) => device.name)).start();
  return monitor;
}

const root = typeof document === 'undefined'
  ? null
  : document.querySelector('[data-eventmonitor-app]');
if (root) {
  initializeEventMonitor(root).catch((error) => {
    const status = root.querySelector('[data-connection]');
    status.dataset.state = 'error';
    status.textContent = error instanceof Error ? error.message : String(error);
    root.querySelector('[data-empty]').textContent = 'Ereignisliste konnte nicht geladen werden.';
  });
}
