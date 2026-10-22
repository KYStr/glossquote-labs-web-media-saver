import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl } from '../src/core/url.mjs';
import { makePlan } from '../src/core/plan.mjs';
import { CoreError, ERROR_CODES, toErrorCode } from '../src/core/errors.mjs';

const validUrls = [
  ['AC01 youtube short', 'https://youtu.be/abcdefghijk?si=demo&t=10', 'youtube', 'https://www.youtube.com/watch?v=abcdefghijk', 'abcdefghijk', 'item'],
  ['youtube watch host case/default port', '  HTTPS://YouTube.COM:443/watch?v=Abc_def-123&feature=demo#part  ', 'youtube', 'https://www.youtube.com/watch?v=Abc_def-123', 'Abc_def-123', 'item'],
  ['youtube shorts', 'https://m.youtube.com/shorts/abcdefghijk/?start=4&si=a&si=b', 'youtube', 'https://www.youtube.com/watch?v=abcdefghijk', 'abcdefghijk', 'item'],
  ['youtube embed', 'https://www.youtube.com/embed/abcdefghijk', 'youtube', 'https://www.youtube.com/watch?v=abcdefghijk', 'abcdefghijk', 'item'],
  ['AC06 player vimeo', 'https://player.vimeo.com/video/12345?utm_source=demo', 'vimeo', 'https://vimeo.com/12345', '12345', 'item'],
  ['vimeo 12 digits', 'https://www.vimeo.com/123456789012/', 'vimeo', 'https://vimeo.com/123456789012', '123456789012', 'item'],
  ['AC07 bilibili p1', 'https://www.bilibili.com/video/BV1234567890?p=1', 'bilibili', 'https://www.bilibili.com/video/BV1234567890', 'BV1234567890', 'item'],
  ['bilibili ID case preserved', 'https://bilibili.com/video/BVaBcDeF1234/?vd_source=demo', 'bilibili', 'https://www.bilibili.com/video/BVaBcDeF1234', 'BVaBcDeF1234', 'item'],
  ['AC08 tiktok short', 'https://vm.tiktok.com/AbC123/', 'tiktok', 'https://vm.tiktok.com/AbC123/', 'AbC123', 'short-link'],
  ['tiktok vt short', 'https://vt.tiktok.com/A1?is_from_webapp=1', 'tiktok', 'https://vt.tiktok.com/A1/', 'A1', 'short-link'],
  ['tiktok item', 'https://tiktok.com/@demo.name_1/video/12345/?sender_device=pc', 'tiktok', 'https://www.tiktok.com/@demo.name_1/video/12345', '12345', 'item'],
  ['AC09 instagram reel', 'https://instagram.com/reel/AbC_123/?igsh=x', 'instagram', 'https://www.instagram.com/reel/AbC_123/', 'AbC_123', 'item'],
  ['instagram post', 'https://www.instagram.com/p/a-B_1', 'instagram', 'https://www.instagram.com/p/a-B_1/', 'a-B_1', 'item'],
  ['AC10 facebook watch', 'https://facebook.com/watch/?v=12345', 'facebook', 'https://www.facebook.com/watch/?v=12345', '12345', 'item'],
  ['facebook reel', 'https://www.facebook.com/reel/12345?mibextid=demo', 'facebook', 'https://www.facebook.com/reel/12345/', '12345', 'item'],
  ['AC10 twitter alias', 'https://twitter.com/demo/status/12345?s=20', 'x', 'https://x.com/demo/status/12345', '12345', 'item'],
  ['x item', 'https://www.x.com/demo_1/status/12345/?t=demo', 'x', 'https://x.com/demo_1/status/12345', '12345', 'item'],
  ['AC11 soundcloud', 'https://soundcloud.com/demo/track', 'soundcloud', 'https://soundcloud.com/demo/track', 'demo/track', 'item'],
  ['soundcloud alias', 'https://www.soundcloud.com/demo-1/track_1/?si=demo', 'soundcloud', 'https://soundcloud.com/demo-1/track_1', 'demo-1/track_1', 'item'],
];
for (const [name, raw, platform, canonicalUrl, contentId, kind] of validUrls) {
  test(name, () => assert.deepEqual(classifyUrl(raw), { ok: true, platform, canonicalUrl, contentId, kind }));
}

