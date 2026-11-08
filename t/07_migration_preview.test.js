import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

class Element {
  constructor() { this.listeners = {}; this.children = []; this.value = ''; this.hidden = false; }
  append(child) { this.children.push(child); this.value ||= child.value; }
  replaceChildren() { this.children = []; this.value = ''; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  fire(type) { return this.listeners[type]({ preventDefault() {} }); }
}

test('one-button upgrade preserves separate draft and retains verified restore', async () => {
  const ids = ['device-form', 'device', 'upgrade', 'status', 'open-cms', 'load-backups',
    'backup', 'preview-backup', 'backup-status', 'backup-result', 'backup-live', 'backup-data',
    'external-backup', 'commit-restore'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const original = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  globalThis.document = {
    getElementById: (id) => elements[id],
    createElement: () => new Element(),
  };
  let confirmed = false;
  let restores = 0;
  globalThis.window = {
    location: { href: 'https://example.test/fhem/fhem-cms/examples/migration-preview.html?device=CMS' },
    addEventListener() {},
    confirm() { return confirmed; },
  };
  const commands = [];
  const config = { schemaVersion: 5, pages: [] };
  const state = { live: config, draft: config, token: 'a'.repeat(64) };
  const backupName = 'config.json.20000101-000000.bak';
  let fail = false;
  let pending;
  globalThis.fetch = async (url, options) => {
    if (!options.method) return new Response('', { headers: { 'X-FHEM-csrfToken': 'test' } });
    const cmd = options.body.get('cmd');
    commands.push(cmd);
    if (cmd === 'set CMS layoutupgrade') {
      if (pending) await pending;
      return new Response(fail ? 'Sicherung fehlgeschlagen' : JSON.stringify({
        schemaVersion: 5, backup: backupName, draftBackup: 'config.json.20000101-000001.bak',
      }));
    }
    if (cmd === 'get CMS version5state') return new Response(JSON.stringify(state));
    if (cmd === 'get CMS migrationbackups') return new Response(JSON.stringify([backupName]));
    if (cmd.startsWith('get CMS migrationrestorepreview ')) {
      return new Response(JSON.stringify({ live: config, backup: config, token: 'b'.repeat(64) }));
    }
    if (cmd.startsWith('set CMS migrationcommit restore ')) {
      restores += 1;
      return new Response(JSON.stringify({ backup: backupName }));
    }
    throw new Error(`Unexpected command ${cmd}`);
  };
  try {
    await import('../fcui/migration-preview.js');
    assert.equal(elements.device.value, 'CMS');
    assert.deepEqual(commands, [], 'loading the page does not migrate');
    let release;
    pending = new Promise((resolve) => { release = resolve; });
    const upgrade = elements['device-form'].fire('submit');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(elements.upgrade.disabled, true);
    await elements['device-form'].fire('submit');
    release();
    await upgrade;
    pending = undefined;
    assert.deepEqual(commands, ['set CMS layoutupgrade', 'get CMS version5state'], 'one click uses only upgrade and verification');
    assert.match(elements.status.textContent, /Live-Sicherung.*Entwurfssicherung/);
    assert.match(elements['open-cms'].href, /CMS\/index\.html\?mode=edit/);
    await elements['load-backups'].fire('click');
    assert.equal(elements.backup.children.length, 1);
    await elements['preview-backup'].fire('click');
    assert.equal(elements['backup-result'].hidden, false);
    assert.match(elements['backup-live'].textContent, /schemaVersion/);
    elements['external-backup'].checked = true;
    await elements['external-backup'].fire('change');
    assert.equal(elements['commit-restore'].disabled, false);
    await elements['commit-restore'].fire('click');
    assert.equal(restores, 0, 'cancelled restore sends no write');
    assert.equal(elements['commit-restore'].disabled, false, 'cancel leaves verified restore usable');
    confirmed = true;
    await elements['commit-restore'].fire('click');
    assert.equal(restores, 1);
    assert.match(elements['backup-status'].textContent, /Wiederherstellung abgeschlossen/);
    fail = true;
    await elements['device-form'].fire('submit');
    assert.match(elements.status.textContent, /Sicherung fehlgeschlagen.*neu laden/);
    assert.equal(elements.upgrade.disabled, true, 'uncertain response locks further actions');
    const count = commands.length;
    await elements['device-form'].fire('submit');
    await elements['load-backups'].fire('click');
    assert.equal(commands.length, count, 'failed action never retried silently');
    const html = await readFile(new URL('../www/fhem-cms/examples/migration-preview.html', import.meta.url), 'utf8');
    assert.match(html, /id="upgrade" type="submit">Jetzt umstellen/);
    assert.doesNotMatch(html, /id="validate"|id="file"|id="forms"|id="commit-migration"/,
      'old migration workflow has been removed');
  } finally {
    Object.assign(globalThis, original);
  }
});
