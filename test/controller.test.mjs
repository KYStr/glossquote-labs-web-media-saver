import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_SCHEMAS, createController } from '../src/core/controller.mjs';
import { METADATA, ARTIFACT, VERIFICATION, makeFakeAdapter, manualScheduler, flush } from './fake-adapter.mjs';

const REQUEST = Object.freeze({ url: 'https://youtu.be/abcdefghijk?si=demo',
  options: Object.freeze({ kind: 'video', format: 'source' }) });

function setup(onState = () => {}) {
  const fake = makeFakeAdapter();
  const clock = manualScheduler();
  const controller = createController({ adapter: fake.adapter, onState, scheduler: clock.scheduler, cancelTimeoutMs: 1000 });
  return { ...fake, ...clock, controller };
}

async function toDownload(fixture) {
  await fixture.controller.start(REQUEST);
  fixture.calls.inspect.at(-1).resolve(METADATA);
  await flush();
}

async function toVerify(fixture) {
  await toDownload(fixture);
  fixture.calls.download.at(-1).resolve(ARTIFACT);
  await flush();
}

test('AC14 all stages are explicit; start accepts while inspect is still pending', async () => {
  const seen = [];
  const f = setup(state => seen.push(state));
  const starting = f.controller.start(REQUEST);
  assert(starting instanceof Promise);
  assert.deepEqual(await starting, { ok: true, jobId: 1 });
  assert.deepEqual(f.controller.getState(), { status: 'resolving', jobId: 1, progress: null, result: null, error: null });
  assert.equal(f.calls.inspect[0].request.url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.deepEqual(Object.keys(f.calls.inspect[0].request).sort(), ['jobId', 'signal', 'url']);
  f.calls.inspect[0].resolve(METADATA);
  await flush();
  assert.equal(f.controller.getState().status, 'downloading');
  assert.deepEqual(f.calls.download[0].request.metadata, { durationSeconds: 12, totalBytes: null });
  assert.deepEqual(f.calls.download[0].request.plan,
    { kind: 'video', format: 'source', maxHeight: 720, maxBytes: 1073741824, maxDurationSeconds: 3600 });
  f.calls.download[0].request.onProgress({ downloadedBytes: 120, totalBytes: 120 });
  assert.equal(f.controller.getState().progress.percent, 99);
  assert.equal(f.controller.getState().result, null);
  f.calls.download[0].resolve(ARTIFACT);
  await flush();
  assert.equal(f.controller.getState().status, 'verifying');
  assert.equal(f.controller.getState().result, null);
  f.calls.verify[0].resolve(VERIFICATION);
  await flush();
  assert.deepEqual(f.controller.getState(), { status: 'complete', jobId: 1,
    progress: { downloadedBytes: 120, totalBytes: 120, percent: 100 }, result: { artifactId: 'verified-fixture' }, error: null });
  assert.deepEqual(seen.map(state => state.status), ['resolving', 'downloading', 'downloading', 'verifying', 'complete']);
  f.calls.download[0].request.onProgress({ downloadedBytes: 1, totalBytes: 2 });
  assert.equal(f.controller.getState().progress.percent, 100);
  assert(!JSON.stringify(seen).includes('https://'));
});

test('AC03 invalid URL/options/request never call an adapter or a getter', async () => {
  const f = setup();
  assert.equal((await f.controller.start({ ...REQUEST, url: 'https://youtube.com.evil.test/watch?v=abcdefghijk' })).code, 'URL_UNSUPPORTED');
  assert.equal((await f.controller.start({ ...REQUEST, options: { kind: 'video', format: 'mp3' } })).code, 'OPTIONS_INVALID');
  let getters = 0;
  assert.equal((await f.controller.start({ get url() { ++getters; return REQUEST.url; }, options: REQUEST.options })).code, 'INVALID_INPUT');
  assert.equal((await f.controller.start({ ...REQUEST, args: [] })).code, 'INVALID_INPUT');
  assert.equal(getters, 0);
  assert.deepEqual(Object.values(f.calls).map(calls => calls.length), [0, 0, 0, 0]);
});

for (const stage of ['resolving', 'downloading', 'verifying']) {
  test(`AC15 single job in ${stage}`, async () => {
    const f = setup();
    if (stage === 'resolving') await f.controller.start(REQUEST);
    if (stage === 'downloading') await toDownload(f);
    if (stage === 'verifying') await toVerify(f);
    const before = f.controller.getState();
    assert.deepEqual(await f.controller.start(REQUEST), { ok: false, code: 'BUSY', jobId: null });
    assert.deepEqual(f.controller.getState(), before);
    assert.equal(f.calls.inspect.length, 1);
    const stopping = f.controller.cancel();
    assert.equal(f.calls.inspect[0].request.signal.aborted, true);
    f.calls.stop[0].resolve();
    assert.deepEqual(await stopping, { ok: true, jobId: 1 });
    assert.equal(f.pendingCount(), 0);
  });
}

for (const stage of ['inspect', 'download', 'verify']) {
  test(`AC16 cancel in ${stage} discards late success before stop ACK`, async () => {
    const f = setup();
    if (stage === 'inspect') await f.controller.start(REQUEST);
    if (stage === 'download') await toDownload(f);
    if (stage === 'verify') await toVerify(f);
    let settled = false;
    const stopping = f.controller.cancel().then(result => { settled = true; return result; });
    await flush();
    assert.equal(settled, false);
    assert.equal(f.controller.getState().status, 'cancelling');
    f.calls[stage][0].resolve(stage === 'inspect' ? METADATA : stage === 'download' ? ARTIFACT : VERIFICATION);
    await flush();
    assert.equal(f.controller.getState().status, 'cancelling');
    assert.equal(f.controller.getState().result, null);
    assert.equal((await f.controller.start(REQUEST)).code, 'BUSY');
    f.calls.stop[0].resolve();
    assert.equal((await stopping).ok, true);
    assert.equal(f.controller.getState().status, 'cancelled');
    assert.equal(f.pendingCount(), 0);
    if (stage === 'inspect') assert.equal(f.calls.download.length, 0);
    if (stage === 'download') assert.equal(f.calls.verify.length, 0);
  });
}

test('AC17 timeout settles cancel; late ACK unlocks the same job', async () => {
  const f = setup();
  await f.controller.start(REQUEST);
  const stopping = f.controller.cancel();
  f.advance(999);
  assert.equal(f.controller.getState().status, 'cancelling');
  f.advance(1);
  assert.deepEqual(await stopping, { ok: false, code: 'CANCEL_UNCONFIRMED', jobId: 1 });
  assert.equal(f.controller.getState().status, 'blocked');
  assert.deepEqual(f.controller.getState().error, { code: 'CANCEL_UNCONFIRMED' });
  assert.equal((await f.controller.start(REQUEST)).code, 'BUSY');
  assert.equal(f.calls.inspect.length, 1);
  assert.equal(f.pendingCount(), 0);
  f.calls.stop[0].resolve();
  await flush();
  assert.equal(f.controller.getState().status, 'cancelled');
  assert.deepEqual(await f.controller.start(REQUEST), { ok: true, jobId: 2 });
});

test('AC18 reject stays blocked; retry stop uses identical jobId', async () => {
  const f = setup();
  await f.controller.start(REQUEST);
  const first = f.controller.cancel();
  f.calls.stop[0].reject(new Error('https://example.test/SYNTHETIC_CANARY stderr'));
  assert.equal((await first).code, 'CANCEL_UNCONFIRMED');
  assert.equal(f.controller.getState().status, 'blocked');
  assert.equal(f.pendingCount(), 0);
  assert.equal((await f.controller.start(REQUEST)).code, 'BUSY');
  const retry = f.controller.cancel();
  assert.equal(f.controller.getState().status, 'cancelling');
  assert.equal(f.calls.stop.length, 2);
  assert.deepEqual(f.calls.stop.map(call => call.request), [{ jobId: 1 }, { jobId: 1 }]);
  f.calls.stop[1].resolve();
  assert.equal((await retry).ok, true);
  assert.equal(f.controller.getState().status, 'cancelled');
  assert.equal(f.pendingCount(), 0);
});

test('timeout retry accepts earlier ACK and settles both callers without stale reblocking', async () => {
  const f = setup();
  await f.controller.start(REQUEST);
  const first = f.controller.cancel();
  f.advance(1000);
  await first;
  const retry = f.controller.cancel();
  const alsoRetry = f.controller.cancel();
  assert.equal(f.calls.stop.length, 2);
  f.calls.stop[0].resolve();
  assert.equal((await retry).ok, true);
  assert.equal((await alsoRetry).ok, true);
  assert.equal(f.pendingCount(), 0);
  await f.controller.start(REQUEST);
  f.calls.stop[1].reject(new Error('late error'));
  f.advance(5000);
  await flush();
  assert.equal(f.controller.getState().status, 'resolving');
  assert.equal(f.controller.getState().jobId, 2);
});

for (const stage of ['inspect', 'download', 'verify']) {
  test(`AC19 clear settles on ACK even if old ${stage} promise never returns`, async () => {
    const f = setup();
    if (stage === 'inspect') await f.controller.start(REQUEST);
    if (stage === 'download') await toDownload(f);
    if (stage === 'verify') await toVerify(f);
    const clearing = f.controller.clear();
    const cancelToo = f.controller.cancel();
    assert.equal(f.controller.getState().status, 'cancelling');
    assert.equal(f.calls.stop.length, 1);
    f.calls.stop[0].resolve();
    assert.equal((await clearing).ok, true);
    assert.equal((await cancelToo).ok, true);
    assert.deepEqual(f.controller.getState(), { status: 'idle', jobId: null, progress: null, result: null, error: null });
    assert.equal(f.pendingCount(), 0);
    assert.equal((await f.controller.start(REQUEST)).jobId, 2);
  });
}

test('AC19 clear after complete drops references; idle/cancelled cancel is idempotent', async () => {
  const f = setup();
  await f.controller.cancel();
  await f.controller.clear();
  await toVerify(f);
  f.calls.verify[0].resolve(VERIFICATION);
  await flush();
  await f.controller.clear();
  assert.equal(f.controller.getState().status, 'idle');
  assert.equal(f.controller.getState().result, null);
  assert.equal(f.calls.stop.length, 0);
  await f.controller.start(REQUEST);
  const stop = f.controller.cancel();
  f.calls.stop[0].resolve();
  await stop;
  await f.controller.cancel();
  await f.controller.cancel();
  assert.equal(f.calls.stop.length, 1);
});

test('blocked clear retries stop; late ACK remembers clear intent', async () => {
  const f = setup();
  await f.controller.start(REQUEST);
  const stop = f.controller.cancel();
  f.advance(1000);
  await stop;
  const clear = f.controller.clear();
  f.advance(1000);
  assert.equal((await clear).code, 'CANCEL_UNCONFIRMED');
  assert.equal(f.controller.getState().status, 'blocked');
  f.calls.stop[1].resolve();
  await flush();
  assert.equal(f.controller.getState().status, 'idle');
  f.calls.stop[0].resolve();
  await flush();
  assert.equal(f.controller.getState().status, 'idle');
  assert.equal(f.pendingCount(), 0);
});

test('AC20 stale progress/error after retry cannot touch new job', async () => {
  const f = setup();
  await toDownload(f);
  const progress = f.calls.download[0].request.onProgress;
  const stop = f.controller.cancel();
  f.calls.stop[0].resolve();
  await stop;
  await toDownload(f);
  f.calls.download[1].request.onProgress({ downloadedBytes: 4, totalBytes: 8 });
  const before = f.controller.getState();
  progress({ downloadedBytes: 900, totalBytes: 1000 });
  f.calls.download[0].reject(new Error('https://example.test/SYNTHETIC_CANARY'));
  await flush();
  assert.deepEqual(f.controller.getState(), before);
  assert.equal(f.calls.inspect.length, 2);
  assert.equal(f.calls.verify.length, 0);
});

test('AC21 unknown and invalid progress cannot create NaN, Infinity, or premature 100%', async () => {
  const f = setup();
  await toDownload(f);
  const progress = f.calls.download[0].request.onProgress;
  progress(Object.freeze({ downloadedBytes: 4, totalBytes: null }));
  assert.deepEqual(f.controller.getState().progress, { downloadedBytes: 4, totalBytes: null, percent: null });
  const before = f.controller.getState();
  let getters = 0;
  const invalid = [
    { downloadedBytes: NaN, totalBytes: 100 }, { downloadedBytes: 4, totalBytes: NaN },
    { downloadedBytes: 4, totalBytes: 0 }, { downloadedBytes: 4, totalBytes: 3 },
    { downloadedBytes: -1, totalBytes: 100 }, { downloadedBytes: Infinity, totalBytes: null },
    { downloadedBytes: 4.5, totalBytes: 100 }, { downloadedBytes: 3, totalBytes: 100 },
    { downloadedBytes: Number.MAX_SAFE_INTEGER + 1, totalBytes: null },
    { downloadedBytes: 1073741825, totalBytes: null }, { downloadedBytes: 4, totalBytes: 1073741825 },
    { downloadedBytes: 4, totalBytes: 100, url: 'SYNTHETIC_CANARY' },
    { get downloadedBytes() { ++getters; return 100; }, totalBytes: 100 }, null,
  ];
  for (const value of invalid) { progress(value); assert.deepEqual(f.controller.getState(), before); }
  progress({ downloadedBytes: 5, totalBytes: 10 });
  assert.equal(f.controller.getState().progress.percent, 50);
  progress({ downloadedBytes: 10, totalBytes: 10 });
  assert.equal(f.controller.getState().progress.percent, 99);
  assert.equal(f.controller.getState().status, 'downloading');
  assert.equal(getters, 0);
});

for (const [name, verification] of [
  ['false', { ok: false, artifactId: 'fake' }], ['null', null], ['missing id', { ok: true }],
  ['unknown field', { ok: true, artifactId: 'id', path: 'SYNTHETIC_CANARY' }],
  ['path as id', { ok: true, artifactId: '../fake' }], ['URL as id', { ok: true, artifactId: 'https://example.test/file' }],
  ['getter', { get ok() { throw new Error('getter executed'); }, artifactId: 'id' }],
]) {
  test(`AC22 malformed verify ${name} cannot complete`, async () => {
    const f = setup();
    await toVerify(f);
    f.calls.verify[0].resolve(verification);
    await flush();
    assert.equal(f.controller.getState().status, 'failed');
    assert.equal(f.controller.getState().result, null);
    assert.deepEqual(f.controller.getState().error, { code: 'OPERATION_FAILED' });
  });
}

test('adapter metadata/artifact shape and finite bounds fail closed', async () => {
  const cases = [
    ['inspect', { durationSeconds: Infinity, totalBytes: null }],
    ['inspect', { durationSeconds: 3601, totalBytes: null }],
    ['inspect', { durationSeconds: 12, totalBytes: -1 }],
    ['inspect', { durationSeconds: 12, totalBytes: 1073741825 }],
    ['inspect', { ...METADATA, title: 'SYNTHETIC_CANARY' }],
    ['download', { ...ARTIFACT, bytes: 0 }], ['download', { ...ARTIFACT, bytes: 1.5 }],
    ['download', { ...ARTIFACT, durationSeconds: NaN }], ['download', { ...ARTIFACT, durationSeconds: 3601 }],
    ['download', { ...ARTIFACT, artifactId: 'C:/SYNTHETIC_CANARY' }],
  ];
  for (const [stage, value] of cases) {
    const f = setup();
    if (stage === 'inspect') await f.controller.start(REQUEST); else await toDownload(f);
    f.calls[stage][0].resolve(value);
    await flush();
    assert.equal(f.controller.getState().status, 'failed');
    assert.deepEqual(f.controller.getState().error, { code: 'OPERATION_FAILED' });
    assert.equal(f.calls.verify.length, 0);
  }
});

test('AC22 raw thrown data/code getters never leak into state or notifications', async () => {
  const seen = [];
  const f = setup(state => seen.push(state));
  await toDownload(f);
  let getters = 0;
  f.calls.download[0].reject({ get code() { ++getters; throw new Error('SYNTHETIC_CANARY'); },
    message: 'https://example.test/SYNTHETIC_CANARY stderr C:/private' });
  await flush();
  assert.equal(getters, 0);
  assert.deepEqual(f.controller.getState().error, { code: 'OPERATION_FAILED' });
  assert(!/SYNTHETIC_CANARY|https:|stderr|C:/.test(JSON.stringify(seen)));
});

test('synchronous adapter errors and invalid stop acknowledgments settle with fixed codes', async () => {
  const fake = makeFakeAdapter();
  const clock = manualScheduler();
  const controller = createController({ adapter: { ...fake.adapter,
    inspect: () => { throw new Error('SYNTHETIC_CANARY'); } }, scheduler: clock.scheduler });
  await controller.start(REQUEST);
  assert.equal(controller.getState().status, 'failed');
  assert.deepEqual(controller.getState().error, { code: 'OPERATION_FAILED' });
  const badStop = createController({ adapter: { ...fake.adapter, stop: () => { throw new Error('SYNTHETIC_CANARY'); } }, scheduler: clock.scheduler });
  await badStop.start(REQUEST);
  assert.equal((await badStop.cancel()).code, 'CANCEL_UNCONFIRMED');
  assert.equal(badStop.getState().status, 'blocked');
  const f = setup();
  await f.controller.start(REQUEST);
  const stopping = f.controller.cancel();
  f.calls.stop[0].resolve({ stopped: true });
  assert.equal((await stopping).code, 'CANCEL_UNCONFIRMED');
  assert.equal(f.controller.getState().status, 'blocked');
  assert.equal(f.pendingCount(), 0);
});

test('AC23 snapshots, adapter data and input cannot mutate internal state', async () => {
  const f = setup(state => { state.status = 'fake'; if (state.progress) state.progress.downloadedBytes = 999; });
  await toVerify(f);
  assert(Object.isFrozen(f.calls.download[0].request.plan));
  assert(Object.isFrozen(f.calls.download[0].request.metadata));
  assert(Object.isFrozen(f.calls.verify[0].request.artifact));
  f.calls.verify[0].resolve(VERIFICATION);
  await flush();
  const snapshot = f.controller.getState();
  snapshot.status = 'fake';
  snapshot.progress.percent = -1;
  snapshot.result.artifactId = 'external';
  assert.equal(f.controller.getState().status, 'complete');
  assert.equal(f.controller.getState().progress.percent, 100);
  assert.equal(f.controller.getState().result.artifactId, 'verified-fixture');
  assert.deepEqual(REQUEST, { url: 'https://youtu.be/abcdefghijk?si=demo', options: { kind: 'video', format: 'source' } });
});

test('AC23 throwing/reentrant observers cannot corrupt cleanup or create work', async () => {
  const attempted = [];
  let controller;
  const f = setup(() => {
    attempted.push(controller.start(REQUEST), controller.clear(), controller.cancel());
    throw new Error('SYNTHETIC_CANARY');
  });
  controller = f.controller;
  await controller.start(REQUEST);
  const clearing = controller.clear();
  f.calls.stop[0].resolve();
  await clearing;
  assert.equal(controller.getState().status, 'idle');
  assert.equal(f.calls.inspect.length, 1);
  assert.equal(f.calls.stop.length, 1);
  for (const promise of attempted) assert.equal((await promise).code, 'BUSY');
  assert.equal(f.pendingCount(), 0);
});

test('async observer rejections are handled during cancel cleanup', async () => {
  const f = setup(async () => { throw new Error('SYNTHETIC_CANARY'); });
  await f.controller.start(REQUEST);
  const cancelling = f.controller.cancel();
  f.calls.stop[0].resolve();
  await cancelling;
  await flush();
  assert.equal(f.controller.getState().status, 'cancelled');
  assert.equal(f.pendingCount(), 0);
});

test('AC24 adapter schemas are explicit and immutable; configuration fails closed', () => {
  assert.deepEqual(ADAPTER_SCHEMAS, { metadata: ['durationSeconds', 'totalBytes'],
    artifact: ['artifactId', 'bytes', 'durationSeconds'], verification: ['ok', 'artifactId'], progress: ['downloadedBytes', 'totalBytes'] });
  assert(Object.isFrozen(ADAPTER_SCHEMAS));
  assert(Object.isFrozen(ADAPTER_SCHEMAS.metadata));
  assert.throws(() => createController({ adapter: {}, args: [] }), error => error.code === 'OPERATION_FAILED');
  assert.throws(() => createController({ adapter: makeFakeAdapter().adapter, cancelTimeoutMs: 0 }), error => error.code === 'OPERATION_FAILED');
});

function reentrantProxy(target, trap, action) {
  let entered = false;
  return new Proxy(target, { [trap](value, ...args) {
    if (!entered) { entered = true; action(); }
    return Reflect[trap](value, ...args);
  } });
}

for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
  for (const location of ['request', 'options']) {
    test(`R01 ${location} ${trap} cannot start a second job or mutate during validation`, async () => {
      const f = setup();
      let inner;
      let innerCancel;
      let innerClear;
      const action = () => {
        inner = f.controller.start(REQUEST);
        innerCancel = f.controller.cancel();
        innerClear = f.controller.clear();
      };
      const request = location === 'request' ? reentrantProxy({ ...REQUEST }, trap, action)
        : { ...REQUEST, options: reentrantProxy({ kind: 'audio', format: 'mp3' }, trap, action) };
      assert.equal((await f.controller.start(request)).jobId, 1);
      assert.equal((await inner).code, 'BUSY');
      assert.equal((await innerCancel).code, 'BUSY');
      assert.equal((await innerClear).code, 'BUSY');
      assert.equal(f.calls.inspect.length, 1);
      const stopping = f.controller.cancel();
      assert.deepEqual(f.calls.stop.map(call => call.request), [{ jobId: 1 }]);
      f.calls.stop[0].resolve();
      await stopping;
      assert.equal(f.controller.getState().status, 'cancelled');
    });
  }
  for (const stage of ['inspect', 'download', 'verify', 'progress']) {
    for (const command of ['cancel', 'clear']) {
      test(`R01 ${stage} ${trap} ${command} cannot resurrect a cancelled stage`, async () => {
        const f = setup();
        if (stage === 'inspect') await f.controller.start(REQUEST);
        if (stage === 'download' || stage === 'progress') await toDownload(f);
        if (stage === 'verify') await toVerify(f);
        let stopping;
        const value = stage === 'inspect' ? { ...METADATA } : stage === 'download' ? { ...ARTIFACT }
          : stage === 'verify' ? { ...VERIFICATION } : { downloadedBytes: 1, totalBytes: null };
        const proxy = reentrantProxy(value, trap, () => { stopping = f.controller[command](); });
        if (stage === 'progress') f.calls.download[0].request.onProgress(proxy);
        else f.calls[stage][0].resolve(proxy);
        await flush();
        assert.equal(f.controller.getState().status, 'cancelling');
        assert.equal(f.controller.getState().result, null);
        assert.equal(f.calls.stop.length, 1);
        if (stage === 'inspect') assert.equal(f.calls.download.length, 0);
        if (stage === 'download' || stage === 'progress') assert.equal(f.calls.verify.length, 0);
        f.calls.stop[0].resolve();
        assert.equal((await stopping).ok, true);
        assert.equal(f.controller.getState().status, command === 'clear' ? 'idle' : 'cancelled');
        assert.equal(f.pendingCount(), 0);
      });
    }
  }
}

test('R01 error code descriptor reentry cancels safely before publishing failure', async () => {
  const f = setup();
  await toDownload(f);
  let stopping;
  const error = reentrantProxy({ code: 'OPERATION_FAILED' }, 'getOwnPropertyDescriptor', () => { stopping = f.controller.clear(); });
  f.calls.download[0].reject(error);
  await flush();
  assert.equal(f.controller.getState().status, 'cancelling');
  f.calls.stop[0].resolve();
  await stopping;
  assert.equal(f.controller.getState().status, 'idle');
});
