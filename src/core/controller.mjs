import { CoreError, readDataRecord, toErrorCode } from './errors.mjs';
import { classifyUrl } from './url.mjs';
import { makePlan } from './plan.mjs';

export const ADAPTER_SCHEMAS = Object.freeze({
  metadata: Object.freeze(['durationSeconds', 'totalBytes']),
  artifact: Object.freeze(['artifactId', 'bytes', 'durationSeconds']),
  verification: Object.freeze(['ok', 'artifactId']),
  progress: Object.freeze(['downloadedBytes', 'totalBytes']),
});

const emptyState = () => ({ status: 'idle', jobId: null, progress: null, result: null, error: null });
const failure = (code, jobId = null) => ({ ok: false, code, jobId });
const accepted = (jobId = null) => ({ ok: true, jobId });
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const positiveNumber = (value, max) => typeof value === 'number'
  && Number.isFinite(value) && value > 0 && value <= max;
const bytesInRange = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;

function metadataData(value, plan) {
  const data = readDataRecord(value, ADAPTER_SCHEMAS.metadata);
  if (!data || !(data.durationSeconds === null || positiveNumber(data.durationSeconds, plan.maxDurationSeconds))
    || !(data.totalBytes === null || bytesInRange(data.totalBytes, plan.maxBytes))) {
    throw new CoreError('OPERATION_FAILED');
  }
  return Object.freeze({ durationSeconds: data.durationSeconds, totalBytes: data.totalBytes });
}

function artifactData(value, plan) {
  const data = readDataRecord(value, ADAPTER_SCHEMAS.artifact);
  if (!data || !validId(data.artifactId) || !bytesInRange(data.bytes, plan.maxBytes) || data.bytes === 0
    || !positiveNumber(data.durationSeconds, plan.maxDurationSeconds)) {
    throw new CoreError('OPERATION_FAILED');
  }
  return Object.freeze({ artifactId: data.artifactId, bytes: data.bytes, durationSeconds: data.durationSeconds });
}