const rejectedUrls = [
  ['AC02 duplicate v', 'https://www.youtube.com/watch?v=abcdefghijk&v=abcdefghijk', 'URL_UNSUPPORTED'],
  ['encoded duplicate identity', 'https://youtube.com/watch?v=abcdefghijk&%76=abcdefghijk', 'URL_UNSUPPORTED'],
  ['AC03 lookalike suffix', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'URL_UNSUPPORTED'],
  ['AC04 http', 'http://youtube.com/watch?v=abcdefghijk', 'SCHEME_UNSUPPORTED'],
  ['AC04 userinfo', 'https://u:p@youtube.com/watch?v=abcdefghijk', 'CREDENTIALS_NOT_ALLOWED'],
  ['empty userinfo', 'https://@youtube.com/watch?v=abcdefghijk', 'CREDENTIALS_NOT_ALLOWED'],
  ['AC05 length 2049', 'x'.repeat(2049), 'URL_TOO_LONG'],
  ['AC05 no object coercion', { toString: () => { throw new Error('must not execute'); } }, 'INVALID_INPUT'],
  ['boxed string', new String('https://youtu.be/abcdefghijk'), 'INVALID_INPUT'],
  ['AC05 internal LF', 'https://you\ntube.com/watch?v=abcdefghijk', 'URL_INVALID'],
  ['AC05 zero-width', 'https://youtube.com/watch?v=abc\u200bdefghijk', 'URL_INVALID'],
  ['AC05 backslash', 'https://youtube.com\\watch?v=abcdefghijk', 'URL_INVALID'],
  ['AC05 port', 'https://youtube.com:444/watch?v=abcdefghijk', 'PORT_NOT_ALLOWED'],
  ['AC07 p2', 'https://bilibili.com/video/BV1234567890?p=2', 'URL_UNSUPPORTED'],
  ['duplicate p', 'https://bilibili.com/video/BV1234567890?p=1&p=1', 'URL_UNSUPPORTED'],
  ['unknown bilibili tracking', 'https://bilibili.com/video/BV1234567890?utm_source=demo', 'URL_UNSUPPORTED'],
  ['AC11 sets extra path', 'https://soundcloud.com/demo/sets/a', 'URL_UNSUPPORTED'],
  ['soundcloud reserved route', 'https://soundcloud.com/discover/track', 'URL_UNSUPPORTED'],
  ['soundcloud sets', 'https://soundcloud.com/demo/sets', 'URL_UNSUPPORTED'],
  ['AC12 list', 'https://youtube.com/watch?v=abcdefghijk&list=123', 'URL_UNSUPPORTED'],
  ['youtube index', 'https://youtu.be/abcdefghijk?index=1', 'URL_UNSUPPORTED'],
  ['AC12 unknown query', 'https://youtube.com/watch?v=abcdefghijk&secret=SYNTHETIC_CANARY', 'URL_UNSUPPORTED'],
  ['shorts extra v', 'https://youtube.com/shorts/abcdefghijk?v=abcdefghijk', 'URL_UNSUPPORTED'],
  ['watch missing v', 'https://youtube.com/watch?si=a', 'URL_UNSUPPORTED'],
  ['ID too short', 'https://youtu.be/abcdefghij', 'URL_UNSUPPORTED'],
  ['vimeo hidden ID semantics', 'https://vimeo.com/12345?h=demo', 'URL_UNSUPPORTED'],
  ['vimeo too long', 'https://vimeo.com/1234567890123', 'URL_UNSUPPORTED'],
  ['facebook duplicate v', 'https://facebook.com/watch?v=1&v=1', 'URL_UNSUPPORTED'],
  ['facebook reel v', 'https://facebook.com/reel/12345?v=12345', 'URL_UNSUPPORTED'],
  ['facebook short unrecognized', 'https://fb.watch/AbC123/', 'URL_UNSUPPORTED'],
  ['tiktok short extra path', 'https://vm.tiktok.com/abc/def', 'URL_UNSUPPORTED'],
  ['instagram long code', `https://instagram.com/p/${'a'.repeat(33)}`, 'URL_UNSUPPORTED'],
  ['x long user', `https://x.com/${'a'.repeat(16)}/status/1`, 'URL_UNSUPPORTED'],
  ['numeric ID limit', `https://facebook.com/reel/${'1'.repeat(26)}`, 'URL_UNSUPPORTED'],
  ['direct media', 'https://example.test/video.mp4', 'URL_UNSUPPORTED'],
  ['trailing host dot', 'https://youtube.com./watch?v=abcdefghijk', 'URL_UNSUPPORTED'],
  ['percent host', 'https://%79outube.com/watch?v=abcdefghijk', 'URL_UNSUPPORTED'],
  ['unicode mapped host', 'https://ｙoutube.com/watch?v=abcdefghijk', 'URL_UNSUPPORTED'],
  ['dot normalization', 'https://youtube.com/ignored/../watch?v=abcdefghijk', 'URL_UNSUPPORTED'],
  ['single dot', 'https://youtube.com/./watch?v=abcdefghijk', 'URL_UNSUPPORTED'],
  ['percent dot', 'https://youtube.com/%2e/watch?v=abcdefghijk', 'URL_UNSUPPORTED'],
  ['mixed dot', 'https://youtube.com/.%2e/watch?v=abcdefghijk', 'URL_UNSUPPORTED'],
  ['percent path', 'https://youtube.com/%77atch?v=abcdefghijk', 'URL_UNSUPPORTED'],
  ['multiple slash', 'https://youtu.be/abcdefghijk//', 'URL_UNSUPPORTED'],
  ['extra path', 'https://youtu.be/abcdefghijk/extra', 'URL_UNSUPPORTED'],
  ['implicit authority', 'https:youtube.com/watch?v=abcdefghijk', 'URL_INVALID'],
  ['empty authority', 'https:///youtube.com/watch?v=abcdefghijk', 'URL_INVALID'],
  ['embedded space', 'https://youtube.com/watch?v=abc defghijk', 'URL_INVALID'],
  ['empty', '', 'URL_INVALID'],
];
for (const [name, raw, code] of rejectedUrls) {
  test(name, () => assert.deepEqual(classifyUrl(raw), { ok: false, code }));
}

