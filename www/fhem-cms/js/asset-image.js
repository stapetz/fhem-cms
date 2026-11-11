const MAX_BYTES = 50 * 1048576;
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 16000000;

const invalid = () => { throw new Error('Das Bildformat ist beschädigt oder wird nicht unterstützt.'); };

export function inspectImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 10 || bytes.length > MAX_BYTES) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fits = (at, length) => at >= 0 && length >= 0 && at + length <= bytes.length;
  const check = (at, length) => { if (!fits(at, length)) invalid(); };
  const u16 = at => { check(at, 2); return view.getUint16(at); };
  const u32 = at => { check(at, 4); return view.getUint32(at); };
  let width, height, type;
  if (bytes[0] === 0x89 && String.fromCharCode(...bytes.subarray(1, 8)) === 'PNG\r\n\x1a\n') {
    check(8, 25);
    if (u32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') invalid();
    width = u32(16); height = u32(20); type = 'image/png';
    let at = 8, ended = false;
    while (fits(at, 12)) {
      const length = u32(at);
      check(at, length + 12);
      const tag = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (tag === 'acTL') throw new Error('Animierte Bilder können nicht bearbeitet werden.');
      at += length + 12;
      if (tag === 'IEND') { ended = true; break; }
    }
    if (!ended) invalid();
  } else if (String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF87a'
    || String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF89a') {
    check(0, 13);
    width = view.getUint16(6, true); height = view.getUint16(8, true); type = 'image/gif';
    let at = 13;
    if (bytes[10] & 0x80) at += 3 * (2 ** ((bytes[10] & 7) + 1));
    let frames = 0, ended = false;
    const blocks = () => {
      for (;;) {
        check(at, 1);
        const length = bytes[at++];
        if (!length) return;
        check(at, length); at += length;
      }
    };
    while (fits(at, 1)) {
      const marker = bytes[at++];
      if (marker === 0x3b) { ended = true; break; }
      if (marker === 0x21) { check(at, 1); at++; blocks(); continue; }
      if (marker !== 0x2c) invalid();
      check(at, 9);
      const left = view.getUint16(at, true), top = view.getUint16(at + 2, true);
      const frameWidth = view.getUint16(at + 4, true), frameHeight = view.getUint16(at + 6, true);
      if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) invalid();
      const packed = bytes[at + 8]; at += 9;
      if (packed & 0x80) at += 3 * (2 ** ((packed & 7) + 1));
      check(at, 1); at++;
      blocks();
      if (++frames > 1) throw new Error('Animierte GIFs können nicht bearbeitet werden.');
    }
    if (!ended || frames !== 1) invalid();
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    type = 'image/jpeg';
    let at = 2;
    while (fits(at, 4)) {
      if (bytes[at++] !== 0xff) invalid();
      while (fits(at, 1) && bytes[at] === 0xff) at++;
      check(at, 1);
      const marker = bytes[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = u16(at);
      if (length < 2) invalid();
      check(at, length);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) invalid();
        height = u16(at + 3); width = u16(at + 5); break;
      }
      at += length;
    }
  } else invalid();
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new Error('Das Bild überschreitet die Bearbeitungsgrenze von 8192 Pixeln je Seite oder 16 Megapixeln.');
  }
  return { width, height, type };
}

export async function fetchEditableImage(asset, signal) {
  if (!asset.image || asset.bytes > MAX_BYTES) throw new Error('Dieses Bild ist zu groß für die Bearbeitung.');
  const response = await fetch(asset.href, { signal, credentials: 'same-origin' });
  if (!response.ok || !response.body) throw new Error('Bild konnte nicht geladen werden.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES || size > asset.bytes) throw new Error('Bilddatei ist größer als im Assetkatalog angegeben.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  if (size !== asset.bytes) throw new Error('Bilddatei stimmt nicht mit dem Assetkatalog überein.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const info = inspectImage(bytes);
  return { ...info, blob: new Blob([bytes], { type: info.type }) };
}