export function createController(configuration) {
  const config = readDataRecord(configuration, ['adapter'], ['onState', 'cancelTimeoutMs', 'scheduler']);
  const adapter = config && readDataRecord(config.adapter, ['inspect', 'download', 'verify', 'stop']);
  const onState = config?.onState ?? (() => {});
  const cancelTimeoutMs = config?.cancelTimeoutMs ?? 1000;
  const scheduler = config?.scheduler === undefined
    ? { setTimeout: (fn, delay) => setTimeout(fn, delay), clearTimeout: handle => clearTimeout(handle) }
    : readDataRecord(config.scheduler, ['setTimeout', 'clearTimeout']);
  if (!config || !adapter || Object.values(adapter).some(fn => typeof fn !== 'function')
    || typeof onState !== 'function' || !Number.isSafeInteger(cancelTimeoutMs) || cancelTimeoutMs < 1
    || cancelTimeoutMs > 2147483647 || !scheduler
    || typeof scheduler.setTimeout !== 'function' || typeof scheduler.clearTimeout !== 'function') {
    throw new CoreError('OPERATION_FAILED');
  }

  let state = emptyState();
  let generation = 0;
  let nextJobId = 0;
  let active = null;
  let pendingStop = null;
  let notifying = false;
  let starting = false;

  function getState() {
    return { ...state,
      progress: state.progress === null ? null : { ...state.progress },
      result: state.result === null ? null : { ...state.result },
      error: state.error === null ? null : { ...state.error },
    };
  }

  function publish(next) {
    state = next;
    notifying = true;
    try {
      // A rejected async observer is also isolated; no raw errors are logged.
      Promise.resolve(onState(getState())).catch(() => {});
    } catch {
      // Observers cannot prevent cancellation or stage cleanup.
    } finally {
      notifying = false;
    }
  }

  const live = job => active === job && generation === job.generation && pendingStop === null;

  function progressFor(job, plan, value) {
    if (!live(job) || state.status !== 'downloading') return;
    const data = readDataRecord(value, ADAPTER_SCHEMAS.progress);
    // Proxy reflection can run user code; validate ownership again afterwards.
    if (!live(job) || state.status !== 'downloading') return;
    if (!data || !bytesInRange(data.downloadedBytes, plan.maxBytes)
      || !(data.totalBytes === null || (bytesInRange(data.totalBytes, plan.maxBytes)
        && data.totalBytes > 0 && data.totalBytes >= data.downloadedBytes))
      || data.downloadedBytes < state.progress.downloadedBytes) return;
    const percent = data.totalBytes === null ? null
      : Math.min(99, Math.floor(data.downloadedBytes / data.totalBytes * 100));
    publish({ ...state, progress: { downloadedBytes: data.downloadedBytes, totalBytes: data.totalBytes, percent } });
  }

  async function run(job, url, plan) {
    try {
      const rawMetadata = await adapter.inspect({ jobId: job.jobId, url, signal: job.abort.signal });
      if (!live(job)) return;
      const metadata = metadataData(rawMetadata, plan);
      if (!live(job)) return;
      publish({ ...state, status: 'downloading', progress: { downloadedBytes: 0, totalBytes: null, percent: null } });
      const rawArtifact = await adapter.download({ jobId: job.jobId, metadata, plan, signal: job.abort.signal,
        onProgress: value => progressFor(job, plan, value) });
      if (!live(job)) return;
      const artifact = artifactData(rawArtifact, plan);
      if (!live(job)) return;
      publish({ ...state, status: 'verifying' });
      const rawVerification = await adapter.verify({ jobId: job.jobId, artifact, plan, signal: job.abort.signal });
      if (!live(job)) return;
      const verified = readDataRecord(rawVerification, ADAPTER_SCHEMAS.verification);
      if (!live(job)) return;
      if (!verified || verified.ok !== true || !validId(verified.artifactId)) throw new CoreError('OPERATION_FAILED');
      active = null;
      publish({ status: 'complete', jobId: job.jobId,
        progress: { downloadedBytes: artifact.bytes, totalBytes: artifact.bytes, percent: 100 },
        result: { artifactId: verified.artifactId }, error: null });
    } catch (error) {
      if (!live(job)) return;
      const code = toErrorCode(error);
      if (!live(job)) return;
      active = null;
      publish({ status: 'failed', jobId: job.jobId, progress: null, result: null, error: { code } });
    }
  }

  function start(request) {
    if (notifying || starting || active !== null || pendingStop !== null) return Promise.resolve(failure('BUSY'));
    // Reserve the command before reflecting on request/options. Proxy traps may reenter.
    starting = true;
    try {
      const data = readDataRecord(request, ['url', 'options']);
      const classified = data ? classifyUrl(data.url) : { ok: false, code: 'INVALID_INPUT' };
      let plan;
      let code = classified.ok ? null : classified.code;
      if (code === null) {
        try { plan = Object.freeze(makePlan(data.options)); } catch (error) { code = toErrorCode(error); }
      }
      if (code !== null || !Number.isSafeInteger(nextJobId + 1)) {
        code ??= 'OPERATION_FAILED';
        publish({ status: 'failed', jobId: null, progress: null, result: null, error: { code } });
        return Promise.resolve(failure(code));
      }
      const job = { jobId: ++nextJobId, generation: ++generation, abort: new AbortController() };
      active = job;
      publish({ status: 'resolving', jobId: job.jobId, progress: null, result: null, error: null });
      // This promise is handled internally; start acknowledges acceptance, not completion.
      void run(job, classified.canonicalUrl, plan);
      return Promise.resolve(accepted(job.jobId));
    } finally {
      starting = false;
    }
  }

  function clearTimer(attempt) {
    if (attempt.timer !== null) {
      scheduler.clearTimeout(attempt.timer);
      attempt.timer = null;
    }
  }

  function requestStop(pending) {
    if (pending.attempt?.status === 'pending') return pending.attempt.promise;
    let settle;
    const attempt = { status: 'pending', timer: null, promise: new Promise(resolve => { settle = resolve; }) };
    pending.attempt = attempt;
    const unconfirmed = () => {
      clearTimer(attempt);
      attempt.status = 'unconfirmed';
      if (pendingStop === pending && pending.attempt === attempt) {
        publish({ status: 'blocked', jobId: pending.jobId, progress: null, result: null,
          error: { code: 'CANCEL_UNCONFIRMED' } });
      }
      settle(failure('CANCEL_UNCONFIRMED', pending.jobId));
    };
    const acknowledged = value => {
      if (value !== undefined) { unconfirmed(); return; }
      clearTimer(attempt);
      attempt.status = 'acknowledged';
      if (pendingStop === pending) {
        clearTimer(pending.attempt);
        // A late ack may satisfy a newer stop retry for this same job.
        if (pending.attempt !== attempt) pending.attempt.finish(accepted(pending.jobId));
        pendingStop = null;
        publish(pending.clearAfter ? emptyState()
          : { status: 'cancelled', jobId: pending.jobId, progress: null, result: null, error: null });
      }
      settle(accepted(pending.jobId));
    };
    attempt.finish = settle;
    attempt.timer = scheduler.setTimeout(unconfirmed, cancelTimeoutMs);
    try {
      Promise.resolve(adapter.stop({ jobId: pending.jobId })).then(acknowledged, unconfirmed);
    } catch {
      unconfirmed();
    }
    return attempt.promise;
  }

  function stop(clearAfter) {
    if (notifying || starting) return Promise.resolve(failure('BUSY'));
    if (pendingStop !== null) {
      pendingStop.clearAfter ||= clearAfter;
      if (pendingStop.attempt?.status !== 'pending') {
        publish({ status: 'cancelling', jobId: pendingStop.jobId, progress: null, result: null, error: null });
      }
      return requestStop(pendingStop);
    }
    if (active === null) {
      if (clearAfter) { ++generation; publish(emptyState()); }
      return Promise.resolve(accepted());
    }
    const job = active;
    ++generation;
    active = null;
    const pending = { jobId: job.jobId, clearAfter, attempt: null };
    pendingStop = pending;
    publish({ status: 'cancelling', jobId: job.jobId, progress: null, result: null, error: null });
    job.abort.abort();
    return requestStop(pending);
  }

  return Object.freeze({ start, cancel: () => stop(false), clear: () => stop(true), getState });
}
