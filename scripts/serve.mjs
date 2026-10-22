import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, regularFile, assertRuntime } from './project-files.mjs';
import { DIST_FILES, SECURITY, tree } from './web-project.mjs';

export async function createPreviewServer(root = ROOT) {
  await tree(root, 'dist', [...DIST_FILES, 'manifest.json']);
  return createServer(async (request, response) => {
    const headers = { ...SECURITY };
    const reply = (status, text) => { response.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); response.end(text); };
    const port = request.socket.localPort;
    if (request.headers.host !== `127.0.0.1:${port}`) { reply(403, 'Forbidden\n'); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { reply(405, 'Method not allowed\n'); return; }
    const raw = request.url.split('?')[0];
    if (raw.includes('%') || raw.includes('\\') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(raw)) { reply(400, 'Invalid path\n'); return; }
    const file = raw === '/' ? 'index.html' : raw === '/en/' ? 'en/index.html' : raw.slice(1);
    if (![...DIST_FILES, 'manifest.json'].includes(file) || file === '_headers') { reply(404, 'Not found\n'); return; }
    try {
      await tree(root, 'dist', [...DIST_FILES, 'manifest.json']);
      const bytes = await regularFile(path.join(root, 'dist', file));
      const type = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' }[path.extname(file)];
      response.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { reply(500, 'Preview unavailable\n'); }
  });
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    assertRuntime();
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && !/^--port=\d+$/.test(args[0]))) throw new Error('INVALID_ARGUMENTS');
    const port = args.length ? Number(args[0].split('=')[1]) : 4218;
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('INVALID_PORT');
    const server = await createPreviewServer();
    server.on('error', () => { console.error('PREVIEW_FAILED'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ status: 'ready', host: '127.0.0.1', port: server.address().port })));
  } catch { console.error('PREVIEW_FAILED'); process.exitCode = 1; }
}
