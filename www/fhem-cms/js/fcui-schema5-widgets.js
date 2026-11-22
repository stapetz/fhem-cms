import { createSchema5Grid, schema5GridItems } from './fcui-schema5-layout.js';
import { createWidgetElement, dataFor, isLiveWidget } from './widget-factory.js';
import { cmsPageCanvas, cmsPageNavigationRect, isFreeform, resizeFreeformPage } from './fcui-freeform-layout.js';
import { mountFreeform } from './fcui-freeform-view.js';
import { mountFreeformEditor } from './fcui-freeform-edit.js';

export function mountSchema5Widgets(GridStack, root, config, pageId, navigation, services, snapshots, editing) {
  if (!navigation || !services || typeof services !== 'object' || !(snapshots instanceof Map)) {
    throw new Error('Navigation, Widget-Dienste und Snapshot-Map erforderlich');
  }
  schema5GridItems(config, pageId);
  root.style.setProperty('--cms-widget-title-align', config.settings.titleAlign || 'left');
  const sourcePage = config.pages.find((item) => item.id === pageId);
  const commonCanvas = cmsPageCanvas(config);
  const pixel = isFreeform(sourcePage);
  const page = pixel ? structuredClone(sourcePage) : sourcePage;
  if (pixel && commonCanvas) {
    if (page.canvas.width !== commonCanvas.width || page.canvas.height !== commonCanvas.height) {
      resizeFreeformPage(page, commonCanvas.width, commonCanvas.height);
    }
    page.canvas = commonCanvas;
    page.navigationRect = cmsPageNavigationRect(config);
  }
  const widgets = new Map(page.widgets.map((widget) => [widget.id, widget]));
  const elements = new Map();
  const createWidget = id => {
    const widget = widgets.get(id);
    const widgetServices = widget.type === 'fhem-link' ? { ...services,
      pages: config.pages.map(({ id, title }) => ({ id, title })) } : services;
    const vehicleServices = widget.type === 'fhem-volvoconnect' ? {...widgetServices,
      GridStack,
      cardGrid: () => ({columns:Number(config.settings.gridColumns),
        rowHeight:root.getBoundingClientRect().width / Number(config.settings.gridColumns)})} : widgetServices;
    const element = createWidgetElement(widget, vehicleServices, snapshots, true);
    if (widget.type === 'fhem-volvoconnect' && editing) {
      element.services = { ...vehicleServices, editing:true,
        showGrid:editing.showGrid,
        ...(typeof editing.onPopupSettings === 'function'
          ? {savePopupSettings: settings => editing.onPopupSettings(id, settings)} : {}) };
    }
    elements.set(id, element);
    return element;
  };
  const params = new URLSearchParams(root.ownerDocument?.defaultView?.location?.search ?? globalThis.window?.location?.search);
  const previewDevice = params.get('mode') === 'preview' && params.get('cms-device');
  const mobilePreview = previewDevice === 'mobile' || previewDevice === 'tablet';
  const gridRoot = !pixel && commonCanvas ? root.ownerDocument.createElement('div') : root;
  if (gridRoot !== root) gridRoot.className = 'grid-stack cms-schema5-grid cms-shared-canvas-grid';
  const framePage = pixel ? page : commonCanvas && {
    canvas: commonCanvas, widgets: [],
    navigationRect: cmsPageNavigationRect(config),
  };
  const frame = framePage ? mountFreeform(root, framePage, navigation, createWidget, {
    background: services.freeformBackground, editing,
    phone: previewDevice === 'mobile', tablet: previewDevice === 'tablet',
    navigationGrid: config.navigation.grid, columns: Number(config.settings.gridColumns),
    grid: pixel ? undefined : gridRoot,
  }) : null;
  const freeform = pixel ? frame : null;
  const viewConfig = editing || pixel ? config : {
    ...config,
    pages: config.pages.map((entry) => entry !== page ? entry : {
      ...page, widgets: [...page.widgets].sort((a, b) => a.grid.row - b.grid.row || a.grid.col - b.grid.col),
    }),
  };
  const grid = pixel ? null : createSchema5Grid(GridStack, gridRoot, viewConfig, pageId, (id, wrapper) => {
    if (id === '__nav') {
      wrapper.className += ' cms-responsive-navigation';
      if (frame) {
        wrapper.classList.add('cms-shared-navigation-placeholder');
        return root.ownerDocument.createElement('span');
      }
      return navigation;
    }
    if (!editing) {
      const { w, h } = widgets.get(id).grid;
      wrapper.style.setProperty('--cms-widget-fraction', String(Math.max(0.25, Number(w) / Number(config.settings.gridColumns))));
      wrapper.style.setProperty('--cms-widget-padding', `${100 * Number(h) / Number(w)}%`);
    }
    return createWidget(id);
  }, Boolean(editing));
  if (!editing && !frame) {
    root.setAttribute('data-responsive', '');
    const touchDevice = window.matchMedia?.('(pointer: coarse)').matches;
    if (mobilePreview) {
      root.setAttribute('data-mobile-preview', '');
    }
    if (mobilePreview || touchDevice) root.setAttribute('data-mobile-layout', '');
  }
  let destroyed = false;
  const selectGridWidget = selected => {
    for (const wrapper of gridRoot.children) {
      if (wrapper !== selected && wrapper.classList.contains('cms-widget-selected')
        && wrapper.contains(root.ownerDocument.activeElement)) root.ownerDocument.activeElement.blur();
      wrapper.classList.toggle('cms-widget-selected', wrapper === selected);
    }
  };
  const gridKeys = new AbortController();
  if (grid && editing) root.ownerDocument.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !root.inert
      && !event.target.closest?.('dialog, .cms-menu-items, :popover-open')) selectGridWidget(null);
  }, {signal: gridKeys.signal});
  if (editing) {
    if (grid) gridRoot.classList.toggle('cms-grid-editable', true);
    const entries = pixel ? Array.from(freeform.wrappers)
      : Array.from(gridRoot.children, wrapper => [wrapper.gridstackNode?.id, wrapper])
        .filter(([id]) => !frame || id !== '__nav');
    if (frame) entries.unshift(['__nav', frame.navBox]);
    for (const [id, wrapper] of entries) {
      const widget = widgets.get(id);
      const gridItem = Boolean(grid && wrapper !== frame?.navBox);
      if (gridItem) {
        wrapper.addEventListener('click', event => {
          if (event.target.closest?.('.cms-widget-tools,.ui-resizable-handle,a:not([aria-current])') || wrapper.classList.contains('ui-draggable-dragging')) return;
          if (event.target.closest?.('a[aria-current]')) event.preventDefault();
          selectGridWidget(wrapper.classList.contains('cms-widget-selected') ? null : wrapper);
          if (wrapper.classList.contains('cms-widget-selected')) wrapper.querySelector('.cms-widget-drag')?.focus({preventScroll: true});
        });
      }
      const controls = document.createElement('div');
      controls.className = 'cms-widget-tools';
      const drag = document.createElement('button');
      drag.type = 'button';
      drag.className = 'cms-widget-drag';
      if (!gridItem) drag.dataset.dir = 'move';
      drag.title = `${widget?.title || widget?.id || 'Navigation'} verschieben`;
      drag.setAttribute('aria-label', drag.title);
      if (gridItem) {
        drag.addEventListener('keydown', event => {
          const delta = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
          if (!delta || !wrapper.classList.contains('cms-widget-selected')) return;
          event.preventDefault();
          const {x, y, w} = wrapper.gridstackNode;
          const next = {x: x + delta[0], y: y + delta[1]};
          if (next.x < 0 || next.y < 0 || next.x + w > grid.getColumn()) return;
          grid.update(wrapper, next);
          editing.onChange(grid.save(false));
        });
      }
      wrapper.append(drag);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'cms-widget-config';
      edit.textContent = '✎';
      edit.title = widget ? 'Widget einstellen' : 'Navigation einstellen';
      edit.setAttribute('aria-label', edit.title);
      edit.addEventListener('click', () => editing.onEdit(id));
      controls.append(edit);
      if (widget && typeof editing.onDuplicate === 'function') {
        const duplicate = document.createElement('button');
        duplicate.type = 'button';
        duplicate.className = 'cms-widget-duplicate';
        duplicate.textContent = '⧉';
        duplicate.title = `Widget „${widget.title || widget.id}“ duplizieren`;
        duplicate.setAttribute('aria-label', duplicate.title);
        duplicate.disabled = page.widgets.length >= 200;
        duplicate.addEventListener('click', () => editing.onDuplicate(id));
        controls.append(duplicate);
      }
      if (widget && typeof editing.onMove === 'function') {
        const move = document.createElement('button');
        move.type = 'button';
        move.className = 'cms-widget-move';
        move.textContent = '⇄';
        move.title = 'Auf andere Seite verschieben';
        move.setAttribute('aria-label', move.title);
        move.addEventListener('click', () => editing.onMove(id));
        controls.append(move);
      }
      if (widget && typeof editing.onDelete === 'function') {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'cms-widget-delete';
        remove.textContent = '×';
        remove.title = `Widget „${widget.title || widget.id}“ löschen`;
        remove.setAttribute('aria-label', remove.title);
        remove.addEventListener('click', () => editing.onDelete(id));
        controls.append(remove);
      }
      wrapper.append(controls);
      if (gridItem) {
        const size = document.createElement('span');
        size.className = 'cms-widget-dimensions';
        size.hidden = true;
        wrapper.append(size);
      }
    }
    grid?.setStatic(false);
    grid?.on('resizestart resize', (_event, wrapper) => {
      const size = wrapper.querySelector('.cms-widget-dimensions');
      if (!size) return;
      size.hidden = false;
      size.textContent = `${wrapper.offsetWidth} × ${wrapper.offsetHeight} px`;
    });
    grid?.on('resizestop', (_event, wrapper) => {
      const size = wrapper.querySelector('.cms-widget-dimensions');
      if (size) size.hidden = true;
    });
    grid?.on('dragstop resizestop', () => {
      if (!destroyed) editing.onChange(grid.save(false));
    });
  }
  const stopEditor = frame && editing?.onFreeformChange
    ? mountFreeformEditor(root, framePage, frame, editing, navigation, true) : null;
  return {
    measureGrid() {
      if (!grid || !editing) return undefined;
      const bounds = gridRoot.getBoundingClientRect();
      const scale = frame?.getScale() ?? 1;
      const boxes = new Map(Array.from(gridRoot.children).flatMap(wrapper => {
        const id = wrapper.gridstackNode?.id;
        if (!widgets.has(id)) return [];
        const box = wrapper.getBoundingClientRect();
        return [[id, {x: (box.left - bounds.left) / scale, y: (box.top - bounds.top) / scale, w: box.width / scale, h: box.height / scale}]];
      }));
      return {width: bounds.width / scale, height: bounds.height / scale, boxes};
    },
    lock() {
      if (destroyed) return;
      root.inert = true;
      // Gridstack must finish its pointer-stop cleanup before DD is disabled.
      queueMicrotask(() => {
        if (destroyed) return;
        grid?.enableMove(false);
        grid?.enableResize(false);
      });
    },
    update(nextSnapshots, staleSince = null) {
      if (destroyed) throw new Error('Raster wurde bereits entfernt');
      if (!(nextSnapshots instanceof Map)) throw new Error('Snapshot-Map erforderlich');
      for (const [id, widget] of widgets) {
        if (!isLiveWidget(widget)) continue;
        const element = elements.get(id);
        element.data = dataFor(widget, nextSnapshots);
        element.stale = staleSince;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      gridKeys.abort();
      grid?.destroy(false);
      if (grid) root.style.removeProperty?.('height');
      stopEditor?.();
      frame?.destroy();
      if (!editing) {
        root.removeAttribute('data-responsive');
        root.removeAttribute('data-mobile-preview');
        root.removeAttribute('data-mobile-layout');
      }
      root.replaceChildren();
      if (editing) {
        gridRoot.classList.toggle('cms-grid-editable', false);
        root.inert = false;
      }
      elements.clear();
    },
  };
}
