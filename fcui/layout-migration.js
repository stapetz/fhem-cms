import { effectiveLayoutFor } from '../www/fhem-cms/js/layout.js';

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

// Mirrors the legacy page rendering without altering the stored configuration.
export function inspectEffectiveLegacyLayout(config) {
  const analysis = inspectLegacyLayout(config);
  const mode = config.settings?.layoutMode ?? 'grid';
  if (!['grid', 'free', 'flow', 'masonry'].includes(mode)) {
    throw new Error('Ungültiger Layoutmodus');
  }
  const columns = [12, 24, 48].includes(config.settings?.gridColumns)
    ? config.settings.gridColumns : 48;
  const defaultNavigation = !analysis.navigation;
  const navigation = analysis.navigation ? config.navigation.grid : { col: 1, row: 1, w: 48, h: 1 };
  const pages = analysis.pages.map((page, index) => {
    if (page.widgets.some((widget) => widget.id === '__nav')) {
      throw new Error(`Widget-ID __nav kollidiert mit der Navigation: ${page.id}`);
    }
    const items = [
      { id: '__nav', grid: { ...navigation } },
      ...page.widgets.map((widget, widgetIndex) => {
        const grid = { ...config.pages[index].widgets[widgetIndex].grid };
        if (defaultNavigation) {
          // The legacy frontend adds one to the original value before numeric coercion.
          grid.row = Math.min(config.pages[index].widgets[widgetIndex].grid.row + 1, 1000);
        }
        return { id: widget.id, grid };
      }),
    ];
    const effective = effectiveLayoutFor(items, mode, mode === 'free' ? 1 : 48 / columns);
    return {
      id: page.id,
      navigation: inspectGrid(effective.get('__nav'), `${page.id}/navigation`),
      widgets: page.widgets.map((widget) => ({
        id: widget.id,
        ...inspectGrid(effective.get(widget.id), `${page.id}/${widget.id}`),
      })),
    };
  });
  return { defaultNavigation, mode, pages };
}

function adjustedGrid(grid) {
  if (!grid || typeof grid !== 'object' || Array.isArray(grid)
    || Object.keys(grid).sort().join(',') !== 'col,h,row,w'
    || !Number.isInteger(grid.col) || grid.col < 1 || grid.col > 12
    || !Number.isInteger(grid.row) || grid.row < 1 || grid.row > 1000
    || !Number.isInteger(grid.w) || grid.w < 1 || grid.col + grid.w > 13
    || !Number.isInteger(grid.h) || grid.h < 1 || grid.row + grid.h > 1001) {
    throw new Error('Ungültige manuelle 12-Spalten-Position');
  }
  return { col: grid.col, row: grid.row, w: grid.w, h: grid.h };
}

function parseAdjustments(adjustments, pageList, hasNavigation) {
  if (!Array.isArray(adjustments)) throw new Error('Anpassungen müssen eine Liste sein');
  const pages = new Map(pageList.map((page) => [page.id, page]));
  const overrides = new Map();
  for (const item of adjustments) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Ungültige Anpassung');
    }
    let key;
    if (item.type === 'navigation' && Object.keys(item).sort().join(',') === 'grid,type'
      && hasNavigation) {
      key = 'navigation';
    } else if (item.type === 'widget'
      && Object.keys(item).sort().join(',') === 'grid,id,page,type'
      && pages.get(item.page)?.widgets.some((widget) => widget.id === item.id)) {
      key = `widget/${item.page}/${item.id}`;
    } else {
      throw new Error('Unbekannte oder ungültige Anpassung');
    }
    if (overrides.has(key)) throw new Error('Doppelte Anpassung');
    overrides.set(key, adjustedGrid(item.grid));
  }
  return overrides;
}

function findCollisions(navigation, widgets) {
  const elements = [
    ...(navigation ? [{ type: 'navigation', id: null, grid: navigation }] : []),
    ...widgets.filter((widget) => widget.grid)
      .map((widget) => ({ type: 'widget', id: widget.id, grid: widget.grid })),
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
  return collisions;
}

// Internal preview data only; the server must independently validate any future write.
export function planLegacyLayout(config, adjustments = []) {
  const analysis = inspectLegacyLayout(config);
  const layoutMode = config.settings?.layoutMode ?? 'grid';
  if (!['grid', 'free', 'flow', 'masonry'].includes(layoutMode)) {
    throw new Error('Ungültiger Layoutmodus');
  }
  const overrides = parseAdjustments(adjustments, analysis.pages, Boolean(analysis.navigation));
  const resolve = (entry, key) => {
    if (!entry) return null;
    const grid = overrides.get(key) || entry.exact;
    if (!grid || grid.row + grid.h > 1001) return null;
    return { ...grid };
  };
  const navigation = resolve(analysis.navigation, 'navigation');
  const resultPages = analysis.pages.map((page) => {
    const widgets = page.widgets.map((widget) => ({
      id: widget.id,
      grid: resolve(widget, `widget/${page.id}/${widget.id}`),
    }));
    return { id: page.id, widgets, collisions: findCollisions(navigation, widgets) };
  });
  return {
    navigation,
    pages: resultPages,
    requiresEffectiveNavigation: analysis.requiresEffectiveNavigation,
    requiresEffectiveLayout: layoutMode === 'flow' || layoutMode === 'masonry',
  };
}

// Planning remains read-only. An effective navigation that differs between
// pages requires an explicit global target, even when each position is exact.
export function planEffectiveLegacyLayout(config, adjustments = []) {
  const analysis = inspectEffectiveLegacyLayout(config);
  const overrides = parseAdjustments(adjustments, analysis.pages, true);

  const nav = analysis.pages[0].navigation;
  const navDiffers = analysis.pages.some((page) =>
    ['col', 'row', 'w', 'h'].some((field) => page.navigation.source[field] !== nav.source[field]));
  const fit = (grid) => grid && grid.row + grid.h <= 1001 ? { ...grid } : null;
  const navigation = fit(overrides.get('navigation') || (!navDiffers ? nav.exact : null));
  const resultPages = analysis.pages.map((page) => {
    const widgets = page.widgets.map((widget) => ({
      id: widget.id,
      source: { ...widget.source },
      issues: [...widget.issues],
      grid: fit(overrides.get(`widget/${page.id}/${widget.id}`) || widget.exact),
    }));
    return {
      id: page.id,
      navigationSource: { ...page.navigation.source },
      widgets,
      collisions: findCollisions(navigation, widgets),
    };
  });
  return {
    defaultNavigation: analysis.defaultNavigation,
    navigationDiffersBetweenPages: navDiffers,
    navigation,
    pages: resultPages,
    allPositionsResolved: navigation !== null
      && resultPages.every((page) => page.widgets.every((widget) => widget.grid !== null)),
  };
}

// The backend must still validate the source, positions and transaction independently.
export function migrationPositions(config, adjustments = []) {
  const plan = planEffectiveLegacyLayout(config, adjustments);
  if (!plan.allPositionsResolved) throw new Error('Nicht alle Positionen sind festgelegt');
  if (plan.pages.some((page) => page.collisions.length)) throw new Error('Positionen überschneiden sich');
  return {
    navigation: { ...plan.navigation },
    pages: plan.pages.map((page) => ({
      id: page.id,
      widgets: page.widgets.map((widget) => ({ id: widget.id, grid: { ...widget.grid } })),
    })),
  };
}
