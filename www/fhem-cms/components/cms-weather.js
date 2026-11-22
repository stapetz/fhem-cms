import { showCmsModal } from '../js/modal-dialog.js';
import { isValidName } from '../js/fhem-client.js';
import { openDevicePicker } from '../js/device-picker.js';
import { createWidgetIconButton, widgetIconButtonCss } from '../js/widget-design.js';

const STATION_ID = /^(?:dwd:\d{5}|wmo:[A-Z0-9]{5})$/;
const READING = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_TEMP_AGE = 90 * 60 * 1000;

function freshTemperature(row, now = Date.now()) {
  const timestamp = asDate(row?.timestamp)?.getTime();
  return Number.isFinite(row?.temp) && Math.abs(row.temp) <= 100
    && timestamp >= now - MAX_TEMP_AGE && timestamp <= now;
}

function stationDistance(station) {
  return `${NUMBER.format(station.distance / 1000)} km`;
}

function selectTemperature(source, stations, sensor, now = Date.now()) {
  if (source?.mode === 'sensor' && freshTemperature(sensor, now)) {
    const name = source.labelMode === 'alias' ? safeText(sensor.alias, 120).trim() : source.labelText;
    return { ...sensor, label: `Quelle: ${name || source.device}`, fallback: false };
  }
  const available = stations.filter(item => freshTemperature(item, now));
  const fixed = source?.mode === 'station' ? available.find(item => item.id === source.station) : null;
  const station = fixed || available[0];
  return station ? { ...station, label: `DWD: ${station.name} · ${stationDistance(station)}`,
    fallback: Boolean(source && !fixed) } : null;
}

const DEFAULTS = Object.freeze({
  dataSource: 'brightsky',
  location: null,
  device: '',
  customTitle: '',
  forecastDays: 3,
  showAlertsBanner: true,
  showCurrentDetails: true,
  enableDetailPopup: true,
});
const SEVERITIES = Object.freeze({
  minor: ['Wetterwarnung', 'minor'],
  moderate: ['Markantes Wetter', 'moderate'],
  severe: ['Unwetterwarnung', 'severe'],
  extreme: ['Extremes Unwetter', 'extreme'],
});
const ICON_KEYS = new Set([
  'clear-day', 'clear-night', 'partly-cloudy-day', 'partly-cloudy-night', 'cloudy',
  'fog', 'rain', 'snow', 'drizzle', 'sleet', 'thunderstorm',
]);
const WMO_TEXT = [
  [new Set([0, 1]), 'Klar oder heiter'],
  [new Set([2]), 'Leicht bewölkt'],
  [new Set([3]), 'Bewölkt'],
  [new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49]), 'Dunst oder Nebel'],
  [new Set([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]), 'Niederschlag in der letzten Stunde'],
  [new Set([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]), 'Sprühregen'],
  [new Set([60, 61, 62, 63, 64, 65, 66, 67, 80, 81, 82]), 'Regen'],
  [new Set([68, 69, 87, 88, 89, 90]), 'Schneeregen oder Graupel'],
  [new Set([70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 83, 84, 85, 86]), 'Schnee'],
  [new Set([91, 92, 93, 94, 95, 96, 97, 98, 99]), 'Gewitter'],
];

const MONTHS = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' });
const WEEKDAY = new Intl.DateTimeFormat('de-DE', { weekday: 'short', timeZone: 'Europe/Berlin' });
const DATE = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' });
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
const HOUR = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' });
const NUMBER = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const SOLAR = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });

function safeText(value, limit = 5000) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, limit) : '';
}

function finite(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? number : null;
}

function displayNumber(value, unit = '', formatter = NUMBER) {
  const number = finite(value);
  return number === null ? '–' : `${formatter.format(number)}${unit}`;
}

function weatherMetrics(row) {
  const visibility = finite(row.visibility);
  const wind = finite(row.windSpeed);
  const windText = wind === null ? '–'
    : `${displayNumber(wind, ' km/h')} · ${Math.min(12, Math.floor(Math.pow(Math.max(0, wind) / 3.6 / 0.836, 2 / 3)))} Bft`;
  return [
    ['Temperatur', displayNumber(row.temp, ' °C')], ['Taupunkt', displayNumber(row.dewPoint, ' °C')],
    ['Luftfeuchtigkeit', displayNumber(row.humidity, ' %')], ['Luftdruck', displayNumber(row.pressure, ' hPa')],
    ['Wind', windText], ['Böen', displayNumber(row.windGust, ' km/h')],
    ['Windrichtung', directionName(row.windDirection)], ['Niederschlag', displayNumber(row.precipitation, ' mm')],
    ['Niederschlagswahrscheinlichkeit', displayNumber(row.precipitationProbability, ' %')],
    ['Sonnenschein', displayNumber(row.sunshine, ' min')], ['Globalstrahlung', displayNumber(row.solar, ' kWh/m²', SOLAR)],
    ['Bewölkung', displayNumber(row.cloudCover, ' %')],
    ['Sichtweite', displayNumber(visibility === null ? null : visibility / 1000, ' km')],
  ].filter(([, value]) => value !== '–');
}

function metricList(rows) {
  const list = make('dl', 'metric-grid');
  for (const [label, value] of rows) {
    const item = make('div', 'metric');
    item.append(make('dt', '', label), make('dd', '', value));
    list.append(item);
  }
  return list;
}

function asDate(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value) {
  const date = asDate(value);
  return date ? TIME.format(date) : '–';
}

function dateHour(value) {
  const date = asDate(value);
  return date ? Number(HOUR.format(date)) : null;
}

function formatDate(value, weekday = false) {
  if (typeof value !== 'string') return '–';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : asDate(value);
  if (!date || Number.isNaN(date.getTime())) return '–';
  return weekday ? `${WEEKDAY.format(date)} ${DATE.format(date)}` : DATE.format(date);
}

function conditionKey(current) {
  const ww = finite(current?.wwCode);
  const fallback = (() => {
    if (ww === null) return '';
    if ([0, 1].includes(ww)) return current?.isDay === false ? 'clear-night' : 'clear-day';
    if (ww === 2) return current?.isDay === false ? 'partly-cloudy-night' : 'partly-cloudy-day';
    if (ww === 3) return 'cloudy';
    if ([4, 5, 6, 7, 8, 9, 10, 11, 12, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49].includes(ww)) return 'fog';
    if ([20, 21, 22, 23, 24, 25, 26, 27, 28, 29].includes(ww)) return [22, 23, 26, 27].includes(ww) ? 'snow' : 'rain';
    if (ww >= 50 && ww <= 59) return 'drizzle';
    if ([68, 69, 87, 88, 89, 90].includes(ww)) return 'sleet';
    if ((ww >= 70 && ww <= 79) || (ww >= 83 && ww <= 86)) return 'snow';
    if (ww >= 91 && ww <= 99) return 'thunderstorm';
    if ((ww >= 60 && ww <= 69) || (ww >= 80 && ww <= 82)) return 'rain';
    return '';
  })();
  const supplied = typeof current?.icon === 'string' && ICON_KEYS.has(current.icon) ? current.icon : '';
  return supplied || fallback || 'cloudy';
}

function conditionText(current) {
  const code = finite(current?.wwCode);
  if (code !== null) {
    const entry = WMO_TEXT.find(([codes]) => codes.has(code));
    if (entry) return entry[1];
  }
  const labels = {
    'clear-day': 'Klar', 'clear-night': 'Klar', 'partly-cloudy-day': 'Leicht bewölkt',
    'partly-cloudy-night': 'Leicht bewölkt', cloudy: 'Bewölkt', fog: 'Nebel',
    rain: 'Regen', snow: 'Schnee', drizzle: 'Sprühregen', sleet: 'Schneeregen',
    thunderstorm: 'Gewitter',
  };
  return labels[conditionKey(current)] || 'Wetterdaten';
}

