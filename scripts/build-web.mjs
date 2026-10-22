import { ROOT, assertRuntime } from './project-files.mjs';
import { buildSettings, buildWeb } from './web-project.mjs';
try {
  assertRuntime();
  const manifest = await buildWeb(ROOT, buildSettings(process.argv.slice(2)));
  console.log(JSON.stringify({ status: 'PASS', mode: manifest.mode, files: manifest.files.length, contentSha256: manifest.contentSha256 }));
} catch { console.error('WEB_BUILD_FAILED'); process.exitCode = 1; }
