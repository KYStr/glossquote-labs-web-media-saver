import { MediaError } from './common.mjs';
const textAt = (b, at, text) => [...text].every((letter, i) => b[at + i] === letter.charCodeAt(0));
function ebmlVint(bytes, offset, end, maxWidth, elementId = false) {
  if (offset >= end || bytes[offset] === 0) return null;
  const first = bytes[offset];
  let width = 1;
  let marker = 128;
  while (!(first & marker)) { ++width; marker >>= 1; }
  if (width > maxWidth || offset + width > end) return null;
  let value = elementId ? first : first & (marker - 1);
  let unknown = (first & (marker - 1)) === marker - 1;
  for (let i = 1; i < width; i++) {
    value = value * 256 + bytes[offset + i];
    unknown &&= bytes[offset + i] === 255;
    if (!Number.isSafeInteger(value)) return null;
  }
  return { width, value, unknown };
}
function isWebm(bytes) {
  if (bytes.length < 5 || bytes[0] !== 26 || bytes[1] !== 69 || bytes[2] !== 223 || bytes[3] !== 163) return false;
  const size = ebmlVint(bytes, 4, bytes.length, 8);
  if (!size || size.unknown || size.value === 0) return false;
  const end = 4 + size.width + size.value;
  // Bound the whole header, not a search window into the following Segment.
  if (end > bytes.length || end > 4096) return false;
  let offset = 4 + size.width;
  let docTypes = 0;
  while (offset < end) {
    const id = ebmlVint(bytes, offset, end, 4, true);
    if (!id) return false;
    offset += id.width;
    const length = ebmlVint(bytes, offset, end, 8);
    if (!length || length.unknown) return false;
    offset += length.width;
    if (length.value > end - offset) return false;
    if (id.value === 0x4282) {
      ++docTypes;
      if (docTypes !== 1 || length.value !== 4 || !textAt(bytes, offset, 'webm')) return false;
    }
    offset += length.value;
  }
  return offset === end && docTypes === 1;
}
function mp3Frame(bytes, offset) {
  if (offset + 4 > bytes.length || bytes[offset] !== 255 || (bytes[offset + 1] & 224) !== 224) return null;
  const version = (bytes[offset + 1] >> 3) & 3;
  if (version === 1 || ((bytes[offset + 1] >> 1) & 3) !== 1 || (bytes[offset + 3] & 3) === 2) return null;
  const index = bytes[offset + 2] >> 4;
  const rateIndex = (bytes[offset + 2] >> 2) & 3;
  if (index === 0 || index === 15 || rateIndex === 3) return null;
  const rates = [44100, 48000, 32000];
  const bitrates = version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const rate = rates[rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const length = Math.floor((version === 3 ? 144000 : 72000) * bitrates[index] / rate) + ((bytes[offset + 2] >> 1) & 1);
  if (length <= 4 || offset + length > bytes.length) return null;
  return { version, rate, length };
}
function isMp3(bytes) {
  let offset = 0;
  if (bytes.length >= 10 && textAt(bytes, 0, 'ID3')) {
    const version = bytes[3];
    if (version < 2 || version > 4 || bytes[4] === 255 || bytes.slice(6, 10).some(value => value > 127)) return false;
    const allowedFlags = version === 2 ? 192 : version === 3 ? 224 : 240;
    if ((bytes[5] & ~allowedFlags) !== 0) return false;
    offset = 10 + bytes.slice(6, 10).reduce((size, value) => size * 128 + value, 0) + ((version === 4 && (bytes[5] & 16)) ? 10 : 0);
  }
  // No scan through arbitrary HTML/noise: the first frame must follow the tag directly.
  const first = mp3Frame(bytes, offset);
  if (!first) return false;
  const nextOffset = offset + first.length;
  if (nextOffset === bytes.length || (bytes.length - nextOffset === 128 && textAt(bytes, nextOffset, 'TAG'))) return true;
  const second = mp3Frame(bytes, nextOffset);
  return second !== null && second.version === first.version && second.rate === first.rate;
}
export function inspectMedia(bytes, rawMime = '') {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new MediaError('EMPTY');
  const mime = rawMime.split(';')[0].trim().toLowerCase();
  let container = null;
  if (bytes.length >= 44 && textAt(bytes, 0, 'RIFF') && textAt(bytes, 8, 'WAVE')) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = view.getUint32(4, true) + 8;
    let fmt = false;
    let data = false;
    let valid = end <= bytes.length && end >= 44;
    for (let offset = 12; valid && offset + 8 <= end;) {
      const length = view.getUint32(offset + 4, true);
      if (offset + 8 + length > end) { valid = false; break; }
      if (textAt(bytes, offset, 'fmt ') && length >= 16) fmt = view.getUint16(offset + 10, true) > 0 && view.getUint32(offset + 12, true) > 0;
      if (textAt(bytes, offset, 'data') && length > 0) data = true;
      offset += 8 + length + length % 2;
    }
    if (valid && fmt && data) container = 'wav';
  }
  if (bytes.length >= 16 && textAt(bytes, 4, 'ftyp')) {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    const brands = ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4A '];
    const allBrands = [brand];
    for (let offset = 16; offset + 4 <= Math.min(size, bytes.length); offset += 4) allBrands.push(String.fromCharCode(...bytes.slice(offset, offset + 4)));
    if (size >= 16 && size % 4 === 0 && size <= bytes.length && brands.includes(brand)
      && !allBrands.some(value => ['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(value))) {
      container = brand === 'M4A ' ? 'm4a' : 'mp4';
    }
  }
  if (isWebm(bytes)) container = 'webm';
  if (bytes.length >= 27 && textAt(bytes, 0, 'OggS') && bytes[4] === 0) {
    const segments = bytes[26];
    const payload = bytes.slice(27, 27 + segments).reduce((a, b) => a + b, 0);
    if (segments > 0 && payload > 0 && bytes.length >= 27 + segments && payload <= bytes.length - 27 - segments) container = 'ogg';
  }
  if (!container && isMp3(bytes)) container = 'mp3';
  const types = { wav: ['audio/wav', 'audio/wave', 'audio/x-wav'], mp3: ['audio/mpeg', 'audio/mp3'],
    mp4: ['video/mp4', 'audio/mp4', 'application/mp4'], m4a: ['audio/mp4', 'video/mp4', 'audio/x-m4a', 'application/mp4'],
    webm: ['audio/webm', 'video/webm'], ogg: ['audio/ogg', 'video/ogg', 'application/ogg'] };
  if (!container) throw new MediaError('MEDIA_UNSUPPORTED');
  if (mime && mime !== 'application/octet-stream' && !types[container].includes(mime)) throw new MediaError('TYPE_MISMATCH');
  return { container, extension: container, mime: types[container].includes(mime) ? mime : types[container][0],
    format: { wav: 'WAV', mp3: 'MP3', mp4: 'MP4', m4a: 'M4A', webm: 'WebM', ogg: 'Ogg' }[container] };
}
