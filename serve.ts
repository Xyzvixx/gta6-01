// VICE BAY v2 — tiny static server for local playtesting (Node 22, stdlib only).
// Serves the repo root; the game page is reachable at /, /index.html and
// /game/, with ./src/... imports resolving in all three places.
// Usage: node serve.ts [--port <n>]  (default port 8080).

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const DEFAULT_PORT = 8080;
let port = DEFAULT_PORT;
const flagAt = process.argv.indexOf('--port');
if (flagAt >= 0 && process.argv[flagAt + 1]) {
  const wanted = Number.parseInt(process.argv[flagAt + 1], 10);
  if (Number.isInteger(wanted) && wanted > 0 && wanted < 65536) port = wanted;
}

const ROOT = resolve(import.meta.dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

function resolveRequestPath(rawPath) {
  let path = rawPath;
  // The game page lives at /game/index.html but is also served at the root,
  // so its relative ./src/... imports must resolve there too.
  if (path === '/' || path === '/index.html') path = '/game/index.html';
  if (path === '/game' || path === '/game/') path = '/game/index.html';
  if (path.startsWith('/src/')) path = '/game' + path;
  return join(ROOT, normalize(path));
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${port}`);
  const file = resolveRequestPath(decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
    return;
  }
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME_TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('read error\n');
  }
});

server.listen(port, () => {
  console.log(`VICE BAY v2 serving at http://localhost:${port}/`);
});
