import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { request } from 'node:http';
import { ROOT, sha256 } from '../scripts/project-files.mjs';
import { buildWeb, buildSettings, PUBLIC_FILES, SECURITY } from '../scripts/web-project.mjs';
import { createPreviewServer } from '../scripts/serve.mjs';
import { inspectMedia } from '../public/assets/media.mjs';

const TEMP = path.join(ROOT, 'test/.tmp');
async function fixture() {
  await mkdir(TEMP, { recursive: true });
  assert.equal((await lstat(TEMP)).isSymbolicLink(), false);
  const root = await mkdtemp(path.join(TEMP, 'web-case-'));
  for (const file of PUBLIC_FILES) { await mkdir(path.dirname(path.join(root, 'public', file)), { recursive: true }); await writeFile(path.join(root, 'public', file), await readFile(path.join(ROOT, 'public', file))); }
  return root;
}
async function cleanup(root) {
  assert(/^web-case-[^/\\]+$/.test(path.relative(TEMP, path.resolve(root))));
  assert.equal((await lstat(root)).isSymbolicLink(), false); await rm(root, { recursive: true, force: true });
}
test('WEB default preview noindex, closed assets, bilingual SEO and actual generated WAV bytes', async () => {
  const root = await fixture();
  try {
    const manifest = await buildWeb(root, buildSettings());
    assert.equal(manifest.mode, 'preview'); assert.equal(manifest.origin, null);
    assert.equal(manifest.files.length, 15);
    for (const file of manifest.files) { const bytes = await readFile(path.join(root, 'dist', file.path)); assert.equal(bytes.length, file.bytes); assert.equal(sha256(bytes), file.sha256); }
    for (const route of ['index.html', 'en/index.html']) {
      const html = await readFile(path.join(root, 'dist', route), 'utf8');
      assert(html.includes('noindex,nofollow')); assert(!html.includes('__SEO_')); assert(html.includes('hreflang="x-default"'));
      assert(html.includes(route.startsWith('en') ? 'href="https://glossquote.com/en/"' : 'href="https://glossquote.com/"'));
    }
    assert.equal(await readFile(path.join(root, 'dist/robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
    assert(!(await readFile(path.join(root, 'dist/sitemap.xml'), 'utf8')).includes('<url>'));
    const wav = new Uint8Array(await readFile(path.join(root, 'dist/assets/demo.wav')));
    assert.equal(inspectMedia(wav, 'audio/wav').container, 'wav'); assert.equal(wav.length, 8044);
    assert.equal(new DataView(wav.buffer).getUint32(24, true), 16000);
    assert.deepEqual(await buildWeb(root, buildSettings()), manifest);
  } finally { await cleanup(root); }
});
test('WEB release requires exact public HTTPS origin and emits consistent index/canonical/hreflang/robots/sitemap', async () => {
  for (const args of [['--mode=release'], ['--origin=https://media.glossquote.com'], ['--mode=bad'], ['--extra=true'],
    ['--mode=release', '--origin=http://media.glossquote.com'], ['--mode=release', '--origin=https://media.glossquote.com/'],
    ['--mode=release', '--origin=https://media.glossquote.com/path'], ['--mode=release', '--origin=https://media.glossquote.com?x=1'],
    ['--mode=release', '--origin=https://127.0.0.1'], ['--mode=preview', '--mode=release']]) assert.throws(() => buildSettings(args));
  const root = await fixture();
  try {
    await buildWeb(root, buildSettings(['--mode=release', '--origin=https://media.glossquote.com']));
    const en = await readFile(path.join(root, 'dist/en/index.html'), 'utf8');
    assert(en.includes('content="index,follow"')); assert(!en.includes('noindex'));
    assert(en.includes('rel="canonical" href="https://media.glossquote.com/en/"'));
    assert(en.includes('hreflang="zh-Hant" href="https://media.glossquote.com/"'));
    assert((await readFile(path.join(root, 'dist/robots.txt'), 'utf8')).includes('Sitemap: https://media.glossquote.com/sitemap.xml'));
    assert.equal((await readFile(path.join(root, 'dist/sitemap.xml'), 'utf8')).match(/<url>/g).length, 2);
  } finally { await cleanup(root); }
});
test('WEB build refuses unknown source/output and junctions without following or deleting them', async () => {
  const root = await fixture(); let linked = false; const link = path.join(root, 'dist');
  try {
    await writeFile(path.join(root, 'public/extra.mjs'), 'unexpected'); await assert.rejects(buildWeb(root, buildSettings()));
    await unlink(path.join(root, 'public/extra.mjs'));
    await mkdir(path.join(root, 'target')); await writeFile(path.join(root, 'target/sentinel'), 'preserve');
    await symlink(path.join(root, 'target'), link, 'junction'); linked = true;
    await assert.rejects(buildWeb(root, buildSettings())); assert.equal(await readFile(path.join(root, 'target/sentinel'), 'utf8'), 'preserve');
    await unlink(link); linked = false;
    await buildWeb(root, buildSettings()); await writeFile(path.join(root, 'dist/unknown'), 'keep');
    await assert.rejects(buildWeb(root, buildSettings())); assert.equal(await readFile(path.join(root, 'dist/unknown'), 'utf8'), 'keep');
  } finally { if (linked) await unlink(link); await cleanup(root); }
});
function get(port, target, { method = 'GET', host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: target, method, headers: { Host: host } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end();
  });
}
test('WEB loopback preview serves exact bytes/security headers; Host/method/traversal denied', async () => {
  const root = await fixture(); let server;
  try {
    await buildWeb(root, buildSettings()); server = await createPreviewServer(root);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port;
    const response = await get(port, '/assets/demo.wav'); assert.equal(response.status, 200);
    assert.deepEqual(response.bytes, await readFile(path.join(root, 'dist/assets/demo.wav')));
    assert.equal(response.headers['content-security-policy'], SECURITY['Content-Security-Policy']);
    assert.equal(response.headers['referrer-policy'], 'no-referrer'); assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal((await get(port, '/', { host: `localhost:${port}` })).status, 403);
    assert.equal((await get(port, '/', { method: 'POST' })).status, 405);
    assert.equal((await get(port, '/assets/../index.html')).status, 400);
    assert.equal((await get(port, '/%2e%2e/package.json')).status, 400);
    assert.equal((await get(port, '/package.json')).status, 404);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await cleanup(root); }
});
