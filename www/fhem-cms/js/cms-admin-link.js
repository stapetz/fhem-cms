import { openEmbeddedTool } from './embedded-tool-dialog.js';

const THEMES = new Set(['dark', 'light', 'liquid-glass', 'oled-black', 'catppuccin-mocha']);
const BACKGROUND = /^\/(?:[A-Za-z0-9_.-]+\/)*fhem-cms\/[A-Za-z0-9_.-]{1,128}\/media\/[0-9a-f]{32}\.(?:png|jpg|gif)$/;
const LIQUID = {
  blur: ['--cms-liquid-blur', 30, 'px'],
  gloss: ['--cms-liquid-gloss', 0.2, ''],
  opacity: ['--cms-liquid-opacity', 1, ''],
};

export function applyCmsAdminAppearance(root, hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.size) return;
  const theme = params.get('theme');
  if (!THEMES.has(theme)) throw new Error('Ungültiges Administrationstheme');
  const background = params.get('background');
  if (background && (!BACKGROUND.test(background) || background.split('/').some(part => part === '.' || part === '..'))) {
    throw new Error('Ungültiger Administrationshintergrund');
  }
  const values = [];
  for (const [key, [property, max, unit]] of Object.entries(LIQUID)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    const value = Number(raw);
    if (!/^\d+(?:\.\d+)?$/.test(raw) || value < 0 || value > max) {
      throw new Error('Ungültige Liquid-Glass-Darstellung');
    }
    values.push([property, `${value}${unit}`]);
  }
  root.setAttribute('data-cms-theme', theme);
  root.style.setProperty('--cms-page-image', background ? `url("${background}")` : 'none');
  for (const [property, value] of values) root.style.setProperty(property, value);
}

export function captureCmsAppearance(root, baseURI) {
  const params = new URLSearchParams({ theme: root.getAttribute('data-cms-theme') || 'dark' });
  const image = root.style.getPropertyValue('--cms-page-image').match(/^url\("([^"]+)"\)$/);
  if (image) {
    const url = new URL(image[1], baseURI);
    if (url.origin === new URL(baseURI).origin) params.set('background', url.pathname);
  }
  for (const [key, [property, , unit]] of Object.entries(LIQUID)) {
    const value = root.style.getPropertyValue(property).trim();
    if (value) params.set(key, unit ? value.replace(/px$/, '') : value);
  }
  return params.toString();
}

export function createCmsAdminLink() {
  const link = document.createElement('a');
  link.className = 'cms-button';
  link.href = '../admin.html';
  link.textContent = 'Globale FHEM-CMS Administration';
  link.target = '_blank';
  link.rel = 'noopener';
  link.setAttribute('aria-haspopup', 'dialog');
  link.addEventListener('click', event => {
    link.hash = captureCmsAppearance(document.documentElement, document.baseURI);
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const url = new URL(link.href, document.baseURI);
    url.searchParams.set('embedded', '1');
    url.hash = captureCmsAppearance(document.documentElement, document.baseURI);
    openEmbeddedTool({
      trigger: link, url, title: 'Globale FHEM-CMS Administration',
      frameTitle: 'Globale FHEM-CMS Administration', closeMessage: 'cms-admin-close',
      canClose: frame => {
        try {
          return typeof frame?.cmsAdminCloseStatus === 'function' ? frame.cmsAdminCloseStatus() : '';
        } catch {
          return 'Der Status der Administration konnte nicht geprüft werden. Bitte erneut versuchen.';
        }
      },
    });
  });
  return link;
}

export function createCmsAdminMenuLinks(client) {
  return client.adminMenuEnabled === true ? [createCmsAdminLink()] : [];
}
