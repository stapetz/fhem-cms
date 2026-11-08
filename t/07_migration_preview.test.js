import assert from 'node:assert/strict';
import { test } from 'node:test';

class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.files = [];
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  async fire(type) {
    assert.ok(this.listeners[type], `missing ${type} listener on ${this.tag}`);
    return this.listeners[type]({ preventDefault() {} });
  }
  get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
}

test('migration preview is read-only, handles adjustments and rejects stale live data', async () => {
  const ids = ['file', 'status', 'preview', 'page', 'summary', 'canvas', 'forms', 'device-form', 'device', 'validate'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element(id)]));
  const previous = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  globalThis.document = {
    getElementById(id) { return elements[id]; },
    createElement(tag) { return new Element(tag); },
  };
  globalThis.window = { location: { href: 'https://example.test/fhem/fhem-cms/examples/migration-preview.html' } };
  const source = {
    schemaVersion: 4, pages: [
      { id: 'one', title: 'One', widgets: [
        { id: 'html', type: 'text', html: '<img src=x onerror=alert(1)> {{Dev:state}}',
          grid: { col: 2, row: 1, w: 3, h: 1 } },
      ] },
      { id: 'two', title: 'Two', widgets: [] },
    ],
  };
  let stale = false;
  let draft = false;
  const commands = [];
  globalThis.fetch = async (url, options) => {
    if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test-token' } });
    const command = options.body.get('cmd');
    commands.push(command);
    if (command === 'get CMS status') return new Response(JSON.stringify({ draft }));
    if (command === 'get CMS config') return new Response(JSON.stringify(source));
    if (command.startsWith('get CMS migrationpreview ')) {
      return new Response(JSON.stringify({
        source: stale ? { ...source, theme: 'light' } : source,
        config: { schemaVersion: 5 }, token: 'a'.repeat(64),
      }));
    }
    throw new Error(`unexpected command: ${command}`);
  };
  try {
    await import('../fcui/migration-preview.js');
    elements.file.files = [{ size: 1048577 }];
    await elements.file.fire('change');
    assert.match(elements.status.textContent, /höchstens 1 MiB/);
    assert.equal(elements.preview.hidden, true);
    elements.file.files = [{ size: 1, text: async () => '{' }];
    await elements.file.fire('change');
    assert.match(elements.status.textContent, /nicht analysiert/);

    elements.device.value = 'CMS';
    await elements['device-form'].fire('submit');
    assert.equal(elements.preview.hidden, false);
    assert.equal(elements.validate.hidden, false);
    assert.match(elements.summary.textContent, /Offene Positionen: 1/);
    const widgetForm = elements.forms.children[1];
    const fieldset = widgetForm.children[0];
    const original = fieldset.children.find((child) => child.tag === 'details').children[1];
    assert.match(original.textContent, /<img src=x onerror=alert\(1\)>/);
    assert.deepEqual(original.children, [], 'source HTML is inserted as text, not markup');
    await elements.validate.fire('click');
    assert.match(elements.status.textContent, /Nicht alle Positionen/);
    assert.equal(commands.length, 2, 'unresolved position sends no preview command');

    const labels = fieldset.children.filter((child) => child.tag === 'label');
    ['1', '2', '1', '1'].forEach((value, index) => { labels[index].children[0].value = value; });
    await widgetForm.fire('submit');
    assert.match(elements.summary.textContent, /Offene Positionen: 0/);
    await elements.validate.fire('click');
    assert.match(elements.status.textContent, /serverseitig geprüft/);
    stale = true;
    await elements.validate.fire('click');
    assert.match(elements.status.textContent, /Live-Daten wurden geändert/);
    assert.ok(commands.every((command) => command.startsWith('get ')), 'only read commands are sent');

    elements.device.value = 'Other';
    await elements.device.fire('input');
    assert.equal(elements.preview.hidden, true, 'changing device clears displayed data');
    draft = true;
    elements.device.value = 'CMS';
    await elements['device-form'].fire('submit');
    assert.match(elements.status.textContent, /Entwurf ist vorhanden/);
    assert.equal(elements.preview.hidden, true);
  } finally {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.fetch = previous.fetch;
  }
});
