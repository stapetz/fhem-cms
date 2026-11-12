export const LINK_COLUMNS = 12;
export const MAX_LINKS = 200;
export const LINK_MEDIA = /^media\/[0-9a-f]{32}\.(?:png|jpg|gif)$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const EXTERNAL = /^https?:\/\/(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])(?::([0-9]{1,5}))?(?:[/?#][A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*)?$/;

export function validLinkUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  const match = EXTERNAL.exec(value);
  return Boolean(match && (!match[1] || (Number(match[1]) >= 1 && Number(match[1]) <= 65535)));
}

export function validateLinkItems(links, pages) {
  if (!Array.isArray(links) || links.length < 1 || links.length > MAX_LINKS) {
    throw new Error(`Ein LinkWidget benötigt 1 bis ${MAX_LINKS} Links`);
  }
  const ids = new Set();
  const placed = [];
  for (const link of links) {
    if (!link || typeof link !== 'object' || Array.isArray(link)) throw new Error('Ungültiger Link');
    const required = ['id', 'kind', 'text', 'showText', 'textPosition', 'target', 'grid',
      link.kind === 'internal' ? 'page' : link.kind === 'asset' ? 'asset' : 'url'];
    const keys = new Set([...required, 'image', ...(link.kind === 'internal' ? ['targetMode', 'modalSize'] : [])]);
    if (required.some(key => !Object.hasOwn(link, key)) || Object.keys(link).some(key => !keys.has(key))) {
      throw new Error('Fehlendes oder unbekanntes Linkfeld');
    }
    if (typeof link.id !== 'string' || !ID.test(link.id) || ids.has(link.id)) throw new Error('Ungültige oder doppelte Link-ID');
    ids.add(link.id);
    if (typeof link.text !== 'string' || !link.text.trim() || [...link.text].length > 128 || /[\x00-\x1f\x7f]/.test(link.text)) {
      throw new Error('Linktext muss 1 bis 128 Zeichen enthalten');
    }
    if (typeof link.showText !== 'boolean' || !['above', 'overlay', 'below'].includes(link.textPosition)) {
      throw new Error('Ungültige Linktext-Darstellung');
    }
    if (link.kind === 'internal') {
      if (typeof link.page !== 'string' || !ID.test(link.page) || !pages.some(page => page.id === link.page)) {
        throw new Error('Link verweist auf eine unbekannte CMS-Seite');
      }
      if (link.target !== 'self') throw new Error('Interne Links öffnen immer im selben Fenster');
      if (Object.hasOwn(link, 'targetMode') && !['page', 'modal'].includes(link.targetMode)) {
        throw new Error('Ungültiger Öffnungsmodus');
      }
      if (Object.hasOwn(link, 'modalSize') && (!['sm', 'md', 'lg'].includes(link.modalSize)
        || link.targetMode !== 'modal')) throw new Error('Ungültige Popupgröße');
    } else if (link.kind === 'asset') {
      if (typeof link.asset !== 'string' || !ASSET_DOCUMENT.test(link.asset)
        || !['self', 'tab', 'window'].includes(link.target)) throw new Error('Ungültiger Dokumentlink');
    } else if (link.kind !== 'external' || !validLinkUrl(link.url) || !['self', 'tab', 'window'].includes(link.target)) {
      throw new Error('Externe Links benötigen eine gültige HTTP(S)-URL und ein gültiges Ziel');
    }
    if (Object.hasOwn(link, 'image') && (typeof link.image !== 'string' || !LINK_MEDIA.test(link.image))) {
      throw new Error('Ungültiges Linkbild');
    }
    const grid = link.grid;
    if (!grid || typeof grid !== 'object' || Array.isArray(grid)
      || Object.keys(grid).sort().join(',') !== 'col,h,row,w'
      || Object.values(grid).some(value => !Number.isInteger(value) || value < 1)
      || grid.col + grid.w > LINK_COLUMNS + 1 || grid.row + grid.h > 1001) {
      throw new Error('Ungültiges Linkraster (12 Spalten, höchstens 1000 Zeilen)');
    }
    if (placed.some(other => grid.col < other.col + other.w && other.col < grid.col + grid.w
      && grid.row < other.row + other.h && other.row < grid.row + grid.h)) {
      throw new Error('Linkkacheln dürfen sich nicht überlappen');
    }
    placed.push(grid);
  }
}

export function linkHref(link) {
  if (link.kind === 'internal' && typeof link.page === 'string' && ID.test(link.page)) return `#/${link.page}`;
  if (link.kind === 'asset' && typeof link.asset === 'string' && ASSET_DOCUMENT.test(link.asset)) return link.asset;
  if (link.kind === 'external' && validLinkUrl(link.url)) return link.url;
  throw new Error('Ungültiges Linkziel');
}

export function linkBounds(links) {
  const col = Math.min(...links.map(link => link.grid.col));
  const row = Math.min(...links.map(link => link.grid.row));
  return { col, row,
    w: Math.max(...links.map(link => link.grid.col + link.grid.w)) - col,
    h: Math.max(...links.map(link => link.grid.row + link.grid.h)) - row };
}

export function fitLinkWidget(widget, columns, pages, previous = null) {
  validateLinkItems(widget.links, pages);
  if (![12, 24, 48, 96, 192].includes(columns)) throw new Error('Ungültige Rasterdichte');
  const bounds = linkBounds(widget.links);
  const height = bounds.h + (widget.title && widget.showTitle !== false ? 1 : 0);
  let widthScale = columns / LINK_COLUMNS;
  let heightScale = widthScale;
  if (previous) {
    validateLinkItems(previous.links, pages);
    const before = linkBounds(previous.links);
    widthScale = previous.grid.w / before.w;
    heightScale = previous.grid.h / (before.h + (previous.title && previous.showTitle !== false ? 1 : 0));
  }
  const result = structuredClone(widget);
  result.grid.w = Math.max(1, Math.round(bounds.w * widthScale));
  result.grid.h = Math.max(1, Math.round(height * heightScale));
  if (result.grid.col + result.grid.w > columns + 1 || result.grid.row + result.grid.h > 1001) {
    throw new Error('Die Linkkacheln benötigen mehr Platz als am Widgetstandort verfügbar. Widget zuerst verschieben oder Linkraster verkleinern.');
  }
  return result;
}
import { ASSET_DOCUMENT } from './asset-contract.js';
