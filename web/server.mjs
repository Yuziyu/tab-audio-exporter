// ローカル配信サーバ。getDisplayMedia / AudioWorklet はセキュアコンテキストが必要なため、
// file:// ではなく http://localhost で配信する。録音処理は extension/lib と共通。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP = [
  ['/lib/', path.join(root, 'extension/lib/')],
  ['/vendor/', path.join(root, 'extension/vendor/')],
  ['/', path.join(root, 'web/public/')],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    for (const [prefix, dir] of MAP) {
      if (!pathname.startsWith(prefix)) continue;
      const file = path.join(dir, pathname.slice(prefix.length));
      if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404);
    res.end('not found');
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8765);
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`Tab Audio Exporter (web): http://localhost:${port}/`);
  });
}
