const labels = new Map([
  [0x010e, 'Beschreibung'], [0x010f, 'Hersteller'], [0x0110, 'Kameramodell'],
  [0x0112, 'Ausrichtung'], [0x011a, 'X-Auflösung'], [0x011b, 'Y-Auflösung'],
  [0x0128, 'Auflösungseinheit'], [0x0131, 'Software'], [0x0132, 'Änderungsdatum'],
  [0x013b, 'Urheber'], [0x8298, 'Copyright'], [0x829a, 'Belichtungszeit'],
  [0x829d, 'Blende'], [0x8822, 'Belichtungsprogramm'], [0x8827, 'ISO'],
  [0x9000, 'EXIF-Version'], [0x9003, 'Aufnahmedatum'], [0x9004, 'Digitalisierungsdatum'],
  [0x9010, 'Zeitzone'], [0x9011, 'Aufnahme-Zeitzone'], [0x9201, 'Verschlusszeit'],
  [0x9202, 'Blendenwert'], [0x9204, 'Belichtungskorrektur'], [0x9207, 'Messmethode'],
  [0x9209, 'Blitz'], [0x920a, 'Brennweite'], [0x927c, 'Herstellernotizen'],
  [0x9286, 'Benutzerkommentar'], [0xa001, 'Farbraum'], [0xa002, 'Bildbreite'],
  [0xa003, 'Bildhöhe'], [0xa405, 'Brennweite (Kleinbild)'], [0xa420, 'Bild-ID'],
  [0xa430, 'Kamera-Eigentümer'], [0xa431, 'Kamera-Seriennummer'],
  [0xa432, 'Objektivdaten'], [0xa433, 'Objektivhersteller'], [0xa434, 'Objektivmodell'],
  [0xa435, 'Objektiv-Seriennummer'],
]);
const gpsLabels = ['Version', 'Breitengrad-Richtung', 'Breitengrad', 'Längengrad-Richtung',
  'Längengrad', 'Höhenbezug', 'Höhe', 'UTC-Zeit', 'Satelliten', 'Status',
  'Messmodus', 'Genauigkeit', 'Geschwindigkeitseinheit', 'Geschwindigkeit',
  'Bewegungsrichtungsbezug', 'Bewegungsrichtung', 'Bildrichtungsbezug', 'Bildrichtung',
  'Kartendatum', 'Ziel-Breitengrad-Richtung', 'Ziel-Breitengrad', 'Ziel-Längengrad-Richtung',
  'Ziel-Längengrad', 'Zielrichtungsbezug', 'Zielrichtung', 'Zielentfernungseinheit',
  'Zielentfernung', 'Verarbeitungsmethode', 'Gebiet', 'Datum', 'Differentialkorrektur'];
const invalid = () => { throw new Error('EXIF-Daten sind beschädigt oder unvollständig.'); };
const maxBytes = 50 * 1048576;

function readTiff(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fits = (offset, size) => Number.isSafeInteger(offset) && offset >= 0
    && size >= 0 && offset + size <= bytes.length;
  const check = (offset, size) => { if (!fits(offset, size)) invalid(); };
  check(0, 8);
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) invalid();
  const le = order === 0x4949;
  const u16 = offset => { check(offset, 2); return view.getUint16(offset, le); };
  const u32 = offset => { check(offset, 4); return view.getUint32(offset, le); };
  if (u16(2) !== 42) invalid();
  const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  const rows = [];
  const visited = new Set();
  let entries = 0;
  const directory = (offset, group) => {
    if (!offset) return;
    if (visited.has(offset) || visited.size >= 16) invalid();
    visited.add(offset);
    const count = u16(offset);
    entries += count;
    if (entries > 1024) throw new Error('EXIF-Daten überschreiten die Grenze von 1024 Einträgen.');
    check(offset + 2, count * 12 + 4);
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const length = u32(entry + 4);
      if (!sizes[type]) {
        rows.push({ name: `${group}: Tag 0x${tag.toString(16).padStart(4, '0')}`, value: `Unbekannter Datentyp ${type}` });
        continue;
      }
      const size = sizes[type] * length;
      const data = size > 4 ? u32(entry + 8) : entry + 8;
      check(data, size);
      if ([0x8769, 0x8825, 0xa005].includes(tag)) {
        if (type !== 4 || length !== 1) invalid();
        directory(u32(data), tag === 0x8825 ? 'GPS' : tag === 0xa005 ? 'Interoperabilität' : 'EXIF');
        continue;
      }
      // Thumbnail payloads are not metadata values; offsets alone are sufficient.
      const name = group === 'GPS' ? (gpsLabels[tag] || `Tag 0x${tag.toString(16)}`)
        : (labels.get(tag) || `Tag 0x${tag.toString(16).padStart(4, '0')}`);
      let value;
      if (type === 2) {
        value = new TextDecoder('utf-8').decode(bytes.subarray(data, data + Math.min(length, 2048)))
          .replace(/\0+$/, '').replace(/[\x00-\x1f\x7f]/g, ' ');
        if (length > 2048) value += ' … (gekürzt)';
      } else {
        const values = [];
        for (let item = 0; item < Math.min(length, 64); item++) {
          const at = data + sizes[type] * item;
          let number;
          if (type === 1 || type === 7) number = view.getUint8(at);
          else if (type === 3) number = u16(at);
          else if (type === 4) number = u32(at);
          else if (type === 6) number = view.getInt8(at);
          else if (type === 8) number = view.getInt16(at, le);
          else if (type === 9) number = view.getInt32(at, le);
          else if (type === 11) number = view.getFloat32(at, le);
          else if (type === 12) number = view.getFloat64(at, le);
          else {
            const numerator = type === 5 ? u32(at) : view.getInt32(at, le);
            const denominator = type === 5 ? u32(at + 4) : view.getInt32(at + 4, le);
            number = denominator ? `${numerator}/${denominator} (${Number((numerator / denominator).toPrecision(8))})` : `${numerator}/0`;
          }
          values.push(String(number));
        }
        value = values.join(', ') + (length > 64 ? ` … (${length} Werte, gekürzt)` : '');
      }
      rows.push({ name: `${group}: ${name}`, value });
    }
    directory(u32(offset + 2 + count * 12), `${group} / Folge-IFD`);
  };
  directory(u32(4), 'Bild');
  return rows;
}

export function extractExif(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes) throw new Error('Ungültige EXIF-Bildgröße.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) invalid();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) return [];
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      if (marker === 0xe1 && length >= 8
        && String.fromCharCode(...bytes.subarray(offset + 2, offset + 8)) === 'Exif\0\0') {
        return readTiff(bytes.subarray(offset + 8, offset + length));
      }
      offset += length;
    }
    invalid();
  }
  if (bytes.length >= 8 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      if (offset + 12 + length > bytes.length) invalid();
      const type = view.getUint32(offset + 4);
      if (type === 0x65584966) return readTiff(bytes.subarray(offset + 8, offset + 8 + length));
      if (type === 0x49454e44) return [];
      offset += 12 + length;
    }
    invalid();
  }
  return [];
}

export async function loadAssetExif(href, { signal } = {}) {
  if (!/^media\/[0-9a-f]{32}\.(?:png|jpg|gif)$/.test(href)) throw new Error('Ungültige EXIF-Bildadresse.');
  const response = await fetch(href, { credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`EXIF-Bild konnte nicht geladen werden (HTTP ${response.status}).`);
  if (!response.body) throw new Error('EXIF-Bildantwort enthält keine Daten.');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) throw new Error('EXIF-Bild überschreitet 50 MiB.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return extractExif(bytes);
}
