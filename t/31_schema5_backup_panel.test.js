import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Schema5BackupPanel } from '../www/fhem-cms/js/fcui-schema5-backup-panel.js';
import { MigrationController } from '../www/fhem-cms/js/fcui-migration-controller.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.value = '';
    this.checked = false;
  }
  append(...children) {
    this.children.push(...children);
    if (this.tag === 'select' && !this.value && this.children.length) this.value = this.children[0].value;
  }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name) { return this.listeners[name]({ preventDefault() {} }); }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('backup panel lists, previews and restores through the guarded migration controller', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const backupName = 'config.json.20261108-190000.bak';
    const live = { schemaVersion: 5, pages: [] };
    const backupConfig = { schemaVersion: 5, pages: [{ id: 'alt', title: 'Alt', widgets: [] }] };
    let restored = 0;
    let failRestore = false;
    const transport = {
      previewMigration: async () => { throw new Error('nicht benötigt'); },
      previewRestore: async (name) => {
        // Vorschau für die Auswahl und für die Verifikation nach der Wiederherstellung.
        assert.match(name, /^config\.json\./);
        return structuredClone({ live: restored ? backupConfig : live, backup: backupConfig, token: 'c'.repeat(64) });
      },
      migrate: async () => { throw new Error('nicht benötigt'); },
      restore: async (name, token) => {
        assert.equal(name, backupName);
        assert.equal(token, 'c'.repeat(64));
        if (failRestore) throw new Error('Antwort verloren');
        restored += 1;
        return 'config.json.20261108-191500.bak';
      },
    };
    const client = {
      getMigrationBackups: async () => [backupName],
    };
    let confirmed = false;
    const browser = { confirm: () => confirmed };
    const root = new Element('section');
    let closed;
    new Schema5BackupPanel({ root, client, browser,
      createController: () => new MigrationController(transport),
      onClose: (outcome) => { closed = outcome; } });
    assert.equal(root.children[0].textContent, 'Sicherungen / Wiederherstellung');
    const status = root.children[2];
    const controls = root.children[3];
    const [load, selectLabel, preview] = controls.children;
    const select = selectLabel.children[0];
    const result = root.children[4];
    const external = result.children[4].children[0];
    const restore = result.children[5];
    const close = root.children[5].children[0];
    assert.equal(close.textContent, 'Schließen');
    assert.equal(select.disabled, true);
    assert.equal(preview.disabled, true);

    await load.fire('click');
    assert.match(status.textContent, /1 Sicherungen gefunden/);
    assert.equal(select.disabled, false);
    assert.equal(select.value, backupName);

    await preview.fire('click');
    assert.equal(result.hidden, false);
    assert.match(result.children[1].textContent, /schemaVersion/);
    assert.match(result.children[3].textContent, /"alt"/);
    assert.equal(restore.disabled, true, 'restore requires the external backup confirmation');

    external.checked = true;
    external.fire('change');
    assert.equal(restore.disabled, false);

    // Abgelehnte Bestätigung schreibt nichts
    confirmed = false;
    await restore.fire('click');
    assert.equal(restored, 0);

    // Bestätigte Wiederherstellung wird verifiziert und verlangt ein Neuladen
    confirmed = true;
    await restore.fire('click');
    await tick();
    assert.equal(restored, 1);
    assert.match(status.textContent, /Wiederherstellung abgeschlossen/);
    assert.equal(result.hidden, true);
    close.fire('click');
    assert.deepEqual(closed, { requiresReload: true });
    assert.equal(root.children.length, 0);

    // Unsichere Wiederherstellung sperrt den Dialog
    const root2 = new Element('section');
    let closed2;
    restored = 0;
    new Schema5BackupPanel({ root: root2, client, browser,
      createController: () => new MigrationController(transport),
      onClose: (outcome) => { closed2 = outcome; } });
    const controls2 = root2.children[3];
    await controls2.children[0].fire('click');
    await controls2.children[2].fire('click');
    const result2 = root2.children[4];
    result2.children[4].children[0].checked = true;
    result2.children[4].children[0].fire('change');
    failRestore = true;
    await result2.children[5].fire('click');
    assert.match(root2.children[2].textContent, /nicht bestätigt/);
    assert.equal(controls2.children[0].disabled, true, 'uncertain restore locks further actions');
    root2.children[5].children[0].fire('click');
    assert.deepEqual(closed2, { requiresReload: true });
  } finally {
    globalThis.document = previous;
  }
});
