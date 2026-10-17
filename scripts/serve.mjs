// Локальный сервер для эфира: раздаёт собранную игру из dist/ и ретранслирует
// сообщения между игрой, панелью и оверлеем. Без зависимостей, кроме ws.
// Запуск: node scripts/serve.mjs [--port 8091] [--dir dist]
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { attachRelay } from './relay.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const port = Number(arg('--port', process.env.PORT ?? '8091'));
const host = arg('--host', '127.0.0.1');
const root = resolve(arg('--dir', 'dist'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.hdr': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function resolvePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0] ?? '/')).replace(/^(\.\.[/\\])+/, '');
  let p = join(root, clean);
  if (!p.startsWith(root)) return null;
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  else if (!existsSync(p) && existsSync(`${p}.html`)) p = `${p}.html`;
  else if (!existsSync(p) && existsSync(join(p, 'index.html'))) p = join(p, 'index.html');
  return existsSync(p) ? p : null;
}

const server = createServer((req, res) => {
  const file = resolvePath(req.url ?? '/');
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const immutable = file.includes(`${join(root, 'assets')}`) && /-[A-Za-z0-9_-]{8}\./.test(file);
  res.writeHead(200, {
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
});

attachRelay(server);

if (!existsSync(join(root, 'index.html'))) {
  console.error(`Нет ${join(root, 'index.html')} — сначала соберите игру: npm run build`);
  process.exit(1);
}

server.listen(port, host, () => {
  console.info(`Гонки на выживание: http://${host}:${port}/  (панель: /control, оверлей: /overlay)`);
});
