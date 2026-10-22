import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMedia } from '../public/assets/media.mjs';
import { audioInfo, encodeWav } from '../public/assets/wav.mjs';
import { createBrowserAudio } from '../public/assets/audio.mjs';
import { wavFixture, audioFixture } from './web-fixtures.mjs';
import { deferred, flush, manualScheduler } from './fake-adapter.mjs';

function ftyp(brand, compatible = 'isom') {
  const bytes = new Uint8Array(20); const view = new DataView(bytes.buffer); view.setUint32(0, 20);
  [...`ftyp${brand}`].forEach((c, i) => { bytes[4 + i] = c.charCodeAt(0); });
  [...compatible].forEach((c, i) => { bytes[16 + i] = c.charCodeAt(0); }); return bytes;
}
function mp3(version = 3, frames = 1) {
  // Independently fixed fixture lengths for 128 kbps MPEG1 / 64 kbps MPEG2/2.5.
  const length = version === 3 ? 417 : version === 2 ? 208 : 417;
  const bytes = new Uint8Array(length * frames);
  for (let i = 0; i < frames; i++) bytes.set([255, version === 3 ? 251 : version === 2 ? 243 : 227, version === 3 ? 144 : 128, 0], i * length);
  return bytes;
}
test('WEB container signatures/MIME identify finite formats, not file extensions', () => {
  assert.equal(inspectMedia(wavFixture(), 'audio/wav; charset=binary').container, 'wav');
  assert.equal(inspectMedia(wavFixture(), '').container, 'wav');
  assert.equal(inspectMedia(ftyp('isom'), 'application/octet-stream').container, 'mp4');
  assert.equal(inspectMedia(ftyp('M4A '), 'audio/mp4').extension, 'm4a');
  const webm = Uint8Array.from([26, 69, 223, 163, 135, 66, 130, 132, 119, 101, 98, 109]);
  assert.equal(inspectMedia(webm, 'video/webm').container, 'webm');
  const ogg = new Uint8Array(32); ogg.set([79, 103, 103, 83]); ogg[26] = 1; ogg[27] = 4;
  assert.equal(inspectMedia(ogg, 'audio/ogg').container, 'ogg');
});
test('WEB rejects HTML/JSON/playlists, MIME mismatch, truncated WAV and general EBML', () => {
  for (const text of ['<html>not media</html>', '{"file":"x"}', '#EXTM3U\nhttps://media.public-domain.org/file']) {
    assert.throws(() => inspectMedia(new TextEncoder().encode(text), ''), error => error.code === 'MEDIA_UNSUPPORTED');
  }
  for (const mime of ['text/html', 'application/json', 'audio/x-mpegurl', 'image/png']) {
    assert.throws(() => inspectMedia(wavFixture(), mime), error => error.code === 'TYPE_MISMATCH');
  }
  assert.throws(() => inspectMedia(wavFixture().slice(0, 12)), error => error.code === 'MEDIA_UNSUPPORTED');
  assert.throws(() => inspectMedia(Uint8Array.from([26, 69, 223, 163, 0, 0, 0, 0, 0])), error => error.code === 'MEDIA_UNSUPPORTED');
});
test('R02 WEB refuses QuickTime, AVIF/HEIC major and compatible brands', () => {
  for (const brand of ['qt  ', 'avif', 'avis', 'heic', 'mif1']) assert.throws(() => inspectMedia(ftyp(brand), 'application/octet-stream'), error => error.code === 'MEDIA_UNSUPPORTED');
  for (const brand of ['avif', 'heic', 'msf1']) assert.throws(() => inspectMedia(ftyp('isom', brand), ''), error => error.code === 'MEDIA_UNSUPPORTED');
});
test('R04 WEB ftyp box requires complete four-byte compatible-brand entries', () => {
  for (const size of [17, 18, 19]) {
    const bytes = ftyp('isom').slice(0, size);
    new DataView(bytes.buffer).setUint32(0, size);
    assert.throws(() => inspectMedia(bytes, ''), error => error.code === 'MEDIA_UNSUPPORTED');
    assert.throws(() => inspectMedia(bytes, 'video/mp4'), error => error.code === 'MEDIA_UNSUPPORTED');
  }
  const noCompatible = ftyp('isom').slice(0, 16);
  new DataView(noCompatible.buffer).setUint32(0, 16);
  assert.equal(inspectMedia(noCompatible, '').container, 'mp4');
  assert.equal(inspectMedia(ftyp('isom'), '').container, 'mp4');
});
const EBML = [0x1a, 0x45, 0xdf, 0xa3];
const WEBM_DOC = [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d];
const MATROSKA_DOC = [0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72, 0x6f, 0x73, 0x6b, 0x61];
function ebmlHeader(payload, size = [0x80 | payload.length], tail = []) {
  return Uint8Array.from([...EBML, ...size, ...payload, ...tail]);
}
test('R03 WEB accepts structurally bounded headers with one real WebM DocType', () => {
  const fields = [0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81, 1, 0x42, 0xf2, 0x81, 4, 0x42, 0xf3, 0x81, 8,
    ...WEBM_DOC, 0x42, 0x87, 0x81, 4, 0x42, 0x85, 0x81, 2];
  const fixtures = [ebmlHeader(WEBM_DOC), ebmlHeader(fields, [0x9f]),
    ebmlHeader(WEBM_DOC, [0x40, 0x07]), ebmlHeader(WEBM_DOC, [0x01, 0, 0, 0, 0, 0, 0, 7]),
    ebmlHeader([0xec, 0x82, 0, 0, ...WEBM_DOC]),
    ebmlHeader([...WEBM_DOC, 0xec, 0x81, 0]),
    ebmlHeader(WEBM_DOC, [0x87], [0x18, 0x53, 0x80, 0x67, 0xff, ...MATROSKA_DOC])];
  for (const bytes of fixtures) {
    assert.equal(inspectMedia(bytes, '').container, 'webm');
    assert.equal(inspectMedia(bytes, 'application/octet-stream').extension, 'webm');
    assert.equal(inspectMedia(bytes, 'video/webm').container, 'webm');
  }
});
test('R03 WEB rejects the exact Matroska-header/outside-WebM reproduction', () => {
  const bytes = ebmlHeader(MATROSKA_DOC, [0x8b], WEBM_DOC);
  assert.deepEqual([...bytes], [26, 69, 223, 163, 139, 66, 130, 136, 109, 97, 116, 114, 111, 115, 107, 97, 66, 130, 132, 119, 101, 98, 109]);
  for (const mime of ['', 'application/octet-stream', 'video/webm']) {
    assert.throws(() => inspectMedia(bytes, mime), error => error.code === 'MEDIA_UNSUPPORTED');
  }
});
for (const [name, bytes] of [
  ['old truncated positive fixture', ebmlHeader(WEBM_DOC, [0x8b])],
  ['truncated outer VINT', Uint8Array.from([...EBML, 0x40])],
  ['zero outer VINT', ebmlHeader(WEBM_DOC, [0])],
  ['unknown header length', ebmlHeader(WEBM_DOC, [0xff])],
  ['unknown eight-byte header length', ebmlHeader(WEBM_DOC, [1, 255, 255, 255, 255, 255, 255, 255])],
  ['unsafe integer header length', ebmlHeader(WEBM_DOC, [1, 32, 0, 0, 0, 0, 0, 0])],
  ['empty header with outside WebM', ebmlHeader([], [0x80], WEBM_DOC)],
  ['missing DocType with outside WebM', ebmlHeader([0xec, 0x81, 0], [0x83], WEBM_DOC)],
  ['DocType pattern inside Void', ebmlHeader([0xec, 0x87, ...WEBM_DOC])],
  ['DocType pattern inside other element', ebmlHeader([0x42, 0x86, 0x87, ...WEBM_DOC])],
  ['Matroska DocType', ebmlHeader(MATROSKA_DOC)],
  ['wrong-case DocType', ebmlHeader([0x42, 0x82, 0x84, 0x57, 0x65, 0x62, 0x4d])],
  ['padded DocType', ebmlHeader([0x42, 0x82, 0x85, 0x77, 0x65, 0x62, 0x6d, 0])],
  ['duplicate identical DocTypes', ebmlHeader([...WEBM_DOC, ...WEBM_DOC])],
  ['conflicting DocTypes', ebmlHeader([...WEBM_DOC, ...MATROSKA_DOC])],
  ['truncated child ID', ebmlHeader([...WEBM_DOC, 0x42])],
  ['invalid child ID VINT', ebmlHeader([...WEBM_DOC, 0])],
  ['child ID over four bytes', ebmlHeader([...WEBM_DOC, 8, 0, 0, 0, 1, 0x80])],
  ['missing child size', ebmlHeader([...WEBM_DOC, 0xec])],
  ['truncated child size VINT', ebmlHeader([...WEBM_DOC, 0xec, 0x40])],
  ['zero child size VINT', ebmlHeader([...WEBM_DOC, 0xec, 0])],
  ['unknown child size', ebmlHeader([...WEBM_DOC, 0xec, 0xff])],
  ['child payload exceeds header', ebmlHeader([...WEBM_DOC, 0xec, 0x82, 0])],
  ['DocType bytes outside declared header', ebmlHeader(WEBM_DOC, [0x83])],
]) test(`R03 WEB rejects ${name}`, () => assert.throws(() => inspectMedia(bytes, ''), error => error.code === 'MEDIA_UNSUPPORTED'));
test('R03 WEB header parsing is bounded to 4096 bytes and retains MIME consistency checks', () => {
  const within = [...WEBM_DOC, 0xec, 0x4f, 0xf0, ...new Uint8Array(4080)];
  assert.equal(within.length, 4090);
  assert.equal(inspectMedia(ebmlHeader(within, [0x4f, 0xfa]), 'audio/webm').container, 'webm');
  const over = [...WEBM_DOC, 0xec, 0x4f, 0xf1, ...new Uint8Array(4081)];
  assert.throws(() => inspectMedia(ebmlHeader(over, [0x4f, 0xfb]), ''), error => error.code === 'MEDIA_UNSUPPORTED');
  assert.throws(() => inspectMedia(ebmlHeader(WEBM_DOC), 'video/mp4'), error => error.code === 'TYPE_MISMATCH');
});
for (const version of [3, 2, 0]) test(`R01 WEB accepts complete Layer III MPEG version ${version}, bare and ID3-tagged`, () => {
  const audio = mp3(version, 2);
  assert.equal(inspectMedia(audio, 'audio/mpeg').container, 'mp3');
  const tagged = new Uint8Array(audio.length + 10); tagged.set([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]); tagged.set(audio, 10);
  assert.equal(inspectMedia(tagged, '').container, 'mp3');
  assert.equal(inspectMedia(mp3(version), '').container, 'mp3');
});
test('R01 WEB rejects short syncs, Layer II, free/reserved headers, arbitrary scanning and adjacent mismatch', () => {
  const bad = [Uint8Array.of(255, 253, 144, 0), Uint8Array.of(255, 251, 144, 0), mp3().slice(0, 416)];
  const layer2 = mp3(); layer2[1] = 253; bad.push(layer2);
  for (const third of [0, 240, 156]) { const value = mp3(); value[2] = third; bad.push(value); }
  const reservedVersion = mp3(); reservedVersion[1] = 235; bad.push(reservedVersion);
  const prefix = new Uint8Array(mp3().length + 6); prefix.set(new TextEncoder().encode('<html>')); prefix.set(mp3(), 6); bad.push(prefix);
  const two = mp3(3, 2); two[418] = 243; bad.push(two);
  const tagOnly = Uint8Array.of(73, 68, 51, 4, 0, 0, 0, 0, 0, 0); bad.push(tagOnly);
  for (const bytes of bad) assert.throws(() => inspectMedia(bytes, ''), error => error.code === 'MEDIA_UNSUPPORTED');
});
test('WEB WAV header, interleaving and signed 16-bit clipping are exact', async () => {
  const audio = audioFixture([new Float32Array([-2, -.5, 0, 2]), new Float32Array([1, .5, 0, -1])]);
  const bytes = await encodeWav(audio, { yieldTask: async () => {} }); const view = new DataView(bytes.buffer);
  assert.equal(bytes.length, 60); assert.equal(view.getUint32(4, true), 52); assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1); assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint32(28, true), 32000); assert.equal(view.getUint16(32, true), 4); assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 16);
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => view.getInt16(44 + i * 2, true)), [-32768, 32767, -16384, 16384, 0, 0, 32767, -32768]);
  assert.equal(inspectMedia(bytes, 'audio/wav').container, 'wav');
});
test('WEB audio shape, duration, sample rate, channels, PCM cap and nonfinite samples fail closed', async () => {
  for (const patch of [{ length: 0 }, { duration: NaN }, { duration: 121 }, { numberOfChannels: 3 }, { sampleRate: 96000 },
    { length: 20000000 }, { sampleRate: 0 }, { duration: .1 }]) {
    assert.throws(() => audioInfo({ ...audioFixture(), ...patch }), error => error.code === 'AUDIO_LIMIT');
  }
  await assert.rejects(encodeWav(audioFixture([new Float32Array([NaN])])), error => error.code === 'AUDIO_INVALID');
});
test('WEB WAV encoding yields and cancels without producing stale bytes', async () => {
  const abort = new AbortController(); let yields = 0;
  await assert.rejects(encodeWav(audioFixture([new Float32Array(8192)]), { signal: abort.signal,
    yieldTask: async () => { ++yields; abort.abort(); } }), error => error.code === 'CANCELLED');
  assert.equal(yields, 1);
});
function mediaHarness() {
  const media = new EventTarget(); media.duration = 1; media.pause = () => {}; media.removeAttribute = () => {}; media.load = () => {};
  const revoked = []; const clock = manualScheduler();
  const audio = createBrowserAudio({ documentImpl: { createElement: tag => { assert.equal(tag, 'video'); return media; } },
    urlApi: { createObjectURL: () => 'blob:metadata', revokeObjectURL: url => revoked.push(url) }, clock: clock.scheduler });
  return { media, revoked, clock, audio };
}
for (const end of ['success', 'error', 'cancel', 'timeout', 'infinite', 'long']) test(`WEB metadata ${end} always revokes blob/timers`, async () => {
  const f = mediaHarness(); const abort = new AbortController();
  const promise = f.audio.measure(new Blob([wavFixture()]), { signal: abort.signal }).catch(error => error);
  if (end === 'success') f.media.dispatchEvent(new Event('loadedmetadata'));
  if (end === 'error') f.media.dispatchEvent(new Event('error'));
  if (end === 'cancel') abort.abort();
  if (end === 'timeout') f.clock.advance(10000);
  if (end === 'infinite' || end === 'long') { f.media.duration = end === 'long' ? 121 : Infinity; f.media.dispatchEvent(new Event('loadedmetadata')); }
  const result = await promise;
  if (end === 'success') assert.equal(result, 1); else assert.equal(result.code, end === 'cancel' ? 'CANCELLED' : 'DURATION_INVALID');
  assert.deepEqual(f.revoked, ['blob:metadata']); assert.equal(f.clock.pendingCount(), 0);
});
test('WEB native decoder cancellation waits for its actual Promise; unavailable codec has fixed failure', async () => {
  const pending = deferred(); let settled = false; const abort = new AbortController();
  class Context { constructor(channels, frames, rate) { assert.deepEqual([channels, frames, rate], [2, 1, 48000]); } decodeAudioData() { return pending.promise; } }
  const audio = createBrowserAudio({ documentImpl: {}, OfflineContext: Context });
  const promise = audio.decode(wavFixture(), { signal: abort.signal }).catch(error => { settled = true; return error; });
  abort.abort(); await flush(); assert.equal(settled, false); pending.resolve(audioFixture());
  assert.equal((await promise).code, 'CANCELLED');
  const unavailable = createBrowserAudio({ documentImpl: {}, OfflineContext: null });
  await assert.rejects(unavailable.decode(wavFixture(), { signal: new AbortController().signal }), error => error.code === 'AUDIO_UNAVAILABLE');
});
