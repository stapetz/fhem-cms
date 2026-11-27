import { formatDateDisplay } from './date-display.js';

export const EVENT_LIMIT = 1000;
const MAX_EVENT_VALUE_LENGTH = 4096;
const RENDER_INTERVAL_MS = 50;

export function parseInformEvent(data, deviceNames, timestamp = Date.now()) {
  if (!Array.isArray(data) || data.length < 2 || typeof data[0] !== 'string'
    || typeof data[1] !== 'string' || !Number.isFinite(timestamp)) {
    return null;
  }

  const eventKey = data[0];
  if (eventKey.startsWith('#FHEMWEB:')) return null;

  let device = '';
  for (const name of deviceNames) {
    if (eventKey === name) {
      device = name;
      break;
    }
    if (name.length > device.length && eventKey.startsWith(`${name}-`)) device = name;
  }

  const reading = device
    ? (eventKey === device ? 'state' : eventKey.slice(device.length + 1))
    : eventKey;
  if (!reading || reading.endsWith('-ts')) return null;
  const value = data[1].length > MAX_EVENT_VALUE_LENGTH
    ? `${data[1].slice(0, MAX_EVENT_VALUE_LENGTH)} …`
    : data[1];
  return { timestamp, device, reading, value };
}

export class EventMonitorBuffer {
  constructor(limit = EVENT_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Ungültige Puffergröße');
    this.limit = limit;
    this.events = [];
    this.dropped = 0;
  }

  add(event) {
    if (!event || typeof event !== 'object') throw new Error('Ungültiges FHEM-Ereignis');
    if (this.events.length === this.limit) {
      this.events.shift();
      this.dropped += 1;
    }
    this.events.push(event);
  }

  clear() {
    this.events = [];
    this.dropped = 0;
  }

  matching(filter) {
    const query = filter.trim().toLocaleLowerCase('de-DE');
    if (!query) return [...this.events];
    return this.events.filter((event) =>
      `${event.device} ${event.reading} ${event.value} ${formatDateDisplay(new Date(event.timestamp).toISOString())}`
        .toLocaleLowerCase('de-DE').includes(query));
  }
}

export class EventMonitor {
  constructor(root, client, deviceNames, now = Date.now) {
    if (!root || typeof root.querySelector !== 'function'
      || !client || typeof client.subscribeAll !== 'function'
      || typeof client.unsubscribe !== 'function'
      || !Array.isArray(deviceNames) || typeof now !== 'function') {
      throw new Error('Ungültige Eventmonitor-Dienste');
    }
    this.root = root;
    this.client = client;
    this.deviceNames = [...new Set(deviceNames)].sort((a, b) => b.length - a.length);
    this.now = now;
    this.buffer = new EventMonitorBuffer();
    this.paused = false;
    this.started = false;
    this.renderTimer = null;
    this.renderedEvents = [];
    this.eventsBody = root.querySelector('[data-events]');
    this.eventScroll = root.querySelector('[data-event-scroll]');
    this.filter = root.querySelector('[data-filter]');
    this.empty = root.querySelector('[data-empty]');
    this.bufferInfo = root.querySelector('[data-buffer-info]');
    this.connection = root.querySelector('[data-connection]');
    this.pauseNotice = root.querySelector('[data-pause-notice]');
    this.pauseButton = root.querySelector('[data-pause]');
    this.clearButton = root.querySelector('[data-clear]');
    if (![this.eventsBody, this.eventScroll, this.filter, this.empty, this.bufferInfo,
      this.connection, this.pauseNotice, this.pauseButton, this.clearButton].every(Boolean)) {
      throw new Error('Eventmonitor-Oberfläche ist unvollständig');
    }
    this.onFilter = () => this.render();
    this.onPause = () => this.togglePause();
    this.onClear = () => {
      this.buffer.clear();
      this.render();
    };
    this.onEvent = (data) => this.receive(data);
    this.onState = (state) => this.setConnection(state);
  }

