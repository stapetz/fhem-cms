export const GRID_COLUMNS = 48;
export const MAX_ROW = 1000;
export const LAYOUT_MODES = ['grid', 'flow', 'masonry', 'free'];
export const GRID_COLUMN_CHOICES = [12, 24, 48];

// Seitenübergreifende Einstellung; die Positionen bleiben immer im 48er-Raster gespeichert.
const options = { mode: 'grid', columns: GRID_COLUMNS };

export function configureLayout(settings = {}) {
  options.mode = LAYOUT_MODES.includes(settings.layoutMode) ? settings.layoutMode : 'grid';
  options.columns = GRID_COLUMN_CHOICES.includes(settings.gridColumns) ? settings.gridColumns : GRID_COLUMNS;
}

export function layoutMode() {
  return options.mode;
}

export function isFlowMode() {
  return options.mode === 'flow' || options.mode === 'masonry';
}

// Schrittweite in 48er-Einheiten: die freie Position nutzt immer das feinste Raster.
export function layoutStep() {
  return options.mode === 'free' ? 1 : GRID_COLUMNS / options.columns;
}

function overlaps(a, b) {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

function byPosition(a, b) {
  return a.grid.row - b.grid.row || a.grid.col - b.grid.col;
}

export function clampPosition(grid, col, row) {
  const step = layoutStep();
  const snapped = 1 + Math.round((col - 1) / step) * step;
  return {
    col: Math.min(Math.max(1, snapped), GRID_COLUMNS + 1 - grid.w),
    row: Math.max(1, Math.round(row))
  };
}

// Setzt ein Widget auf eine neue Position. Je nach Modus rutschen überlappende Widgets nach unten (Raster),
// werden neu angeordnet (Fluss, Spalten) oder bleiben unberührt (frei).
// Rückgabe: Map Widget-ID -> neue Rasterposition oder null, wenn das Raster überläuft.
export function moveWidget(widgets, movedId, col, row) {
  const moved = widgets.find((widget) => widget.id === movedId);
  if (!moved) {
    return null;
  }
  return arrange(widgets, movedId, { ...moved.grid, ...clampPosition(moved.grid, col, row) });
}

// Ändert die Größe eines Widgets (Breite und Höhe in Rasterzellen) und ordnet die übrigen neu an.
export function resizeWidget(widgets, resizedId, w, h) {
  const resized = widgets.find((widget) => widget.id === resizedId);
  if (!resized) {
    return null;
  }
  const step = layoutStep();
  const maxWidth = isFlowMode() ? GRID_COLUMNS : GRID_COLUMNS + 1 - resized.grid.col;
  const width = Math.min(Math.max(step, Math.round(w / step) * step), maxWidth);
  const height = Math.min(Math.max(1, Math.round(h)), MAX_ROW);
  return arrange(widgets, resizedId, { ...resized.grid, w: width, h: height });
}

function fitsRows(result) {
  return [...result.values()].every((grid) => grid.row + grid.h - 1 <= MAX_ROW);
}

// Schiebt die Elemente der Reihe nach so weit nach unten, bis sie nichts Platziertes mehr überlappen.
function settle(placed, others, result) {
  for (const widget of [...others].sort(byPosition)) {
    const grid = { ...widget.grid };
    while (placed.some((other) => overlaps(grid, other))) {
      const blocker = placed.find((other) => overlaps(grid, other));
      grid.row = blocker.row + blocker.h;
    }
    placed.push(grid);
    result.set(widget.id, grid);
  }
}

// Fluss: Reihenfolge von links nach rechts, bei Platzmangel Zeilenumbruch.
// Spalten: jedes Widget kommt in die Spalte(n) mit dem geringsten Stand (lückenlos von oben nach unten).
export function flowLayout(items, mode = options.mode) {
  const result = new Map();
  const heights = new Array(GRID_COLUMNS).fill(1);
  let row = 1;
  let col = 1;
  let lineHeight = 0;
  for (const item of items) {
    const w = Math.min(item.grid.w, GRID_COLUMNS);
    const h = item.grid.h;
    let target;
    if (mode === 'masonry') {
      let best = null;
      for (let start = 1; start + w - 1 <= GRID_COLUMNS; start += layoutStep()) {
        const level = Math.max(...heights.slice(start - 1, start - 1 + w));
        if (best === null || level < best.row) {
          best = { col: start, row: level };
        }
      }
      target = { col: best.col, row: best.row, w, h };
      heights.fill(target.row + h, target.col - 1, target.col - 1 + w);
    } else {
      if (col + w - 1 > GRID_COLUMNS) {
        row += lineHeight;
        col = 1;
        lineHeight = 0;
      }
      target = { col, row, w, h };
      col += w;
      lineHeight = Math.max(lineHeight, h);
    }
    result.set(item.id, target);
  }
  return fitsRows(result) ? result : null;
}

function arrange(widgets, movedId, target) {
  if (isFlowMode()) {
    const items = widgets.map((widget) => (widget.id === movedId ? { ...widget, grid: target } : widget));
    const order = items.filter((widget) => widget.id !== movedId).sort(byPosition);
    const moved = items.find((widget) => widget.id === movedId);
    const index = order.findIndex((widget) => byPosition(moved, widget) <= 0);
    order.splice(index < 0 ? order.length : index, 0, moved);
    return flowLayout(order);
  }
  const result = new Map([[movedId, target]]);
  if (options.mode === 'free') {
    for (const widget of widgets) {
      if (widget.id !== movedId) {
        result.set(widget.id, { ...widget.grid });
      }
    }
    return fitsRows(result) ? result : null;
  }
  settle([target], widgets.filter((widget) => widget.id !== movedId), result);
  return fitsRows(result) ? result : null;
}

// Positionen, wie sie im aktuellen Modus tatsächlich angezeigt werden (Fluss und Spalten werden berechnet).
export function effectiveLayout(items) {
  if (isFlowMode()) {
    return flowLayout([...items].sort(byPosition)) || new Map(items.map((item) => [item.id, { ...item.grid }]));
  }
  return new Map(items.map((item) => [item.id, { ...item.grid }]));
}

// Rechnet gespeicherte Positionen auf die aktuelle Rastergröße und den aktuellen Modus um.
export function normalizeLayout(items) {
  const step = layoutStep();
  const snapped = items.map((item) => {
    const w = Math.min(Math.max(step, Math.round(item.grid.w / step) * step), GRID_COLUMNS);
    const col = Math.min(Math.max(1, 1 + Math.round((item.grid.col - 1) / step) * step), GRID_COLUMNS + 1 - w);
    return { ...item, grid: { ...item.grid, col, w } };
  });
  if (isFlowMode()) {
    return flowLayout(snapped.sort(byPosition));
  }
  if (options.mode === 'free') {
    return new Map(snapped.map((item) => [item.id, item.grid]));
  }
  const result = new Map();
  settle([], snapped, result);
  return fitsRows(result) ? result : null;
}

// Wandelt eine Zeigerposition in Spalte und Zeile des Rasters um.
export function cellFromPoint(gridElement, x, y) {
  const rect = gridElement.getBoundingClientRect();
  const style = getComputedStyle(gridElement);
  const gap = parseFloat(style.columnGap) || 0;
  const rowGap = parseFloat(style.rowGap) || 0;
  const colWidth = (rect.width - gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const col = Math.floor((x - rect.left) / (colWidth + gap)) + 1;

  const tracks = style.gridTemplateRows.split(/\s+/).map(parseFloat).filter((value) => Number.isFinite(value));
  let offset = y - rect.top;
  let row = 1;
  for (const height of tracks) {
    if (offset < height + rowGap) {
      return { col, row };
    }
    offset -= height + rowGap;
    row += 1;
  }
  const fallback = parseFloat(style.gridAutoRows) || 88;
  return { col, row: row + Math.max(0, Math.floor(offset / (fallback + rowGap))) };
}
