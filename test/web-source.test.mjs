import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMediaUrl, readUrl, readDemo, readLocal } from '../public/assets/source.mjs';
import { deferred, flush, manualScheduler } from './fake-adapter.mjs';
import { responseFixture, wavFixture } from './web-fixtures.mjs';

const GOOD = 'https://media.public-domain.org/file?X-Signature=a%2Fb%2Bc&expires=123&x=1&x=2';
const options = () => ({ signal: new AbortController().signal, maxBytes: 128 });
test('WEB URL preserves signed path/query and allows normal HTTPS DNS/default port', () => {
  assert.equal(validateMediaUrl(GOOD), GOOD);
  assert.equal(validateMediaUrl(' HTTPS://cdn.public-domain.org:443/file '), 'HTTPS://cdn.public-domain.org:443/file');
});
for (const [name, url] of [
  ['object', {}], ['oversized', 'x'.repeat(2049)], ['http', 'http://cdn.public-domain.org/file'],
  ['userinfo', 'https://u:p@cdn.public-domain.org/file'], ['empty userinfo', 'https://@cdn.public-domain.org/file'],
  ['port', 'https://cdn.public-domain.org:444/file'], ['backslash', 'https://cdn.public-domain.org\\file'],
  ['LF', 'https://cdn.public-domain.org/fi\nle'], ['format char', 'https://cdn.public-domain.org/fi\u200ble'],
  ['literal space', 'https://cdn.public-domain.org/fi le'], ['IPv4', 'https://127.0.0.1/file'],
  ['decimal IPv4', 'https://2130706433/file'], ['hex IPv4', 'https://0x7f000001/file'], ['IPv6', 'https://[::1]/file'],
  ['localhost', 'https://localhost/file'], ['localhost suffix', 'https://a.localhost/file'], ['local', 'https://a.local/file'],
  ['internal', 'https://a.internal/file'], ['test', 'https://a.test/file'], ['invalid', 'https://a.invalid/file'],
  ['example', 'https://example.com/file'], ['single label', 'https://intranet/file'], ['trailing dot', 'https://cdn.public-domain.org./file'],
  ['percent authority', 'https://%63dn.public-domain.org/file'], ['implicit URL', 'https:cdn.public-domain.org/file'],
]) test(`WEB rejects ${name}`, () => assert.throws(() => validateMediaUrl(url), error => error.code === 'URL_INVALID'));
for (const url of ['https://www.youtube.com/watch?v=abcdefghijk', 'https://youtu.be/abcdefghijk',
  'https://vimeo.com/12345', 'https://www.bilibili.com/video/BV1234567890', 'https://www.tiktok.com/@demo/video/123',
  'https://instagram.com/reel/ABC/', 'https://facebook.com/watch/?v=123', 'https://x.com/demo/status/123', 'https://soundcloud.com/demo/track']) {
  test(`WEB platform page rejected before any fetch: ${new URL(url).hostname}`, () => assert.throws(() => validateMediaUrl(url), error => error.code === 'PAGE_LINK'));
}
test('WEB fetch exact options, known length, bytes retained and timers released', async () => {
  const bytes = wavFixture();
  const f = responseFixture([bytes.slice(0, 10), bytes.slice(10)], { length: bytes.length });
  const clock = manualScheduler();
  const seen = [];
  let called;
  const result = await readUrl(GOOD, { ...options(), clock: clock.scheduler, onProgress: value => seen.push(value) }, async (url, init) => { called = { url, init }; return f.response; });
  assert.equal(called.url, GOOD);
  assert.deepEqual(Object.keys(called.init).sort(), ['cache', 'credentials', 'method', 'mode', 'redirect', 'referrerPolicy', 'signal']);
  assert.equal(called.init.method, 'GET'); assert.equal(called.init.mode, 'cors'); assert.equal(called.init.credentials, 'omit');
  assert.equal(called.init.cache, 'no-store'); assert.equal(called.init.redirect, 'error'); assert.equal(called.init.referrerPolicy, 'no-referrer');
  assert.deepEqual(result.bytes, bytes); assert.deepEqual(seen.at(-1), { downloadedBytes: 52, totalBytes: 52 });
  assert.equal(clock.pendingCount(), 0); assert.equal(f.calls.released, 1);
});
test('WEB unknown/misreported length never disables actual byte limits', async () => {
  for (const length of [null, 'garbage', '1', '9999999999999999999999999']) {
    const f = responseFixture([new Uint8Array(3), new Uint8Array(3)], { length });
    await assert.rejects(readUrl(GOOD, { ...options(), maxBytes: 5 }, async () => f.response), error => error.code === 'TOO_LARGE');
    assert.equal(f.calls.cancelled, 1);
  }
  const f = responseFixture([new Uint8Array(4)], { length: 1 });
  const seen = [];
  await readUrl(GOOD, { ...options(), onProgress: value => seen.push(value) }, async () => f.response);
  assert.deepEqual(seen, [{ downloadedBytes: 4, totalBytes: null }]);
});
test('WEB length early refusal and non-200/opaque/redirected responses cancel their bodies', async () => {
  const cases = [
    [responseFixture([], { length: 129 }), 'TOO_LARGE'],
    ...[204, 206, 301, 404, 500].map(status => [responseFixture([new Uint8Array(1)], { status }), 'HTTP_ERROR']),
  ];
  for (const type of ['opaque', 'opaqueredirect']) { const f = responseFixture([]); f.response.type = type; cases.push([f, 'HTTP_ERROR']); }
  const redirected = responseFixture([]); redirected.response.redirected = true; cases.push([redirected, 'HTTP_ERROR']);
  for (const [f, code] of cases) {
    await assert.rejects(readUrl(GOOD, options(), async () => f.response), error => error.code === code);
    assert.equal(f.calls.cancelled, 1);
  }
});
test('WEB empty and network errors are fixed and never echo the URL', async () => {
  await assert.rejects(readUrl(GOOD, options(), async () => responseFixture([]).response), error => error.code === 'EMPTY');
  await assert.rejects(readUrl(GOOD, options(), async () => { throw new Error(`CANARY ${GOOD}`); }), error => error.message === 'NETWORK');
  let getters = 0;
  await assert.rejects(readUrl(GOOD, options(), async () => { throw { get code() { ++getters; throw new Error('CANARY'); } }; }), error => error.message === 'NETWORK');
  assert.equal(getters, 0);
});
function hangingResponse() {
  const reading = deferred(); const ack = deferred();
  let cancelling = 0;
  const response = responseFixture([]).response;
  response.body = { getReader: () => ({ read: () => reading.promise, releaseLock: () => {}, cancel: () => { ++cancelling; reading.resolve({ done: true }); return ack.promise; } }) };
  return { response, ack, cancelling: () => cancelling };
}
test('WEB cancellation waits for read cleanup ACK before settling', async () => {
  const f = hangingResponse(); const abort = new AbortController(); let settled = false;
  const promise = readUrl(GOOD, { ...options(), signal: abort.signal }, async () => f.response).catch(error => { settled = true; return error; });
  await flush(); abort.abort(); await flush();
  assert.equal(f.cancelling(), 1); assert.equal(settled, false);
  f.ack.resolve(); assert.equal((await promise).code, 'CANCELLED');
});
for (const timeout of ['idle', 'total']) test(`WEB ${timeout} timeout aborts and releases timers`, async () => {
  const f = hangingResponse(); const clock = manualScheduler();
  const promise = readUrl(GOOD, { ...options(), clock: clock.scheduler, totalMs: timeout === 'total' ? 10 : 100,
    idleMs: timeout === 'idle' ? 10 : 100 }, async () => f.response).catch(error => error);
  await flush(); clock.advance(10); f.ack.resolve();
  assert.equal((await promise).code, 'TIMEOUT'); assert.equal(clock.pendingCount(), 0);
});
test('WEB pre-abort makes no request; demo is a separate fixed same-site entry; local File is not fetched', async () => {
  const abort = new AbortController(); abort.abort(); let calls = 0;
  await assert.rejects(readUrl(GOOD, { ...options(), signal: abort.signal }, async () => { ++calls; }), error => error.code === 'CANCELLED');
  assert.equal(calls, 0);
  let demoUrl;
  const demo = await readDemo(options(), async url => { demoUrl = url; return responseFixture([wavFixture()]).response; });
  assert.equal(demoUrl, '/assets/demo.wav'); assert.equal(demo.bytes.length, 52);
  const blob = new File([wavFixture()], 'ignored-private-name.wav', { type: 'audio/wav' });
  assert.deepEqual((await readLocal(blob, options())).bytes, wavFixture());
  await assert.rejects(readLocal(null, options()), error => error.code === 'FILE_REQUIRED');
});