  start() {
    if (this.started) throw new Error('Eventmonitor wurde bereits gestartet');
    this.started = true;
    this.filter.addEventListener('input', this.onFilter);
    this.pauseButton.addEventListener('click', this.onPause);
    this.clearButton.addEventListener('click', this.onClear);
    this.setConnection('connecting');
    this.client.subscribeAll(this.onEvent, this.onState);
    this.render();
    return this;
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    window.clearTimeout(this.renderTimer);
    this.renderTimer = null;
    this.filter.removeEventListener('input', this.onFilter);
    this.pauseButton.removeEventListener('click', this.onPause);
    this.clearButton.removeEventListener('click', this.onClear);
    this.client.unsubscribe();
  }

  receive(data) {
    const event = parseInformEvent(data, this.deviceNames, this.now());
    if (!event) return;
    this.buffer.add(event);
    this.updateBufferInfo();
    if (!this.paused && this.renderTimer === null) {
      this.renderTimer = window.setTimeout(() => {
        this.renderTimer = null;
        if (!this.paused) this.render(true);
      }, RENDER_INTERVAL_MS);
    }
  }

  setConnection(state) {
    const messages = {
      connecting: 'Verbindung zu FHEMWEB wird aufgebaut …',
      live: 'Live verbunden – FHEM-Ereignisse werden empfangen.',
      reconnecting: 'Verbindung unterbrochen – Wiederverbindung läuft …',
      unavailable: 'WebSocket ist nicht verfügbar. Live-Ereignisse können nicht empfangen werden.',
      error: 'Der Eventmonitor konnte nicht gestartet werden.',
    };
    this.connection.dataset.state = Object.hasOwn(messages, state) ? state : 'error';
    this.connection.textContent = messages[state] || messages.error;
  }

  togglePause() {
    this.paused = !this.paused;
    this.pauseButton.textContent = this.paused ? 'Weiter' : 'Anzeige pausieren';
    this.pauseButton.setAttribute('aria-pressed', String(this.paused));
    this.pauseNotice.hidden = !this.paused;
    if (!this.paused) this.render(true);
  }

  updateBufferInfo() {
    const count = this.buffer.events.length;
    const dropped = this.buffer.dropped;
    this.bufferInfo.textContent = `Puffer: ${count} / ${EVENT_LIMIT}`
      + (dropped ? ` · ${dropped} ältere Ereignisse verworfen` : '');
  }

  render(preservePosition = false) {
    const oldScrollTop = this.eventScroll.scrollTop;
    const scrollTop = this.eventScroll.getBoundingClientRect().top;
    const oldRows = [...this.eventsBody.children];
    const anchorIndex = preservePosition && oldScrollTop > 1
      ? oldRows.findIndex((row) => row.getBoundingClientRect().bottom > scrollTop)
      : -1;
    const anchor = anchorIndex >= 0 ? this.renderedEvents[anchorIndex] : null;
    const anchorTop = anchor ? oldRows[anchorIndex].getBoundingClientRect().top : 0;
    const events = this.buffer.matching(this.filter.value).reverse();
    const rows = events.map((event) => {
      const row = document.createElement('tr');
      const values = [
        formatDateDisplay(new Date(event.timestamp).toISOString()),
        event.device || 'Nicht zugeordnet',
        event.reading,
        event.value,
      ];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    });
    this.eventsBody.replaceChildren(...rows);
    this.renderedEvents = events;
    this.empty.hidden = events.length > 0;
    this.empty.textContent = this.buffer.events.length
      ? 'Keine Ereignisse entsprechen dem Filter.'
      : 'Noch keine Ereignisse empfangen.';
    this.updateBufferInfo();
    const newAnchorIndex = anchor ? events.indexOf(anchor) : -1;
    if (newAnchorIndex >= 0) {
      this.eventScroll.scrollTop = oldScrollTop
        + rows[newAnchorIndex].getBoundingClientRect().top - anchorTop;
    } else {
      this.eventScroll.scrollTop = preservePosition && oldScrollTop > 1 ? oldScrollTop : 0;
    }
  }
}
