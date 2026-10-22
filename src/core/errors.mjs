export const ERROR_CODES = Object.freeze([
  'INVALID_INPUT', 'URL_TOO_LONG', 'URL_INVALID', 'SCHEME_UNSUPPORTED',
  'CREDENTIALS_NOT_ALLOWED', 'PORT_NOT_ALLOWED', 'URL_UNSUPPORTED',
  'OPTIONS_INVALID', 'BUSY', 'OPERATION_FAILED', 'CANCEL_UNCONFIRMED',
]);

const codes = new Set(ERROR_CODES);

export class CoreError extends Error {
  constructor(code) {
    const safe = codes.has(code) ? code : 'OPERATION_FAILED';
    super(safe);
    this.name = 'CoreError';
    this.code = safe;
  }
}

// Read data descriptors, never option getters or arbitrary exception messages.
export function readDataRecord(value, required, optional = []) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = new Set([...required, ...optional]);
    if (keys.some(key => !allowed.has(key))) return null;
    if (required.some(key => !Object.hasOwn(descriptors, key))) return null;
    const copy = Object.create(null);
    for (const key of keys) {
      if (!Object.hasOwn(descriptors[key], 'value')) return null;
      copy[key] = descriptors[key].value;
    }
    return copy;
  } catch {
    return null;
  }
}

export function toErrorCode(error) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (descriptor && Object.hasOwn(descriptor, 'value') && codes.has(descriptor.value)) {
      return descriptor.value;
    }
  } catch {
    // Untrusted error objects may themselves throw. The fallback is constant.
  }
  return 'OPERATION_FAILED';
}
