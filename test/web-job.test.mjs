import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaJob } from '../public/assets/job.mjs';
import { encodeWav } from '../public/assets/wav.mjs';
import { wavFixture, audioFixture } from './web-fixtures.mjs';
import { deferred, flush } from './fake-adapter.mjs';

const INPUT = Object.freeze({ source: Object.freeze({ kind: 'url', url: 'https://media.public-domain.org/file?signature=SYNTHETIC_CANARY' }), mode: 'original' });
function fixture({ hold = null, onState = () => {} } = {}) {
  const waiting = deferred(); const calls = []; const created = []; const revoked = []; const phases = [];
  const audio = { measure: async () => { phases.push('measure'); return hold === 'measure' ? waiting.promise : .0005; },
    decode: async () => { phases.push('decode'); return hold === 'decode' ? waiting.promise : audioFixture(); } };
  const read = kind => async (arg, options) => { calls.push({ kind, arg, options }); return hold === 'read' ? waiting.promise : { bytes: wavFixture(), mime: 'audio/wav' }; };
  const controller = createMediaJob({ audio, onState, readers: { url: read('url'), file: read('file'), demo: options => read('demo')(null, options) },
    encode: async (data, options) => { phases.push('encode'); return hold === 'encode' ? waiting.promise : encodeWav(data, { ...options, yieldTask: async () => {} }); },
    urlApi: { createObjectURL: blob => { const url = `blob:result-${created.length + 1}`; created.push({ url, blob }); return url; }, revokeObjectURL: url => revoked.push(url) } });
  return { controller, waiting, calls, created, revoked, phases };
}
test('WEB original result has actual identical bytes, safe filename, no fabricated duration, and persists for repeat download', async () => {
  const seen = []; const f = fixture({ onState: state => seen.push(state) });
  assert.deepEqual(await f.controller.start(INPUT), { ok: true, jobId: 1 }); await flush();
  const state = f.controller.getState(); assert.equal(state.status, 'ready');
  assert.deepEqual(state.result, { url: 'blob:result-1', bytes: 52, format: 'WAV', filename: 'glossquote-media.wav', duration: null });
  assert.deepEqual(new Uint8Array(await f.created[0].blob.arrayBuffer()), wavFixture());
  assert.equal(f.calls[0].options.maxBytes, 33554432); assert.deepEqual(f.phases, []);
  f.controller.getState(); f.controller.getState(); assert.deepEqual(f.revoked, []);
  assert(!JSON.stringify(seen).includes('SYNTHETIC_CANARY'));
  const snapshot = f.controller.getState(); snapshot.result.bytes = 1;
  assert.equal(f.controller.getState().result.bytes, 52);
  await f.controller.clear(); assert.deepEqual(f.revoked, ['blob:result-1']); assert.equal(f.controller.getState().result, null);
});
test('WEB WAV result is encoded PCM with verified duration and smaller input budget', async () => {
  const seen = []; const f = fixture({ onState: state => seen.push(state.status) });
  await f.controller.start({ ...INPUT, mode: 'wav' }); await flush(); await flush();
  assert.equal(f.controller.getState().status, 'ready'); assert.equal(f.calls[0].options.maxBytes, 16777216);
  assert.deepEqual(f.phases, ['measure', 'decode', 'encode']);
  assert.deepEqual(seen, ['fetching', 'checking', 'metadata', 'decoding', 'encoding', 'ready']);
  const result = f.controller.getState().result;
  assert.equal(result.duration, .0005); assert.equal(result.filename, 'glossquote-audio.wav');
  assert.deepEqual(new Uint8Array(await f.created[0].blob.arrayBuffer()), wavFixture());
});
for (const stage of ['read', 'measure', 'decode', 'encode']) {
  for (const command of ['cancel', 'clear']) test(`WEB ${command} during ${stage} keeps BUSY until real settlement`, async () => {
    const f = fixture({ hold: stage }); await f.controller.start({ ...INPUT, mode: 'wav' }); await flush(); await flush();
    let settled = false; const stopping = f.controller[command]().then(result => { settled = true; return result; });
    await flush(); assert.equal(settled, false); assert.equal(f.controller.getState().status, 'cancelling');
    assert.equal((await f.controller.start(INPUT)).code, 'BUSY'); assert.equal(f.created.length, 0);
    if (f.calls[0]) f.calls[0].options.onProgress({ downloadedBytes: 30, totalBytes: 100 });
    assert.equal(f.controller.getState().progress, null);
    f.waiting.resolve(stage === 'read' ? { bytes: wavFixture(), mime: 'audio/wav' } : stage === 'measure' ? .0005 : stage === 'decode' ? audioFixture() : wavFixture());
    await stopping;
    assert.equal(f.controller.getState().status, command === 'clear' ? 'idle' : 'cancelled');
    assert.equal(f.created.length, 0); assert.equal(f.calls.length, 1);
  });
}
test('WEB clear while cancelling retains idle intent; stale progress after retry is discarded', async () => {
  const f = fixture({ hold: 'decode' }); await f.controller.start({ ...INPUT, mode: 'wav' }); await flush();
  const stopping = f.controller.cancel(); const clearing = f.controller.clear(); const again = f.controller.cancel();
  f.waiting.reject(new Error('CANARY https://source.invalid/path')); await Promise.all([stopping, clearing, again]);
  assert.equal(f.controller.getState().status, 'idle');
  await f.controller.start(INPUT); await flush(); const before = f.controller.getState();
  f.calls[0].options.onProgress({ downloadedBytes: 99, totalBytes: 100 }); assert.deepEqual(f.controller.getState(), before);
});
test('WEB source/mode change, cancel-ready, invalid start and new start revoke old result exactly once', async () => {
  const f = fixture(); await f.controller.start(INPUT); await flush();
  await f.controller.cancel(); assert.equal(f.controller.getState().result, null);
  await f.controller.clear(); assert.deepEqual(f.revoked, ['blob:result-1']);
  await f.controller.start(INPUT); await flush();
  await f.controller.start({ source: { kind: 'url', url: 'http://invalid' }, mode: 'original' });
  assert.equal(f.controller.getState().status, 'error'); assert.equal(f.controller.getState().result, null);
  assert.deepEqual(f.revoked, ['blob:result-1', 'blob:result-2']);
  await f.controller.start(INPUT); await flush(); await f.controller.start(INPUT); await flush();
  assert.deepEqual(f.revoked, ['blob:result-1', 'blob:result-2', 'blob:result-3']);
});
test('WEB all validation/errors are fixed; frozen caller inputs and observer mutations are isolated', async () => {
  let getter = 0;
  const f = fixture({ onState: state => { state.status = 'fake'; if (state.result) state.result.bytes = -1; throw new Error('SYNTHETIC_CANARY'); } });
  const bad = { get source() { ++getter; return INPUT.source; }, mode: 'original' };
  assert.equal((await f.controller.start(bad)).code, 'INPUT_INVALID'); assert.equal(getter, 0);
  await f.controller.start(INPUT); await flush(); assert.equal(f.controller.getState().result.bytes, 52);
  assert.equal(INPUT.mode, 'original');
});
test('WEB reentrant input reflection cannot create two jobs', async () => {
  const f = fixture({ hold: 'read' }); let inner; let entered = false;
  const input = new Proxy({ ...INPUT }, { getPrototypeOf(target) { if (!entered) { entered = true; inner = f.controller.start(INPUT); } return Reflect.getPrototypeOf(target); } });
  await f.controller.start(input); assert.equal((await inner).code, 'BUSY'); assert.equal(f.calls.length, 1);
  const stop = f.controller.cancel(); f.waiting.resolve({ bytes: wavFixture(), mime: 'audio/wav' }); await stop;
});
test('WEB reentrant progress reflection cannot overwrite cancelling state', async () => {
  const f = fixture({ hold: 'read' }); await f.controller.start(INPUT); let stopping;
  const progress = new Proxy({ downloadedBytes: 1, totalBytes: null }, { getPrototypeOf(target) { stopping = f.controller.clear(); return Reflect.getPrototypeOf(target); } });
  f.calls[0].options.onProgress(progress); assert.equal(f.controller.getState().status, 'cancelling');
  f.waiting.resolve({ bytes: wavFixture(), mime: 'audio/wav' }); await stopping; assert.equal(f.controller.getState().status, 'idle');
});
test('WEB late result URL creation reentry revokes unpublished object URL', async () => {
  let controller; let clearing; const revoked = [];
  controller = createMediaJob({ audio: {}, readers: { url: async () => ({ bytes: wavFixture(), mime: 'audio/wav' }) },
    urlApi: { createObjectURL: () => { clearing = controller.clear(); return 'blob:late'; }, revokeObjectURL: url => revoked.push(url) } });
  await controller.start(INPUT); await flush(); await clearing;
  assert.deepEqual(revoked, ['blob:late']); assert.equal(controller.getState().status, 'idle');
});
test('WEB error descriptor reentry cannot publish stale failure', async () => {
  const f = fixture({ hold: 'read' }); await f.controller.start(INPUT); let clearing;
  const error = new Proxy({ code: 'NETWORK' }, { getOwnPropertyDescriptor(target, key) { clearing = f.controller.clear(); return Reflect.getOwnPropertyDescriptor(target, key); } });
  f.waiting.reject(error); await flush(); await clearing;
  assert.equal(f.controller.getState().status, 'idle');
});
test('WEB local file and fixed demo use distinct readers and never echo filename', async () => {
  const f = fixture();
  await f.controller.start({ source: { kind: 'file', file: new File([wavFixture()], 'SYNTHETIC_CANARY.wav') }, mode: 'original' }); await flush();
  assert.equal(f.calls[0].kind, 'file'); assert(!JSON.stringify(f.controller.getState()).includes('SYNTHETIC_CANARY'));
  await f.controller.start({ source: { kind: 'demo' }, mode: 'original' }); await flush(); assert.equal(f.calls[1].kind, 'demo');
});
