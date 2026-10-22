import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEMP_ROOT = path.join(ROOT, 'test/.tmp');
const FILES = ['controller.mjs', 'errors.mjs', 'plan.mjs', 'url.mjs'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  await mkdir(TEMP_ROOT, { recursive: true });
  assert.equal((await lstat(TEMP_ROOT)).isSymbolicLink(), false);
  const root = await mkdtemp(path.join(TEMP_ROOT, 'build-case-'));
  for (const rel of [...FILES.map(name => `src/core/${name}`),
    'scripts/build.mjs', 'scripts/project-files.mjs']) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), await readFile(path.join(ROOT, rel)));
  }
  return root;
}

async function cleanup(root) {
  // Only the exact mkdtemp child inside this tool's test directory is disposable.
  const absolute = path.resolve(root);
  const relative = path.relative(TEMP_ROOT, absolute);
  assert(!path.isAbsolute(relative) && /^build-case-[^/\\]+$/.test(relative));
  assert.equal((await lstat(absolute)).isSymbolicLink(), false);
  await rm(absolute, { recursive: true, force: true });
}

function run(script, cwd, args = []) {
  return spawnSync(process.execPath, [path.join(cwd, 'scripts', script), ...args], {
    cwd, shell: false, windowsHide: true, timeout: 10000, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('AC24 build emits only the four portable core files and byte/SHA manifest, deterministically', async () => {
  const root = await fixture();
  try {
    const first = run('build.mjs', root);
    assert.equal(first.status, 0, first.stderr);
    const rawManifest = await readFile(path.join(root, 'dist-core/manifest.json'));
    const manifest = JSON.parse(rawManifest);
    assert.equal(manifest.milestone, 'M0');
    assert.equal(manifest.artifactType, 'offline-core-only');
    assert.deepEqual(manifest.files.map(file => file.path),
      ['core/controller.mjs', 'core/errors.mjs', 'core/plan.mjs', 'core/url.mjs']);
    for (const file of manifest.files) {
      assert(!path.isAbsolute(file.path) && !file.path.includes('..') && !file.path.includes('\\'));
      const bytes = await readFile(path.join(root, 'dist-core', file.path));
      assert.equal(file.bytes, bytes.length);
      assert.equal(file.sha256, digest(bytes));
      assert.deepEqual(bytes, await readFile(path.join(root, 'src', file.path)));
    }
    const second = run('build.mjs', root);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(await readFile(path.join(root, 'dist-core/manifest.json')), rawManifest);
    assert.equal(JSON.parse(second.stdout).coreSha256, JSON.parse(first.stdout).coreSha256);
  } finally { await cleanup(root); }
});

test('AC24 unknown source/output files make build fail, preserving existing bytes', async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, 'src/core/unknown.mjs'), 'export const unexpected = true;\n');
    assert.equal(run('build.mjs', root).status, 1);
    await unlink(path.join(root, 'src/core/unknown.mjs'));
    await mkdir(path.join(root, 'dist-core'), { recursive: true });
    await writeFile(path.join(root, 'dist-core/unknown.txt'), 'preserve-fixture');
    assert.equal(run('build.mjs', root).status, 1);
    assert.equal(await readFile(path.join(root, 'dist-core/unknown.txt'), 'utf8'), 'preserve-fixture');
  } finally { await cleanup(root); }
});

test('AC24 build refuses a junction output root and never follows it', async () => {
  const root = await fixture();
  const link = path.join(root, 'dist-core');
  let linked = false;
  try {
    const target = path.join(root, 'target');
    await mkdir(target);
    await writeFile(path.join(target, 'sentinel.txt'), 'preserve-target');
    await symlink(target, link, 'junction');
    linked = true;
    assert.equal(run('build.mjs', root).status, 1);
    assert.equal(await readFile(path.join(target, 'sentinel.txt'), 'utf8'), 'preserve-target');
  } finally {
    if (linked) await unlink(link);
    await cleanup(root);
  }
});

test('AC24 check/build reject extra arguments with genuine nonzero exits', () => {
  for (const script of ['check.mjs', 'build.mjs']) {
    const result = run(script, ROOT, ['--unexpected']);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), script === 'check.mjs' ? 'CHECK_FAILED' : 'BUILD_FAILED');
  }
});
