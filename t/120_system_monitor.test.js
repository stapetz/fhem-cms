import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystemMonitorDevices, systemMonitorSnapshot, systemMonitorGraphCandidates, systemMonitorMetricForGraph } from '../www/fhem-cms/js/system-monitor.js';
import { blueprintDevices, remapBlueprintDevice } from '../www/fhem-cms/js/fcui-schema5-blueprints.js';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';

test('system monitor keeps FHEM system and log sources distinct', () => {
  const devices = [
    {name: 'Local', alias: 'Server', type: 'SYSMON', readings: {
      fhemuptime_text: '2 days', loadavg: '0.1 0.2 0.3', ram: 'Total: 1024 MB', cpu_temp: '0',
      fs_root: 'Total: 7340 MB, Used: 3573 MB',
    }},
    {name: 'Remote', type: 'SYSMON', readings: {loadavg: '9'}},
    {name: 'Db', type: 'DbLog', readings: {state: 'connected', LastError: 'bad\nvalue', DbFileSize:'200'}},
    {name: 'File', type: 'FileLog', readings: {}},
    {name: 'Other', type: 'dummy', readings: {state: 'anything'}},
  ];
  const result = systemMonitorSnapshot(devices, 'Local');
  assert.equal(result.systems.length, 2);
  assert.equal(result.selected, 'Local');
  assert.equal(result.metrics.find(item => item.reading === 'loadavg').value, '0.1 0.2 0.3');
  assert.equal(result.metrics.find(item => item.reading === 'cpu_temp').value, '0');
  assert.equal(result.metrics.find(item => item.reading === 'fs_root').value, 'Total: 7340 MB, Used: 3573 MB');
  assert.equal(result.metrics.find(item => item.reading === 'uptime_text').value, null);
  assert.deepEqual(result.logs.map(item => item.name), ['Db', 'File']);
  assert.equal(result.logs[0].readings[1].value, 'bad value');
  assert.equal(result.logs[0].readings.find(item => item.name === 'DbFileSize').value, '200');
  assert.deepEqual(result.logs[1].readings, []);
});

test('no device is guessed and malformed input is explicit', () => {
  const noSelection = systemMonitorSnapshot([{name: 'Remote', type: 'SYSMON', readings: {loadavg: '9'}}]);
  assert.equal(noSelection.selected, null);
  assert.ok(noSelection.metrics.every(item => item.value === null));
  assert.equal(systemMonitorSnapshot([], 'Missing').selected, null);
  const root = systemMonitorSnapshot([{name:'Local',type:'SYSMON',
    readings:{root:'Used: 49 %'}}], 'Local').metrics.find(item => item.label === 'Dateisystem /');
  assert.equal(root.reading, 'root');
  assert.equal(root.value, 'Used: 49 %');
  assert.throws(() => systemMonitorSnapshot(null), /Ungültige/);
});

test('system monitor blueprint remaps the chosen source', () => {
  const widget = {type:'system-monitor', systemDevice:'Local'};
  assert.deepEqual(blueprintDevices(widget), ['Local']);
  assert.equal(remapBlueprintDevice(widget, 'Local', 'Other').systemDevice, 'Other');
});

test('jsonlist preserves reading timestamps when provided', async () => {
  const client = new FhemClient('CMS', 'https://example.test/fhem/');
  client.command = async () => JSON.stringify({Results:[{Name:'Local', Internals:{TYPE:'SYSMON'},
    Readings:{ram:{Value:'0', Time:'2026-11-27 21:00:00'}}}]});
  const [device] = await client.jsonlist('Local');
  assert.equal(systemMonitorSnapshot([device], 'Local').metrics.find(item => item.reading === 'ram').timestamp,
    '2026-11-27 21:00:00');
});

test('log sizes use a read-only command and reject malformed results', async () => {
  const client = new FhemClient('CMS', 'https://example.test/fhem/');
  const calls = [];
  let reply = {checkedAt: 1, items:[{name:'global', type:'FHEM', bytes:0, modifiedAt:1}]};
  client.command = async command => {calls.push(command); return JSON.stringify(reply);};
  assert.equal((await client.systemLogSizes()).items[0].bytes, 0);
  assert.deepEqual(calls, ['get CMS systemlogs']);
  for (const invalid of [
    {}, {checkedAt:1,items:[{name:'bad;name',type:'FHEM',bytes:1,modifiedAt:1}]},
    {checkedAt:1,items:[{name:'global',type:'FHEM',bytes:-1,modifiedAt:1}]},
    {checkedAt:1,items:[{name:'global',type:'FHEM',bytes:1,modifiedAt:null}]},
  ]) {
    reply = invalid;
    await assert.rejects(client.systemLogSizes(), /ungültige Loggrößen/);
  }
  reply = {checkedAt:1,items:[{name:'Log',type:'FileLog',error:'Datei fehlt'}]};
  assert.equal((await client.systemLogSizes()).items[0].error, 'Datei fehlt');
  client.command = async () => 'Unknown argument systemlogs';
  await assert.rejects(client.systemLogSizes(), /Unknown argument/);
});

test('concurrent monitor reads share requests and retry after failure', async () => {
  let calls = 0;
  let fail = true;
  const service = async () => { calls++; if (fail) throw new Error('offline'); return []; };
  const first = loadSystemMonitorDevices(service);
  assert.equal(first, loadSystemMonitorDevices(service));
  await assert.rejects(first, /offline/);
  fail = false;
  assert.deepEqual(await loadSystemMonitorDevices(service), []);
  assert.equal(calls, 2);
});

test('graph candidates use numeric readings without parsing composite SYSMON text', () => {
  const devices = [
    {name:'Local',type:'SYSMON',readings:{ram:'Total: 10 MB, Used: 5 MB',ram_used:'5',
      root_used_percent:'0',loadavg:'0.01 0.00 0.00',loadavg_1:'0.01',stat_cpu_percent:'1 2 3',
      cpu_temp:'NaN',broken:'1e999',bad:'2 MB','bad;reading':'3',new_metric:'2'}},
    {name:'Remote',type:'SYSMON',readings:{ram_used:'9'}},
    {name:'DB',type:'DbLog',readings:{CacheUsage:'4',state:'connected',Other:'9'}},
  ];
  const graphs = systemMonitorGraphCandidates(devices,'Local');
  assert.deepEqual(graphs.map(item => item.reading), ['ram_used','root_used_percent','loadavg_1','new_metric','CacheUsage']);
  assert.equal(graphs[0].unit,'MB');
  assert.equal(graphs[1].unit,'%');
  assert.equal(graphs.find(item => item.reading==='loadavg_1').unit,'');
  assert.deepEqual(systemMonitorGraphCandidates(devices,'Missing').map(item => item.device), ['DB']);
  assert.throws(() => systemMonitorGraphCandidates(null,'Local'), /Ungültige/);
});

test('inline graphs are grouped into the corresponding metric boxes', () => {
  for (const [reading, metric] of Object.entries({
    ram_used:'ram', swap_used:'swap', root_used_percent:'root',fs_root_used_percent:'root',
    loadavg_1:'loadavg',loadavg_15:'loadavg',cpu_temp:'cpu_temp',fhemuptime:'fhemuptime_text',
    cpu_usage:'stat_cpu_text',uptime:'uptime_text',
  })) assert.equal(systemMonitorMetricForGraph(reading),metric);
  assert.equal(systemMonitorMetricForGraph('CacheUsage'),null);
});
