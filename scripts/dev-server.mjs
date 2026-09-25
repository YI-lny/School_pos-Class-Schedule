/**
 * 零依赖静态开发服务器。
 *
 * 为什么不用 Vite：本项目是纯原生 ES Module + CSS，没有任何构建步骤，
 * 因此不需要 node_modules 也能跑起来（离线可用）。
 * 如果你之后想用 Vite / 任意静态服务器，直接指向项目根目录即可，
 * 因为 index.html 中的引用都是相对路径。
 *
 * 用法：
 *   node scripts/dev-server.mjs            # 默认 http://127.0.0.1:5173
 *   PORT=6000 node scripts/dev-server.mjs  # 指定端口
 *   node scripts/dev-server.mjs --host     # 监听 0.0.0.0（手机同局域网调试）
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const args = new Set(process.argv.slice(2));
const HOST = args.has('--host') ? '0.0.0.0' : '127.0.0.1';
const BASE_PORT = Number(process.env.PORT || 5173);
const MAX_PORT_TRIES = 10;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** 把 URL 路径安全地映射到磁盘路径（阻止 ../ 越界）。 */
function resolveTarget(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const normalized = normalize(clean).replace(/^([/\\])+/, '');
  const abs = resolve(ROOT, normalized);
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null;
  return abs;
}

async function statSafe(p) {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  let target = resolveTarget(req.url || '/');
  if (!target) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let info = await statSafe(target);
  if (info?.isDirectory()) {
    target = join(target, 'index.html');
    info = await statSafe(target);
  }

  if (!info?.isFile()) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<meta charset="utf-8"><body style="font:16px/1.6 system-ui;padding:40px">
       <h1>404</h1><p>找不到 <code>${decodeURIComponent(req.url || '')}</code></p>
       <p><a href="/">回到课表首页</a></p></body>`,
    );
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
});

let attempt = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_TRIES) {
    attempt += 1;
    const next = BASE_PORT + attempt;
    console.log(`端口 ${BASE_PORT + attempt - 1} 被占用，尝试 ${next} ...`);
    server.listen(next, HOST);
    return;
  }
  console.error(err);
  process.exit(1);
});

server.on('listening', () => {
  const { port } = server.address();
  console.log('');
  console.log('  课程表开发服务器已启动');
  console.log(`  ➜  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${port}/`);
  console.log(`  ➜  根目录 ${ROOT}`);
  console.log('  （Ctrl+C 停止）');
  console.log('');
});

server.listen(BASE_PORT, HOST);
