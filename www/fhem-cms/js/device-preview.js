// Geräte-Vorschau für den Bearbeitungsmodus: zeigt den Entwurf in einem Rahmen mit der Bildschirmgröße
// (CSS-Pixel) des gewählten Geräts. Die Seite läuft in einem iframe und reagiert so wie auf dem echten Gerät.

// Größen im Hochformat in CSS-Pixeln (Breite x Höhe).
export const DEVICE_GROUPS = [
  ['iPhone', [
    ['iphone-se', 'iPhone SE (3. Gen.)', 375, 667],
    ['iphone-13', 'iPhone 13 / 14', 390, 844],
    ['iphone-15', 'iPhone 15 / 16', 393, 852],
    ['iphone-pro-max', 'iPhone 15 / 16 Pro Max', 430, 932]
  ]],
  ['iPad', [
    ['ipad-mini', 'iPad mini', 744, 1133],
    ['ipad-10', 'iPad (9./10. Gen.)', 810, 1080],
    ['ipad-air', 'iPad Air 11"', 820, 1180],
    ['ipad-pro-11', 'iPad Pro 11"', 834, 1194],
    ['ipad-pro-13', 'iPad Pro 12,9" / 13"', 1024, 1366]
  ]],
  ['Android', [
    ['pixel-7', 'Pixel 7', 412, 915],
    ['galaxy-tab', 'Galaxy Tab S9', 800, 1280]
  ]],
  ['Desktop / Monitor', [
    ['desktop-1280', 'Laptop 1280 × 720', 1280, 720, true],
    ['desktop-1366', 'Laptop 1366 × 768', 1366, 768, true],
    ['desktop-1920', 'Full HD 1920 × 1080', 1920, 1080, true],
    ['desktop-2560', 'WQHD 2560 × 1440', 2560, 1440, true]
  ]]
];

const DEVICES = new Map(DEVICE_GROUPS.flatMap(([, items]) => items.map(([id, name, width, height, landscape]) => [
  id, { id, name, width, height, landscape: Boolean(landscape) }
])));

export function deviceSize(id, rotated) {
  const device = DEVICES.get(id);
  if (!device) {
    return null;
  }
  // Desktop-Größen sind von Haus aus Querformat; „Drehen“ vertauscht bei allen Geräten die Seiten.
  const flip = Boolean(rotated);
  return flip ? { width: device.height, height: device.width, name: device.name }
    : { width: device.width, height: device.height, name: device.name };
}

export class DevicePreview {
  // getUrl liefert die Adresse der Vorschau; beforeOpen speichert vorher ausstehende Änderungen.
  constructor({ getUrl, beforeOpen }) {
    this.getUrl = getUrl;
    this.beforeOpen = beforeOpen;
    this.deviceId = '';
    this.rotated = false;
    this.onResize = () => this.fit();
    this.onKey = (event) => {
      if (event.key === 'Escape' && this.deviceId) {
        this.select('');
      }
    };

    this.bar = document.createElement('div');
    this.bar.className = 'cms-device-bar';
    this.bar.setAttribute('role', 'group');
    this.bar.setAttribute('aria-label', 'Geräte-Vorschau');

    this.select_ = document.createElement('select');
    this.select_.setAttribute('aria-label', 'Geräte-Vorschau');
    this.select_.title = 'Seite in der Größe eines Geräts ansehen';
    const off = document.createElement('option');
    off.value = '';
    off.textContent = 'Vorschau: Aus';
    this.select_.append(off);
    for (const [label, items] of DEVICE_GROUPS) {
      const group = document.createElement('optgroup');
      group.label = label;
      for (const [id, name, width, height, landscape] of items) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = landscape ? name : `${name} (${width} × ${height})`;
        group.append(option);
      }
      this.select_.append(group);
    }
    this.select_.addEventListener('change', () => this.select(this.select_.value));

    this.rotate = document.createElement('button');
    this.rotate.type = 'button';
    this.rotate.className = 'cms-device-rotate';
    this.rotate.textContent = '⟳';
    this.rotate.title = 'Gerät drehen (Hoch-/Querformat)';
    this.rotate.setAttribute('aria-label', 'Gerät drehen');
    this.rotate.disabled = true;
    this.rotate.addEventListener('click', () => {
      this.rotated = !this.rotated;
      this.render();
    });
    this.bar.append(this.select_, this.rotate);
    document.body.append(this.bar);
  }

  async select(id) {
    this.deviceId = DEVICES.has(id) ? id : '';
    this.select_.value = this.deviceId;
    this.rotate.disabled = !this.deviceId;
    this.rotated = false;
    this.close();
    if (!this.deviceId) {
      return;
    }
    try {
      await this.beforeOpen?.();
    } catch {
      this.select_.value = '';
      this.deviceId = '';
      this.rotate.disabled = true;
      return;
    }
    if (this.deviceId === id) {
      this.render();
    }
  }

  close() {
    this.overlay?.remove();
    this.overlay = null;
    this.frame = null;
    this.stage = null;
    this.label = null;
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKey);
  }

  destroy() {
    this.deviceId = '';
    this.select_.value = '';
    this.rotate.disabled = true;
    this.close();
    this.bar.remove();
  }

  render() {
    const size = deviceSize(this.deviceId, this.rotated);
    if (!size) {
      return;
    }
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'cms-device-overlay';
      this.overlay.setAttribute('role', 'dialog');
      this.overlay.setAttribute('aria-label', 'Geräte-Vorschau');
      this.stage = document.createElement('div');
      this.stage.className = 'cms-device-stage';
      this.frame = document.createElement('div');
      this.frame.className = 'cms-device-frame';
      this.iframe = document.createElement('iframe');
      this.iframe.className = 'cms-device-screen';
      this.iframe.title = 'Vorschau';
      const url = new URL(this.getUrl());
      if (!DEVICES.get(this.deviceId).landscape) url.searchParams.set('cms-device', 'mobile');
      this.iframe.src = url.href;
      this.frame.append(this.iframe);
      this.stage.append(this.frame);
      this.label = document.createElement('p');
      this.label.className = 'cms-device-label';
      this.overlay.append(this.stage, this.label);
      document.body.append(this.overlay);
      window.addEventListener('resize', this.onResize);
      document.addEventListener('keydown', this.onKey);
    }
    this.iframe.style.width = `${size.width}px`;
    this.iframe.style.height = `${size.height}px`;
    this.fit();
  }

  // Skaliert die Gerätegröße so, dass der Rahmen in den freien Bereich passt.
  fit() {
    const size = deviceSize(this.deviceId, this.rotated);
    if (!size || !this.overlay) {
      return;
    }
    const border = 12;
    const availableWidth = Math.max(100, this.stage.clientWidth - 16);
    const availableHeight = Math.max(100, this.stage.clientHeight - 16);
    const scale = Math.min(1, (availableWidth - 2 * border) / size.width, (availableHeight - 2 * border) / size.height);
    this.iframe.style.transform = `scale(${scale})`;
    this.frame.style.width = `${Math.round(size.width * scale)}px`;
    this.frame.style.height = `${Math.round(size.height * scale)}px`;
    this.label.textContent = `${size.name} · ${size.width} × ${size.height} px · ${Math.round(scale * 100)} %`;
  }
}
