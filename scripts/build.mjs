import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, assertRuntime, inspectOutput, makeManifest, sha256, sourceBytes, verifyOutput } from './project-files.mjs';

try {
  assertRuntime();
  if (process.argv.length !== 2) throw new Error('ARGUMENTS_NOT_ALLOWED');
  const sources = await sourceBytes();
  await inspectOutput();
  await mkdir(path.join(ROOT, 'dist-core/core'), { recursive: true });
  const records = [];
  for (const { name, bytes } of sources) {
    await writeFile(path.join(ROOT, 'dist-core/core', name), bytes);
    records.push({ path: `core/${name}`, bytes: bytes.length, sha256: sha256(bytes) });
  }
  await writeFile(path.join(ROOT, 'dist-core/manifest.json'), `${JSON.stringify(makeManifest(records), null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'PASS', artifactType: 'offline-core-only', ...await verifyOutput() }));
} catch {
  console.error('BUILD_FAILED');
  process.exitCode = 1;
}