function iconSvg(key, large = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', large ? 'weather-icon is-large' : 'weather-icon');
  svg.setAttribute('aria-hidden', 'true');
  const node = (name, attrs) => {
    const item = document.createElementNS(svg.namespaceURI, name);
    for (const [attr, value] of Object.entries(attrs)) item.setAttribute(attr, value);
    svg.append(item);
  };
  const cloud = () => node('path', { d: 'M18 45h29a10 10 0 0 0 0-20 15 15 0 0 0-28-3A12 12 0 0 0 18 45Z', class: 'icon-cloud' });
  if (key === 'clear-day') {
    node('circle', { cx: '32', cy: '31', r: '12', class: 'icon-sun' });
    for (let angle = 0; angle < 360; angle += 45) {
      node('path', { d: 'M32 6v7', class: 'icon-ray', transform: `rotate(${angle} 32 32)` });
    }
  } else if (key === 'clear-night') {
    node('path', { d: 'M42 13a21 21 0 1 0 9 35A23 23 0 0 1 42 13Z', class: 'icon-moon' });
    node('circle', { cx: '48', cy: '18', r: '1.8', class: 'icon-star' });
  } else if (key === 'partly-cloudy-day' || key === 'partly-cloudy-night') {
    node('circle', { cx: '24', cy: '24', r: '10', class: key.endsWith('night') ? 'icon-moon' : 'icon-sun' });
    cloud();
  } else {
    cloud();
    if (key === 'rain' || key === 'drizzle' || key === 'sleet') {
      node('path', { d: key === 'drizzle' ? 'M25 51v2m11-2v2m11-2v2' : 'M25 50l-3 6m14-6-3 6m14-6-3 6', class: 'icon-rain' });
    } else if (key === 'snow') {
      node('path', { d: 'M24 50v8m-4-4h8m-6.8-2.8 5.6 5.6m0-5.6-5.6 5.6m14.8-6.8v8m-4-4h8m-6.8-2.8 5.6 5.6m0-5.6-5.6 5.6', class: 'icon-snow' });
    } else if (key === 'thunderstorm') {
      node('path', { d: 'm34 47-8 10h7l-3 7 11-13h-7l4-4', class: 'icon-lightning' });
    } else if (key === 'fog') {
      node('path', { d: 'M13 51h38M18 57h29', class: 'icon-fog' });
    } else if (key === 'sleet') {
      node('circle', { cx: '22', cy: '57', r: '1.5', class: 'icon-snow' });
    }
  }
  return svg;
}

function make(tag, className, value) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (value !== undefined) item.textContent = value;
  return item;
}

function iconForAlert(alert) {
  const severity = safeText(alert?.severity, 24).toLowerCase();
  return Object.hasOwn(SEVERITIES, severity) ? SEVERITIES[severity] : ['Wetterwarnung', 'moderate'];
}

function weatherConfig(widget) {
  const source = widget?.config && typeof widget.config === 'object' && !Array.isArray(widget.config)
    ? widget.config : {};
  const location = source.location && typeof source.location === 'object' ? source.location : null;
  const temperature = source.temperatureSource;
  const temperatureSource = temperature?.mode === 'station' && STATION_ID.test(temperature.station)
    ? { mode: 'station', station: temperature.station }
    : temperature?.mode === 'sensor' && isValidName(temperature.device) && READING.test(temperature.reading)
      ? { mode: 'sensor', device: temperature.device, reading: temperature.reading,
        labelMode: ['alias', 'custom'].includes(temperature.labelMode) ? temperature.labelMode : 'device',
        labelText: temperature.labelMode === 'custom' ? safeText(temperature.labelText, 64).trim() : '' } : null;
  return {
    ...DEFAULTS,
    ...source,
    dataSource: source.dataSource === 'fhem_dwd' ? 'fhem_dwd' : 'brightsky',
    location: location ? {
      name: safeText(location.name, 120),
      admin1: safeText(location.admin1, 120),
      country: safeText(location.country, 80),
      lat: finite(location.lat),
      lon: finite(location.lon),
    } : null,
    device: isValidName(source.device) ? source.device : '',
    customTitle: safeText(source.customTitle, 64),
    temperatureSource,
    forecastDays: Number.isInteger(Number(source.forecastDays))
      ? Math.min(8, Math.max(0, Number(source.forecastDays))) : DEFAULTS.forecastDays,
    showAlertsBanner: source.showAlertsBanner !== false,
    showCurrentDetails: source.showCurrentDetails !== false,
    enableDetailPopup: source.enableDetailPopup !== false,
  };
}

function locationLabel(location) {
  if (!location) return '';
  return [location.name, location.admin1, location.country].filter(Boolean).join(', ');
}

function weatherTitle(widget) {
  const config = weatherConfig(widget);
  const defaultTitle = config.dataSource === 'fhem_dwd' ? config.device : config.location?.name;
  return safeText(config.customTitle || defaultTitle || 'DWD-Wetter', 160);
}

function weatherTarget(config) {
  return config.dataSource === 'fhem_dwd' ? `device:${config.device}`
    : `online:${config.location?.lat},${config.location?.lon}`;
}

function forecastPlace(config, data) {
  if (config.dataSource === 'brightsky') return config.location?.name || '';
  const name = safeText(data?.forecastStationName, 120).trim();
  const id = safeText(data?.forecastStationId, 12).trim();
  return name || (id ? `DWD-Station ${id}` : 'Ort nicht verfügbar');
}

function currentProvenance(data) {
  const current = data?.current;
  if (!asDate(current?.timestamp)) return '';
  const stamp = `${formatDate(current.timestamp)} ${formatTime(current.timestamp)} Uhr`;
  if (current.isForecast === true) return `Vorhersage für ${stamp} · keine Stationsmessung`;
  const station = safeText(data.stationName, 120).trim();
  return `Messung ${stamp}${station ? ` · ${station}` : ''}${current.stale === true ? ' · aus dem Cache' : ''}`;
}

function directionName(value) {
  const degrees = finite(value);
  if (degrees === null) return '–';
  const directions = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return `${directions[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16]} ${Math.round(degrees)}°`;
}

