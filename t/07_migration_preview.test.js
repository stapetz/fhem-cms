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

test('migration preview requires backup and confirmation, handles adjustments and rejects stale data', async () => {
  const ids = ['file', 'status', 'preview', 'page', 'summary', 'canvas', 'forms', 'device-form', 'device', 'validate',
    'load-backups', 'backup-controls', 'backup', 'preview-backup', 'backup-status', 'backup-result', 'backup-live', 'backup-data',
    'show-target', 'target', 'target-grid', 'target-status', 'grid-css',
    'show-widgets', 'widget-target', 'widget-grid', 'widget-status'];
  ids.push('commit-migration', 'commit-restore', 'external-backup', 'migration-ready');
  const elements = Object.fromEntries(ids.map((id) => [id, new Element(id)]));
  const previous = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  let confirmed = false;
  let changed = false;
  globalThis.document = {
    getElementById(id) { return elements[id]; },
    createElement(tag) { return new Element(tag); },
  };
  globalThis.window = {
    location: { href: 'https://example.test/fhem/fhem-cms/examples/migration-preview.html' },
    addEventListener() {},
    confirm() { return confirmed; },
  };
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
  let invalidSource = false;
  let delayedBackup;
  const commands = [];
  globalThis.fetch = async (url, options) => {
    if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test-token' } });
    const command = options.body.get('cmd');
    commands.push(command);
    if (command === 'get CMS migrationstate') {
      return new Response(draft ? 'Entwurf vorhanden: zuerst veroeffentlichen oder verwerfen'
        : JSON.stringify(invalidSource ? {} : source));
    }
    if (command === 'get CMS migrationbackups') return new Response(JSON.stringify(['config.json.20000101-000000.bak']));
    if (/^get CMS migrationrestorepreview config\.json\.20000101-00000[01]\.bak$/.test(command)) {
      if (delayedBackup) return new Promise((resolve) => {
        delayedBackup.resolve = resolve;
        delayedBackup.started();
      });
      return new Response(JSON.stringify({ live: changed ? { schemaVersion: 5 } : source,
        backup: source, token: 'b'.repeat(64) }));
    }
    if (command.startsWith('get CMS migrationpreview ')) {
      return new Response(JSON.stringify({
        source: stale ? { ...source, theme: 'light' } : source,
        config: { schemaVersion: 5 }, token: 'a'.repeat(64),
      }));
    }
    if (command.startsWith('set CMS migrationcommit ')) {
      changed = true;
      return new Response(JSON.stringify({ backup: 'config.json.20000101-000001.bak' }));
    }
    throw new Error(`unexpected command: ${command}`);
  };
  try {
    await import('../fcui/migration-preview.js');
    assert.equal(elements.validate.disabled, true);
    assert.equal(elements['commit-migration'].disabled, true);
    assert.match(elements['migration-ready'].textContent, /Live-Daten/);
    elements.file.files = [{ size: 1048577 }];
    await elements.file.fire('change');
    assert.match(elements.status.textContent, /höchstens 1 MiB/);
    assert.equal(elements.preview.hidden, true);
    elements.file.files = [{ size: 1, text: async () => '{' }];
    await elements.file.fire('change');
    assert.match(elements.status.textContent, /nicht analysiert/);
    elements.file.files = [{ size: 1, text: async () => JSON.stringify(source) }];
    await elements.file.fire('change');
    assert.equal(elements.preview.hidden, false);
    assert.equal(elements.validate.disabled, true, 'local file cannot be sent for migration');
    assert.equal(elements['commit-migration'].disabled, true, 'local file cannot be migrated');

    elements.device.value = 'CMS';
    await elements['device-form'].fire('submit');
    assert.equal(elements.preview.hidden, false);
    assert.equal(elements.validate.disabled, false);
    assert.equal(elements['commit-migration'].disabled, true);
    assert.match(elements['migration-ready'].textContent, /serverseitig prüfen/);
    assert.match(elements.summary.textContent, /Offene Positionen: 0/);
    const widgetForm = elements.forms.children[1];
    const fieldset = widgetForm.children[0];
    const original = fieldset.children.find((child) => child.tag === 'details').children[1];
    assert.match(original.textContent, /<img src=x onerror=alert\(1\)>/);
    assert.deepEqual(original.children, [], 'source HTML is inserted as text, not markup');
    const labels = fieldset.children.filter((child) => child.tag === 'label');
    assert.deepEqual(labels.map((label) => label.children[0].value), ['1', '2', '1', '1']);
    labels[1].children[0].value = '1';
    await widgetForm.fire('submit');
    await elements.validate.fire('click');
    assert.match(elements.status.textContent, /überschneiden/);
    assert.equal(commands.length, 1, 'colliding manual positions are not sent');
    const resetFieldset = elements.forms.children[1].children[0];
    await resetFieldset.children.find((child) => child.textContent === 'Anpassung zurücksetzen').fire('click');
    assert.match(elements.status.textContent, /Automatischer Vorschlag wiederhergestellt/);
    await elements.validate.fire('click');
    assert.match(elements.status.textContent, /serverseitig geprüft/);
    assert.equal(elements['commit-migration'].disabled, true);
    assert.match(elements['migration-ready'].textContent, /Sicherung bestätigen/);
    elements['external-backup'].checked = true;
    await elements['external-backup'].fire('change');
    assert.equal(elements['commit-migration'].disabled, false);
    elements['external-backup'].checked = false;
    await elements['external-backup'].fire('change');
    assert.equal(elements['commit-migration'].disabled, true, 'removing backup confirmation blocks migration');
    assert.equal(elements['show-target'].hidden, false);
    assert.equal(elements['show-widgets'].hidden, false);
    await elements['show-widgets'].fire('click');
    assert.match(elements['widget-status'].textContent, /Gridstack-CSS konnte nicht geladen werden/);
    await elements['show-target'].fire('click');
    assert.equal(elements.target.hidden, false);
    assert.match(elements['target-status'].textContent, /Gridstack-CSS konnte nicht geladen werden/);
    await elements.page.fire('change');
    assert.match(elements['target-status'].textContent, /Gridstack-CSS konnte nicht geladen werden/);
    await elements['load-backups'].fire('click');
    assert.equal(elements['backup-controls'].hidden, false);
    elements.backup.value = 'config.json.20000101-000000.bak';
    await elements['preview-backup'].fire('click');
    assert.equal(elements['backup-result'].hidden, false);
    assert.match(elements['backup-data'].textContent, /<img src=x onerror=alert\(1\)>/);
    assert.deepEqual(elements['backup-data'].children, [], 'backup HTML is shown as text');
    assert.match(elements['backup-status'].textContent, /nichts wiederhergestellt/);
    stale = true;
    await elements.validate.fire('click');
    assert.match(elements.status.textContent, /Migrationsquelle hat sich geändert/);
    assert.equal(elements['show-target'].hidden, true, 'stale validation clears target preview');
    assert.equal(elements['show-widgets'].hidden, true, 'stale validation clears widget preview');
    assert.equal(elements.target.hidden, true, 'stale validation hides target preview');
    assert.equal(elements['widget-target'].hidden, true, 'stale validation hides widget preview');
    assert.ok(commands.every((command) => command.startsWith('get ')), 'only read commands are sent');
    stale = false;
    await elements.validate.fire('click');
    await elements['commit-migration'].fire('click');
    assert.match(elements.status.textContent, /vollständige externe Sicherung/);
    assert.ok(commands.every((command) => command.startsWith('get ')), 'missing external backup blocks writes');
    await elements.validate.fire('click');
    elements['external-backup'].checked = true;
    await elements['external-backup'].fire('change');
    assert.equal(elements['commit-migration'].disabled, false);
    await elements['commit-migration'].fire('click');
    assert.ok(commands.every((command) => command.startsWith('get ')), 'cancelled confirmation sends no write');
    confirmed = true;
    await elements['commit-migration'].fire('click');
    assert.match(elements.status.textContent, /Umstellung abgeschlossen.*config\.json/);
    assert.equal(commands.filter((command) => command.startsWith('set CMS migrationcommit migrate ')).length, 1);
    assert.equal(elements.preview.hidden, true);
    assert.equal(elements['commit-migration'].disabled, true);

    await elements['load-backups'].fire('click');
    elements.backup.value = 'config.json.20000101-000000.bak';
    delayedBackup = {};
    const started = new Promise((resolve) => { delayedBackup.started = resolve; });
    const pending = elements['preview-backup'].fire('click');
    await started;
    elements.device.value = 'Other';
    await elements.device.fire('input');
    delayedBackup.resolve(new Response(JSON.stringify({ live: source, backup: source, token: 'b'.repeat(64) })));
    await pending;
    assert.equal(elements.preview.hidden, true, 'changing device clears displayed data');
    assert.equal(elements['backup-result'].hidden, true, 'changing device clears backup preview');
    assert.equal(elements['backup-controls'].hidden, true, 'changing device clears backup choices');
    assert.equal(elements['backup-data'].textContent, '', 'late backup response cannot expose old content');
    draft = true;
    elements.device.value = 'CMS';
    await elements['device-form'].fire('submit');
    assert.match(elements.status.textContent, /Entwurf vorhanden/);
    assert.equal(elements.preview.hidden, true);
    draft = false;
    invalidSource = true;
    const before = commands.length;
    await elements['device-form'].fire('submit');
    assert.match(elements.status.textContent, /Unerwartete Antwort für die Migrationsquelle/);
    assert.deepEqual(commands.slice(before), ['get CMS migrationstate'], 'invalid source is rejected');
    assert.equal(elements.preview.hidden, true);
  } finally {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.fetch = previous.fetch;
  }
});
