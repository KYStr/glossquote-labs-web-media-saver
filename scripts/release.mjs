import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, assertRuntime, regularFile, sha256 } from './project-files.mjs';
import { buildSettings, buildWeb, demoBytes, DIST_FILES, PUBLIC_FILES, SECURITY, tree } from './web-project.mjs';

export const RELEASE = Object.freeze({ worker: 'glossquote-web-media-saver', host: 'media.glossquote.com',
  origin: 'https://media.glossquote.com', compatibilityDate: '2026-10-22', wranglerVersion: '4.147.0' });

export function assertDeploymentConfig(config) {
  assert.deepEqual(config, {
    name: RELEASE.worker, compatibility_date: RELEASE.compatibilityDate,
    workers_dev: false, preview_urls: false, send_metrics: false,
    observability: { enabled: false, logs: { enabled: false, invocation_logs: false }, traces: { enabled: false } },
    build: { command: 'node scripts/release.mjs' },
    routes: [{ pattern: RELEASE.host, custom_domain: true }],
    assets: { directory: './dist', run_worker_first: false, html_handling: 'auto-trailing-slash', not_found_handling: 'none' },
  }, 'RELEASE_CONFIG_INVALID');
}

const REQUIRED_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https:; media-src blob:; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': 'no-store',
});

export async function verifyRelease(root = ROOT) {
  assertDeploymentConfig(JSON.parse((await regularFile(path.join(root, 'wrangler.jsonc'))).toString('utf8')));
  assert.deepEqual(SECURITY, REQUIRED_HEADERS, 'RELEASE_HEADERS_CHANGED');
  assert.deepEqual(await tree(root, 'dist', [...DIST_FILES, 'manifest.json']), [...DIST_FILES, 'manifest.json'].sort());
  const manifestBytes = await regularFile(path.join(root, 'dist/manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['schemaVersion', 'milestone', 'mode', 'origin', 'files', 'contentSha256'].sort());
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.milestone, 'WEB-M1');
  assert.equal(manifest.mode, 'release'); assert.equal(manifest.origin, RELEASE.origin);
  const records = [];
  for (const file of DIST_FILES) {
    const bytes = await regularFile(path.join(root, 'dist', file));
    records.push({ path: file, bytes: bytes.length, sha256: sha256(bytes) });
  }
  assert.deepEqual(manifest.files, records, 'RELEASE_MANIFEST_MISMATCH');
  assert.equal(manifest.contentSha256, sha256(`${JSON.stringify(records)}\n`));
  for (const file of PUBLIC_FILES.filter(name => !name.endsWith('.html'))) {
    assert((await regularFile(path.join(root, 'public', file))).equals(await regularFile(path.join(root, 'dist', file))), 'RELEASE_ASSET_CHANGED');
  }
  assert((await regularFile(path.join(root, 'dist/assets/demo.wav'))).equals(Buffer.from(await demoBytes())), 'RELEASE_DEMO_CHANGED');
  for (const [file, route, language, home] of [
    ['index.html', '/', 'zh-Hant', 'https://glossquote.com/'],
    ['en/index.html', '/en/', 'en', 'https://glossquote.com/en/'],
  ]) {
    const htmlBytes = await regularFile(path.join(root, 'dist', file));
    const html = htmlBytes.toString('utf8');
    assert(html.includes(`<html lang="${language}">`));
    assert.equal((html.match(/<meta name="robots" content="index,follow">/g) ?? []).length, 1);
    assert(!html.includes('noindex') && !html.includes('__ROBOTS__') && !html.includes('__SEO_LINKS__'));
    assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1);
    assert(html.includes(`<link rel="canonical" href="${RELEASE.origin}${route}">`));
    for (const [lang, target] of [['zh-Hant', '/'], ['en', '/en/'], ['x-default', '/']]) {
      assert(html.includes(`<link rel="alternate" hreflang="${lang}" href="${RELEASE.origin}${target}">`));
    }
    assert.equal((html.match(/rel="alternate" hreflang=/g) ?? []).length, 3);
    assert(html.includes(`href="${home}"`));
    const publicHtml = (await regularFile(path.join(root, 'public', file))).toString('utf8');
    // Only the two approved release substitutions may change the public HTML.
    const expectedLinks = [
      `<link rel="canonical" href="${RELEASE.origin}${route}">`,
      `<link rel="alternate" hreflang="zh-Hant" href="${RELEASE.origin}/">`,
      `<link rel="alternate" hreflang="en" href="${RELEASE.origin}/en/">`,
      `<link rel="alternate" hreflang="x-default" href="${RELEASE.origin}/">`,
    ].join('\n  ');
    const expectedHtml = publicHtml.replace('__ROBOTS__', 'index,follow').replace('__SEO_LINKS__', expectedLinks);
    assert(htmlBytes.equals(Buffer.from(expectedHtml)), 'RELEASE_HTML_CHANGED');
    assert.equal(html.slice(html.indexOf('<body>')), publicHtml.slice(publicHtml.indexOf('<body>')), 'RELEASE_UI_CHANGED');
  }
  const expectedHeaders = `/*\n${Object.entries(REQUIRED_HEADERS).map(([name, value]) => `  ${name}: ${value}`).join('\n')}\n`;
  assert.equal((await regularFile(path.join(root, 'dist/_headers'))).toString('utf8'), expectedHeaders);
  assert.equal((await regularFile(path.join(root, 'dist/robots.txt'))).toString('utf8'), `User-agent: *\nAllow: /\nSitemap: ${RELEASE.origin}/sitemap.xml\n`);
  assert.equal((await regularFile(path.join(root, 'dist/sitemap.xml'))).toString('utf8'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${RELEASE.origin}/</loc></url><url><loc>${RELEASE.origin}/en/</loc></url></urlset>\n`);
  return { mode: manifest.mode, origin: manifest.origin, worker: RELEASE.worker, wranglerVersionRequired: RELEASE.wranglerVersion,
    files: records.length, contentSha256: manifest.contentSha256, manifestSha256: sha256(manifestBytes) };
}

export async function prepareRelease(root = ROOT) {
  assertRuntime();
  assertDeploymentConfig(JSON.parse((await regularFile(path.join(root, 'wrangler.jsonc'))).toString('utf8')));
  await buildWeb(root, buildSettings(['--mode=release', `--origin=${RELEASE.origin}`]));
  return verifyRelease(root);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 2) throw new Error('RELEASE_ARGUMENTS_NOT_ALLOWED');
    console.log(JSON.stringify({ status: 'PASS', ...await prepareRelease() }));
  } catch { console.error('RELEASE_FAILED'); process.exitCode = 1; }
}
