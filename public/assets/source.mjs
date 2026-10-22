import { LIMITS, MediaError, errorCode } from './common.mjs';

export function validateMediaUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new MediaError('URL_INVALID');
  const text = raw.replace(/^ +| +$/g, '');
  if (!text || /[\p{Cc}\p{Cf}\s\\]/u.test(text)) throw new MediaError('URL_INVALID');
  let parsed;
  try { parsed = new URL(text); } catch { throw new MediaError('URL_INVALID'); }
  const authority = /^https:\/\/([^/?#]+)/i.exec(text)?.[1];
  const host = parsed.hostname.toLowerCase();
  if (!authority || parsed.protocol !== 'https:' || parsed.username || parsed.password || authority.includes('@')
    || parsed.port || !/^[a-z0-9.-]+(?::\d+)?$/i.test(authority)
    || authority.split(':')[0].toLowerCase() !== host || host.endsWith('.')
    || /^\d+(?:\.\d+)*$/.test(host) || host.startsWith('[')) throw new MediaError('URL_INVALID');
  const labels = host.split('.');
  const reserved = ['localhost', 'local', 'internal', 'test', 'invalid', 'example', 'lan', 'home', 'onion'];
  if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || reserved.includes(labels.at(-1)) || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels.at(-1))
    || ['example.com', 'example.net', 'example.org'].some(name => host === name || host.endsWith(`.${name}`))) {
    throw new MediaError('URL_INVALID');
  }
  const base = host.replace(/^(?:www|m)\./, '');
  const p = parsed.pathname;
  if ((base === 'youtube.com' && /^\/(?:watch|shorts|embed)(?:\/|$)/.test(p)) || base === 'youtu.be'
    || (base === 'vimeo.com' && /^\/\d+\/?$/.test(p))
    || (base === 'bilibili.com' && p.startsWith('/video/'))
    || (base === 'tiktok.com' && /\/video\//.test(p)) || ['vm.tiktok.com', 'vt.tiktok.com'].includes(host)
    || (base === 'instagram.com' && /^\/(?:p|reel)\//.test(p))
    || (base === 'facebook.com' && /^\/(?:watch|reel)(?:\/|$)/.test(p))
    || (['x.com', 'twitter.com'].includes(base) && /\/status\//.test(p))
    || (base === 'soundcloud.com' && /^\/[^/]+\/[^/]+\/?$/.test(p))) throw new MediaError('PAGE_LINK');
  return text; // Signed path/query remains untouched; no DNS safety claim is made.
}

const clockDefault = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };

async function acquire(open, { signal, maxBytes, onProgress = () => {}, clock = clockDefault,
  totalMs = LIMITS.totalMs, idleMs = LIMITS.idleMs }) {
  const abort = new AbortController();
  let reason = null;
  let reader = null;
  let body = null;
  let cancelPromise = null;
  let totalTimer = null;
  let idleTimer = null;
  let chunks = [];
  const cancelReader = () => {
    if (!cancelPromise) {
      try { cancelPromise = Promise.resolve(reader ? reader.cancel() : body?.cancel()).catch(() => {}); }
      catch { cancelPromise = Promise.resolve(); }
    }
  };
  const halt = code => { reason ??= code; abort.abort(); cancelReader(); };
  const externalAbort = () => halt('CANCELLED');
  const resetIdle = () => { clock.clearTimeout(idleTimer); idleTimer = clock.setTimeout(() => halt('TIMEOUT'), idleMs); };
  try {
    if (signal?.aborted) throw new MediaError('CANCELLED');
    signal?.addEventListener('abort', externalAbort, { once: true });
    totalTimer = clock.setTimeout(() => halt('TIMEOUT'), totalMs);
    resetIdle();
    const opened = await open(abort.signal);
    body = opened.body;
    if (reason) { cancelPromise = null; cancelReader(); throw new MediaError(reason); }
    if (!opened.valid) throw new MediaError('HTTP_ERROR');
    if (opened.length !== null && opened.length > maxBytes) throw new MediaError('TOO_LARGE');
    if (!body || typeof body.getReader !== 'function') throw new MediaError('EMPTY');
    reader = body.getReader();
    let size = 0;
    const announced = opened.length > 0 ? opened.length : null;
    while (true) {
      const part = await reader.read();
      if (reason) throw new MediaError(reason);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw new MediaError('MEDIA_UNSUPPORTED');
      size += part.value.byteLength;
      if (!Number.isSafeInteger(size) || size > maxBytes) throw new MediaError('TOO_LARGE');
      if (part.value.byteLength) { chunks.push(part.value.slice()); resetIdle(); }
      try { onProgress({ downloadedBytes: size, totalBytes: announced !== null && announced >= size ? announced : null }); } catch { /* observer only */ }
    }
    if (size === 0) throw new MediaError('EMPTY');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes, mime: opened.mime };
  } catch (error) {
    const code = errorCode(error);
    halt(reason ?? (code === 'FAILED' ? 'NETWORK' : code));
    throw new MediaError(reason);
  } finally {
    if (reason) { cancelReader(); await cancelPromise; }
    try { reader?.releaseLock(); } catch { /* already released */ }
    clock.clearTimeout(totalTimer); clock.clearTimeout(idleTimer);
    signal?.removeEventListener('abort', externalAbort);
    chunks = [];
  }
}

export function readUrl(raw, options, fetchImpl = fetch) {
  const url = validateMediaUrl(raw);
  return fetchBytes(url, options, fetchImpl);
}
export function readDemo(options, fetchImpl = fetch) { return fetchBytes('/assets/demo.wav', options, fetchImpl); }
function fetchBytes(url, options, fetchImpl) {
  return acquire(async signal => {
    const response = await fetchImpl(url, { method: 'GET', mode: 'cors', credentials: 'omit',
      referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', signal });
    const rawLength = response.headers.get('content-length');
    const length = rawLength !== null && /^\d+$/.test(rawLength) && Number.isSafeInteger(Number(rawLength)) ? Number(rawLength) : null;
    return { valid: response.status === 200 && response.type !== 'opaque' && response.type !== 'opaqueredirect'
      && !response.redirected, body: response.body, length, mime: response.headers.get('content-type') ?? '' };
  }, options);
}
export function readLocal(file, options) {
  if (!(file instanceof Blob)) return Promise.reject(new MediaError('FILE_REQUIRED'));
  return acquire(async () => ({ valid: true, body: file.stream(), length: file.size, mime: file.type }), options);
}
