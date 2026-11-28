import { fitFreeformRect, validateFreeformCanvas } from './fcui-freeform-layout.js';

export function centerNewPin(widget, canvas) {
  widget.position = {centerX: 50, centerY: 50};
  widget.rect = fitFreeformRect({...widget.rect, x: (canvas.width - widget.rect.w) / 2,
    y: (canvas.height - widget.rect.h) / 2}, canvas);
}

export function validatePinPage(page, schemaVersion) {
  for (const key of ['renderAsPins', 'backgroundDim']) {
    if (!Object.hasOwn(page, key)) continue;
    if (Number(schemaVersion) !== 6 || page.layoutMode !== 'freeform') {
      throw new Error(`${key} ist nur auf Schema-6-Freeform-Seiten erlaubt`);
    }
    const value = page[key];
    if (key === 'renderAsPins' ? typeof value !== 'boolean'
      : typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > .5) {
      throw new Error(`Ungültiger Wert für ${key}`);
    }
  }
}

export function validatePinPosition(position) {
  if (!position || typeof position !== 'object' || Array.isArray(position)
    || Object.keys(position).sort().join(',') !== 'centerX,centerY'
    || !['centerX', 'centerY'].every(key => typeof position[key] === 'number'
      && Number.isFinite(position[key]) && position[key] >= 0 && position[key] <= 100
      && Math.abs(position[key] * 100 - Math.round(position[key] * 100)) < 1e-8)) {
    throw new Error('Ungültige prozentuale Pin-Position');
  }
}

export function pinImageFrame(canvas, image) {
  validateFreeformCanvas(canvas);
  if (image === undefined) return {x: 0, y: 0, w: canvas.width, h: canvas.height};
  if (!image || !['width', 'height'].every(key => Number.isSafeInteger(image[key]) && image[key] > 0)) {
    throw new Error('Gültige natürliche Bildmaße für den Pin-Grundriss erforderlich');
  }
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
  const w = image.width * scale, h = image.height * scale;
  return {x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h};
}

function validateFrame(frame) {
  if (!frame || !['x', 'y', 'w', 'h'].every(key =>
    typeof frame[key] === 'number' && Number.isFinite(frame[key]))
    || frame.x < 0 || frame.y < 0 || frame.w <= 0 || frame.h <= 0) {
    throw new Error('Ungültige Bildbezugsfläche für Pins');
  }
}

export function pinPercentPoint(point, frame) {
  validateFrame(frame);
  if (!point || !['x', 'y'].every(key => typeof point[key] === 'number' && Number.isFinite(point[key]))) {
    throw new Error('Ungültiger Pin-Mittelpunkt');
  }
  const percent = value => Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
  return {
    centerX: percent((point.x - frame.x) / frame.w * 100),
    centerY: percent((point.y - frame.y) / frame.h * 100),
  };
}

export function pinCanvasPoint(position, frame) {
  validateFrame(frame);
  validatePinPosition(position);
  return {
    x: frame.x + position.centerX / 100 * frame.w,
    y: frame.y + position.centerY / 100 * frame.h,
  };
}

export function translateFloorplanSelection(widgets, dx, dy, canvas, frame, isPin, positionFor) {
  validateFrame(frame);
  if (!Array.isArray(widgets) || !widgets.length || ![dx, dy].every(Number.isFinite)) {
    throw new Error('Ungültige Floorplan-Auswahl oder Verschiebung');
  }
  const points = widgets.map(widget => isPin(widget.id)
    ? {widget, pin: true, point: pinCanvasPoint(positionFor(widget), frame)}
    : {widget, pin: false, point: {x: widget.rect.x, y: widget.rect.y}});
  let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
  for (const {widget, pin, point} of points) {
    minX = Math.max(minX, (pin ? frame.x : 0) - point.x);
    maxX = Math.min(maxX, (pin ? frame.x + frame.w : canvas.width - widget.rect.w) - point.x);
    minY = Math.max(minY, (pin ? frame.y : 0) - point.y);
    maxY = Math.min(maxY, (pin ? frame.y + frame.h : canvas.height - widget.rect.h) - point.y);
  }
  if (minX > maxX || minY > maxY) throw new Error('Floorplan-Auswahl passt nicht in die Bezugsfläche');
  const x = Math.max(minX, Math.min(maxX, dx)), y = Math.max(minY, Math.min(maxY, dy));
  return points.map(({widget, pin, point}) => {
    if (!pin) return {id: widget.id, rect: {...widget.rect, x: Math.round(point.x + x), y: Math.round(point.y + y)}};
    const position = pinPercentPoint({x: point.x + x, y: point.y + y}, frame);
    const center = pinCanvasPoint(position, frame);
    return {id: widget.id, position, rect: fitFreeformRect({...widget.rect,
      x: center.x - widget.rect.w / 2, y: center.y - widget.rect.h / 2}, canvas)};
  });
}
