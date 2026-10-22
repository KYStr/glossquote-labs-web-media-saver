import { LIMITS, MediaError, errorCode, record, checkAbort } from './common.mjs';
import { readUrl, readLocal, readDemo, validateMediaUrl } from './source.mjs';
import { inspectMedia } from './media.mjs';
import { encodeWav, audioInfo } from './wav.mjs';

const empty = () => ({ status: 'idle', jobId: null, progress: null, result: null, error: null });
export function createMediaJob({ audio, onState = () => {}, readers = { url: readUrl, file: readLocal, demo: readDemo },
  inspect = inspectMedia, encode = encodeWav, urlApi = URL } = {}) {
  let state = empty();
  let active = null;
  let nextId = 0;
  let notifying = false;
  let starting = false;
  let resultUrl = null;
  const getState = () => ({ ...state, progress: state.progress && { ...state.progress }, result: state.result && { ...state.result } });
  const emit = next => {
    state = next;
    notifying = true;
    try { Promise.resolve(onState(getState())).catch(() => {}); } catch { /* observation cannot corrupt cleanup */ }
    finally { notifying = false; }
  };
  const revoke = url => { try { urlApi.revokeObjectURL(url); } catch { /* no raw diagnostics */ } };
  function dropResult() { if (resultUrl !== null) { revoke(resultUrl); resultUrl = null; } }
  const live = job => active === job && !job.cancelled;
  const requireLive = job => { if (!live(job)) throw new MediaError('CANCELLED'); };
  const phase = (job, status) => { requireLive(job); emit({ ...state, status }); };

  async function run(job, source, mode) {
    let createdUrl = null;
    try {
      const options = { signal: job.abort.signal, maxBytes: mode === 'wav' ? LIMITS.audio : LIMITS.original,
        onProgress: value => {
          if (!live(job)) return;
          const progress = record(value, ['downloadedBytes', 'totalBytes']);
          if (!live(job) || !progress || !Number.isSafeInteger(progress.downloadedBytes) || progress.downloadedBytes < 0
            || progress.downloadedBytes > options.maxBytes || (state.progress && progress.downloadedBytes < state.progress.downloadedBytes)
            || !(progress.totalBytes === null || (Number.isSafeInteger(progress.totalBytes)
              && progress.totalBytes > 0 && progress.totalBytes >= progress.downloadedBytes))) return;
          emit({ ...state, progress });
        } };
      const content = await (source.kind === 'demo' ? readers.demo(options)
        : readers[source.kind](source.kind === 'url' ? source.url : source.file, options));
      requireLive(job);
      phase(job, 'checking');
      const type = inspect(content.bytes, content.mime);
      requireLive(job);
      let bytes = content.bytes;
      let mime = type.mime;
      let format = type.format;
      let filename = `glossquote-media.${type.extension}`;
      let duration = null;
      if (mode === 'wav') {
        phase(job, 'metadata');
        const measured = await audio.measure(new Blob([bytes], { type: mime }), { signal: job.abort.signal });
        requireLive(job);
        if (!Number.isFinite(measured) || measured <= 0 || measured > LIMITS.duration) throw new MediaError('DURATION_INVALID');
        phase(job, 'decoding');
        const decoded = await audio.decode(bytes, { signal: job.abort.signal });
        requireLive(job);
        const info = audioInfo(decoded);
        requireLive(job);
        duration = info.duration;
        phase(job, 'encoding');
        bytes = await encode(decoded, { signal: job.abort.signal });
        requireLive(job);
        mime = 'audio/wav'; format = 'WAV · 16-bit PCM'; filename = 'glossquote-audio.wav';
      }
      checkAbort(job.abort.signal);
      const blob = new Blob([bytes], { type: mime });
      createdUrl = urlApi.createObjectURL(blob);
      requireLive(job);
      resultUrl = createdUrl;
      createdUrl = null;
      emit({ status: 'ready', jobId: job.id, progress: null,
        result: { url: resultUrl, bytes: blob.size, format, filename, duration }, error: null });
    } catch (error) {
      const code = errorCode(error);
      if (live(job)) emit({ status: 'error', jobId: job.id, progress: null, result: null, error: code });
    } finally {
      if (createdUrl !== null) revoke(createdUrl);
      if (active === job) {
        active = null;
        if (job.cancelled) emit(job.clearAfter ? empty()
          : { status: 'cancelled', jobId: job.id, progress: null, result: null, error: null });
      }
    }
  }

  function start(input) {
    if (starting || notifying || active) return Promise.resolve({ ok: false, code: 'BUSY' });
    starting = true;
    try {
      dropResult();
      const data = record(input, ['source', 'mode']);
      if (!data || !['original', 'wav'].includes(data.mode)) throw new MediaError('INPUT_INVALID');
      const sourceKind = Object.getOwnPropertyDescriptor(data.source ?? {}, 'kind')?.value;
      const keys = sourceKind === 'url' ? ['kind', 'url'] : sourceKind === 'file' ? ['kind', 'file'] : ['kind'];
      const source = record(data.source, keys);
      if (!source || !['url', 'file', 'demo'].includes(source.kind)) throw new MediaError('INPUT_INVALID');
      if (source.kind === 'url') source.url = validateMediaUrl(source.url);
      if (source.kind === 'file' && !(source.file instanceof Blob)) throw new MediaError('FILE_REQUIRED');
      const job = { id: ++nextId, cancelled: false, clearAfter: false, abort: new AbortController(), done: null };
      active = job;
      emit({ status: 'fetching', jobId: job.id, progress: null, result: null, error: null });
      job.done = run(job, source, data.mode);
      return Promise.resolve({ ok: true, jobId: job.id });
    } catch (error) {
      const code = errorCode(error);
      emit({ status: 'error', jobId: null, progress: null, result: null, error: code });
      return Promise.resolve({ ok: false, code });
    } finally { starting = false; }
  }
  function stop(clearAfter) {
    if (starting || notifying) return Promise.resolve({ ok: false, code: 'BUSY' });
    starting = true;
    try {
      dropResult();
      if (!active) {
        if (clearAfter) emit(empty());
        else if (state.result) emit({ status: 'cancelled', jobId: state.jobId, progress: null, result: null, error: null });
        return Promise.resolve({ ok: true });
      }
      const job = active;
      job.clearAfter ||= clearAfter;
      if (!job.cancelled) {
        job.cancelled = true;
        emit({ status: 'cancelling', jobId: job.id, progress: null, result: null, error: null });
        job.abort.abort();
      }
      return job.done.then(() => ({ ok: true }));
    } finally { starting = false; }
  }
  return Object.freeze({ start, cancel: () => stop(false), clear: () => stop(true), getState });
}
