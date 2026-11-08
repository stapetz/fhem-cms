function integer(value, min, max) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || !/^[0-9]{1,6}$/.test(String(value))) return null;
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

function inspectGrid(grid, location) {
  if (!grid || typeof grid !== 'object' || Array.isArray(grid)) {
    throw new Error(`Ungültiges Raster: ${location}`);
  }
  const col = integer(grid.col, 1, 48);
  const row = integer(grid.row, 1, 1000);
  const w = integer(grid.w, 1, 48);
  const h = integer(grid.h, 1, 1000);
  if (col === null || row === null || w === null || h === null || col + w > 49) {
    throw new Error(`Ungültiges Raster: ${location}`);
  }
  const issues = [];
  if ((col - 1) % 4 !== 0) issues.push('col');
  if (w % 4 !== 0) issues.push('w');
  return {
    source: { col, row, w, h },
    exact: issues.length === 0
      ? { col: (col - 1) / 4 + 1, row, w: w / 4, h }
      : null,
    issues,
  };
}

function overlaps(a, b) {
  return a.col < b.col + b.w && b.col < a.col + a.w
    && a.row < b.row + b.h && b.row < a.row + a.h;
}

// Analyse only: no rounding, persistence or mutation of the input.
export function inspectLegacyLayout(config) {
  if (!config || integer(config.schemaVersion, 4, 4) === null
    || !Array.isArray(config.pages) || config.pages.length < 1 || config.pages.length > 50) {
    throw new Error('Schema 4 mit gültiger Seitenliste erwartet');
  }
  const navigation = config.navigation === undefined
    ? null
    : inspectGrid(config.navigation?.grid, 'navigation');
  const ids = new Set();
  const pages = config.pages.map((page, pageIndex) => {
    if (!page || typeof page.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(page.id)
      || ids.has(page.id) || !Array.isArray(page.widgets) || page.widgets.length > 200) {
      throw new Error(`Ungültige Seite: ${pageIndex + 1}`);
    }
    ids.add(page.id);
    const widgetIds = new Set();
    const widgets = page.widgets.map((widget, widgetIndex) => {
      if (!widget || typeof widget.id !== 'string'
        || !/^[A-Za-z0-9_-]{1,64}$/.test(widget.id) || widgetIds.has(widget.id)) {
        throw new Error(`Ungültiges Widget: ${page.id}/${widgetIndex + 1}`);
      }
      widgetIds.add(widget.id);
      return { id: widget.id, ...inspectGrid(widget.grid, `${page.id}/${widget.id}`) };
    });
    const elements = [
      ...(navigation ? [{ type: 'navigation', id: null, grid: navigation.source }] : []),
      ...widgets.map((widget) => ({ type: 'widget', id: widget.id, grid: widget.source })),
    ];
    const collisions = [];
    for (let i = 0; i < elements.length; i += 1) {
      for (let j = i + 1; j < elements.length; j += 1) {
        if (overlaps(elements[i].grid, elements[j].grid)) {
          collisions.push([
            { type: elements[i].type, id: elements[i].id },
            { type: elements[j].type, id: elements[j].id },
          ]);
        }
      }
    }
    return { id: page.id, widgets, collisions };
  });
  return { navigation, pages, requiresEffectiveNavigation: navigation === null };
}
