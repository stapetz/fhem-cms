import { createSchema5Grid, schema5GridItems } from './fcui-schema5-layout.js';
import { createWidgetElement, dataFor, isLiveWidget } from './widget-factory.js';

export function mountSchema5Widgets(GridStack, root, config, pageId, navigation, services, snapshots, editing) {
  if (!navigation || !services || typeof services !== 'object' || !(snapshots instanceof Map)) {
    throw new Error('Navigation, Widget-Dienste und Snapshot-Map erforderlich');
  }
  schema5GridItems(config, pageId);
  root.style.setProperty('--cms-widget-title-align', config.settings.titleAlign || 'left');
  const page = config.pages.find((item) => item.id === pageId);
  const widgets = new Map(page.widgets.map((widget) => [widget.id, widget]));
  const elements = new Map();
  const viewConfig = editing ? config : {
    ...config,
    pages: config.pages.map((entry) => entry !== page ? entry : {
      ...page,
      widgets: [...page.widgets].sort((a, b) => a.grid.row - b.grid.row || a.grid.col - b.grid.col),
    }),
  };
  const grid = createSchema5Grid(GridStack, root, viewConfig, pageId, (id, wrapper) => {
    if (!editing) {
      if (id === '__nav') {
        wrapper.className += ' cms-responsive-navigation';
      } else {
        const { w, h } = widgets.get(id).grid;
        const fraction = Number(w) / Number(config.settings.gridColumns);
        wrapper.style.setProperty('--cms-widget-fraction', String(Math.max(0.25, fraction)));
        wrapper.style.setProperty('--cms-widget-padding', `${100 * Number(h) / Number(w)}%`);
      }
    }
    if (id === '__nav') return navigation;
    const widget = widgets.get(id);
    const element = createWidgetElement(widget, services, snapshots, true);
    elements.set(id, element);
    return element;
  }, Boolean(editing));
  if (!editing) root.setAttribute('data-responsive', '');
  let destroyed = false;
  if (editing) {
    root.classList.toggle('cms-grid-editable', true);
    for (const wrapper of Array.from(root.children)) {
      const id = wrapper.gridstackNode?.id;
      const widget = widgets.get(id);
      const controls = document.createElement('div');
      controls.className = 'cms-widget-tools';
      const drag = document.createElement('button');
      drag.type = 'button';
      drag.className = 'cms-widget-drag';
      drag.textContent = '⠿';
      drag.title = `${widget?.title || widget?.id || 'Navigation'} verschieben`;
      drag.setAttribute('aria-label', drag.title);
      controls.append(drag);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'cms-widget-config';
      edit.textContent = '✎';
      edit.title = widget ? 'Widget einstellen' : 'Navigation einstellen';
      edit.setAttribute('aria-label', edit.title);
      edit.addEventListener('click', () => editing.onEdit(id));
      controls.append(edit);
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
      wrapper.append(controls);
    }
    grid.setStatic(false);
    grid.on('dragstop resizestop', () => {
      if (!destroyed) editing.onChange(grid.save(false));
    });
  }
  return {
    lock() {
      if (destroyed) return;
      root.inert = true;
      // Gridstack must finish its pointer-stop cleanup before DD is disabled.
      queueMicrotask(() => {
        if (destroyed) return;
        grid.enableMove(false);
        grid.enableResize(false);
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
      grid.destroy(false);
      if (!editing) root.removeAttribute('data-responsive');
      root.replaceChildren();
      if (editing) {
        root.classList.toggle('cms-grid-editable', false);
        root.inert = false;
      }
      elements.clear();
    },
  };
}
