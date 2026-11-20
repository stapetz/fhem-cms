export const isFreeform = page => page?.layoutMode === 'freeform';
export const DEFAULT_CANVAS = Object.freeze({width: 1280, height: 800, scaling: 'fit', snapGrid: 5, mobileBehavior: 'stack'});

export function syncSharedFreeformSize(config) {
  if (config.settings.sharedFreeformSize !== true) return;
  const [start, ...pages] = config.pages;
  if (!isFreeform(start)) {
    delete config.settings.sharedFreeformSize;
    return;
  }
  const {width, height} = start.canvas;
  for (const page of pages) {
    if (isFreeform(page) && (page.canvas.width !== width || page.canvas.height !== height)) {
      resizeFreeformPage(page, width, height);
    }
  }
}

function integer(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function keys(value, required, optional = []) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

export function validateFreeformCanvas(canvas) {
  if (!keys(canvas, ['width', 'height'], ['scaling', 'snapGrid', 'mobileBehavior'])
    || !integer(canvas.width, 200, 7680) || !integer(canvas.height, 200, 7680)
    || !['fit', 'width', 'none'].includes(canvas.scaling === undefined ? 'fit' : canvas.scaling)
    || ![1, 5, 10].includes(canvas.snapGrid === undefined ? 5 : canvas.snapGrid)
    || !['stack', 'scale'].includes(canvas.mobileBehavior === undefined ? 'stack' : canvas.mobileBehavior)) {
    throw new Error('Ungültige Freeform-Canvas-Einstellungen');
  }
}

export function validateFreeformWidget(widget, canvas) {
  const { rect, hideOnMobile } = widget;
  if (!keys(rect, ['x', 'y', 'w', 'h'], ['z'])
    || !integer(rect.x, 0, canvas.width) || !integer(rect.y, 0, canvas.height)
    || !integer(rect.w, 10, canvas.width) || !integer(rect.h, 10, canvas.height)
    || rect.x + rect.w > canvas.width || rect.y + rect.h > canvas.height
    || !integer(rect.z === undefined ? 1 : rect.z, 0, 9999)) {
    throw new Error(`Ungültige Freeform-Geometrie: ${widget.id}`);
  }
  if (hideOnMobile !== undefined && typeof hideOnMobile !== 'boolean') {
    throw new Error('Ungültige Einstellung für die mobile Sichtbarkeit');
  }
}

export function freeformScale(canvas, width, height) {
  if (canvas.scaling === 'none') return 1;
  const byWidth = width / canvas.width;
  return canvas.scaling === 'width' ? byWidth : Math.min(byWidth, height / canvas.height);
}

const clamp = (n, low, high) => Math.min(high, Math.max(low, Math.round(n)));

export function fitFreeformRect(rect, canvas) {
  const w = clamp(rect.w, 10, canvas.width);
  const h = clamp(rect.h, 10, canvas.height);
  return {...rect, x: clamp(rect.x, 0, canvas.width - w), y: clamp(rect.y, 0, canvas.height - h), w, h};
}

export function resizeFreeformPage(page, width, height) {
  if (!isFreeform(page) || !Array.isArray(page.widgets)) throw new Error('Freeform-Seite für Größenänderung erforderlich');
  validateFreeformCanvas(page.canvas);
  const canvas = {...page.canvas, width, height};
  validateFreeformCanvas(canvas);
  const scaleRect = rect => fitFreeformRect({
    ...rect,
    x: Math.round(rect.x * width / page.canvas.width),
    y: Math.round(rect.y * height / page.canvas.height),
    w: Math.round(rect.w * width / page.canvas.width),
    h: Math.round(rect.h * height / page.canvas.height),
  }, canvas);
  for (const widget of page.widgets) {
    widget.rect = scaleRect(widget.rect);
    validateFreeformWidget(widget, canvas);
  }
  if (page.navigationRect !== undefined) {
    page.navigationRect = scaleRect(page.navigationRect);
    validateFreeformWidget({id: 'navigation', rect: page.navigationRect}, canvas);
  }
  page.canvas = canvas;
  return page;
}

export function freeformStartRect(widget, index, canvas, columns, measured) {
  if (measured && measured.w > 0 && measured.h > 0) return fitFreeformRect({...measured, z: 1}, canvas);
  if (widget.grid) {
    const unit = canvas.width / columns;
    const { col, row, w, h } = widget.grid;
    return fitFreeformRect({x: (col - 1) * unit, y: (row - 1) * unit, w: w * unit, h: h * unit, z: 1}, canvas);
  }
  return fitFreeformRect({x: (index * 24) % canvas.width, y: (index * 24) % canvas.height, w: 240, h: 140, z: 1}, canvas);
}

export function freeformReadingOrder(widgets) {
  const byY = [...widgets].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const rows = [];
  for (const widget of byY) {
    const row = rows.at(-1);
    if (row && widget.rect.y - row[0].rect.y <= 30) row.push(widget);
    else rows.push([widget]);
  }
  return rows.flatMap(row => row.sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y));
}
