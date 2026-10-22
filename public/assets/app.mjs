import { createMediaJob } from './job.mjs';
import { createBrowserAudio } from './audio.mjs';

const english = document.documentElement.lang === 'en';
const copy = english ? {
  idle: 'Paste a direct media link or choose a local file.', fetching: 'Reading media…', checking: 'Checking the container…',
  metadata: 'Checking audio duration…', decoding: 'Decoding audio in this browser…', encoding: 'Preparing WAV audio…',
  ready: 'File ready to download', cancelling: 'Stopping. Waiting for the browser operation to finish…',
  cancelled: 'Stopped. You can start again.', error: 'This file could not be prepared.', bytes: 'bytes read',
  download: 'Download file', wav: 'Download WAV', duration: 'seconds', demo: 'Synthetic demo audio. No platform is contacted.',
  INPUT_INVALID: 'Check the source and output selection, then try again.',
  URL_INVALID: 'Use one public HTTPS media link, without a login or custom port. Local and reserved hostnames are not accepted.',
  PAGE_LINK: 'This is a platform page. Use a direct media file link that allows browser access, or choose a local file.',
  FILE_REQUIRED: 'Choose a local media file first.', TOO_LARGE: 'This input is too large. Use up to 32 MiB for an original file or 16 MiB for WAV audio.',
  EMPTY: 'The source returned no media data. Check the link or choose another file.',
  NETWORK: 'The browser could not read this source. It may be a network, CORS, redirect or expired-link issue. Try a readable direct link or a local file.',
  HTTP_ERROR: 'The source did not return a complete HTTP 200 file. Try another direct link or a local file.',
  TIMEOUT: 'Reading took too long or stopped receiving data. Check the connection and try again.',
  MEDIA_UNSUPPORTED: 'This is not a recognized WAV, MP3, MP4/M4A, WebM or Ogg container. HTML pages and playlists are not supported.',
  TYPE_MISMATCH: 'The source content type and file signature do not match. Try a reliable media source.',
  DURATION_INVALID: 'Audio duration could not be confirmed within 120 seconds. Try a shorter, supported file.',
  AUDIO_UNAVAILABLE: 'This browser cannot decode audio here. You can still save the original file.',
  AUDIO_UNSUPPORTED: 'This browser could not decode an audio track. Try another codec, or save the original file.',
  AUDIO_LIMIT: 'Decoded audio exceeds the limit: 120 seconds, 2 channels, 48 kHz and 64 MiB of PCM. No channels were silently removed.',
  AUDIO_INVALID: 'Decoded audio contains invalid sample data. Try another file.',
  CANCELLED: 'Stopped. You can start again.', BUSY: 'Wait for the current operation to stop before starting another.',
  FAILED: 'This file could not be processed. Try another supported source or save the original file.',
} : {
  idle: '貼上影音直鏈，或選取本機檔案。', fetching: '正在讀取影音…', checking: '正在檢查容器…',
  metadata: '正在確認音訊時長…', decoding: '正在瀏覽器內解碼音訊…', encoding: '正在準備 WAV 音訊…',
  ready: '檔案已準備，可下載', cancelling: '正在停止，等待瀏覽器處理結束…',
  cancelled: '已停止，可以重新開始。', error: '這份檔案未能準備完成。', bytes: 'bytes 已讀取',
  download: '下載檔案', wav: '下載 WAV', duration: '秒', demo: '這是自行產生的示範音檔，不會連到影音平台。',
  INPUT_INVALID: '請確認來源與輸出選項後重試。',
  URL_INVALID: '請使用一個公開 HTTPS 影音直鏈，不含帳密或自訂連接埠；不接受本機與保留主機名稱。',
  PAGE_LINK: '這是平台作品頁。請改用允許瀏覽器讀取的影音檔直鏈，或選取本機檔案。',
  FILE_REQUIRED: '請先選取一份本機影音檔案。', TOO_LARGE: '輸入超過上限：原檔最多 32 MiB，取 WAV 的輸入最多 16 MiB。請改用較小檔案。',
  EMPTY: '來源沒有傳回影音資料，請確認連結或換一份檔案。',
  NETWORK: '瀏覽器無法讀取此來源，可能是網路、CORS、重新導向或連結到期。請換成可讀直鏈，或使用本機檔案。',
  HTTP_ERROR: '來源未傳回完整的 HTTP 200 檔案，請換一個影音直鏈或使用本機檔案。',
  TIMEOUT: '讀取過久或一段時間未收到資料，請確認連線後重試。',
  MEDIA_UNSUPPORTED: '無法辨識為 WAV、MP3、MP4/M4A、WebM 或 Ogg 容器；不接受 HTML 網頁與播放清單。',
  TYPE_MISMATCH: '來源宣告的類型與檔案簽章不符，請改用可靠的影音來源。',
  DURATION_INVALID: '無法確認音訊時長不超過 120 秒，請改用較短且可支援的檔案。',
  AUDIO_UNAVAILABLE: '此瀏覽器目前無法在這裡解碼音訊；仍可嘗試保存原檔。',
  AUDIO_UNSUPPORTED: '此瀏覽器無法解碼音軌，請換一種編碼，或保存原檔。',
  AUDIO_LIMIT: '解碼音訊超過限制：120 秒、2 聲道、48 kHz 與 64 MiB PCM；沒有自動丟棄聲道。',
  AUDIO_INVALID: '解碼音訊含無效取樣值，請換一份檔案。',
  CANCELLED: '已停止，可以重新開始。', BUSY: '請等待目前工作停止後，再開始另一份工作。',
  FAILED: '這份檔案處理失敗，請換一個支援來源，或嘗試保存原檔。',
};
const byId = id => document.getElementById(id);
const form = byId('media-form');
const number = new Intl.NumberFormat(english ? 'en' : 'zh-TW', { maximumFractionDigits: 2 });
const bytesText = bytes => `${number.format(bytes)} bytes (${number.format(bytes / 1048576)} MiB)`;
const busyStates = new Set(['fetching', 'checking', 'metadata', 'decoding', 'encoding', 'cancelling']);
function render(state) {
  const busy = busyStates.has(state.status);
  byId('start').disabled = busy;
  byId('demo').disabled = busy;
  byId('cancel').hidden = !busy;
  byId('cancel').disabled = state.status === 'cancelling';
  byId('status').textContent = copy[state.status];
  byId('stage-progress').hidden = !busy;
  byId('read-progress').textContent = state.progress ? `${number.format(state.progress.downloadedBytes)} ${copy.bytes}` : '';
  byId('error').hidden = !state.error;
  byId('error').textContent = state.error ? (copy[state.error] ?? copy.FAILED) : '';
  byId('result').hidden = !state.result;
  const download = byId('download');
  if (state.result) {
    download.href = state.result.url;
    download.download = state.result.filename;
    download.textContent = state.result.duration === null ? copy.download : copy.wav;
    byId('result-details').textContent = `${state.result.format} · ${bytesText(state.result.bytes)}${state.result.duration === null ? '' : ` · ${number.format(state.result.duration)} ${copy.duration}`}`;
  } else { download.removeAttribute('href'); download.removeAttribute('download'); byId('result-details').textContent = ''; }
}
const controller = createMediaJob({ audio: createBrowserAudio(), onState: render });
const mode = () => form.querySelector('input[name="mode"]:checked').value;
function invalidate() { byId('demo-note').textContent = ''; void controller.clear(); }
form.addEventListener('submit', event => {
  event.preventDefault();
  const source = form.querySelector('input[name="source"]:checked').value === 'url'
    ? { kind: 'url', url: byId('url').value } : { kind: 'file', file: byId('file').files[0] ?? null };
  byId('demo-note').textContent = '';
  void controller.start({ source, mode: mode() });
});
for (const radio of form.querySelectorAll('input[name="source"]')) radio.addEventListener('change', () => {
  const local = radio.checked && radio.value === 'file';
  byId('url-panel').hidden = local;
  byId('file-panel').hidden = !local;
  invalidate();
});
byId('url').addEventListener('input', invalidate);
byId('file').addEventListener('change', invalidate);
for (const radio of form.querySelectorAll('input[name="mode"]')) radio.addEventListener('change', invalidate);
byId('cancel').addEventListener('click', () => { void controller.cancel(); });
byId('clear').addEventListener('click', () => {
  byId('url').value = ''; byId('file').value = ''; invalidate();
});
byId('demo').addEventListener('click', () => {
  byId('demo-note').textContent = copy.demo;
  void controller.start({ source: { kind: 'demo' }, mode: mode() });
});
addEventListener('pagehide', () => { void controller.clear(); });
render(controller.getState());
