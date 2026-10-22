import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, CORE_FILES, assertRuntime, filesIn, regularFile, sourceBytes } from './project-files.mjs';
import { checkWeb } from './web-project.mjs';

try {
  assertRuntime();
  assert.equal(process.argv.length, 2, 'ARGUMENTS_NOT_ALLOWED');
  const packageData = JSON.parse((await regularFile(path.join(ROOT, 'package.json'))).toString('utf8'));
  assert.equal(packageData.private, true);
  assert.equal(packageData.type, 'module');
  assert.deepEqual(packageData.engines, { node: '>=24.0.0' });
  assert.deepEqual(packageData.scripts, {
    test: 'node --test --test-concurrency=1 test/*.test.mjs',
    check: 'node scripts/check.mjs', build: 'node scripts/build-web.mjs', serve: 'node scripts/serve.mjs',
  });
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(packageData[field] ?? {}, {}, 'DEPENDENCIES_NOT_ALLOWED');
  }
  assert.equal(packageData.bundleDependencies, undefined);
  assert.equal(packageData.bundledDependencies, undefined);
  const sources = await sourceBytes();
  const allowedImports = new Set(CORE_FILES.map(name => `./${name}`));
  for (const { bytes } of sources) {
    const text = bytes.toString('utf8');
    // This is an auditable closed-source check, not a JavaScript sandbox.
    assert.doesNotMatch(text, /\b(?:fetch|eval|Function|require|WebSocket|XMLHttpRequest)\s*\(/);
    assert.doesNotMatch(text, /\b(?:process|console|globalThis|navigator|window|document|localStorage)\s*(?:\.|\[)/);
    assert.doesNotMatch(text, /\bimport\s*\(/);
    for (const match of text.matchAll(/\b(?:import|export)\s[^;]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
      assert(allowedImports.has(match[1]), 'CORE_IMPORT_NOT_ALLOWED');
    }
    assert.doesNotMatch(text, /\bimport\s*['"]/);
  }
  const webFiles = await checkWeb(ROOT);
  const esmFiles = [...(await Promise.all(['src', 'test', 'scripts'].map(filesIn))).flat(),
    ...webFiles.filter(file => file.endsWith('.mjs')).map(file => `public/${file}`)];
  assert(esmFiles.length > CORE_FILES.length);
  for (const rel of esmFiles) {
    assert(rel.endsWith('.mjs'), 'ESM_ONLY');
    const result = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], {
      cwd: ROOT, windowsHide: true, shell: false, encoding: 'utf8', timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, 'SYNTAX_CHECK_FAILED');
  }
  const urlApi = await import('../src/core/url.mjs');
  const planApi = await import('../src/core/plan.mjs');
  const controllerApi = await import('../src/core/controller.mjs');
  const errorApi = await import('../src/core/errors.mjs');
  assert.deepEqual(Object.keys(urlApi), ['classifyUrl']);
  assert.deepEqual(Object.keys(planApi), ['makePlan']);
  assert.deepEqual(Object.keys(controllerApi), ['ADAPTER_SCHEMAS', 'createController']);
  assert.deepEqual(Object.keys(errorApi), ['CoreError', 'ERROR_CODES', 'readDataRecord', 'toErrorCode']);
  const never = () => new Promise(() => {});
  const controller = controllerApi.createController({ adapter: { inspect: never, download: never, verify: never, stop: never } });
  assert.deepEqual(Object.keys(controller).sort(), ['cancel', 'clear', 'getState', 'start']);
  assert.equal(controller.getState().status, 'idle');
  console.log(JSON.stringify({ status: 'PASS', esmFiles: esmFiles.length, coreFiles: sources.length, webFiles: webFiles.length, externalDependencies: 0 }));
} catch {
  console.error('CHECK_FAILED');
  process.exitCode = 1;
}
