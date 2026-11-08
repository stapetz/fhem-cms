import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Schema5DraftController } from '../www/fhem-cms/js/fcui-schema5-draft.js';
import { Schema5MovePanel } from '../www/fhem-cms/js/fcui-schema5-move-panel.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.value = '';
  }
  append(...children) {
    this.children.push(...children);
    if (this.tag === 'select' && !this.value && this.children.length) this.value = this.children[0].value;
  }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name) { return this.listeners[name]({ preventDefault() {} }); }
}

function fixture() {
  const live = {
    schemaVersion: 5, settings: { layoutMode: 'grid', gridColumns: 12 },
    navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
    pages: [
      { id: 'a', title: 'A', widgets: [
        { id: 'text', type: 'text', title: 'Notiz', html: 'Hallo', grid: { col: 3, row: 4, w: 4, h: 2 } },
      ] },
      { id: 'b', title: 'B', widgets: [
        { id: 'other', type: 'text', html: 'B', grid: { col: 1, row: 2, w: 2, h: 3 } },
      ] },
    ],
  };
  let state = { live, draft: null, token: 'a'.repeat(64) };
  let fail = false;
  const controller = new Schema5DraftController({
    read: async () => structuredClone(state),
    save: async (draft, token) => {
      assert.equal(token, state.token);
      if (fail) throw new Error('Antwort verloren');
      state = { live, draft, token: 'b'.repeat(64) };
    },
    publish: async () => {}, discard: async () => {},
  });
  return { controller, fail: () => { fail = true; } };
}

test('move panel moves a widget below the target page content and saves once', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const state = await f.controller.reload();
    const root = new Element('section');
    let closed;
    new Schema5MovePanel({ root, controller: f.controller, pageId: 'a', widgetId: 'text',
      token: state.token, onClose: (outcome) => { closed = outcome; } });
    assert.equal(root.children[0].textContent, 'Widget auf andere Seite verschieben');
    assert.match(root.children[1].textContent, /„Notiz“/, 'uses the title as internal name');
    const select = root.children[3].children[0];
    const [move, cancel] = root.children[4].children;
    assert.equal(select.value, 'b');
    assert.equal(move.textContent, 'Verschieben');
    assert.equal(cancel.textContent, 'Abbrechen');
    await move.fire('click');
    assert.deepEqual(closed, { requiresReload: false });
    assert.equal(root.children.length, 0);
    const draft = f.controller.snapshot().draft;
    assert.equal(draft.pages[0].widgets.length, 0);
    const moved = draft.pages[1].widgets.find((widget) => widget.id === 'text');
    // Navigation endet bei Zeile 2, Widget "other" bei Zeile 5 -> neue Zeile 5
    assert.deepEqual(moved.grid, { col: 1, row: 5, w: 4, h: 2 });
    assert.equal(moved.html, 'Hallo');
  } finally {
    globalThis.document = previous;
  }
});

test('move panel reports uncertain moves and offers no target on a single page', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const f = fixture();
    const state = await f.controller.reload();
    f.fail();
    const root = new Element('section');
    let closed;
    new Schema5MovePanel({ root, controller: f.controller, pageId: 'a', widgetId: 'text',
      token: state.token, onClose: (outcome) => { closed = outcome; } });
    await root.children[4].children[0].fire('click');
    assert.match(root.children[2].textContent, /nicht bestätigt/);
    root.children[4].children[1].fire('click');
    assert.equal(closed.requiresReload, true);

    // Einzige Seite: kein Ziel, Verschieben deaktiviert
    const single = {
      schemaVersion: 5, settings: { layoutMode: 'grid', gridColumns: 12 },
      navigation: { orientation: 'horizontal', grid: { col: 1, row: 1, w: 12, h: 1 } },
      pages: [{ id: 'a', title: 'A', widgets: [
        { id: 'text', type: 'text', html: 'Hallo', grid: { col: 1, row: 2, w: 2, h: 2 } },
      ] }],
    };
    let soloState = { live: single, draft: null, token: 'c'.repeat(64) };
    const solo = new Schema5DraftController({
      read: async () => structuredClone(soloState),
      save: async () => { throw new Error('darf nicht schreiben'); },
      publish: async () => {}, discard: async () => {},
    });
    const loaded = await solo.reload();
    const soloRoot = new Element('section');
    new Schema5MovePanel({ root: soloRoot, controller: solo, pageId: 'a', widgetId: 'text',
      token: loaded.token, onClose: () => {} });
    assert.equal(soloRoot.children[4].children[0].disabled, true);
    assert.match(soloRoot.children[2].textContent, /keine weitere Seite/);
  } finally {
    globalThis.document = previous;
  }
});
