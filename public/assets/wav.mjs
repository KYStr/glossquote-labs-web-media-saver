import { LIMITS, MediaError, checkAbort } from './common.mjs';
export function audioInfo(audio) {
  const frames = audio.length;
  const channels = audio.numberOfChannels;
  const rate = audio.sampleRate;
  const duration = audio.duration;
  if (!Number.isSafeInteger(frames) || frames < 1 || !Number.isSafeInteger(channels) || channels < 1
    || channels > LIMITS.channels || !Number.isSafeInteger(rate) || rate < 1 || rate > LIMITS.sampleRate
    || !Number.isFinite(duration) || duration <= 0 || duration > LIMITS.duration
    || frames / rate > LIMITS.duration || Math.abs(duration - frames / rate) > 1 / rate
    || frames * channels * 4 > LIMITS.pcm) throw new MediaError('AUDIO_LIMIT');
  return { frames, channels, rate, duration: frames / rate };
}
export async function encodeWav(audio, { signal, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  checkAbort(signal);
  const info = audioInfo(audio);
  const samples = Array.from({ length: info.channels }, (_, index) => audio.getChannelData(index));
  if (samples.some(data => !(data instanceof Float32Array) || data.length !== info.frames)) throw new MediaError('AUDIO_INVALID');
  const pcmBytes = info.frames * info.channels * 2;
  const bytes = new Uint8Array(44 + pcmBytes);
  const view = new DataView(bytes.buffer);
  const write = (offset, text) => [...text].forEach((letter, i) => { bytes[offset + i] = letter.charCodeAt(0); });
  write(0, 'RIFF'); view.setUint32(4, 36 + pcmBytes, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, info.channels, true);
  view.setUint32(24, info.rate, true); view.setUint32(28, info.rate * info.channels * 2, true);
  view.setUint16(32, info.channels * 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, pcmBytes, true);
  let at = 44;
  for (let start = 0; start < info.frames; start += 4096) {
    checkAbort(signal);
    for (let frame = start; frame < Math.min(start + 4096, info.frames); frame++) {
      for (let channel = 0; channel < info.channels; channel++) {
        const raw = samples[channel][frame];
        if (!Number.isFinite(raw)) throw new MediaError('AUDIO_INVALID');
        const sample = Math.max(-1, Math.min(1, raw));
        view.setInt16(at, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true); at += 2;
      }
    }
    await yieldTask();
  }
  checkAbort(signal);
  return bytes;
}
