import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystemMonitorDevices, systemMonitorSnapshot, systemMonitorGraphCandidates, systemMonitorMetricForGraph,
  systemMonitorMetricMappings, validateSystemMetricMappings } from '../www/fhem-cms/js/system-monitor.js';
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
    cpu_usage:'stat_cpu_text',uptime:'uptime_text',net_rx_kbs:'network',net_tx_kbs:'network',
  })) assert.equal(systemMonitorMetricForGraph(reading),metric);
  assert.equal(systemMonitorMetricForGraph('CacheUsage'),null);
});

test('system metrics combine real numeric values with validated memory capacity', () => {
  const source = {name:'Local',type:'SYSMON',readings:{stat_cpu_text:'user: 1.77 %',cpu_usage:'14.2',
    ram:'Total: 1642.43 MB, Used: 640.41 MB',ram_used:'640.41',root:'Raw root details',
    root_used_percent:'49',swap:'Total: 2048.00 MB, Used: 0 MB',swap_used:'0',
    net_rx_kbs:'2.5',net_tx_kbs:'0'},readingTimes:{cpu_usage:'2026-11-28 00:03:20'}};
  const metrics = systemMonitorSnapshot([source],'Local').metrics;
  const cpu = metrics.find(item => item.reading==='stat_cpu_text');
  assert.equal(cpu.value,'user: 1.77 %','raw CPU details remain available');
  assert.equal(cpu.displayValue,'14,2 %');
  assert.equal(cpu.displayTimestamp,'2026-11-28 00:03:20');
  const ram = metrics.find(item => item.reading==='ram');
  assert.equal(ram.displayValue,'640,4 / 1.642,4 MB · 39 %');
  assert.ok(Math.abs(ram.progress-640.41/1642.43*100) < 1e-9);
  assert.equal(metrics.find(item=>item.reading==='root').progress,49);
  assert.equal(metrics.find(item=>item.reading==='swap').progress,0,'zero usage is valid');
  assert.equal(metrics.find(item=>item.reading==='network').displayValue,'↓ 2,5 · ↑ 0 KiB/s');
  for (const value of ['NaN','1e999','-1','101','0;set bad']) {
    source.readings.cpu_usage = value;
    assert.equal(systemMonitorSnapshot([source],'Local').metrics[3].displayValue,undefined);
  }
  source.readings.ram = 'Total: 2 GB';
  assert.equal(systemMonitorSnapshot([source],'Local').metrics.find(item=>item.reading==='ram').progress,undefined,
    'different or missing capacity units are not guessed');
  source.readings.ram = 'Total: 10 MB';
  assert.equal(systemMonitorSnapshot([source],'Local').metrics.find(item=>item.reading==='ram').progress,undefined,
    'usage above capacity does not create a misleading bar');
  delete source.readings.net_tx_kbs;
  assert.equal(systemMonitorSnapshot([source],'Local').metrics.at(-1).displayValue,'↓ 2,5 · ↑ – KiB/s');
});

