import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MigrationController } from '../www/fhem-cms/js/fcui-migration-controller.js';

test('migration controller requires the displayed state, confirmation and a fresh preview after writes', async () => {
  const token = 'a'.repeat(64);
  const source = { schemaVersion: 4, pages: [{ id: 'one' }], theme: 'dark' };
  const positions = { pages: [{ id: 'one', col: 1 }] };
  let release;
  let sent;
  let fail = false;
  let liveAfterWrite = source;
  const transport = {
    async previewMigration(plan) {
      plan.pages[0].col = 99;
      return { source: { theme: 'dark', pages: [{ id: 'one' }], schemaVersion: 4 },
        config: { schemaVersion: 5 }, token };
    },
    async previewRestore() { return { live: liveAfterWrite, backup: source, token }; },
    async migrate(plan, actualToken) {
      sent = { plan, token: actualToken };
      if (fail) throw new Error('Antwort verloren');
      return new Promise((resolve) => { release = resolve; });
    },
    async restore(name, actualToken) { return `${name}:${actualToken}`; },
  };
  const controller = new MigrationController(transport);
  await assert.rejects(controller.commit(() => true), /Vorschau/);
  await assert.rejects(controller.previewMigration({ ...source, theme: 'light' }, positions), /geändert/);
  await assert.rejects(controller.commit(() => true), /Vorschau/);
  const preview = await controller.previewMigration(source, positions);
  positions.pages[0].col = 7;
  preview.token = 'b'.repeat(64);
  assert.equal(await controller.commit(() => false), null);
  assert.equal(sent, undefined);
  const write = controller.commit((shown) => {
    shown.result.token = 'c'.repeat(64);
    return true;
  });
  assert.deepEqual(sent, { plan: { pages: [{ id: 'one', col: 1 }] }, token });
  await assert.rejects(controller.commit(() => true), /läuft bereits/);
  await assert.rejects(controller.previewRestore('backup'), /läuft bereits/);
  liveAfterWrite = { schemaVersion: 5 };
  release('backup');
  assert.equal(await write, 'backup');
  await assert.rejects(controller.commit(() => true), /Vorschau/);
  await controller.previewMigration(source, positions);
  fail = true;
  await assert.rejects(controller.commit(() => true), /Antwort verloren/);
  await assert.rejects(controller.commit(() => true), /Vorschau/);
  await controller.previewRestore('selected-backup');
  liveAfterWrite = source;
  assert.equal(await controller.commit(() => true), `selected-backup:${token}`);
  await controller.previewRestore('selected-backup');
  await assert.rejects(controller.commit(() => { controller.invalidate(); return true; }), /verworfen/);
  await assert.rejects(controller.commit(() => true), /Vorschau/);
  controller.stop();
  await assert.rejects(controller.previewRestore('backup'), /beendet/);
});

test('invalidating or stopping an in-flight preview discards the eventual result', async () => {
  let resolvePreview;
  const controller = new MigrationController({
    previewMigration: () => new Promise((resolve) => { resolvePreview = resolve; }),
    previewRestore() {}, migrate() {}, restore() {},
  });

  const pending = controller.previewMigration({}, {});
  controller.invalidate();
  resolvePreview({ source: {}, token: 'a'.repeat(64) });
  await assert.rejects(pending, /verworfen/);
  await assert.rejects(controller.commit(() => true), /Vorschau/);
  const stopping = controller.previewMigration({}, {});
  controller.stop();
  resolvePreview({ source: {}, token: 'a'.repeat(64) });
  await assert.rejects(stopping, /verworfen/);
});

test('a successful write with an unverified result requires a new preview', async () => {
  const controller = new MigrationController({
    async previewMigration() {
      return { source: {}, config: { schemaVersion: 5 }, token: 'a'.repeat(64) };
    },
    async previewRestore() { return { live: { schemaVersion: 4 } }; },
    async migrate() { return 'backup'; },
    async restore() { throw new Error('unexpected'); },
  });
  await controller.previewMigration({}, {});
  await assert.rejects(controller.commit(() => true), /nicht eindeutig verifiziert/);
  await assert.rejects(controller.commit(() => true), /Vorschau/);
});
