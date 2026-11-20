import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';

globalThis.HTMLElement ??= class {};
const definitions = new Map();
globalThis.customElements ??= {
  get: name => definitions.get(name),
  define: (name, value) => definitions.set(name, value),
};

const {
  conditionKey,
  conditionText,
  directionName,
  formatDate,
  formatTime,
  weatherTitle,
  weatherConfig,
  selectTemperature,
} = await import('../www/fhem-cms/components/cms-weather.js');

test('temperature selects the closest recent measurement, supports fixed stations and labels fallback', () => {
  const now = Date.parse('2026-11-20T05:30:00Z');
  const sample = (temp, ago) => ({ temp, timestamp: new Date(now - ago * 60000).toISOString() });
  const stations = [
    { id: 'dwd:04078', name: 'Rastede', distance: 11480, ...sample(3, 91) },
    { id: 'dwd:02355', name: 'Hude', distance: 14200, ...sample(0, 25) },
    { id: 'dwd:00044', name: 'Großenkneten', distance: 23000, ...sample(1.9, 5) },
  ];
  assert.equal(selectTemperature(null, stations, null, now).temp, 0);
  assert.equal(selectTemperature({ mode: 'station', station: 'dwd:00044' }, stations, null, now).temp, 1.9);
  assert.equal(selectTemperature({ mode: 'station', station: 'dwd:04078' }, stations, null, now).fallback, true);
  const sensor = { mode: 'sensor', device: 'Garden', reading: 'temperature' };
  assert.equal(selectTemperature(sensor, stations, sample(-2.2, 1), now).temp, -2.2);
  assert.equal(selectTemperature({ ...sensor, labelMode: 'alias' }, stations, sample(2, 1), now).label,
    'Quelle: Garden');
  assert.equal(selectTemperature(sensor, stations, sample(9, 91), now).fallback, true);
  assert.equal(selectTemperature(sensor, [], sample(9, -1), now), null);
});

test('weather client builds the supported Bright Sky and DWD device commands', async () => {
  const client = new FhemClient('CMS', 'http://fhem.example/fhem');
  const commands = [];
  client.command = async command => {
    commands.push(command);
    return JSON.stringify(commands.length === 1 ? { loading: true } : {
      source: 'fhem_dwd', current: { temp: 6.4 }, alerts: [],
    });
  };
  assert.deepEqual(await client.weather({
    dataSource: 'brightsky', location: { lat: 53.1435, lon: 8.2146 },
  }), { loading: true });
  assert.deepEqual(await client.weather({ dataSource: 'fhem_dwd', device: 'DWD_Oldenburg' }), {
    source: 'fhem_dwd', current: { temp: 6.4 }, alerts: [],
  });
  assert.deepEqual(commands, [
    'get CMS weather 53.1435 8.2146',
    'get CMS weather device DWD_Oldenburg',
  ]);
  await assert.rejects(() => client.weather({
    dataSource: 'brightsky', location: { lat: '53.1', lon: 8.2 },
  }), /gültigen Ort/);
  await assert.rejects(() => client.weather({ dataSource: 'fhem_dwd', device: 'Weather;set' }), /DWD_OpenData/);
  client.command = async () => JSON.stringify({ error: 'Wetterquelle nicht erreichbar' });
  await assert.rejects(() => client.weather({
    dataSource: 'brightsky', location: { lat: 53.1, lon: 8.2 },
  }), /Wetterquelle nicht erreichbar/);
});

