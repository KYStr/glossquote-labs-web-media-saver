export const LIMITS = Object.freeze({ original: 33554432, audio: 16777216, duration: 120,
  pcm: 67108864, sampleRate: 48000, channels: 2, totalMs: 120000, idleMs: 20000, metadataMs: 10000 });
export const CODES = Object.freeze(['INPUT_INVALID', 'URL_INVALID', 'PAGE_LINK', 'FILE_REQUIRED', 'TOO_LARGE',
  'EMPTY', 'NETWORK', 'HTTP_ERROR', 'TIMEOUT', 'MEDIA_UNSUPPORTED', 'TYPE_MISMATCH', 'DURATION_INVALID',
  'AUDIO_UNAVAILABLE', 'AUDIO_UNSUPPORTED', 'AUDIO_LIMIT', 'AUDIO_INVALID', 'CANCELLED', 'BUSY', 'FAILED']);
export class MediaError extends Error {
  constructor(code) { const safe = CODES.includes(code) ? code : 'FAILED'; super(safe); this.code = safe; }
}
export function errorCode(error) {
  try { const field = Object.getOwnPropertyDescriptor(error, 'code');
    if (field && Object.hasOwn(field, 'value') && CODES.includes(field.value)) return field.value;
  } catch { /* Never inspect raw messages. */ }
  return 'FAILED';
}
export function record(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (![null, Object.prototype].includes(Object.getPrototypeOf(value))) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).length !== keys.length || keys.some(key => !Object.hasOwn(fields, key))) return null;
    const output = {};
    for (const key of keys) { if (!Object.hasOwn(fields[key], 'value')) return null; output[key] = fields[key].value; }
    return output;
  } catch { return null; }
}
export function checkAbort(signal) { if (signal?.aborted) throw new MediaError('CANCELLED'); }
