const UTM = ['utm_source', 'utm_medium', 'utm_campaign'];
const YOUTUBE_TRACKING = ['si', 'feature', 't', 'start', ...UTM];
const TIKTOK_TRACKING = ['_is_copy_url', 'is_from_webapp', 'sender_device', ...UTM];
const invalid = code => ({ ok: false, code });
const item = (platform, canonicalUrl, contentId, kind = 'item') =>
  ({ ok: true, platform, canonicalUrl, contentId, kind });

function queryAllowed(params, tracking, identity = null, required = false) {
  const allowed = new Set(tracking);
  if (identity !== null) allowed.add(identity);
  for (const key of params.keys()) if (!allowed.has(key)) return false;
  return identity === null || params.getAll(identity).length === (required ? 1 : 0);
}

export function classifyUrl(raw) {
  if (typeof raw !== 'string') return invalid('INVALID_INPUT');
  if (raw.length > 2048) return invalid('URL_TOO_LONG');
  // Only ordinary edge spaces are trimmed; tabs, LF, Cf and embedded spaces fail.
  const text = raw.replace(/^ +| +$/g, '');
  if (!text || /[\p{Cc}\p{Cf}\s\\]/u.test(text)) return invalid('URL_INVALID');

  // Require an explicit authority: WHATWG URL otherwise repairs https:host/path.
  const explicit = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/.exec(text);
  let url;
  try { url = new URL(text); } catch { return invalid('URL_INVALID'); }
  if (url.protocol !== 'https:') return invalid('SCHEME_UNSUPPORTED');
  if (!explicit || !explicit[2]) return invalid('URL_INVALID');
  if (url.username || url.password || explicit[2].includes('@')) {
    return invalid('CREDENTIALS_NOT_ALLOWED');
  }
  if (url.port) return invalid('PORT_NOT_ALLOWED');
  // Do not let authority decoding or path normalization manufacture an allowed URL.
  if (!/^[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(explicit[2])
    || explicit[2].split(':')[0].toLowerCase() !== url.hostname || url.hostname.endsWith('.')) {
    return invalid('URL_UNSUPPORTED');
  }
  const rawPath = explicit[3];
  if (rawPath.includes('%') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) {
    return invalid('URL_UNSUPPORTED');
  }
  if (url.pathname.includes('//')) return invalid('URL_UNSUPPORTED');
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const host = url.hostname;
  const params = url.searchParams;
  let match;

  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    let id;
    if (host !== 'youtu.be' && path === '/watch') {
      if (!queryAllowed(params, YOUTUBE_TRACKING, 'v', true)) return invalid('URL_UNSUPPORTED');
      id = params.get('v');
    } else {
      match = (host === 'youtu.be' ? /^\/([A-Za-z0-9_-]{11})$/
        : /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})$/).exec(path);
      if (!match || !queryAllowed(params, YOUTUBE_TRACKING)) return invalid('URL_UNSUPPORTED');
      id = match[1];
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return invalid('URL_UNSUPPORTED');
    return item('youtube', `https://www.youtube.com/watch?v=${id}`, id);
  }

  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    match = (host === 'player.vimeo.com' ? /^\/video\/(\d{1,12})$/ : /^\/(\d{1,12})$/).exec(path);
    if (match && queryAllowed(params, UTM)) return item('vimeo', `https://vimeo.com/${match[1]}`, match[1]);
  } else if (['bilibili.com', 'www.bilibili.com'].includes(host)) {
    match = /^\/video\/(BV[A-Za-z0-9]{10})$/.exec(path);
    const parts = params.getAll('p');
    const tracking = ['spm_id_from', 'vd_source', 'share_source', 'p'];
    if (match && queryAllowed(params, tracking) && parts.length <= 1
      && (parts.length === 0 || parts[0] === '1')) {
      return item('bilibili', `https://www.bilibili.com/video/${match[1]}`, match[1]);
    }
  } else if (['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(host)) {
    if (!queryAllowed(params, TIKTOK_TRACKING)) return invalid('URL_UNSUPPORTED');
    if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
      match = /^\/([A-Za-z0-9]{1,32})$/.exec(path);
      if (match) return item('tiktok', `https://${host}/${match[1]}/`, match[1], 'short-link');
    } else {
      match = /^\/@([A-Za-z0-9_.]{1,32})\/video\/(\d{1,25})$/.exec(path);
      if (match) return item('tiktok', `https://www.tiktok.com${path}`, match[2]);
    }
  } else if (['instagram.com', 'www.instagram.com'].includes(host)) {
    match = /^\/(p|reel)\/([A-Za-z0-9_-]{1,32})$/.exec(path);
    if (match && queryAllowed(params, ['igsh', ...UTM])) {
      return item('instagram', `https://www.instagram.com/${match[1]}/${match[2]}/`, match[2]);
    }
  } else if (['facebook.com', 'www.facebook.com'].includes(host)) {
    const tracking = ['mibextid', ...UTM];
    if (path === '/watch' && queryAllowed(params, tracking, 'v', true)) {
      const id = params.get('v');
      if (/^\d{1,25}$/.test(id)) return item('facebook', `https://www.facebook.com/watch/?v=${id}`, id);
    } else {
      match = /^\/reel\/(\d{1,25})$/.exec(path);
      if (match && queryAllowed(params, tracking)) {
        return item('facebook', `https://www.facebook.com/reel/${match[1]}/`, match[1]);
      }
    }
  } else if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(host)) {
    match = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})$/.exec(path);
    if (match && queryAllowed(params, ['s', 't', ...UTM])) {
      return item('x', `https://x.com/${match[1]}/status/${match[2]}`, match[2]);
    }
  } else if (['soundcloud.com', 'www.soundcloud.com'].includes(host)) {
    match = /^\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,100})$/.exec(path);
    const reserved = new Set(['sets', 'discover', 'search', 'stream', 'you', 'upload',
      'charts', 'stations', 'tags', 'likes', 'tracks', 'albums', 'reposts', 'popular-tracks']);
    if (match && !reserved.has(match[1].toLowerCase()) && !reserved.has(match[2].toLowerCase())
      && queryAllowed(params, ['si', ...UTM])) {
      return item('soundcloud', `https://soundcloud.com/${match[1]}/${match[2]}`, `${match[1]}/${match[2]}`);
    }
  }
  return invalid('URL_UNSUPPORTED');
}
