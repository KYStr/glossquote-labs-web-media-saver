import { CoreError, readDataRecord } from './errors.mjs';

export function makePlan(options) {
  const data = readDataRecord(options, ['kind', 'format']);
  if (!data || !((data.kind === 'video' && data.format === 'source')
    || (data.kind === 'audio' && data.format === 'mp3'))) {
    throw new CoreError('OPTIONS_INVALID');
  }
  return {
    kind: data.kind,
    format: data.format,
    maxHeight: data.kind === 'video' ? 720 : null,
    maxBytes: 1073741824,
    maxDurationSeconds: 3600,
  };
}