class FHEMCMSWeather extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.weatherData = null;
    this.refreshTimer = null;
    this.requestRevision = 0;
    this.geocodeRevision = 0;
    this.stationRevision = 0;
    this.temperatureData = null;
    this.isNew = false;
  }

  connectedCallback() {
    if (!this.shadowRoot.childElementCount) this.initialize();
    this.render();
    this.scheduleRefresh(0);
  }

  disconnectedCallback() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.requestRevision += 1;
    this.geocodeRevision += 1;
    this.sensorPicker?.abort();
  }

  set config(value) {
    const before = weatherConfig(this.widgetConfig);
    const after = weatherConfig(value);
    if (weatherTarget(after) !== weatherTarget(before)) {
      this.weatherData = null;
      this.temperatureData = null;
      this.requestRevision += 1;
    } else if (JSON.stringify(before.temperatureSource) !== JSON.stringify(after.temperatureSource)) {
      this.temperatureData = null;
      this.requestRevision += 1;
    }
    this.widgetConfig = value;
    this.render();
    if (this.isConnected) this.scheduleRefresh(0);
  }

  get config() { return this.widgetConfig; }

  set stale(value) {
    this.shadowRoot.querySelector('[data-tile]')?.toggleAttribute('data-fhem-stale', value !== null);
  }

  initialize() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; min-width:0; min-height:0; color:var(--cms-text,#edf4ef); }
        * { box-sizing:border-box; }
        .tile { height:var(--cms-widget-height,100%); min-height:0; overflow:auto; position:relative;
          container-type:inline-size; container-name:weather; border:1px solid var(--cms-frame,#7f8c84); border-radius:1.2rem;
          padding:.7rem; background:var(--cms-surface,#202e27); color:inherit; font:inherit; }
        .tile[data-fhem-stale] { opacity:.78; border-style:dashed; }
        .gear { position:absolute; z-index:1; top:.4rem; right:.4rem; min-width:44px; min-height:44px; }
        button { font:inherit; color:inherit; cursor:pointer; border:1px solid var(--cms-border,#43564a);
          border-radius:.55rem; background:var(--cms-surface-raised,#2a3b32); padding:.4rem .65rem; }
        button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--cms-accent,#8fd0a8); outline-offset:2px; }
        :host([view-only]) .gear, :host(:not([view-only])) [data-detail] { display:none; }
        [hidden] { display:none !important; }
        header { min-height:2rem; display:flex; flex-wrap:wrap; align-items:center; gap:.45rem; padding-right:3rem; }
        header h3 { min-width:0; }
        h3 { margin:0; font-size:clamp(.95rem,5cqi,1.3rem); overflow-wrap:anywhere; }
        .tile header h3 { font-size:clamp(1.2rem,4cqi,2rem); }
        .updated { margin-left:auto; color:var(--cms-muted,#a5c9b2); font-size:.75rem; white-space:nowrap; }
        .badge { flex:none; border-radius:99px; padding:.15rem .45rem; font-size:.72rem; font-weight:700; color:#241500; }
        .badge.minor { background:#ffeb3b; } .badge.moderate { background:#ff9800; }
        .badge.severe { background:#f44336; color:white; } .badge.extreme { background:#7e57c2; color:white; }
        .current { display:flex; align-items:center; gap:clamp(.5rem,3cqi,1rem); min-width:0; padding:.5rem 0; }
        .weather-icon { width:clamp(2.4rem,14cqi,4.2rem); height:auto; flex:none; overflow:visible; }
        .is-large { width:4.5rem; }
        .icon-sun,.icon-star { fill:#ffd54f; } .icon-moon { fill:#d7e3ff; }
        .icon-ray,.icon-rain,.icon-fog { fill:none; stroke:#ffd54f; stroke-width:3; stroke-linecap:round; }
        .icon-cloud { fill:#aebdc6; stroke:#dbe4e9; stroke-width:1.5; }
        .icon-rain,.icon-fog { stroke:#64b5f6; } .icon-snow { fill:none; stroke:#b3e5fc; stroke-width:2; stroke-linecap:round; }
        .icon-lightning { fill:#ffca28; stroke:#ffca28; stroke-width:1; }
        .temp { font-size:clamp(2rem,14cqi,4rem); line-height:1; font-weight:750; font-variant-numeric:tabular-nums; }
        .condition { color:var(--cms-muted-strong,#c4d0c8); font-size:clamp(1rem,3cqi,1.5rem); }
        .forecast-place,.current-origin { margin:.2rem 0 0; color:var(--cms-muted-strong,#c4d0c8);
          font-size:clamp(1rem,3cqi,1.5rem); overflow-wrap:anywhere; }
        .details { display:flex; flex-wrap:wrap; gap:.25rem .8rem; color:var(--cms-muted-strong,#c4d0c8); font-size:clamp(1rem,3cqi,1.5rem); }
        .message { margin:.3rem 0; color:var(--cms-muted,#a5c9b2); font-size:clamp(1rem,3cqi,1.5rem); overflow-wrap:anywhere; }
        .message.alert-unavailable { color:#ffcc80; }
        .forecast { display:grid; grid-template-columns:repeat(var(--forecast-count,3),minmax(0,1fr)); gap:.35rem; margin:.45rem 0; }
        .day { min-width:0; display:grid; justify-items:center; gap:.15rem; padding:.35rem .15rem;
          border-radius:.6rem; background:color-mix(in srgb,var(--cms-surface-raised,#2a3b32) 75%,transparent); text-align:center; }
        .day .weather-icon { width:2.4rem; }
        .day-name,.day-precip { font-size:clamp(.9rem,2.5cqi,1.25rem); color:var(--cms-muted,#a5c9b2); }
        .day-temp { font-size:clamp(.9rem,2.5cqi,1.25rem); font-variant-numeric:tabular-nums; white-space:nowrap; }
        ${widgetIconButtonCss}
        [data-detail] { position:absolute; top:.4rem; right:.4rem; }
        dialog { width:min(94vw,60rem); max-width:60rem; max-height:min(92dvh,60rem); overflow:auto;
          padding:1rem; border:1px solid var(--cms-border,#43564a); border-radius:1rem;
          background:var(--cms-surface,#202e27); color:var(--cms-text,#edf4ef); }
        dialog::backdrop { background:var(--cms-backdrop,rgb(0 0 0 / .65)); }
        dialog[data-modal][open] { display:flex; flex-direction:column; overflow:hidden; }
        .modal-head { flex:none; display:flex; gap:.5rem; align-items:center; padding:.35rem 0 .7rem; }
        .modal-head h2 { margin:0; min-width:0; overflow-wrap:anywhere; font-size:1.25rem; }
        [data-modal-content] { min-height:0; overflow-y:auto; }
        .modal-close { margin-left:auto; min-width:44px; min-height:44px; }
        .modal-section { margin:1rem 0; }
        .modal-section h3 { margin:.2rem 0 .65rem; }
        .alerts { display:grid; gap:.6rem; }
        .alert { padding:.7rem; border-left:.35rem solid var(--alert-color,#ff9800); border-radius:.5rem;
          background:color-mix(in srgb,var(--alert-color,#ff9800) 14%,transparent); }
        .alert.minor { --alert-color:#fdd835; } .alert.moderate { --alert-color:#fb8c00; }
        .alert.severe { --alert-color:#e53935; } .alert.extreme { --alert-color:#8e24aa; }
        .alert h4 { margin:0 0 .35rem; } .alert p { margin:.35rem 0; white-space:pre-wrap; overflow-wrap:anywhere; }
        .metric-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,9rem),1fr)); gap:.45rem; margin:0; }
        .metric { padding:.55rem; border-radius:.5rem; background:color-mix(in srgb,var(--cms-surface-raised,#2a3b32) 75%,transparent); }
        .metric dt { color:var(--cms-muted,#a5c9b2); font-size:.78rem; overflow-wrap:anywhere; }
        .metric dd { margin:.2rem 0 0; font-variant-numeric:tabular-nums; }
        .hourly { width:100%; table-layout:fixed; border-spacing:0; }
        .hourly thead { position:sticky; top:0; z-index:1; background:var(--cms-surface,#202e27); }
        .hourly th,.hourly td { padding:.3rem .15rem; text-align:center; overflow-wrap:anywhere; }
        .hourly th { font-size:.8rem; }
        .hourly th,.hourly .hour td { border-bottom:1px solid var(--cms-border,#43564a); }
        .hourly th:last-child { width:3.1rem; }
        .hourly .weather-icon { display:block; width:2rem; max-width:100%; margin:auto; }
        .hour-toggle { width:44px; min-height:44px; padding:0; }
        .hour-toggle[aria-expanded=true] { transform:rotate(180deg); }
        .hour-details .metric-grid { text-align:left; }
        .daily details { border-top:1px solid var(--cms-border,#43564a); }
        .daily summary { display:flex; align-items:center; gap:.6rem; min-height:48px; cursor:pointer; }
        .daily summary .weather-icon { width:2.5rem; }
        .daily summary .daily-temp { margin-left:auto; }
        .day-parts { display:grid; grid-template-columns:repeat(auto-fit,minmax(8rem,1fr)); gap:.35rem; padding:.25rem .5rem .7rem; }
        .day-part { padding:.45rem; border-radius:.4rem; background:color-mix(in srgb,var(--cms-surface-raised,#2a3b32) 75%,transparent); }
        .day-part strong,.day-part span { display:block; } .day-part span { font-size:.82rem; margin-top:.2rem; }
        .source { color:var(--cms-muted,#a5c9b2); font-size:.8rem; }
        form { display:grid; gap:.75rem; }
        label { display:grid; gap:.25rem; }
        fieldset { display:flex; flex-wrap:wrap; gap:.65rem; }
        fieldset label,.check { display:flex; align-items:center; gap:.35rem; }
        input,select { width:100%; min-height:44px; padding:.45rem .55rem; color:inherit; font:inherit;
          border:1px solid var(--cms-border,#43564a); border-radius:.5rem; background:var(--cms-bg,#17211d); }
        input[type=checkbox],input[type=radio] { width:1.15rem; min-height:1.15rem; }
        .location-search,.form-actions { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; }
        .location-search input { flex:1 1 12rem; }
        [data-sensor-select] { display:grid; gap:.5rem; margin-top:.5rem; }
        .sensor-row { display:flex; flex-wrap:wrap; align-items:end; gap:.5rem; }
        .sensor-row label { flex:1 1 9rem; min-width:0; }
        .sensor-row input,.sensor-row select { min-width:0; }
        .sensor-row [data-pick-sensor] { flex:none; min-height:44px; max-width:100%; }
        .results { display:grid; gap:.35rem; max-height:12rem; overflow:auto; }
        .results button { text-align:left; }
        .hint { margin:0; color:var(--cms-muted,#a5c9b2); font-size:.82rem; }
        .error { margin:0; color:var(--cms-danger,#ffb4a8); }
        .form-actions { justify-content:flex-end; }
        .danger { margin-right:auto; }
        @container weather (max-width:259px) {
          .forecast { grid-template-columns:1fr; }
          .day { grid-template-columns:2.4rem 1fr auto auto; justify-items:start; text-align:left; }
          .day .weather-icon { width:2rem; grid-row:span 2; }
          .day-precip { align-self:end; }
        }
        @media (max-width:639px) {
          dialog { width:100vw; max-width:none; height:100dvh; max-height:100dvh; margin:0;
            border-radius:0; padding:calc(env(safe-area-inset-top) + .75rem) .75rem calc(env(safe-area-inset-bottom) + .75rem); }
        }
      </style>
      <article class="tile" data-tile>
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="DWD-Wetter konfigurieren">⚙</button>
        <header><h3 data-title></h3><span data-alert-badge class="badge" hidden></span><span class="updated" data-updated></span></header>
        <p class="forecast-place" data-forecast-place hidden></p>
        <p class="message" data-message role="status">Wetterdaten werden geladen …</p>
        <div class="current" data-current hidden></div>
        <div class="details" data-details hidden></div>
        <div class="message alert-unavailable" data-alert-status hidden></div>
        <div class="forecast" data-forecast></div>
      </article>
      <dialog data-modal aria-labelledby="weather-modal-title">
        <div class="modal-head"><h2 id="weather-modal-title" data-modal-title>Wetterdetails</h2>
          <button type="button" class="modal-close" data-modal-close aria-label="Details schließen" autofocus>×</button></div>
        <div data-modal-content tabindex="0" role="region" aria-label="Wetterdetails und Vorhersagen"></div>
      </dialog>
      <dialog data-dialog aria-labelledby="weather-editor-title">
        <form data-form novalidate>
          <h2 id="weather-editor-title">DWD-Wetter konfigurieren</h2>
          <fieldset><legend>Datenquelle</legend>
            <label><input type="radio" name="dataSource" value="brightsky"> Ort suchen (DWD Online)</label>
            <label><input type="radio" name="dataSource" value="fhem_dwd"> FHEM DWD_OpenData Device</label>
          </fieldset>
          <section data-location-fields>
            <label>Ort suchen
              <span class="location-search"><input name="query" type="search" minlength="2" maxlength="80" autocomplete="off" placeholder="Ort oder Postleitzahl">
                <button type="button" data-search> Suchen</button></span>
            </label>
            <div class="results" data-results aria-live="polite"></div>
            <p class="hint" data-location-selected></p>
          </section>
          <section data-device-fields hidden>
            <label>DWD_OpenData-Device<select name="device"><option value="">Device auswählen …</option></select></label>
            <p class="hint" data-device-status></p>
          </section>
          <section data-temperature-fields>
            <label>Ist-Temperatur<select name="temperatureMode">
              <option value="auto">Automatisch · nächster frischer DWD-Messwert</option>
              <option value="station">DWD-Station auswählen</option>
              <option value="sensor">Eigenes FHEM-Thermometer</option>
            </select></label>
            <p class="hint" data-station-status></p>
            <label data-station-select hidden>DWD-Messstation<select name="temperatureStation"></select></label>
            <section data-sensor-select hidden>
              <div class="sensor-row">
                <label>Thermometer (FHEM-Device)<input name="temperatureDevice" readonly></label>
                <button type="button" data-pick-sensor>Device auswählen …</button>
              </div>
              <div class="sensor-row">
                <label>Temperatur-Reading (°C)<select name="temperatureReading"></select></label>
                <label>Anzeigename der Quelle<select name="temperatureLabelMode">
                  <option value="device">Gerätename</option>
                  <option value="alias">FHEM-Alias</option>
                  <option value="custom">Eigener Text</option>
                </select></label>
              </div>
              <label data-temperature-label-text hidden>Eigener Anzeigename
                <input name="temperatureLabelText" maxlength="64" autocomplete="off" placeholder="z. B. Garten">
              </label>
            </section>
          </section>
          <label>Anzeigename (optional)<input name="customTitle" type="text" maxlength="64" autocomplete="off"></label>
          <label>Vorhersagetage (0–8)<input name="forecastDays" type="number" min="0" max="8" step="1" required></label>
          <label class="check"><input name="showAlertsBanner" type="checkbox"> Warn-Banner anzeigen</label>
          <label class="check"><input name="showCurrentDetails" type="checkbox"> Wind, Luftfeuchtigkeit und Regen auf der Kachel anzeigen</label>
          <label class="check"><input name="enableDetailPopup" type="checkbox"> Detail-Popup aktivieren</label>
          <p class="error" data-error role="alert"></p>
          <div class="form-actions"><button type="button" class="danger" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button><button type="submit">Speichern</button></div>
        </form>
      </dialog>`;
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    const info = createWidgetIconButton('info', 'Wetterdetails anzeigen');
    info.dataset.detail = '';
    info.hidden = true;
    info.addEventListener('click', () => this.openDetails());
    this.shadowRoot.querySelector('header').append(info);
    this.shadowRoot.querySelector('[data-modal-close]').addEventListener('click', () => this.closeDetails());
    const modal = this.shadowRoot.querySelector('[data-modal]');
    modal.addEventListener('cancel', (event) => { event.preventDefault(); this.closeDetails(); });
    modal.addEventListener('click', (event) => { if (event.target === modal) this.closeDetails(); });
    this.shadowRoot.querySelector('[data-dialog]').addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeConfig(false);
    });
    this.shadowRoot.querySelector('[data-cancel]').addEventListener('click', () => this.closeConfig(false));
    this.shadowRoot.querySelector('[data-delete]').addEventListener('click', () => this.deleteWidget());
    this.shadowRoot.querySelector('[data-search]').addEventListener('click', () => this.searchLocation());
    this.shadowRoot.querySelector('[name=temperatureMode]').addEventListener('change', () => this.updateTemperatureFields());
    this.shadowRoot.querySelector('[name=temperatureLabelMode]').addEventListener('change', () => this.updateTemperatureFields());
    for (const selector of ['[data-pick-sensor]', '[name=temperatureDevice]']) {
      this.shadowRoot.querySelector(selector).addEventListener('click', () => this.pickTemperatureSensor());
    }
    this.shadowRoot.querySelector('[name=query]').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); this.searchLocation(); }
    });
    this.shadowRoot.querySelector('[data-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveConfig();
    });
    for (const radio of this.shadowRoot.querySelectorAll('[name=dataSource]')) {
      radio.addEventListener('change', () => this.updateSourceFields());
    }
  }

  scheduleRefresh(delay) {
    clearTimeout(this.refreshTimer);
    if (!this.isConnected) return;
    this.refreshTimer = setTimeout(() => this.refresh(), delay);
  }

  async refresh() {
    const revision = ++this.requestRevision;
    const config = weatherConfig(this.widgetConfig);
    if (!this.services || typeof this.services.weather !== 'function'
      || (config.dataSource === 'brightsky' && (!config.location
        || config.location.lat === null || config.location.lon === null))) {
      this.setStatus('Bitte Wetterdaten im Widgetdialog konfigurieren.');
      return;
    }
    if (config.dataSource === 'fhem_dwd' && !config.device) {
      this.setStatus('Bitte ein DWD_OpenData-Device auswählen.');
      return;
    }
    if (!this.weatherData) this.setStatus('Wetterdaten werden geladen …');
    if (config.dataSource === 'brightsky' && typeof this.services.weatherStations === 'function') {
      void this.refreshTemperature(config, revision);
    }
    try {
      const result = await this.services.weather(config);
      if (!this.isConnected || revision !== this.requestRevision) return;
      if (result?.loading === true) {
        this.setStatus(this.weatherData ? 'Wetterdaten werden aktualisiert …' : 'Wetterdaten werden geladen …');
        this.scheduleRefresh(1500);
        return;
      }
      this.weatherData = result;
      this.render();
      this.scheduleRefresh(5 * 60 * 1000);
    } catch (error) {
      if (!this.isConnected || revision !== this.requestRevision) return;
      this.setStatus(`Wetterdaten nicht verfügbar: ${safeText(error?.message || String(error), 240)}`);
      this.scheduleRefresh(30 * 1000);
    }
  }

  async readStations(location, active) {
    for (let attempt = 0; attempt < 20 && active(); attempt++) {
      const result = await this.services.weatherStations(location);
      if (Array.isArray(result?.stations)) return result.stations.filter(item => item
        && STATION_ID.test(item.id) && typeof item.name === 'string'
        && Number.isFinite(item.distance) && item.distance >= 0)
        .sort((a, b) => a.distance - b.distance);
      if (!result?.loading) throw new Error(result?.error || 'Keine gültige Antwort für Messstationen');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (!active()) return [];
    throw new Error('Zeitüberschreitung bei der Messstationssuche');
  }

  async refreshTemperature(config, revision) {
    const source = config.temperatureSource;
    const active = () => this.isConnected && revision === this.requestRevision;
    const apply = (data) => {
      if (!active()) return;
      this.temperatureData = data;
      this.render();
    };
    if (source?.mode === 'sensor') {
      let sensor;
      try {
        sensor = await this.services.weatherTemperature(source);
      } catch {
        // The fallback is labeled on the tile, including on communication errors.
      }
      if (!active()) return;
      if (freshTemperature(sensor)) {
        apply({ sensor, stations: [] });
        return;
      }
    }
    try {
      apply({ stations: await this.readStations(config.location, active) });
    } catch (error) {
      apply({ stations: [], error: safeText(error?.message, 120) || 'DWD-Messstationsabfrage fehlgeschlagen' });
    }
  }

  temperaturePresentation(config, data) {
    const enabled = config.dataSource === 'brightsky' && typeof this.services?.weatherStations === 'function';
    const feeds = this.temperatureData;
    if (!enabled) return { value: data?.current?.temp, label: '', enabled };
    const selected = feeds && selectTemperature(config.temperatureSource, feeds.stations, feeds.sensor);
    if (selected) {
      return { value: selected.temp, enabled, label: `${selected.fallback ? 'Gewählte Quelle nicht verfügbar · Ersatz: ' : ''}`
        + `${selected.label} · ${formatDate(selected.timestamp)} ${formatTime(selected.timestamp)} Uhr` };
    }
    const unavailable = config.temperatureSource ? 'Gewählte Temperaturquelle nicht verfügbar. ' : '';
    return { value: null, enabled, label: !feeds ? 'Ist-Temperatur wird geladen …'
      : `${unavailable}${feeds.error || 'Keine frische DWD-Temperaturmessung in der Umgebung verfügbar.'}` };
  }

  setStatus(message) {
    const output = this.shadowRoot.querySelector('[data-message]');
    if (output) output.textContent = message;
  }

  render() {
    if (!this.widgetConfig || !this.shadowRoot.querySelector('[data-title]')) return;
    const config = weatherConfig(this.widgetConfig);
    const data = this.weatherData;
    const title = weatherTitle(this.widgetConfig);
    this.shadowRoot.querySelector('[data-title]').textContent = safeText(title, 160);
    const place = forecastPlace(config, data);
    const placeLine = this.shadowRoot.querySelector('[data-forecast-place]');
    placeLine.textContent = place ? `Vorhersageort: ${place}` : '';
    placeLine.hidden = !place;
    const detailButton = this.shadowRoot.querySelector('[data-detail]');
    detailButton.hidden = !this.hasAttribute('view-only') || !config.enableDetailPopup || !data;
    const message = this.shadowRoot.querySelector('[data-message]');
    const current = data?.current && typeof data.current === 'object' ? data.current : null;
    const alerts = Array.isArray(data?.alerts) ? data.alerts.filter(alert => alert && typeof alert === 'object') : [];
    const badge = this.shadowRoot.querySelector('[data-alert-badge]');
    if (config.showAlertsBanner && alerts.length) {
      const [label, severity] = iconForAlert(alerts[0]);
      badge.hidden = false;
      badge.className = `badge ${severity}`;
      badge.textContent = alerts.length > 1 ? `${alerts.length} Warnungen` : label;
    } else {
      badge.hidden = true;
      badge.textContent = '';
    }
    const updated = config.dataSource === 'fhem_dwd' && asDate(data?.updatedAt) ? formatTime(data.updatedAt) : '';
    this.shadowRoot.querySelector('[data-updated]').textContent =
      [updated && `FHEM-Stand: ${updated}`, data?.stale && 'Cache'].filter(Boolean).join(' · ');
    const currentBox = this.shadowRoot.querySelector('[data-current]');
    const temperature = this.temperaturePresentation(config, data);
    currentBox.replaceChildren();
    currentBox.hidden = !current && !temperature.enabled;
    if (!currentBox.hidden) {
      if (current) currentBox.append(iconSvg(conditionKey(current)));
      const summary = make('div', 'summary');
      summary.append(make('div', 'temp', displayNumber(temperature.value, '°')));
      if (temperature.label) summary.append(make('p', 'current-origin', temperature.label));
      if (current) summary.append(make('div', 'condition', conditionText(current)));
      const provenance = currentProvenance(data);
      if (provenance) summary.append(make('p', 'current-origin', temperature.enabled ? `Übrige Wetterdaten: ${provenance}` : provenance));
      currentBox.append(summary);
    }
    const details = this.shadowRoot.querySelector('[data-details]');
    details.replaceChildren();
    details.hidden = !config.showCurrentDetails || !current;
    if (!details.hidden) {
      for (const label of [
        ['Wind', displayNumber(current.windSpeed, ' km/h')],
        ['Richtung', directionName(current.windDirection)],
        ['Luftfeuchte', displayNumber(current.humidity, ' %')],
        ['Regen', displayNumber(current.precipitation, ' mm/h')],
      ]) details.append(make('span', '', `${label[0]}: ${label[1]}`));
    }
    const unavailable = this.shadowRoot.querySelector('[data-alert-status]');
    unavailable.hidden = data?.alertsUnavailable !== true;
    unavailable.textContent = data?.alertsUnavailable === true
      ? 'Amtliche Warnungen sind derzeit nicht verfügbar.' : '';
    if (!data) {
      message.textContent ||= 'Wetterdaten werden geladen …';
    } else if (data.loading === true) {
      message.textContent = 'Wetterdaten werden geladen …';
    } else {
      message.textContent = current ? '' : 'Aktuelle Wetterwerte sind nicht verfügbar.';
    }
    const forecast = this.shadowRoot.querySelector('[data-forecast]');
    forecast.replaceChildren();
    const days = Array.isArray(data?.daily) ? data.daily.slice(0, config.forecastDays) : [];
    forecast.hidden = config.forecastDays === 0 || !days.length;
    forecast.style.setProperty('--forecast-count', String(Math.max(1, days.length)));
    for (const day of days) {
      const card = make('div', 'day');
      card.append(iconSvg(conditionKey(day)));
      card.append(make('span', 'day-name', formatDate(day.date, true)));
      card.append(make('span', 'day-temp', `${displayNumber(day.tempMin, '°')} / ${displayNumber(day.tempMax, '°')}`));
      card.append(make('span', 'day-precip', `Regen ${displayNumber(day.precipitationProbabilityMax, ' %')}`));
      forecast.append(card);
    }
  }

  openDetails() {
    const config = weatherConfig(this.widgetConfig);
    if (!this.weatherData || !config.enableDetailPopup || !this.hasAttribute('view-only')) return;
    const data = this.weatherData;
    const title = weatherTitle(this.widgetConfig);
    this.shadowRoot.querySelector('[data-modal-title]').textContent = `${safeText(title, 160)} – Wetterdetails`;
    const previousContent = this.shadowRoot.querySelector('[data-modal-content]');
    // A new scroll container cannot restore the position from the previous opening.
    const content = previousContent.cloneNode(false);
    previousContent.replaceWith(content);
    const place = forecastPlace(config, data);
    if (place) content.append(make('p', 'forecast-place', `Vorhersageort: ${place}`));
    const alerts = Array.isArray(data.alerts) ? data.alerts.filter(alert => alert && typeof alert === 'object') : [];
    const alertsSection = make('section', 'modal-section alerts');
    alertsSection.append(make('h3', '', 'Amtliche DWD-Unwetterwarnungen'));
    if (data.alertsUnavailable === true) {
      alertsSection.append(make('p', 'message alert-unavailable',
        'Warninformationen sind derzeit nicht vollständig verfügbar; daraus lässt sich nicht auf Warnungsfreiheit schließen.'));
    }
    if (alerts.length) {
      for (const alert of alerts) {
        const [label, severity] = iconForAlert(alert);
        const card = make('article', `alert ${severity}`);
        card.append(make('h4', '', safeText(alert.headline || alert.event || label, 300)));
        const onset = asDate(alert.onset) ? `${formatDate(alert.onset)} ${formatTime(alert.onset)}` : '–';
        const expires = asDate(alert.expires) ? `${formatDate(alert.expires)} ${formatTime(alert.expires)}` : '–';
        card.append(make('p', '', `${label} · ${onset} – ${expires}`));
        if (alert.description) card.append(make('p', '', safeText(alert.description)));
        if (alert.instruction) card.append(make('p', '', safeText(alert.instruction)));
        alertsSection.append(card);
      }
    } else if (data.alertsUnavailable !== true) {
      alertsSection.append(make('p', 'message', 'Keine aktiven Warnungen gemeldet.'));
    }
    content.append(alertsSection);

    const current = data.current && typeof data.current === 'object' ? data.current : {};
    const currentSection = make('section', 'modal-section');
    currentSection.append(make('h3', '', current.isForecast === true
      ? 'Vorhersagewerte · keine Stationsmessung' : 'Aktuelle Messwerte'));
    const provenance = currentProvenance(data);
    if (provenance) currentSection.append(make('p', 'current-origin', provenance));
    const temperature = this.temperaturePresentation(config, data);
    if (temperature.enabled) currentSection.append(make('p', 'current-origin',
      `Ist-Temperatur: ${displayNumber(temperature.value, ' °C')} · ${temperature.label}`));
    const rows = weatherMetrics(temperature.enabled ? { ...current, temp: null } : current);
    if (rows.length) currentSection.append(make('p', '', conditionText(current)), metricList(rows));
    else currentSection.append(make('p', 'message', 'Keine aktuellen Wetterwerte verfügbar.'));
    content.append(currentSection);

    const hourly = Array.isArray(data.hourly) ? data.hourly.slice(0, 48) : [];
    const hourlySection = make('section', 'modal-section');
    hourlySection.append(make('h3', '', 'Stündliche Vorhersage · nächste 48 Stunden'));
    if (hourly.length) {
      const table = make('table', 'hourly');
      table.setAttribute('aria-label', 'Stündliche Vorhersage');
      const heading = table.createTHead().insertRow();
      for (const label of ['Datum', 'Uhrzeit', 'Wetter', 'Temp.', 'Details']) {
        const cell = make('th', '', label);
        cell.scope = 'col';
        heading.append(cell);
      }
      const body = table.createTBody();
      for (const hour of hourly) {
        const row = body.insertRow();
        row.className = 'hour';
        const date = formatDate(hour.timestamp);
        const time = formatTime(hour.timestamp);
        row.insertCell().textContent = date;
        row.insertCell().textContent = time;
        const icon = iconSvg(conditionKey(hour));
        const condition = conditionText(hour);
        icon.removeAttribute('aria-hidden');
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', condition);
        row.insertCell().append(icon);
        row.insertCell().textContent = displayNumber(hour.temp, ' °C');
        const toggle = make('button', 'hour-toggle', '⌄');
        toggle.type = 'button';
        toggle.setAttribute('aria-label', `Wetterwerte am ${date} um ${time} Uhr`);
        toggle.setAttribute('aria-expanded', 'false');
        row.insertCell().append(toggle);
        const details = body.insertRow();
        details.className = 'hour-details';
        details.hidden = true;
        const cell = details.insertCell();
        cell.colSpan = heading.cells.length;
        cell.append(make('p', '', condition), metricList(weatherMetrics(hour)));
        toggle.addEventListener('click', () => {
          details.hidden = !details.hidden;
          toggle.setAttribute('aria-expanded', String(!details.hidden));
        });
      }
      hourlySection.append(table);
    } else {
      hourlySection.append(make('p', 'message', 'Keine Stundenwerte verfügbar.'));
    }
    content.append(hourlySection);

    const dailySection = make('section', 'modal-section daily');
    dailySection.append(make('h3', '', 'Erweiterte Vorhersage'));
    const daily = Array.isArray(data.daily) ? data.daily : [];
    for (const day of daily.slice(0, 10)) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.append(iconSvg(conditionKey(day)), make('strong', '', formatDate(day.date, true)));
      summary.append(make('span', 'daily-temp', `${displayNumber(day.tempMin, '°')} / ${displayNumber(day.tempMax, '°')}`));
      details.append(summary);
      const sunshineHours = finite(day.sunshineMinutes) === null ? null : Number(day.sunshineMinutes) / 60;
      details.append(make('p', '', conditionText(day)), metricList([
        ['Niederschlagswahrscheinlichkeit (max.)', displayNumber(day.precipitationProbabilityMax, ' %')],
        ['Niederschlagssumme', displayNumber(day.precipitationSum, ' mm')],
        ['Sonnenschein', displayNumber(sunshineHours, ' h')],
        ['Globalstrahlung', displayNumber(day.solarSum, ' kWh/m²', SOLAR)],
        ['Wind (max.)', displayNumber(day.windSpeedMax, ' km/h')],
        ['Böen (max.)', displayNumber(day.windGustMax, ' km/h')],
      ].filter(([, value]) => value !== '–')));
      const parts = make('div', 'day-parts');
      for (const hour of [6, 12, 18, 0]) {
        const periods = Array.isArray(day.periods) ? day.periods : [];
        const entry = periods.find(item => dateHour(item?.timestamp) === hour)
          || hourly.find(item => dateHour(item?.timestamp) === hour
            && formatDate(item.timestamp) === formatDate(day.date));
        const part = make('div', 'day-part');
        part.append(make('strong', '', `${hour === 0 ? 'Nachts' : hour === 6 ? 'Morgens' : hour === 12 ? 'Mittags' : 'Abends'} · ${String(hour).padStart(2, '0')}:00`));
        if (entry) part.append(make('span', '', conditionText(entry)), metricList(weatherMetrics(entry)));
        else part.append(make('span', '', 'Keine Stundenwerte verfügbar'));
        parts.append(part);
      }
      details.append(parts);
      dailySection.append(details);
    }
    if (!daily.length) dailySection.append(make('p', 'message', 'Keine Tagesvorhersage verfügbar.'));
    content.append(dailySection);
    content.append(make('p', 'source', 'Datenbasis: Deutscher Wetterdienst (DWD)'));
    showCmsModal(this.shadowRoot.querySelector('[data-modal]'));
  }

  closeDetails() {
    const modal = this.shadowRoot.querySelector('[data-modal]');
    if (modal?.open) modal.close();
  }

  updateSourceFields() {
    const source = this.shadowRoot.querySelector('[name=dataSource]:checked')?.value || 'brightsky';
    this.shadowRoot.querySelector('[data-location-fields]').hidden = source !== 'brightsky';
    this.shadowRoot.querySelector('[data-device-fields]').hidden = source !== 'fhem_dwd';
    this.shadowRoot.querySelector('[data-temperature-fields]').hidden = source !== 'brightsky';
    this.updateTemperatureFields();
  }

  updateTemperatureFields() {
    const mode = this.shadowRoot.querySelector('[name=temperatureMode]').value;
    this.shadowRoot.querySelector('[data-station-select]').hidden = mode !== 'station';
    this.shadowRoot.querySelector('[data-sensor-select]').hidden = mode !== 'sensor';
    this.shadowRoot.querySelector('[data-temperature-label-text]').hidden =
      this.shadowRoot.querySelector('[name=temperatureLabelMode]').value !== 'custom';
  }

  async loadTemperatureStations(location, wanted = '') {
    const revision = ++this.stationRevision;
    const select = this.shadowRoot.querySelector('[name=temperatureStation]');
    const status = this.shadowRoot.querySelector('[data-station-status]');
    select.replaceChildren(new Option('Messstation auswählen …', ''));
    if (STATION_ID.test(wanted)) {
      select.add(new Option(`Gespeicherte Messstation (${wanted})`, wanted));
      select.value = wanted;
    }
    status.textContent = '';
    if (!location || typeof this.services?.weatherStations !== 'function') return;
    status.textContent = 'Messstationen werden geladen …';
    try {
      const stations = await this.readStations(location,
        () => revision === this.stationRevision && this.shadowRoot.querySelector('[data-dialog]').open);
      if (revision !== this.stationRevision || !this.shadowRoot.querySelector('[data-dialog]').open) return;
      const currentChoice = select.value;
      select.replaceChildren(new Option('Messstation auswählen …', ''));
      for (const item of stations) {
        const value = freshTemperature(item) ? `${displayNumber(item.temp, ' °C')} um ${formatTime(item.timestamp)} Uhr`
          : 'keine frische Temperatur';
        select.add(new Option(`${item.name} · ${stationDistance(item)} · ${value}`, item.id));
      }
      if (currentChoice && !stations.some(item => item.id === currentChoice)) {
        select.add(new Option(`Gespeicherte Messstation (${currentChoice}) · derzeit nicht verfügbar`, currentChoice));
      }
      select.value = currentChoice;
      const nearest = stations.find(item => freshTemperature(item));
      status.textContent = nearest
        ? `${nearest.distance > 5000 ? `Keine frische DWD-Temperaturmessung im Umkreis von 5 km um ${location.name} gefunden. ` : ''}`
          + `Automatisch: ${nearest.name} · ${stationDistance(nearest)} · ${displayNumber(nearest.temp, ' °C')} um ${formatTime(nearest.timestamp)} Uhr.`
        : 'Keine frische DWD-Temperaturmessung in der Umgebung gefunden.';
    } catch (error) {
      if (revision === this.stationRevision && this.shadowRoot.querySelector('[data-dialog]').open) {
        status.textContent = `Messstationen nicht verfügbar: ${safeText(error?.message, 160)}`;
      }
    }
  }

  async pickTemperatureSensor() {
    this.sensorPicker?.abort();
    this.sensorPicker = new AbortController();
    const device = await openDevicePicker({ services: this.services, title: 'Thermometer auswählen',
      accept: item => Object.keys(item.readings || {}).some(name => READING.test(name)),
      signal: this.sensorPicker.signal });
    if (!device || !this.shadowRoot.querySelector('[data-dialog]').open) return;
    const { elements } = this.shadowRoot.querySelector('[data-form]');
    elements.temperatureDevice.value = device.name;
    const readings = Object.keys(device.readings || {}).filter(name => READING.test(name)).sort();
    elements.temperatureReading.replaceChildren(new Option('Reading auswählen …', ''),
      ...readings.map(name => new Option(name, name)));
    elements.temperatureReading.value = readings.find(name => /^temperature$/i.test(name)) || '';
  }

  async openConfig({ isNew = false } = {}) {
    this.isNew = isNew;
    this.selectedLocation = null;
    const config = weatherConfig(this.widgetConfig);
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.dataSource.value = config.dataSource;
    form.elements.customTitle.value = config.customTitle;
    form.elements.forecastDays.value = String(config.forecastDays);
    form.elements.showAlertsBanner.checked = config.showAlertsBanner;
    form.elements.showCurrentDetails.checked = config.showCurrentDetails;
    form.elements.enableDetailPopup.checked = config.enableDetailPopup;
    const temp = config.temperatureSource;
    form.elements.temperatureMode.value = temp?.mode || 'auto';
    form.elements.temperatureDevice.value = temp?.device || '';
    form.elements.temperatureLabelMode.value = temp?.labelMode || 'device';
    form.elements.temperatureLabelText.value = temp?.labelText || '';
    form.elements.temperatureReading.replaceChildren(new Option(temp?.reading || 'Reading auswählen …', temp?.reading || ''));
    this.shadowRoot.querySelector('[data-results]').replaceChildren();
    this.shadowRoot.querySelector('[data-location-selected]').textContent = config.location
      ? `Ausgewählt: ${locationLabel(config.location)}` : 'Noch kein Ort ausgewählt.';
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    this.updateSourceFields();
    showCmsModal(this.shadowRoot.querySelector('[data-dialog]'));
    void this.loadTemperatureStations(config.location, temp?.station);
    await this.loadWeatherDevices(config.device);
  }

  async loadWeatherDevices(selected) {
    const select = this.shadowRoot.querySelector('[name=device]');
    const status = this.shadowRoot.querySelector('[data-device-status]');
    select.replaceChildren(new Option('Device auswählen …', ''));
    status.textContent = 'DWD_OpenData-Devices werden geladen …';
    try {
      let devices;
      if (typeof this.services?.weatherDevices === 'function') {
        const result = await this.services.weatherDevices();
        if (result?.loading === true) {
          status.textContent = 'DWD_OpenData-Devices werden geladen …';
          return;
        }
        devices = Array.isArray(result?.devices)
          ? result.devices.map(name => ({ name, type: 'DWD_OpenData' })) : [];
      } else if (typeof this.services?.listAllDevices === 'function') {
        devices = await this.services.listAllDevices();
      } else {
        throw new Error('Geräteliste ist nicht verfügbar');
      }
      if (!this.shadowRoot.querySelector('[data-dialog]').open) return;
      const matches = devices.filter(device => device?.type === 'DWD_OpenData' && isValidName(device.name));
      for (const item of matches) select.add(new Option(safeText(item.alias || item.name, 160), item.name));
      if (matches.some(item => item.name === selected)) select.value = selected;
      status.textContent = matches.length ? `${matches.length} DWD_OpenData-Device${matches.length === 1 ? '' : 's'} gefunden.`
        : 'Kein DWD_OpenData-Device gefunden.';
    } catch (error) {
      if (!this.shadowRoot.querySelector('[data-dialog]').open) return;
      status.textContent = `Geräteliste nicht verfügbar: ${safeText(error?.message || String(error), 200)}`;
    }
  }

  async searchLocation() {
    const query = this.shadowRoot.querySelector('[name=query]').value.trim();
    const resultsRoot = this.shadowRoot.querySelector('[data-results]');
    const status = this.shadowRoot.querySelector('[data-location-selected]');
    const revision = ++this.geocodeRevision;
    resultsRoot.replaceChildren();
    void this.loadTemperatureStations(location);
    status.textContent = 'Ortssuche läuft …';
    try {
      if (typeof this.services?.weatherGeocode !== 'function') throw new Error('Ortssuche ist nicht verfügbar');
      if (query.length < 2 || query.length > 80) throw new Error('Bitte 2 bis 80 Zeichen eingeben');
      const deadline = Date.now() + 30000;
      let result;
      do {
        result = await this.services.weatherGeocode(query);
        if (result?.loading === true) {
          if (Date.now() >= deadline) throw new Error('Zeitüberschreitung bei der Ortssuche');
          status.textContent = 'Ortssuche läuft …';
          await new Promise(resolve => setTimeout(resolve, 1500));
          if (revision !== this.geocodeRevision || !this.shadowRoot.querySelector('[data-dialog]').open) return;
        }
      } while (result?.loading === true);
      if (revision !== this.geocodeRevision || !this.shadowRoot.querySelector('[data-dialog]').open) return;
      if (typeof result?.error === 'string') throw new Error(result.error);
      if (!result.results.length) {
        status.textContent = 'Keine passenden Orte gefunden.';
        return;
      }
      status.textContent = 'Bitte einen Ort auswählen:';
      for (const item of result.results) {
        const lat = finite(item.lat);
        const lon = finite(item.lon);
        const name = safeText(item.name, 120);
        if (!name || lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
        const country = safeText(item.country, 2);
        if (!/^[A-Z]{2}$/.test(country)) continue;
        const location = { name, admin1: safeText(item.admin1, 120), country, lat, lon };
        const button = make('button', '', locationLabel(location));
        button.type = 'button';
        button.addEventListener('click', () => {
          this.selectedLocation = location;
          this.shadowRoot.querySelector('[data-location-selected]').textContent = `Ausgewählt: ${locationLabel(location)}`;
          resultsRoot.replaceChildren();
        });
        resultsRoot.append(button);
      }
    } catch (error) {
      if (revision !== this.geocodeRevision || !this.shadowRoot.querySelector('[data-dialog]').open) return;
      status.textContent = '';
      this.shadowRoot.querySelector('[data-error]').textContent = `Ortssuche fehlgeschlagen: ${safeText(error?.message || String(error), 240)}`;
    }
  }

  async saveConfig() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const error = this.shadowRoot.querySelector('[data-error]');
    const current = weatherConfig(this.widgetConfig);
    const dataSource = form.elements.dataSource.value;
    const customTitle = form.elements.customTitle.value.trim();
    const rawDays = form.elements.forecastDays.value;
    if (!['brightsky', 'fhem_dwd'].includes(dataSource)) { error.textContent = 'Bitte eine Datenquelle auswählen.'; return; }
    if (customTitle.length > 64 || /[\u0000-\u001f\u007f]/.test(customTitle)) { error.textContent = 'Der Anzeigename ist ungültig.'; return; }
    if (!/^[0-8]$/.test(rawDays)) { error.textContent = 'Die Vorhersagetage müssen zwischen 0 und 8 liegen.'; return; }
    const location = this.selectedLocation || current.location;
    const device = form.elements.device.value;
    if (dataSource === 'brightsky' && (!location || location.lat === null || location.lon === null
      || !/^[A-Z]{2}$/.test(location.country) || !location.name || location.name.length > 120)) {
      error.textContent = 'Bitte einen Ort suchen und auswählen.';
      return;
    }
    if (dataSource === 'fhem_dwd' && !isValidName(device)) {
      error.textContent = 'Bitte ein gültiges DWD_OpenData-Device auswählen.';
      return;
    }
    const config = {
      dataSource,
      customTitle,
      forecastDays: Number(rawDays),
      showAlertsBanner: form.elements.showAlertsBanner.checked,
      showCurrentDetails: form.elements.showCurrentDetails.checked,
      enableDetailPopup: form.elements.enableDetailPopup.checked,
    };
    if (dataSource === 'brightsky') {
      config.location = location;
      const { temperatureMode, temperatureStation, temperatureDevice, temperatureReading,
        temperatureLabelMode, temperatureLabelText } = form.elements;
      if (temperatureMode.value === 'station') {
        if (!STATION_ID.test(temperatureStation.value)) { error.textContent = 'Bitte eine DWD-Messstation auswählen.'; return; }
        config.temperatureSource = { mode: 'station', station: temperatureStation.value };
      } else if (temperatureMode.value === 'sensor') {
        if (!isValidName(temperatureDevice.value) || !READING.test(temperatureReading.value)) {
          error.textContent = 'Bitte ein Thermometer und ein Temperatur-Reading auswählen.';
          return;
        }
        config.temperatureSource = { mode: 'sensor', device: temperatureDevice.value, reading: temperatureReading.value };
        if (temperatureLabelMode.value !== 'device') config.temperatureSource.labelMode = temperatureLabelMode.value;
        if (temperatureLabelMode.value === 'custom') {
          const label = temperatureLabelText.value.trim();
          if (!label || label.length > 64 || /[\u0000-\u001f\u007f]/.test(label)) {
            error.textContent = 'Bitte einen gültigen Anzeigenamen (1–64 Zeichen) eingeben.';
            return;
          }
          config.temperatureSource.labelText = label;
        }
      }
    } else config.device = device;
    const next = { ...structuredClone(this.widgetConfig), type: 'weather', config };
    try {
      await this.services.saveWidget(next);
      this.config = next;
      this.selectedLocation = null;
      this.closeConfig(true);
    } catch (failure) {
      error.textContent = `Speichern fehlgeschlagen: ${safeText(failure?.message || String(failure), 240)}`;
    }
  }

  async deleteWidget() {
    if (!window.confirm('Dieses DWD-Wetter-Widget entfernen?')) return;
    try {
      await this.services.deleteWidget(this.widgetConfig.id);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent =
        `Entfernen fehlgeschlagen: ${safeText(error?.message || String(error), 240)}`;
    }
  }

  closeConfig(saved) {
    this.sensorPicker?.abort();
    this.stationRevision += 1;
    this.geocodeRevision += 1;
    const editor = this.shadowRoot.querySelector('[data-dialog]');
    if (editor?.open) editor.close();
    this.selectedLocation = null;
    if (!saved && this.isNew) this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true }));
  }
}

if (!customElements.get('cms-weather')) customElements.define('cms-weather', FHEMCMSWeather);

export {
  selectTemperature,
  conditionKey,
  conditionText,
  directionName,
  formatDate,
  formatTime,
  weatherTitle,
  weatherConfig,
};