test('raw length checked before edge trim; exactly 2048 is allowed', () => {
  const base = 'https://youtu.be/abcdefghijk?si=';
  const raw = base + 'a'.repeat(2048 - base.length);
  assert.equal(classifyUrl(raw).ok, true);
  assert.deepEqual(classifyUrl(`${raw} `), { ok: false, code: 'URL_TOO_LONG' });
});

test('AC13 fixed plans with no mutation or implicit default', () => {
  const input = Object.freeze({ kind: 'video', format: 'source' });
  assert.deepEqual(makePlan(input), { kind: 'video', format: 'source', maxHeight: 720, maxBytes: 1073741824, maxDurationSeconds: 3600 });
  assert.deepEqual(makePlan(Object.assign(Object.create(null), { kind: 'audio', format: 'mp3' })),
    { kind: 'audio', format: 'mp3', maxHeight: null, maxBytes: 1073741824, maxDurationSeconds: 3600 });
  assert.deepEqual(input, { kind: 'video', format: 'source' });
});

test('AC13 invalid options/accessors/symbols/prototypes fail with fixed error', () => {
  let getters = 0;
  const accessor = { get kind() { ++getters; throw new Error('SYNTHETIC_CANARY'); }, format: 'source' };
  const bad = [undefined, null, [], 'video', {}, { kind: 'video', format: 'mp3' }, { kind: 'audio', format: 'source' },
    { kind: 'video', format: 'source', args: '--extra' }, { kind: 'video', format: 'source', path: '../bad' },
    Object.assign(Object.create({}), { kind: 'video', format: 'source' }), accessor,
    { kind: 'video', format: 'source', [Symbol('hidden')]: 'value' }];
  for (const options of bad) assert.throws(() => makePlan(options), error => error.code === 'OPTIONS_INVALID' && error.message === 'OPTIONS_INVALID');
  assert.equal(getters, 0);
});

test('fixed errors ignore messages and code getters', () => {
  let getters = 0;
  assert.equal(toErrorCode({ get code() { ++getters; return 'BUSY'; } }), 'OPERATION_FAILED');
  assert.equal(toErrorCode({ code: 'SYNTHETIC_CANARY' }), 'OPERATION_FAILED');
  assert.equal(toErrorCode(new CoreError('OPTIONS_INVALID')), 'OPTIONS_INVALID');
  assert.equal(new CoreError('SYNTHETIC_CANARY').message, 'OPERATION_FAILED');
  assert.equal(getters, 0);
  assert(Object.isFrozen(ERROR_CODES));
});