test('monitor detects defaults, honors explicit mappings and adds arbitrary source readings', () => {
  const devices=[{name:'Server',type:'SYSMON',readings:{cpu_usage:'2',ram_used:'3',
    ram:'Total: 12 MB',cpu_other:'14.2',memory_gb:'1.5',capacity_gb:'8',cold:'-4.5',
    in_rate:'3',out_rate:'7',note:'Alles gut'}}];
  const defaults=systemMonitorMetricMappings(devices,'Server');
  assert.equal(defaults.find(item=>item.key==='stat_cpu_text').reading,'cpu_usage');
  assert.equal(defaults.find(item=>item.key==='ram').unit,'MB');
  assert.equal(defaults.find(item=>item.key==='network').reading,'');
  const mappings=[
    {key:'stat_cpu_text',label:'Prozessor',reading:'cpu_other',unit:'%'},
    {key:'ram',label:'Speicher',reading:'memory_gb',unit:'GB',totalReading:'capacity_gb'},
    {key:'network',label:'Netz',reading:'in_rate',unit:'Mbit/s',secondaryReading:'out_rate',secondaryUnit:'Mbit/s'},
    {key:'custom-temperature',label:'Kalt',reading:'cold',unit:'°C'},
    {key:'custom-note',label:'Hinweis',reading:'note',unit:''},
  ];
  validateSystemMetricMappings(mappings);
  assert.equal(systemMonitorMetricMappings(devices,'Server',mappings).find(item=>item.key==='stat_cpu_text').reading,'cpu_other');
  const metrics=systemMonitorSnapshot(devices,'Server',mappings).metrics;
  assert.equal(metrics.find(item=>item.key==='stat_cpu_text').displayValue,'14,2 %');
  assert.equal(metrics.find(item=>item.key==='ram').progress,18.75);
  assert.equal(metrics.find(item=>item.key==='custom-temperature').displayValue,'-4,5 °C');
  assert.equal(metrics.find(item=>item.key==='custom-note').displayValue,'Alles gut');
  assert.equal(metrics.find(item=>item.key==='network').displayValue,'↓ 3 Mbit/s · ↑ 7 Mbit/s');
  const graphs=systemMonitorGraphCandidates(devices,'Server',mappings);
  assert.ok(!graphs.some(item=>item.reading==='cpu_usage'),'overridden automatic CPU graph is not restored');
  assert.equal(graphs.find(item=>item.reading==='memory_gb' && item.metric==='ram').unit,'GB');
  assert.equal(graphs.find(item=>item.reading==='cold' && item.metric==='custom-temperature').unit,'°C');
  assert.equal(systemMonitorSnapshot([], 'Missing', mappings).metrics.find(item=>item.key==='custom-temperature').displayValue,'Nicht verfügbar');
  assert.equal(systemMonitorSnapshot(devices,'Server',[]).metrics[3].displayValue,'2 %','reset restores automatic source');
  for (const invalid of [null,{},[mappings[0],mappings[0]],[{...mappings[0],reading:'bad;set'}],
    [{...mappings[0],key:'unknown'}],[{...mappings[0],unit:'unknown'}],
    [{...mappings[0],label:'bad\nlabel'}],[{...mappings[0],device:'Other'}]]) {
    assert.throws(()=>validateSystemMetricMappings(invalid));
  }
  assert.throws(()=>validateSystemMetricMappings(Array.from({length:13},(_,i)=>({
    key:`custom-${i}`,label:'Extra',reading:'cold',unit:'°C'}))),/zwölf/);
});

test('dynamic reading lists keep all values and chart units and reject ambiguous rows', () => {
  const mapping={key:'custom-many',label:'Vergleich',reading:'one',unit:'%',
    additionalReadings:[{reading:'two',unit:'%'},{reading:'three',unit:'W'},{reading:'four',unit:'°C'}]};
  const devices=[{name:'Local',type:'SYSMON',readings:{one:'1',two:'2',three:'3',four:'-4'}}];
  validateSystemMetricMappings([mapping]);
  assert.equal(systemMonitorSnapshot(devices,'Local',[mapping]).metrics.at(-1).displayValue,
    'one 1 % · two 2 % · three 3 W · four -4 °C');
  assert.deepEqual(systemMonitorGraphCandidates(devices,'Local',[mapping]).map(row=>[row.reading,row.unit]),
    [['one','%'],['two','%'],['three','W'],['four','°C']]);
  for (const invalid of [
    {...mapping,additionalReadings:{}}, {...mapping,additionalReadings:[null]},
    {...mapping,additionalReadings:[{reading:'one',unit:'%'}]},
    {...mapping,additionalReadings:[{reading:'two',unit:'bad'}]},
    {...mapping,additionalReadings:[{reading:'bad;set',unit:'%'}]},
    {...mapping,secondaryReading:'old'},
  ]) assert.throws(()=>validateSystemMetricMappings([invalid]),/Datenreihen/);
  const many={...mapping,additionalReadings:Array.from({length:25},(_,i)=>({reading:`r${i}`,unit:''}))};
  assert.doesNotThrow(()=>validateSystemMetricMappings([many]));
});
