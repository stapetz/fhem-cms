import { validateFreeformCanvas } from './fcui-freeform-layout.js';

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
  if (!position || !['centerX', 'centerY'].every(key => typeof position[key] === 'number'
    && Number.isFinite(position[key]) && position[key] >= 0 && position[key] <= 100)) {
    throw new Error('Ungültige prozentuale Pin-Position');
  }
  return {
    x: frame.x + position.centerX / 100 * frame.w,
    y: frame.y + position.centerY / 100 * frame.h,
  };
}
