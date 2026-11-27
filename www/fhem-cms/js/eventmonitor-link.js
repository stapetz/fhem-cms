import { openEmbeddedTool } from './embedded-tool-dialog.js';
import { captureCmsAppearance } from './cms-admin-link.js';

export function createEventMonitorLink(client) {
  if (!client || typeof client.cmsDevice !== 'string' || client.cmsDevice === '') return null;
  const link = document.createElement('button');
  link.type = 'button';
  link.setAttribute('aria-haspopup', 'dialog');
  link.className = 'cms-button';
  link.textContent = 'Eventmonitor';

  link.addEventListener('click', () => {
    const url = new URL('../eventmonitor.html', window.location.href);
    url.searchParams.set('device', client.cmsDevice);
    url.searchParams.set('embedded', '1');
    url.hash = captureCmsAppearance(document.documentElement, document.baseURI);

    openEmbeddedTool({ trigger: link, url, title: 'Live-Eventmonitor',
      frameTitle: 'Live-Ereignisse', closeMessage: 'cms-eventmonitor-close' });
  });

  return link;
}
