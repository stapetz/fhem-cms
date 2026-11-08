import { createSchema5Grid, schema5GridItems } from './fcui-schema5-layout.js';
import { createWidgetElement, dataFor, isLiveWidget } from './widget-factory.js';

export function mountSchema5Widgets(GridStack, root, config, pageId, navigation, services, snapshots) {
  if (!navigation || !services || typeof services !== 'object' || !(snapshots instanceof Map)) {
    throw new Error('Navigation, Widget-Dienste und Snapshot-Map erforderlich');
  }
  schema5GridItems(config, pageId);
  const page = config.pages.find((item) => item.id === pageId);
  const widgets = new Map(page.widgets.map((widget) => [widget.id, widget]));
  const elements = new Map();
  const grid = createSchema5Grid(GridStack, root, config, pageId, (id) => {
    if (id === '__nav') return navigation;
    const widget = widgets.get(id);
    const element = createWidgetElement(widget, services, snapshots, true);
    elements.set(id, element);
    return element;
  });
  let destroyed = false;
  return {
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
      root.replaceChildren();
      elements.clear();
    },
  };
}
