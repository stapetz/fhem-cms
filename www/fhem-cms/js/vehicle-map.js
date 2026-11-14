const selector = 'div[data-map="vehicle"]';
const coordinate = (value, limit) => typeof value === 'string' && /^-?[0-9]+(?:\.[0-9]+)?$/.test(value)
  && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit ? Number(value) : null;

class VehicleMap {
  constructor(host, runtime) {
    const { map, tileLayer, marker, divIcon } = runtime;
    this.host = host;
    this.position = null;
    this.zoom = null;
    this.cssError = '';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<link rel="stylesheet" href="${new URL('../css/fcui-map.css', import.meta.url)}">
      <style>
        :host{display:block;position:relative;min-height:100px;overflow:hidden}
        .map{height:100%;width:100%;background:#e4e9ed}
        .car{background:#243746;border:2px solid white;border-radius:50%;box-shadow:0 2px 5px #0008;display:grid;place-items:center}
        .car svg{width:25px;height:25px}
        [role=status]{position:absolute;bottom:26px;left:8px;right:8px;z-index:1000;background:#fff;color:#8b1d1d;padding:4px 8px;font:12px sans-serif}
        [hidden]{display:none}
      </style><div class="map" aria-label="Fahrzeugstandort"></div><div role="status" hidden></div>`;
    this.status = shadow.querySelector('[role=status]');
    this.instance = map(shadow.querySelector('.map'), { scrollWheelZoom: false, attributionControl: true });
    this.tiles = tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, minZoom: 2,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    });
    this.tiles.on('tileerror', () => this.message('Kartenkacheln konnten nicht geladen werden.'));
    this.tiles.on('load', () => {
      if (this.position && !this.host.shadowRoot.querySelector('.leaflet-tile:not(.leaflet-tile-loaded)')) this.message('');
    });
    this.car = marker([0, 0], { title: 'Fahrzeugstandort', icon: divIcon({
      className: 'car', iconSize: [36, 36], iconAnchor: [18, 18],
      html: '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="white" d="M8 7h16l3 8v10h-4v-3H9v3H5V15zm3 3-2 6h14l-2-6z"/><circle cx="10" cy="19" r="2" fill="#243746"/><circle cx="22" cy="19" r="2" fill="#243746"/></svg>',
    }) });
    this.observer = new ResizeObserver(() => this.instance.invalidateSize({ pan: false }));
    this.observer.observe(host);
    shadow.querySelector('link').addEventListener('load', () => this.instance.invalidateSize({ pan: false }));
    shadow.querySelector('link').addEventListener('error', () => {
      this.cssError = 'Kartenformatierung konnte nicht geladen werden.';
      this.message('');
    });
  }

  message(text) {
    this.status.textContent = this.cssError || text;
    this.status.hidden = !this.status.textContent;
  }

  update(source) {
    const lat = coordinate(source.dataset.latitude, 90);
    const lon = coordinate(source.dataset.longitude, 180);
    const rawZoom = source.dataset.zoom ?? '16';
    const zoom = /^[0-9]+$/.test(rawZoom) && Number(rawZoom) >= 2 && Number(rawZoom) <= 19 ? Number(rawZoom) : null;
    if (lat === null || lon === null || zoom === null) {
      this.car.remove();
      this.tiles.remove();
      this.position = null;
      this.message('Ungültige oder fehlende Kartenkoordinaten bzw. Zoomstufe (2–19).');
      return;
    }
    const changed = !this.position || lat !== this.position[0] || lon !== this.position[1];
    if (changed || zoom !== this.zoom) {
      this.instance.setView([lat, lon], this.zoom === zoom && this.position ? this.instance.getZoom() : zoom, { animate: false });
      this.car.setLatLng([lat, lon]).addTo(this.instance);
      this.position = [lat, lon];
      this.zoom = zoom;
      this.message('');
    }
    if (!this.instance.hasLayer(this.tiles)) this.tiles.addTo(this.instance);
    this.instance.invalidateSize({ pan: false });
  }

  destroy() {
    this.observer.disconnect();
    this.instance.remove();
  }
}

export function renderVehicleMaps(content, rendered, existing, runtime) {
  const next = new Map();
  const ids = new Set();
  const hosts = [...rendered.querySelectorAll(selector)].filter(host => {
    if (!host.id || ids.has(host.id)) {
      const warning = document.createElement('span');
      warning.setAttribute('role', 'status');
      warning.textContent = 'Fahrzeugkarte benötigt eine eindeutige id im HTML-Widget.';
      host.replaceChildren(warning);
      return false;
    }
    ids.add(host.id);
    return true;
  });
  for (const host of hosts) {
    const controller = existing.get(host.id);
    if (!controller) continue;
    for (const attr of [...controller.host.attributes]) controller.host.removeAttribute(attr.name);
    for (const attr of host.attributes) controller.host.setAttribute(attr.name, attr.value);
    host.replaceWith(controller.host);
  }
  content.replaceChildren(rendered);
  for (const source of hosts) {
    const host = content.querySelector(selector + `[id="${source.id}"]`);
    if (next.has(host.id)) continue;
    let controller = existing.get(host.id);
    if (!controller) controller = new VehicleMap(host, runtime);
    controller.update(controller.host);
    next.set(controller.host.id, controller);
  }
  for (const [id, controller] of existing) if (!next.has(id)) controller.destroy();
  for (const controller of next.values()) controller.instance.invalidateSize({ pan: false });
  return next;
}
