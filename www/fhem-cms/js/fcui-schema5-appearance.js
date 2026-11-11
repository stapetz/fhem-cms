import { ASSET_IMAGE } from './asset-contract.js';

export const LIQUID_DEFAULTS = { liquidIntensity: 47, liquidTransparency: 12 };

export function setLiquidAppearance(element, settings = {}) {
  const intensity = settings.liquidIntensity === undefined ? LIQUID_DEFAULTS.liquidIntensity : settings.liquidIntensity;
  const transparency = settings.liquidTransparency === undefined ? LIQUID_DEFAULTS.liquidTransparency : settings.liquidTransparency;
  if (![intensity, transparency].every((value) => Number.isInteger(value) && value >= 0 && value <= 100)) {
    throw new Error('Ungültige Liquid-Glass-Einstellungen');
  }
  element.style.setProperty('--cms-liquid-blur', `${intensity * 0.3}px`);
  element.style.setProperty('--cms-liquid-gloss', String(intensity * 0.002));
  element.style.setProperty('--cms-liquid-opacity', String(1 - transparency / 100));
}

export function schema5PageBackground(config, pageId) {
  const page = config.pages.find((entry) => entry.id === pageId);
  if (!page) throw new Error('Unbekannte Seite');
  const background = config.settings?.sharedBackground === true ? config.pages[0].background : page.background;
  if (background !== undefined && (typeof background !== 'string' || !ASSET_IMAGE.test(background))) {
    throw new Error('Ungültiges Hintergrundbild');
  }
  return config.theme === 'liquid-glass' ? background || '' : '';
}
