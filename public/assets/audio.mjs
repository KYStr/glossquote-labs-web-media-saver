import { LIMITS, MediaError, checkAbort, errorCode } from './common.mjs';

export function createBrowserAudio({ documentImpl = document, urlApi = URL,
  OfflineContext = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext,
  clock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) } } = {}) {
  function measure(blob, { signal }) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      const media = documentImpl.createElement('video');
      let url = null;
      let timer = null;
      let settled = false;
      const finish = (error, duration) => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        signal.removeEventListener('abort', cancelled);
        media.removeEventListener('loadedmetadata', loaded);
        media.removeEventListener('error', failed);
        try { media.pause(); media.removeAttribute('src'); media.load(); } catch { /* release below still runs */ }
        if (url !== null) { try { urlApi.revokeObjectURL(url); } catch { /* no raw diagnostics */ } }
        if (error) reject(error); else resolve(duration);
      };
      const cancelled = () => finish(new MediaError('CANCELLED'));
      const failed = () => finish(new MediaError('DURATION_INVALID'));
      const loaded = () => {
        const duration = media.duration;
        if (!Number.isFinite(duration) || duration <= 0 || duration > LIMITS.duration) failed();
        else finish(null, duration);
      };
      try {
        signal.addEventListener('abort', cancelled, { once: true });
        media.addEventListener('loadedmetadata', loaded);
        media.addEventListener('error', failed);
        timer = clock.setTimeout(failed, LIMITS.metadataMs);
        url = urlApi.createObjectURL(blob);
        if (settled) { urlApi.revokeObjectURL(url); url = null; return; }
        if (signal.aborted) { cancelled(); return; }
        media.preload = 'metadata';
        media.src = url;
        media.load();
      } catch { finish(new MediaError('DURATION_INVALID')); }
    });
  }
  async function decode(bytes, { signal }) {
    checkAbort(signal);
    if (typeof OfflineContext !== 'function') throw new MediaError('AUDIO_UNAVAILABLE');
    try {
      // Native decoding is not abortable. Always await its real settlement.
      const context = new OfflineContext(2, 1, LIMITS.sampleRate);
      const audio = await context.decodeAudioData(bytes.slice().buffer);
      checkAbort(signal);
      return audio;
    } catch (error) {
      const code = errorCode(error);
      if (signal.aborted) throw new MediaError('CANCELLED');
      throw new MediaError(code === 'FAILED' ? 'AUDIO_UNSUPPORTED' : code);
    }
  }
  return { measure, decode };
}
