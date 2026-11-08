import '../components/cms-thermostat.js';
import '../components/cms-text.js';
import '../components/cms-value.js';
import '../components/cms-switch.js';
import '../components/cms-button.js';
import '../components/cms-html.js';
import '../components/cms-clock.js';
import '../components/cms-icon.js';
import '../components/cms-table.js';
import '../components/cms-slider.js';
import '../components/cms-chart.js';
import { devicesOfSolarFlow } from '../components/cms-solarflow.js';
import { MAX_FREE_DEVICES, extractDevices } from './freehtml.js';
import { isValidName } from './fhem-client.js';

const tags = new Map([
  ['thermostat', 'cms-thermostat'],
  ['fhem-value', 'cms-value'],
  ['fhem-switch', 'cms-switch'],
  ['fhem-button', 'cms-button'],
  ['fhem-clock', 'cms-clock'],
  ['fhem-icon', 'cms-icon'],
  ['fhem-table', 'cms-table'],
  ['fhem-solarflow', 'cms-solarflow'],
  ['fhem-chart', 'cms-chart'],
  ['fhem-slider', 'cms-slider'],
  ['fhem-html', 'cms-html'],
  ['text', 'cms-text'],
]);
const withoutSnapshots = new Set(['fhem-button', 'fhem-clock', 'fhem-chart']);
const groupedSnapshots = new Set(['fhem-html', 'text', 'fhem-table', 'fhem-solarflow']);

export function devicesOf(widget) {
  if (widget.type === 'fhem-table') {
    return [...new Set((widget.rows || []).map((row) => row.device).filter(isValidName))];
  }
  if (widget.type === 'fhem-chart') return [];
  if (widget.type === 'fhem-solarflow') return devicesOfSolarFlow(widget);
  if (widget.type === 'fhem-html') return widget.devices;
  if (widget.type === 'text') return extractDevices(widget.html || '').slice(0, MAX_FREE_DEVICES);
  return [widget.device];
}

export function dataFor(widget, snapshots) {
  return groupedSnapshots.has(widget.type)
    ? new Map(devicesOf(widget).filter((name) => snapshots.has(name)).map((name) => [name, snapshots.get(name)]))
    : snapshots.get(widget.device) || null;
}

export function groupSnapshots(mains, results) {
  const byName = new Map(results.map((item) => [item.name, item]));
  const groups = new Map();
  for (const name of mains) {
    const main = byName.get(name);
    if (!main) continue;
    const channels = results.filter((item) => item.parent === name)
      .sort((a, b) => a.name.localeCompare(b.name));
    groups.set(name, [main, ...channels]);
  }
  return groups;
}

export function isLiveWidget(widget) {
  return ['thermostat', 'fhem-value', 'fhem-switch', 'fhem-html', 'fhem-icon', 'fhem-table', 'fhem-slider', 'fhem-solarflow'].includes(widget.type)
    || (widget.type === 'text' && devicesOf(widget).length > 0);
}

export function createWidgetElement(widget, services, snapshots, viewOnly) {
  const tag = tags.get(widget.type);
  const element = document.createElement(tag || 'p');
  if (tag) {
    element.services = services;
    element.config = widget;
    if (!withoutSnapshots.has(widget.type)) element.data = dataFor(widget, snapshots);
  } else {
    element.className = 'cms-unsupported';
    element.textContent = `Widget-Typ „${widget.type}“ wird noch nicht angezeigt.`;
  }
  if (viewOnly) element.setAttribute('view-only', '');
  return element;
}
