export function tiffFixture(littleEndian = true) {
  const bytes = new Uint8Array(180);
  const view = new DataView(bytes.buffer);
  const u16 = (at, value) => view.setUint16(at, value, littleEndian);
  const u32 = (at, value) => view.setUint32(at, value, littleEndian);
  const text = (at, value) => bytes.set(new TextEncoder().encode(value), at);
  const entry = (at, tag, type, count, value) => {
    u16(at, tag); u16(at + 2, type); u32(at + 4, count); u32(at + 8, value);
  };
  text(0, littleEndian ? 'II' : 'MM'); u16(2, 42); u32(4, 8);
  u16(8, 3);
  entry(10, 0x010f, 2, 12, 100);
  entry(22, 0x8769, 4, 1, 50);
  entry(34, 0x8825, 4, 1, 68);
  u16(50, 1); entry(52, 0x9003, 2, 20, 120);
  u16(68, 1); entry(70, 2, 5, 3, 148);
  text(100, 'Test Camera\0'); text(120, '2026:11:10 12:34:56\0');
  [52, 1, 30, 1, 15, 2].forEach((value, index) => u32(148 + index * 4, value));
  return bytes;
}

export function jpegFixture(tiff = tiffFixture()) {
  const bytes = new Uint8Array(tiff.length + 14);
  bytes.set([0xff, 0xd8, 0xff, 0xe1, (tiff.length + 8) >> 8, (tiff.length + 8) & 255, 69, 120, 105, 102, 0, 0]);
  bytes.set(tiff, 12); bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

export function pngFixture(tiff = tiffFixture()) {
  const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrJkAAAAASUVORK5CYII=', 'base64');
  const chunk = Buffer.alloc(tiff.length + 12);
  chunk.writeUInt32BE(tiff.length); chunk.write('eXIf', 4); chunk.set(tiff, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([original.subarray(0, 33), chunk, original.subarray(33)]);
}