test('weather geocoding encodes user text and returns bounded, safe location records', async () => {
  const client = new FhemClient('CMS', 'http://fhem.example/fhem');
  let command;
  let calls = 0;
  client.command = async value => {
    command = value;
    calls += 1;
    return JSON.stringify(calls === 1 ? { loading: true } : { results: [
      { name: 'München\u0007', admin1: 'Bayern', country: 'DE', lat: '48.137', lon: '11.575' },
      { name: 'Ungültig', country: 'Deutschland', lat: 91, lon: 0 },
      { name: 'Fehlender Code', lat: 0, lon: 0 },
    ] });
  };
  assert.deepEqual(await client.weatherGeocode('München & Umgebung'), { loading: true });
  const result = await client.weatherGeocode('München & Umgebung');
  assert.equal(command, 'get CMS weathergeocode M%C3%BCnchen%20%26%20Umgebung');
  assert.equal(calls, 2);
  assert.deepEqual(result.results, [{
    name: 'München', admin1: 'Bayern', country: 'DE', lat: 48.137, lon: 11.575,
  }]);
  await assert.rejects(() => client.weatherGeocode('bad\nquery'), /Suchbegriff/);
  client.command = async () => JSON.stringify({ error: 'Ortssuche fehlgeschlagen' });
  await assert.rejects(() => client.weatherGeocode('Oldenburg'), /Ortssuche fehlgeschlagen/);
  await assert.rejects(() => client.weatherGeocode('x'), /Suchbegriff/);
  await assert.rejects(() => client.weatherGeocode('ä'.repeat(80)), /Suchbegriff/);
});

test('weather device discovery validates the backend device list', async () => {
  const client = new FhemClient('CMS', 'http://fhem.example/fhem');
  let command;
  client.command = async value => {
    command = value;
    return JSON.stringify({ devices: ['DWD_Oldenburg', 'invalid;set'] });
  };
  assert.deepEqual(await client.weatherDevices(), { devices: ['DWD_Oldenburg'] });
  assert.equal(command, 'get CMS weatherdevices');
  client.command = async () => JSON.stringify({ error: 'Device-Liste nicht verfügbar' });
  await assert.rejects(() => client.weatherDevices(), /Device-Liste nicht verfügbar/);
});

test('weather display helpers cover WMO codes, compass bearings and German dates', () => {
  assert.equal(conditionKey({ wwCode: 0, isDay: false }), 'clear-night');
  assert.equal(conditionKey({ wwCode: 2, isDay: true }), 'partly-cloudy-day');
  assert.equal(conditionKey({ wwCode: 68 }), 'sleet');
  assert.equal(conditionKey({ wwCode: 95 }), 'thunderstorm');
  assert.equal(conditionText({ wwCode: 3 }), 'Bewölkt');
  assert.equal(directionName(240), 'WSW 240°');
  assert.equal(directionName(null), '–');
  assert.match(formatDate('2026-11-20', true), /^Fr\.?\s+20\.11\.$/);
  assert.equal(formatTime('2026-11-20T04:45:00Z'), '05:45');
  assert.equal(formatDate('not a date'), '–');
});

test('weather config applies defaults while constraining external text and forecast days', () => {
  const config = weatherConfig({ type: 'weather', config: {
    dataSource: 'brightsky',
    location: { name: '<img>\u0007Ort', admin1: 'Niedersachsen', country: 'DE', lat: 53.1, lon: 8.2 },
    forecastDays: 99,
    showAlertsBanner: false,
  } });
  assert.equal(config.dataSource, 'brightsky');
  assert.equal(config.location.name, '<img>Ort');
  assert.equal(config.forecastDays, 8);
  assert.equal(config.showAlertsBanner, false);
  assert.equal(config.showCurrentDetails, true);
  assert.equal(config.enableDetailPopup, true);
  assert.equal(weatherConfig({ config: { dataSource: 'fhem_dwd', device: 'Weather' } }).dataSource, 'fhem_dwd');
  assert.equal(weatherTitle({ config: {
    customTitle: '', location: { name: 'Konfigurierter Ort', country: 'DE', lat: 53.1, lon: 8.2 },
  } }, { stationName: 'Messstation' }), 'Konfigurierter Ort');
  assert.equal(weatherTitle({ config: {
    customTitle: 'Eigener Titel', location: { name: 'Konfigurierter Ort' },
  } }, { stationName: 'Messstation' }), 'Eigener Titel');
});
