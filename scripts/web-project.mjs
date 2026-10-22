import assert from 'node:assert/strict';
import { lstat, readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { regularDirectory, regularFile, sha256 } from './project-files.mjs';
import { encodeWav } from '../public/assets/wav.mjs';
import { validateMediaUrl } from '../public/assets/source.mjs';

export const PUBLIC_FILES = Object.freeze(['assets/app.mjs', 'assets/audio.mjs', 'assets/common.mjs',
  'assets/icon.svg', 'assets/job.mjs', 'assets/media.mjs', 'assets/source.mjs', 'assets/style.css', 'assets/wav.mjs',
  'en/index.html', 'index.html']);
export const DIST_FILES = Object.freeze([...PUBLIC_FILES, 'assets/demo.wav', '_headers', 'robots.txt', 'sitemap.xml'].sort());
export const SECURITY = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https:; media-src blob:; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': 'no-store',
});

export function buildSettings(args = []) {
  let mode = 'preview';
  let origin = null;
  const seen = new Set();
  for (const argument of args) {
    const match = /^--(mode|origin)=(.+)$/.exec(argument);
    if (!match || seen.has(match[1])) throw new Error('BUILD_ARGUMENT_INVALID');
    seen.add(match[1]);
    if (match[1] === 'mode') mode = match[2]; else origin = match[2];
  }
  if (!['preview', 'release'].includes(mode) || (mode === 'preview' && origin !== null)) throw new Error('BUILD_MODE_INVALID');
  if (mode === 'release') {
    if (!origin || new URL(origin).origin !== origin || new URL(origin).pathname !== '/') throw new Error('BUILD_ORIGIN_INVALID');
    validateMediaUrl(`${origin}/`);
  }
  return { mode, origin };
}

export async function tree(root, subdir, allowed) {
  const base = path.join(root, subdir);
  await regularDirectory(root);
  await regularDirectory(base);
  const files = [];
  async function walk(relative) {
    const directory = path.join(base, relative);
    await regularDirectory(directory);
    for (const name of (await readdir(directory)).sort()) {
      const rel = relative ? `${relative}/${name}` : name;
      const info = await lstat(path.join(base, rel));
      if (info.isSymbolicLink()) throw new Error('WEB_TREE_UNSAFE');
      if (info.isDirectory()) {
        if (!allowed.some(file => file.startsWith(`${rel}/`))) throw new Error('WEB_TREE_UNKNOWN');
        await walk(rel);
      } else if (info.isFile() && allowed.includes(rel)) files.push(rel);
      else throw new Error('WEB_TREE_UNKNOWN');
    }
  }
  await walk('');
  return files.sort();
}

export async function checkWeb(root) {
  const files = await tree(root, 'public', PUBLIC_FILES);
  assert.deepEqual(files, [...PUBLIC_FILES].sort());
  const pages = [];
  for (const file of files) {
    const source = (await regularFile(path.join(root, 'public', file))).toString('utf8');
    if (file.endsWith('.mjs')) {
      assert.doesNotMatch(source, /\b(?:require|eval|Function)\s*\(|\bimport\s*\(/);
      assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB|sendBeacon|serviceWorker|WebSocket)\b/);
      for (const match of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
        assert(match[1].startsWith('./') && PUBLIC_FILES.includes(target), 'WEB_IMPORT_NOT_CLOSED');
      }
    }
    if (file.endsWith('.css')) assert.doesNotMatch(source, /@import|url\(\s*['"]?https?:/i);
    if (file.endsWith('.html')) {
      assert.doesNotMatch(source, /\son\w+\s*=|\sstyle\s*=|<iframe|<audio|<video/i);
      assert(source.includes('__ROBOTS__') && source.includes('__SEO_LINKS__'));
      assert(source.includes('id="url"') && source.includes('id="file"') && source.includes('role="alert"'));
      for (const match of source.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) assert(PUBLIC_FILES.includes(match[1].slice(1)));
      const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      assert.equal(ids.length, new Set(ids).size);
      pages.push(ids.sort());
    }
  }
  assert.deepEqual(pages[0], pages[1]);
  return files;
}

export async function demoBytes() {
  const samples = Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i * 2 * Math.PI * 220 / 16000) * .08);
  return encodeWav({ length: 4000, numberOfChannels: 1, sampleRate: 16000, duration: .25,
    getChannelData: () => samples }, { yieldTask: async () => {} });
}

export async function buildWeb(root, settings) {
  await checkWeb(root);
  const output = path.join(root, 'dist');
  try { await lstat(output); await tree(root, 'dist', [...DIST_FILES, 'manifest.json']); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(path.join(output, 'assets'), { recursive: true });
  await mkdir(path.join(output, 'en'), { recursive: true });
  const values = new Map();
  for (const file of PUBLIC_FILES) {
    let bytes = await regularFile(path.join(root, 'public', file));
    if (file.endsWith('.html')) {
      const prefix = settings.origin ?? '';
      const target = file.startsWith('en/') ? '/en/' : '/';
      const links = `<link rel="canonical" href="${prefix}${target}">\n  <link rel="alternate" hreflang="zh-Hant" href="${prefix}/">\n  <link rel="alternate" hreflang="en" href="${prefix}/en/">\n  <link rel="alternate" hreflang="x-default" href="${prefix}/">`;
      bytes = Buffer.from(bytes.toString('utf8').replace('__ROBOTS__', settings.mode === 'release' ? 'index,follow' : 'noindex,nofollow').replace('__SEO_LINKS__', links));
    }
    values.set(file, bytes);
  }
  values.set('assets/demo.wav', Buffer.from(await demoBytes()));
  values.set('_headers', Buffer.from(`/*\n${Object.entries(SECURITY).map(([name, value]) => `  ${name}: ${value}`).join('\n')}\n`));
  values.set('robots.txt', Buffer.from(settings.mode === 'release' ? `User-agent: *\nAllow: /\nSitemap: ${settings.origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n'));
  values.set('sitemap.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${settings.mode === 'release' ? ['/', '/en/'].map(route => `<url><loc>${settings.origin}${route}</loc></url>`).join('') : ''}</urlset>\n`));
  const records = [];
  for (const file of DIST_FILES) {
    const bytes = values.get(file);
    await writeFile(path.join(output, file), bytes);
    records.push({ path: file, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const manifest = { schemaVersion: 1, milestone: 'WEB-M1', ...settings, files: records,
    contentSha256: sha256(`${JSON.stringify(records)}\n`) };
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  assert.deepEqual(await tree(root, 'dist', [...DIST_FILES, 'manifest.json']), [...DIST_FILES, 'manifest.json'].sort());
  for (const item of records) {
    const bytes = await regularFile(path.join(output, item.path));
    assert.equal(bytes.length, item.bytes); assert.equal(sha256(bytes), item.sha256);
  }
  return manifest;
}
