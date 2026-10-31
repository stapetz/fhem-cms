export const GRID_COLUMNS = 12;
export const MAX_ROW = 1000;

function overlaps(a, b) {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

export function clampPosition(grid, col, row) {
  return {
    col: Math.min(Math.max(1, Math.round(col)), GRID_COLUMNS + 1 - grid.w),
    row: Math.max(1, Math.round(row))
  };
}

// Setzt ein Widget auf eine neue Position. Überlappende Widgets rutschen nach unten.
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
  const width = Math.min(Math.max(1, Math.round(w)), GRID_COLUMNS + 1 - resized.grid.col);
  const height = Math.min(Math.max(1, Math.round(h)), MAX_ROW);
  return arrange(widgets, resizedId, { ...resized.grid, w: width, h: height });
}

function arrange(widgets, movedId, target) {
  const result = new Map([[movedId, target]]);
  const placed = [target];

  const others = widgets
    .filter((widget) => widget.id !== movedId)
    .sort((a, b) => a.grid.row - b.grid.row || a.grid.col - b.grid.col);
  for (const widget of others) {
    const grid = { ...widget.grid };
    while (placed.some((other) => overlaps(grid, other))) {
      const blocker = placed.find((other) => overlaps(grid, other));
      grid.row = blocker.row + blocker.h;
    }
    if (grid.row + grid.h - 1 > MAX_ROW) {
      return null;
    }
    placed.push(grid);
    result.set(widget.id, grid);
  }
  if (target.row + target.h - 1 > MAX_ROW) {
    return null;
  }
  return result;
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
