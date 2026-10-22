export function wavFixture() {
  const bytes = new Uint8Array(52);
  const view = new DataView(bytes.buffer);
  const write = (at, text) => [...text].forEach((c, i) => { bytes[at + i] = c.charCodeAt(0); });
  write(0, 'RIFF'); view.setUint32(4, 44, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, 8, true);
  [-32768, -8192, 8192, 32767].forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
  return bytes;
}
export function audioFixture(samples = [new Float32Array([-1, -.25, .25, 1])], rate = 8000) {
  return { length: samples[0].length, numberOfChannels: samples.length, sampleRate: rate,
    duration: samples[0].length / rate, getChannelData: channel => samples[channel] };
}
export function responseFixture(chunks, { status = 200, mime = 'audio/wav', length = null } = {}) {
  let at = 0;
  const calls = { cancelled: 0, released: 0 };
  const reader = { read: async () => at < chunks.length ? { done: false, value: chunks[at++] } : { done: true },
    cancel: async () => { ++calls.cancelled; }, releaseLock: () => { ++calls.released; } };
  return { calls, response: { status, type: 'cors', redirected: false,
    headers: { get: name => name === 'content-type' ? mime : length === null ? null : String(length) },
    body: { getReader: () => reader, cancel: async () => { ++calls.cancelled; } } } };
}
