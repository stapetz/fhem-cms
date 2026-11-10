const NAVIGATION = '__nav';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const SCHEMA5_GRID_COLUMNS = [12, 24, 48, 96, 192];

function integer(value, min, max) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || !/^[0-9]{1,6}$/.test(String(value))) return null;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : null;
}

function geometry(grid, columns) {
  if (!grid || typeof grid !== 'object' || Array.isArray(grid)
    || Object.keys(grid).sort().join(',') !== 'col,h,row,w') {
    throw new Error('Ungültiges Schema-5-Raster');
  }
  const col = integer(grid.col, 1, columns);
  const row = integer(grid.row, 1, 1000);
  const w = integer(grid.w, 1, columns);
  const h = integer(grid.h, 1, 1000);
  if (col === null || row === null || w === null || h === null || col + w > columns + 1 || row + h > 1001) {
    throw new Error('Schema-5-Raster liegt außerhalb der Grenzen');
  }
  return { col, row, w, h };
}

function overlaps(a, b) {
  return a.col < b.col + b.w && b.col < a.col + a.w
    && a.row < b.row + b.h && b.row < a.row + a.h;
}

function validateLayout(config) {
  if (!config || integer(config.schemaVersion, 5, 5) === null
    || config.settings?.layoutMode !== 'grid'
    || !SCHEMA5_GRID_COLUMNS.includes(integer(config.settings?.gridColumns, 12, 192))
    || !Array.isArray(config.pages) || config.pages.length < 1 || config.pages.length > 50) {
    throw new Error('Gültiges Schema 5 mit 12, 24, 48, 96 oder 192 Rasterspalten erwartet');
  }
  const columns = Number(config.settings.gridColumns);
  if (config.settings.titleAlign !== undefined && !['left', 'center', 'right'].includes(config.settings.titleAlign)) {
    throw new Error('Ungültige Titelausrichtung');
  }
  const nav = geometry(config.navigation?.grid, columns);
  const pages = new Set();
  for (const page of config.pages) {
    if (!page || typeof page.id !== 'string' || !ID.test(page.id) || pages.has(page.id)
      || !Array.isArray(page.widgets) || page.widgets.length > 200) {
      throw new Error('Ungültige oder doppelte Seite');
    }
    pages.add(page.id);
    const ids = new Set();
    const grids = [nav];
    for (const widget of page.widgets) {
      if (!widget || typeof widget.id !== 'string' || !ID.test(widget.id)
        || widget.id === NAVIGATION || ids.has(widget.id)) {
        throw new Error(`Ungültige oder doppelte Widget-ID auf Seite ${page.id}`);
      }
      ids.add(widget.id);
      const current = geometry(widget.grid, columns);
      if (grids.some((other) => overlaps(current, other))) {
        throw new Error(`Rasterüberschneidung auf Seite ${page.id}`);
      }
      grids.push(current);
    }
  }
}

export function schema5GridItems(config, pageId) {
  validateLayout(config);
  const columns = Number(config.settings.gridColumns);
  const page = config.pages.find((entry) => entry.id === pageId);
  if (!page) throw new Error('Unbekannte Seite');
  return [{ id: NAVIGATION, grid: geometry(config.navigation.grid, columns) },
    ...page.widgets.map((widget) => ({ id: widget.id, grid: geometry(widget.grid, columns) }))]
    .map(({ id, grid }) => ({ id, x: grid.col - 1, y: grid.row - 1, w: grid.w, h: grid.h }));
}

export function applySchema5GridItems(config, pageId, items) {
  const expected = schema5GridItems(config, pageId);
  if (!Array.isArray(items) || items.length !== expected.length) {
    throw new Error('Raster enthält fehlende oder zusätzliche Elemente');
  }
  const expectedIds = new Set(expected.map((item) => item.id));
  const positions = new Map();
  for (const item of items) {
    const x = item?.x === undefined ? 0 : item.x;
    const y = item?.y === undefined ? 0 : item.y;
    const w = item?.w === undefined ? 1 : item.w;
    const h = item?.h === undefined ? 1 : item.h;
    if (!item || typeof item.id !== 'string' || !expectedIds.has(item.id) || positions.has(item.id)
      || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(w) || !Number.isInteger(h)) {
      throw new Error('Ungültige oder doppelte Rasterposition');
    }
    positions.set(item.id, geometry({ col: x + 1, row: y + 1, w, h }, Number(config.settings.gridColumns)));
  }
  const result = structuredClone(config);
  result.navigation.grid = positions.get(NAVIGATION);
  const page = result.pages.find((entry) => entry.id === pageId);
  for (const widget of page.widgets) widget.grid = positions.get(widget.id);
  validateLayout(result);
  return result;
}

