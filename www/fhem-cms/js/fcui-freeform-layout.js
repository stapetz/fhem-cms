export const isFreeform = page => page?.layoutMode === 'freeform';
export const DEFAULT_CANVAS = Object.freeze({width: 1280, height: 800, scaling: 'fit', snapGrid: 5, mobileBehavior: 'stack'});

export function cmsPageCanvas(config) {
  const start = config.pages[0];
  return config.settings.pageCanvas ?? start.canvas
    ?? (config.pages.some(isFreeform) ? DEFAULT_CANVAS : undefined);
}

export function cmsPageNavigationRect(config) {
  return config.settings.pageCanvas ? config.settings.pageNavigationRect : config.pages[0].navigationRect;
}

export function applyCmsPageCanvas(config, canvas) {
  validateFreeformCanvas(canvas);
  const previous = cmsPageCanvas(config);
  const navigation = cmsPageNavigationRect(config);
  if (navigation && previous) config.settings.pageNavigationRect = scaleFreeformRect(navigation, previous, canvas);
  config.settings.pageCanvas = {...canvas};
  delete config.settings.sharedFreeformSize;
  for (const page of config.pages) {
    if (!isFreeform(page)) continue;
    if (page.canvas.width !== canvas.width || page.canvas.height !== canvas.height) {
      resizeFreeformPage(page, canvas.width, canvas.height);
    }
    page.canvas = {...canvas};
  }
}

export function scaleFreeformRect(rect, from, to) {
  return fitFreeformRect({
    ...rect, x: rect.x * to.width / from.width, y: rect.y * to.height / from.height,
    w: rect.w * to.width / from.width, h: rect.h * to.height / from.height,
  }, to);
}

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
  if (Object.hasOwn(widget, 'groupId')
    && (typeof widget.groupId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(widget.groupId))) {
    throw new Error('Ungültige Widget-Gruppe');
  }
}

export function freeformSelection(page, ids) {
  if (!isFreeform(page) || !Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) {
    throw new Error('Gültige Freeform-Auswahl erforderlich');
  }
  const selected = ids.map(id => page.widgets.find(widget => widget.id === id));
  if (selected.some(widget => !widget)) throw new Error('Unbekanntes Widget in der Auswahl');
  const groups = new Set(selected.map(widget => widget.groupId).filter(Boolean));
  return page.widgets.filter(widget => ids.includes(widget.id) || groups.has(widget.groupId));
}

export function freeformBounds(widgets) {
  const x = Math.min(...widgets.map(widget => widget.rect.x));
  const y = Math.min(...widgets.map(widget => widget.rect.y));
  return {x, y, w: Math.max(...widgets.map(widget => widget.rect.x + widget.rect.w)) - x,
    h: Math.max(...widgets.map(widget => widget.rect.y + widget.rect.h)) - y};
}

export function translateFreeformWidgets(widgets, dx, dy, canvas) {
  const bounds = freeformBounds(widgets);
  const fitted = fitFreeformRect({...bounds, x: bounds.x + dx, y: bounds.y + dy}, canvas);
  if (bounds.w > canvas.width || bounds.h > canvas.height) throw new Error('Gruppe passt nicht auf den Ziel-Canvas');
  return widgets.map(widget => ({id: widget.id, rect: {...widget.rect,
    x: widget.rect.x + fitted.x - bounds.x, y: widget.rect.y + fitted.y - bounds.y}}));
}

export function setFreeformGroup(page, ids, groupId) {
  const widgets = freeformSelection(page, ids);
  if (page.renderAsPins === true) throw new Error('Gruppierung ist auf Pin-Seiten nicht verfügbar');
  if (groupId !== undefined) {
    if (widgets.length < 2) throw new Error('Mindestens zwei Widgets zum Gruppieren auswählen');
    validateFreeformWidget({...widgets[0], groupId}, page.canvas);
  }
  for (const widget of widgets) {
    if (groupId === undefined) delete widget.groupId;
    else widget.groupId = groupId;
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
    const {y, h} = widget.rect;
    const row = rows.at(-1);
    // Keep a shared vertical band so a tall widget cannot bridge established rows.
    if (row && Math.min(row.bottom, y + h) - y >= Math.min(row.anchorHeight, h) / 2) {
      row.widgets.push(widget);
      row.bottom = Math.min(row.bottom, y + h);
    } else {
      rows.push({widgets: [widget], bottom: y + h, anchorHeight: h});
    }
  }
  return rows.flatMap(({widgets}) => widgets.sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y));
}
