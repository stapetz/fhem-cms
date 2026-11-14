import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSchema5WidgetServices, createWidgetServices } from '../www/fhem-cms/js/widget-services.js';

test('shared widget services preserve client arguments and allow retry after failed reads', async () => {
  const calls = [];
  let fail = true;
  const client = {
    async jsonlist(spec) {
      calls.push(['jsonlist', spec]);
      if (fail) { fail = false; throw new Error('offline'); }
      return [{ name: 'Temp' }];
    },
    async listIcons() { calls.push(['listIcons']); return ['icon']; },
    iconUrl: (...args) => { calls.push(['iconUrl', ...args]); return 'url'; },
    setCommand: (...args) => { calls.push(['setCommand', ...args]); },
    setReading: (...args) => { calls.push(['setReading', ...args]); },
    listMedia: (...args) => { calls.push(['listMedia', ...args]); },
    uploadMedia: (...args) => { calls.push(['uploadMedia', ...args]); },
    logReadings: (...args) => { calls.push(['logReadings', ...args]); },
    history: (...args) => { calls.push(['history', ...args]); },
  };
  const services = createSchema5WidgetServices(client);
  await assert.rejects(services.listDevices(), /offline/);
  assert.deepEqual(await services.listDevices(), [{ name: 'Temp' }]);
  await services.listDevices();
  await services.listAllDevices();
  await services.listAllDevices();
  await services.listIcons();
  await services.listIcons();
  assert.equal(services.iconUrl('lamp'), 'url');
  services.setCommand('Temp', 'on', '1');
  services.setTarget({ device: 'Temp', readings: { target: 'desired' } }, 21);
  services.setTarget({ device: 'Temp', readings: { target: 'desired' } }, 22, 'Temp2');
  services.listMedia();
  services.uploadMedia('abc');
  services.logReadings('Temp', 'filelog');
  services.history('Temp', 'state', '24h', '1h', 'auto');
  await assert.rejects(services.saveWidget({}), /Widgetdialog/);
  await assert.rejects(services.deleteWidget('x'), /Widgetdialog/);
  assert.deepEqual(calls, [
    ['jsonlist', 'TYPE=MAX,TYPE=CUL_HM'], ['jsonlist', 'TYPE=MAX,TYPE=CUL_HM'],
    ['jsonlist', '.*'], ['listIcons'], ['iconUrl', 'lamp'], ['setCommand', 'Temp', 'on', '1'],
    ['setReading', 'Temp', 'desired', 21], ['setReading', 'Temp2', 'desired', 22], ['listMedia'],
    ['uploadMedia', 'abc'], ['logReadings', 'Temp', 'filelog'],
    ['history', 'Temp', 'state', '24h', '1h', 'auto'],
  ]);
  assert.throws(() => createWidgetServices({ client }), /Vollständige/);
});

test('device refresh bypasses cache and propagates failures instead of serving stale readings', async () => {
  let reads = 0;
  let fail = false;
  const services = createSchema5WidgetServices({
    async jsonlist() {
      reads++;
      if (fail) throw new Error('refresh failed');
      return [{ name: 'Sensor', readings: { temperature: String(reads) } }];
    },
  });
  assert.equal((await services.listAllDevices())[0].readings.temperature, '1');
  assert.equal((await services.listAllDevices())[0].readings.temperature, '1');
  assert.equal((await services.listAllDevices({ refresh: true }))[0].readings.temperature, '2');
  assert.equal((await services.listAllDevices())[0].readings.temperature, '2');
  fail = true;
  await assert.rejects(services.listAllDevices({ refresh: true }), /refresh failed/);
  fail = false;
  assert.equal((await services.listAllDevices({ refresh: true }))[0].readings.temperature, '4');
});
