import { isValidName } from './fhem-client.js';
import { devicesOf, groupSnapshots } from './widget-factory.js';

const POLL_INTERVAL_MS = 30000;
const REFRESH_DEBOUNCE_MS = 300;

export class Schema5LivePage {
  constructor(client, widgets, onUpdate, onStatus, timers = globalThis, now = Date.now) {
    if (!client || typeof client.jsonlist !== 'function' || typeof client.subscribe !== 'function'
      || typeof client.unsubscribe !== 'function' || !Array.isArray(widgets)
      || typeof onUpdate !== 'function' || typeof onStatus !== 'function'
      || typeof timers.setTimeout !== 'function' || typeof timers.clearTimeout !== 'function'
      || typeof timers.setInterval !== 'function' || typeof timers.clearInterval !== 'function'
      || typeof now !== 'function') {
      throw new Error('Ungültige Live-Dienste oder Widget-Liste');
    }
    this.client = client;
    this.devices = [...new Set(widgets.flatMap(devicesOf).filter(isValidName))].sort();
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.timers = timers;
    this.now = now;
    this.snapshots = new Map();
    this.lastSuccess = null;
    this.error = null;
    this.connection = 'polling';
    this.subscriptionKey = null;
    this.subscriptionGeneration = 0;
    this.generation = 0;
    this.started = false;
    this.stopped = false;
    this.pending = false;
    this.inFlight = null;
    this.refreshTimer = null;
    this.pollTimer = null;
  }

  start() {
    if (this.started || this.stopped) throw new Error('Live-Seite wurde bereits gestartet oder beendet');
    this.started = true;
    this.resubscribe();
    this.pollTimer = this.timers.setInterval(() => this.scheduleRefresh(0), POLL_INTERVAL_MS);
    return this.refresh();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1;
    this.subscriptionGeneration += 1;
    this.timers.clearTimeout(this.refreshTimer);
    this.timers.clearInterval(this.pollTimer);
    this.client.unsubscribe();
  }

  status() {
    this.onStatus({ connection: this.connection, error: this.error, lastSuccess: this.lastSuccess });
  }

  scheduleRefresh(delay = REFRESH_DEBOUNCE_MS) {
    if (!this.started || this.stopped) return;
    this.timers.clearTimeout(this.refreshTimer);
    this.refreshTimer = this.timers.setTimeout(() => {
      this.refreshTimer = null;
      this.refresh().catch((error) => {
        if (this.stopped) return;
        this.stop();
        this.error = `Live-Aktualisierung abgebrochen: ${error instanceof Error ? error.message : String(error)}`;
        this.status();
      });
    }, delay);
  }

  resubscribe() {
    if (this.stopped) return;
    const names = new Set(this.devices);
    for (const group of this.snapshots.values()) {
      for (const item of group) if (isValidName(item.name)) names.add(item.name);
    }
    const sorted = [...names].sort();
    const key = sorted.join('|');
    if (key === this.subscriptionKey) return;
    this.subscriptionKey = key;
    const generation = ++this.subscriptionGeneration;
    this.connection = 'polling';
    this.client.subscribe(sorted, () => {
      if (!this.stopped && generation === this.subscriptionGeneration) this.scheduleRefresh();
    }, (state) => {
      if (this.stopped || generation !== this.subscriptionGeneration) return;
      const reconnected = state === 'live' && this.connection !== 'live' && this.lastSuccess !== null;
      this.connection = state === 'live' ? 'live' : 'polling';
      this.status();
      if (reconnected) this.scheduleRefresh();
    });
  }

  refresh() {
    if (!this.started || this.stopped) throw new Error('Live-Seite ist nicht aktiv');
    if (this.inFlight) {
      this.pending = true;
      return this.inFlight;
    }
    const generation = this.generation;
    let request;
    try {
      request = this.devices.length
        ? this.client.jsonlist(this.devices.flatMap((name) => [name, `device=${name}`]).join(','))
        : Promise.resolve([]);
    } catch (error) {
      request = Promise.reject(error);
    }
    const operation = Promise.resolve(request).then((results) => {
      if (this.stopped || generation !== this.generation) return;
      this.snapshots = groupSnapshots(this.devices, results);
      this.lastSuccess = this.now();
      this.error = null;
      this.onUpdate(this.snapshots, null);
      this.resubscribe();
      this.status();
    }, (error) => {
      if (this.stopped || generation !== this.generation) return;
      this.error = (error instanceof Error ? error.message : String(error)) || 'Unbekannter Fehler';
      this.onUpdate(this.snapshots, this.lastSuccess);
      this.status();
    }).finally(() => {
      this.inFlight = null;
      if (!this.stopped && generation === this.generation && this.pending) {
        this.pending = false;
        this.scheduleRefresh(0);
      }
    });
    this.inFlight = operation;
    return operation;
  }
}
