import assert from 'node:assert/strict';
import { test } from 'node:test';

test('schema 5 widget adapter preserves bindings and cleans up the grid', async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, customElements: globalThis.customElements,
  };
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.attributes = {};
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.classList = { toggle() {} };
    }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener() {}
  }
  globalThis.window = { location: { href: 'https://example.test/' } };
  globalThis.document = { createElement: (tag) => new Element(tag) };
  globalThis.HTMLElement = class {};
  const registry = new Map();
  globalThis.customElements = {
    define(name, element) { registry.set(name, element); },
    get(name) { return registry.get(name); },
  };
  try {
    const { mountSchema5Widgets } = await import('../www/fhem-cms/js/fcui-schema5-widgets.js');
    const { resizeSchema5Grid } = await import('../www/fhem-cms/js/fcui-schema5-layout.js');
    const config = {
      schemaVersion: 5, settings: { layoutMode: 'grid', gridColumns: 12 },
      navigation: { grid: { col: 1, row: 1, w: 12, h: 1 } },
      pages: [{ id: 'one', widgets: [
        { id: 'html', type: 'fhem-html', devices: ['Temp'], html: '{{Temp:state}}',
          grid: { col: 1, row: 2, w: 3, h: 1 } },
        { id: 'button', type: 'fhem-button', device: 'Lamp',
          grid: { col: 4, row: 2, w: 3, h: 1 } },
      ] }],
    };
    const root = new Element('grid');
    const navigation = new Element('nav');
    const services = {};
    const grid = {
      items: [], destroyed: 0,
      getColumn() { return this.columns; },
      makeWidget(wrapper, item) { this.items.push({ ...item }); wrapper.gridstackNode = { ...item }; },
      save() { return structuredClone(this.items); },
      destroy(remove) { assert.equal(remove, false); this.destroyed += 1; },
      setStatic(value) { this.static = value; },
      on() {},
    };
    const api = { init(options) { grid.columns = options.column; grid.items = []; return grid; } };
    const oldData = [{ name: 'Temp', readings: { state: 'old' } }];
    const mounted = mountSchema5Widgets(api, root, config, 'one', navigation, services, new Map([['Temp', oldData]]));
    assert.equal(root.children.length, 3);
    assert.equal(root.attributes['data-responsive'], '');
    assert.match(root.children[0].className, /cms-responsive-navigation/);
    assert.equal(root.children[1].style['--cms-widget-fraction'], '0.25');
    assert.equal(root.children[1].style['--cms-widget-padding'], `${100 / 3}%`);
    assert.equal(root.children[0].children[0].children[0], navigation);
    const html = root.children[1].children[0].children[0];
    const button = root.children[2].children[0].children[0];
    assert.equal(html.tag, 'cms-html');
    assert.equal(html.config, config.pages[0].widgets[0]);
    assert.equal(html.services, services);
    assert.equal(html.data.get('Temp'), oldData);
    assert.equal(html.attributes['view-only'], '');
    assert.equal(button.tag, 'cms-button');
    assert.equal(button.attributes['view-only'], '');
    assert.equal('data' in button, false);
    const nextData = [{ name: 'Temp', readings: { state: 'new' } }];
    mounted.update(new Map([['Temp', nextData]]), 123);
    assert.equal(html.data.get('Temp'), nextData);
    assert.equal(html.stale, 123);
    assert.equal('data' in button, false);
    mounted.update(new Map(), null);
    assert.equal(html.data.size, 0);
    assert.equal(html.stale, null);
    assert.throws(() => mounted.update({}), /Snapshot-Map/);
    mounted.destroy();
    mounted.destroy();
    assert.equal(grid.destroyed, 1);
    assert.equal(root.children.length, 0);
    assert.equal('data-responsive' in root.attributes, false);
    assert.throws(() => mounted.update(new Map()), /bereits entfernt/);
    assert.throws(() => mountSchema5Widgets(api, root, config, 'missing', navigation, services, new Map()), /Unbekannte Seite/);
    assert.throws(() => mountSchema5Widgets(api, root, config, 'one', navigation, null, new Map()), /Widget-Dienste/);
    grid.save = () => [{ id: '__nav', x: 0, y: 1, w: 12, h: 1 },
      { id: 'html', x: 0, y: 1, w: 3, h: 1 }, { id: 'button', x: 3, y: 1, w: 3, h: 1 }];
    assert.throws(() => mountSchema5Widgets(api, root, config, 'one', navigation, services, new Map()), /Position verändert/);
    assert.equal(root.children.length, 0);
    assert.equal(grid.destroyed, 2, 'invalid grid is destroyed before widgets are attached');
    grid.save = () => structuredClone(grid.items);
    const mixed = structuredClone(config);
    const [small, second] = mixed.pages[0].widgets;
    const normal = { ...small, id: 'normal', grid: { col: 1, row: 3, w: 6, h: 2 } };
    const wide = { ...small, id: 'wide', grid: { col: 1, row: 5, w: 12, h: 1 } };
    mixed.pages[0].widgets = [wide, second, normal, small];
    for (const columns of [12, 24, 48, 96, 192]) {
      const current = resizeSchema5Grid(mixed, columns);
      const before = structuredClone(current);
      const view = mountSchema5Widgets(api, root, current, 'one', navigation, services, new Map());
      assert.deepEqual(root.children.map((child) => child.gridstackNode.id),
        ['__nav', 'html', 'button', 'normal', 'wide'], 'DOM and tab order follow the original visual order');
      assert.deepEqual(root.children.slice(1).map((child) => child.style['--cms-widget-fraction']),
        ['0.25', '0.25', '0.5', '1']);
      assert.equal(root.children[3].style['--cms-widget-padding'], `${100 / 3}%`);
      assert.deepEqual(current, before, 'responsive presentation never mutates the persisted configuration');
      view.destroy();
      const editor = mountSchema5Widgets(api, root, current, 'one', navigation, services, new Map(),
        { onEdit() {}, onChange() {} });
      assert.equal('data-responsive' in root.attributes, false, 'editing is never reflowed');
      assert.ok(root.children.every((child) => !('--cms-widget-fraction' in child.style)));
      assert.ok(root.children.every((child) => !('--cms-widget-padding' in child.style)));
      assert.equal(grid.static, false);
      assert.deepEqual(current, before);
      editor.destroy();
    }
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.customElements = previous.customElements;
  }
});
