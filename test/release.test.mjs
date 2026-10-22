import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../scripts/project-files.mjs';
import { buildWeb, buildSettings, PUBLIC_FILES, DIST_FILES } from '../scripts/web-project.mjs';
import { RELEASE, assertDeploymentConfig, prepareRelease, verifyRelease } from '../scripts/release.mjs';

const TEMP = path.join(ROOT, 'test/.tmp');
const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture() {
  await mkdir(TEMP, { recursive: true });
  assert.equal((await lstat(TEMP)).isSymbolicLink(), false);
  const root = await mkdtemp(path.join(TEMP, 'release-case-'));
  const files = [...PUBLIC_FILES.map(file => `public/${file}`), 'wrangler.jsonc',
    'scripts/release.mjs', 'scripts/project-files.mjs', 'scripts/web-project.mjs'];
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), await readFile(path.join(ROOT, file)));
  }
  return root;
}
async function cleanup(root) {
  const absolute = path.resolve(root);
  assert(/^release-case-[^/\\]+$/.test(path.relative(TEMP, absolute)));
  assert.equal((await lstat(absolute)).isSymbolicLink(), false);
  await rm(absolute, { recursive: true, force: true });
}
async function rehash(root) {
  const filename = path.join(root, 'dist/manifest.json');
  const manifest = JSON.parse(await readFile(filename, 'utf8'));
  manifest.files = [];
  for (const file of DIST_FILES) {
    const bytes = await readFile(path.join(root, 'dist', file));
    manifest.files.push({ path: file, bytes: bytes.length, sha256: digest(bytes) });
  }
  manifest.contentSha256 = digest(`${JSON.stringify(manifest.files)}\n`);
  await writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`);
}
const config = JSON.parse(await readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
test('RELEASE config fixes the one approved asset-only target and disables telemetry/observation', () => {
  assert.equal(config.name, 'glossquote-web-media-saver'); assert.equal(config.compatibility_date, '2026-10-22');
  assert.deepEqual(config.routes, [{ pattern: 'media.glossquote.com', custom_domain: true }]);
  assert.deepEqual(config.assets, { directory: './dist', run_worker_first: false,
    html_handling: 'auto-trailing-slash', not_found_handling: 'none' });
  assert.equal(config.build.command, 'node scripts/release.mjs');
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false); assert.equal(config.send_metrics, false);
  assert.deepEqual(config.observability, { enabled: false, logs: { enabled: false, invocation_logs: false }, traces: { enabled: false } });
  assert.equal(RELEASE.wranglerVersion, '4.147.0'); assertDeploymentConfig(config);
});
test('RELEASE rejects alternate workers/domains, runtime/resources, telemetry and downloading build hooks', () => {
  const changes = [
    value => { value.name = 'different-worker'; }, value => { value.routes[0].pattern = 'other.glossquote.com'; },
    value => { value.routes.push({ pattern: 'extra.glossquote.com', custom_domain: true }); },
    value => { value.routes[0].custom_domain = false; }, value => { value.compatibility_date = '2026-10-21'; },
    value => { value.main = 'worker.mjs'; }, value => { value.vars = {}; }, value => { value.kv_namespaces = []; },
    value => { value.r2_buckets = []; }, value => { value.services = []; }, value => { value.workers_dev = true; },
    value => { value.preview_urls = true; }, value => { value.send_metrics = true; },
    value => { value.observability.enabled = true; }, value => { value.observability.logs.enabled = true; },
    value => { value.observability.logs.invocation_logs = true; }, value => { value.observability.traces.enabled = true; },
    value => { value.build.command = 'npx wrangler deploy'; }, value => { value.assets.directory = '../other/dist'; },
    value => { value.assets.run_worker_first = true; }, value => { value.assets.html_handling = 'none'; },
    value => { value.assets.not_found_handling = 'single-page-application'; },
  ];
  for (const change of changes) { const value = structuredClone(config); change(value); assert.throws(() => assertDeploymentConfig(value)); }
});
test('RELEASE builds exact production SEO, headers, closed byte hashes and unchanged application assets', async () => {
  const root = await fixture();
  try {
    const result = await prepareRelease(root);
    assert.equal(result.origin, 'https://media.glossquote.com'); assert.equal(result.mode, 'release'); assert.equal(result.files, 15);
    for (const [file, route, language, home] of [['index.html', '/', 'zh-Hant', 'https://glossquote.com/'],
      ['en/index.html', '/en/', 'en', 'https://glossquote.com/en/']]) {
      const html = await readFile(path.join(root, 'dist', file), 'utf8');
      assert(html.includes(`<html lang="${language}">`)); assert(html.includes('name="robots" content="index,follow"'));
      assert(!html.includes('noindex')); assert(html.includes(`rel="canonical" href="https://media.glossquote.com${route}"`));
      for (const [lang, target] of [['zh-Hant', '/'], ['en', '/en/'], ['x-default', '/']]) {
        assert(html.includes(`hreflang="${lang}" href="https://media.glossquote.com${target}"`));
      }
      assert(html.includes(`href="${home}"`));
    }
    assert.equal(await readFile(path.join(root, 'dist/robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\nSitemap: https://media.glossquote.com/sitemap.xml\n');
    const sitemap = await readFile(path.join(root, 'dist/sitemap.xml'), 'utf8');
    assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), ['https://media.glossquote.com/', 'https://media.glossquote.com/en/']);
    const headers = await readFile(path.join(root, 'dist/_headers'), 'utf8');
    for (const rule of ["script-src 'self'", "style-src 'self'", "connect-src 'self' https:", 'media-src blob:', "frame-ancestors 'none'",
      'Referrer-Policy: no-referrer', 'X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY']) assert(headers.includes(rule));
    const manifest = JSON.parse(await readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
    for (const file of manifest.files) { const bytes = await readFile(path.join(root, 'dist', file.path)); assert.equal(file.bytes, bytes.length); assert.equal(file.sha256, digest(bytes)); }
    assert.equal(digest(await readFile(path.join(root, 'dist/assets/demo.wav'))), 'faa5d5d0760bea6b5860a1fbbd3e655b6ef4d192b2ba26c9003dcee7e85c46c6');
    assert.deepEqual(await verifyRelease(root), result);
  } finally { await cleanup(root); }
});
test('RELEASE keeps ordinary preview noindex and refuses it as production', async () => {
  const root = await fixture();
  try {
    await buildWeb(root, buildSettings());
    assert((await readFile(path.join(root, 'dist/index.html'), 'utf8')).includes('noindex,nofollow'));
    assert.equal(await readFile(path.join(root, 'dist/robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
    await assert.rejects(verifyRelease(root));
    await prepareRelease(root); assert.equal((await verifyRelease(root)).mode, 'release');
  } finally { await cleanup(root); }
});
for (const [name, file, alter] of [
  ['weakened CSP', '_headers', text => text.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")],
  ['wrong canonical origin', 'en/index.html', text => text.replace('href="https://media.glossquote.com/en/"', 'href="https://other.glossquote.com/en/"')],
  ['noindex production', 'index.html', text => text.replace('content="index,follow"', 'content="noindex,nofollow"')],
  ['wrong English home', 'en/index.html', text => text.replaceAll('https://glossquote.com/en/', 'https://glossquote.com/')],
  ['modified body', 'index.html', text => text.replace('<body>', '<body><p>Unexpected content</p>')],
  ['modified application asset', 'assets/style.css', text => `${text}\n/* unexpected change */\n`],
  ['wrong robots', 'robots.txt', text => text.replace('Allow: /', 'Disallow: /')],
  ['wrong sitemap', 'sitemap.xml', text => text.replace('https://media.glossquote.com/en/', 'https://other.glossquote.com/en/')],
]) test(`RELEASE rejects ${name} even when the output manifest was rehashed`, async () => {
  const root = await fixture();
  try {
    await prepareRelease(root); const filename = path.join(root, 'dist', file);
    await writeFile(filename, alter(await readFile(filename, 'utf8'))); await rehash(root); await assert.rejects(verifyRelease(root));
  } finally { await cleanup(root); }
});
for (const file of ['index.html', 'en/index.html']) {
  for (const [name, alter] of [
    ['additional robots NOINDEX', html => html.replace('</head>', '<meta name="robots" content="NOINDEX">\n</head>')],
    ['additional robots none', html => html.replace('</head>', '<meta name="robots" content="none">\n</head>')],
    ['additional googlebot NOINDEX', html => html.replace('</head>', '<meta name="googlebot" content="NOINDEX">\n</head>')],
    ['second canonical with single quotes', html => html.replace('</head>', "<link rel='canonical' href='https://example.com/wrong'>\n</head>")],
    ['removed viewport', html => html.replace(/  <meta name="viewport"[^>]+>\n/, '')],
    ['changed charset', html => html.replace('charset="utf-8"', 'charset="windows-1252"')],
    ['changed title', html => html.replace(/<title>[^<]*<\/title>/, '<title>Unapproved title</title>')],
    ['removed description', html => html.replace(/  <meta name="description"[^>]+>\n/, '')],
  ]) test(`RELEASE rejects ${file} ${name} with unchanged body and a self-consistent rehashed manifest`, async () => {
    const root = await fixture();
    try {
      await prepareRelease(root);
      const filename = path.join(root, 'dist', file);
      const before = await readFile(filename, 'utf8');
      const after = alter(before);
      assert.notEqual(after, before, 'HEAD_MUTATION_DID_NOT_APPLY');
      assert.equal(after.slice(after.indexOf('<body>')), before.slice(before.indexOf('<body>')), 'BODY_MUTATED');
      await writeFile(filename, after);
      await rehash(root);
      const manifest = JSON.parse(await readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
      const records = [];
      for (const output of DIST_FILES) {
        const bytes = await readFile(path.join(root, 'dist', output));
        records.push({ path: output, bytes: bytes.length, sha256: digest(bytes) });
      }
      assert.deepEqual(manifest.files, records, 'MUTATION_MANIFEST_NOT_SELF_CONSISTENT');
      assert.equal(manifest.contentSha256, digest(`${JSON.stringify(records)}\n`));
      assert.notEqual(manifest.files.find(item => item.path === file).sha256, digest(before));
      await assert.rejects(verifyRelease(root), { code: 'ERR_ASSERTION', message: 'RELEASE_HTML_CHANGED' });
    } finally { await cleanup(root); }
  });
}
test('RELEASE rejects altered config before writing output, unknown output and extra manifest fields', async () => {
  const root = await fixture();
  try {
    const bad = { ...config, main: 'worker.mjs' }; await writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify(bad));
    await assert.rejects(prepareRelease(root)); await writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify(config));
    await prepareRelease(root); await writeFile(path.join(root, 'dist/extra.txt'), 'not approved'); await assert.rejects(verifyRelease(root));
    await rm(path.join(root, 'dist/extra.txt'));
    const filename = path.join(root, 'dist/manifest.json'); const manifest = JSON.parse(await readFile(filename, 'utf8'));
    manifest.extra = true; await writeFile(filename, JSON.stringify(manifest)); await assert.rejects(verifyRelease(root));
  } finally { await cleanup(root); }
});
test('RELEASE CLI has no deployment or origin override; fixed command rebuilds with no dependencies', async () => {
  const root = await fixture();
  const run = args => spawnSync(process.execPath, [path.join(root, 'scripts/release.mjs'), ...args], {
    cwd: root, shell: false, windowsHide: true, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const denied = run(['--origin=https://other.glossquote.com']); assert.equal(denied.status, 1); assert.equal(denied.stderr.trim(), 'RELEASE_FAILED');
    const built = run([]); assert.equal(built.status, 0, built.stderr);
    const { status, ...result } = JSON.parse(built.stdout); assert.equal(status, 'PASS');
    assert.equal(result.origin, 'https://media.glossquote.com'); assert.equal(result.wranglerVersionRequired, '4.147.0');
    assert.deepEqual(await verifyRelease(root), result);
  } finally { await cleanup(root); }
});
