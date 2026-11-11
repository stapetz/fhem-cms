import { ASSET_IMAGE } from './asset-contract.js';

export function schema5PageBackground(config, pageId) {
  const page = config.pages.find((entry) => entry.id === pageId);
  if (!page) throw new Error('Unbekannte Seite');
  const background = config.settings?.sharedBackground === true ? config.pages[0].background : page.background;
  if (background !== undefined && (typeof background !== 'string' || !ASSET_IMAGE.test(background))) {
    throw new Error('Ungültiges Hintergrundbild');
  }
  return config.theme === 'liquid-glass' ? background || '' : '';
}