export function resizeSchema5Grid(config, columns) {
  validateLayout(config);
  if (!SCHEMA5_GRID_COLUMNS.includes(columns)) throw new Error('Ungültige Rastergröße');
  const result = structuredClone(config);
  const ratio = columns / Number(config.settings.gridColumns);
  if (ratio === 1) return result;
  const resize = (source) => {
    const grid = geometry(source, Number(config.settings.gridColumns));
    const w = Math.max(1, Math.round(grid.w * ratio));
    return geometry({
      col: Math.min(columns - w, Math.round((grid.col - 1) * ratio)) + 1,
      row: Math.round((grid.row - 1) * ratio) + 1,
      w,
      h: Math.max(1, Math.round(grid.h * ratio)),
    }, columns);
  };
  result.settings.gridColumns = columns;
  result.navigation.grid = resize(config.navigation.grid);
  for (const page of result.pages) {
    const placed = [result.navigation.grid];
    // Keep visual order when rounding creates collisions, without reordering stored widgets.
    const ordered = [...page.widgets].sort((a, b) => Number(a.grid.row) - Number(b.grid.row)
      || Number(a.grid.col) - Number(b.grid.col));
    for (const widget of ordered) {
      const grid = resize(widget.grid);
      let collisions = placed.filter((other) => overlaps(grid, other));
      while (collisions.length) {
        grid.row = Math.max(...collisions.map((other) => other.row + other.h));
        collisions = placed.filter((other) => overlaps(grid, other));
      }
      widget.grid = geometry(grid, columns);
      placed.push(widget.grid);
    }
  }
  validateLayout(result);
  return result;
}

export function createSchema5Grid(GridStack, element, config, pageId, renderContent, editable = false) {
  const items = schema5GridItems(config, pageId);
  const columns = Number(config.settings.gridColumns);
  if (!element || element.children.length || element.gridstack || typeof renderContent !== 'function') {
    throw new Error('Leeres Rasterelement und Inhaltsfunktion erforderlich');
  }
  const grid = GridStack.init({ column: columns, maxRow: 1000, minRow: editable ? 8 * columns / 12 : 0, mode: 'float', staticGrid: true,
    draggable: { handle: '.cms-widget-drag' }, resizable: { handles: 'se' } }, element);
  if (!grid) throw new Error(`${columns}-Spalten-Raster konnte nicht angelegt werden`);
  try {
    if (grid.getColumn() !== columns) throw new Error(`${columns}-Spalten-Raster konnte nicht angelegt werden`);
    const contents = new Map();
    for (const item of items) {
      const wrapper = document.createElement('div');
      wrapper.className = 'grid-stack-item';
      const content = document.createElement('div');
      content.className = 'grid-stack-item-content';
      wrapper.append(content);
      element.append(wrapper);
      grid.makeWidget(wrapper, item);
      contents.set(item.id, { content, wrapper });
    }
    const actual = grid.save(false);
    if (!Array.isArray(actual) || actual.length !== items.length) {
      throw new Error('Gridstack hat Rasterelemente verloren oder ergänzt');
    }
    const actualById = new Map(actual.map((item) => [item.id, item]));
    if (actualById.size !== items.length) throw new Error('Gridstack hat doppelte Rasterelemente erzeugt');
    for (const expected of items) {
      const item = actualById.get(expected.id);
      if (!item || ['x', 'y', 'w', 'h'].some((key) => (item[key] ?? (key === 'w' || key === 'h' ? 1 : 0)) !== expected[key])) {
        throw new Error('Gridstack hat eine gespeicherte Position verändert');
      }
    }
    for (const item of items) {
      const { content, wrapper } = contents.get(item.id);
      content.append(renderContent(item.id, wrapper));
    }
    return grid;
  } catch (error) {
    grid.destroy(false);
    element.replaceChildren();
    throw error;
  }
}
