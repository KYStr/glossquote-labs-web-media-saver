import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CORE_FILES = Object.freeze(['controller.mjs', 'errors.mjs', 'plan.mjs', 'url.mjs']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function assertRuntime() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('NODE_24_REQUIRED');
}

export async function statIfPresent(filename) {
  try { return await lstat(filename); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function regularDirectory(directory) {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('DIRECTORY_UNSAFE');
  const actual = await realpath(directory);
  if (path.resolve(actual).toLowerCase() !== path.resolve(directory).toLowerCase()) throw new Error('DIRECTORY_UNSAFE');
}

export async function regularFile(filename) {
  const info = await lstat(filename);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('FILE_UNSAFE');
  return readFile(filename);
}

// Walk only this tool's explicitly selected directories, refusing links/reparse targets.
export async function filesIn(relative) {
  const directory = path.join(ROOT, relative);
  await regularDirectory(directory);
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const rel = `${relative}/${name}`;
    const info = await lstat(path.join(ROOT, rel));
    if (info.isSymbolicLink()) throw new Error('TREE_LINK_UNSAFE');
    if (info.isDirectory()) files.push(...await filesIn(rel));
    else if (info.isFile()) files.push(rel);
    else throw new Error('TREE_ENTRY_UNSAFE');
  }
  return files;
}

export async function sourceBytes() {
  await regularDirectory(ROOT);
  const actual = await filesIn('src');
  const expected = CORE_FILES.map(name => `src/core/${name}`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('CORE_ALLOWLIST_FAILED');
  const entries = [];
  for (const name of CORE_FILES) entries.push({ name, bytes: await regularFile(path.join(ROOT, 'src/core', name)) });
  return entries;
}

export async function inspectOutput() {
  const output = path.join(ROOT, 'dist-core');
  if (!await statIfPresent(output)) return false;
  await regularDirectory(output);
  const allowed = new Set(['core', 'manifest.json']);
  for (const name of await readdir(output)) {
    if (!allowed.has(name)) throw new Error('OUTPUT_ALLOWLIST_FAILED');
    const target = path.join(output, name);
    const info = await lstat(target);
    if (info.isSymbolicLink() || (name === 'core' ? !info.isDirectory() : !info.isFile())) {
      throw new Error('OUTPUT_UNSAFE');
    }
  }
  const core = path.join(output, 'core');
  if (await statIfPresent(core)) {
    await regularDirectory(core);
    for (const name of await readdir(core)) {
      if (!CORE_FILES.includes(name)) throw new Error('OUTPUT_ALLOWLIST_FAILED');
      await regularFile(path.join(core, name));
    }
  }
  return true;
}

export async function verifyOutput() {
  if (!await inspectOutput()) throw new Error('OUTPUT_MISSING');
  const files = await filesIn('dist-core');
  const expected = [...CORE_FILES.map(name => `dist-core/core/${name}`), 'dist-core/manifest.json'];
  if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error('OUTPUT_INCOMPLETE');
  const raw = await regularFile(path.join(ROOT, 'dist-core/manifest.json'));
  const manifest = JSON.parse(raw.toString('utf8'));
  const records = [];
  for (const name of CORE_FILES) {
    const bytes = await regularFile(path.join(ROOT, 'dist-core/core', name));
    const source = await regularFile(path.join(ROOT, 'src/core', name));
    if (!bytes.equals(source)) throw new Error('OUTPUT_SOURCE_MISMATCH');
    records.push({ path: `core/${name}`, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const expectedManifest = makeManifest(records);
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) throw new Error('MANIFEST_INVALID');
  return { files: records.length, manifestSha256: sha256(raw), coreSha256: manifest.coreSha256 };
}

export function makeManifest(files) {
  return { schemaVersion: 1, milestone: 'M0', artifactType: 'offline-core-only', node: '>=24.0.0',
    files, coreSha256: sha256(`${JSON.stringify(files)}\n`) };
}
