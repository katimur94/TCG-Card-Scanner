// Kleiner statischer Server für die Tests: liefert unter /TCG-Card-Scanner/ (wie GitHub Pages) aus.
// Mehrere Wurzeln möglich (die erste, die die Datei hat, gewinnt). Die Wurzeln lassen sich zur Laufzeit
// über /__roots?set=a,b umstellen – so testet der Update-Test „alte App -> neue App“ am selben Origin.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const PREFIX = '/TCG-Card-Scanner/';
let roots = (process.argv[2] || 'dist').split(',').map((r) => resolve(r));
const port = Number(process.argv[3] || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.map': 'application/json',
};

async function find(rel) {
  for (const root of roots) {
    const p = normalize(join(root, rel));
    if (!p.startsWith(root)) return null;
    try {
      const s = await stat(p);
      if (s.isFile()) return p;
      if (s.isDirectory()) {
        const idx = join(p, 'index.html');
        if ((await stat(idx).catch(() => null))?.isFile()) return idx;
      }
    } catch {
      /* nächste Wurzel */
    }
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__roots') {
    roots = (url.searchParams.get('set') || '')
      .split(',')
      .filter(Boolean)
      .map((r) => resolve(r));
    res.end(JSON.stringify(roots));
    return;
  }
  if (!url.pathname.startsWith(PREFIX)) {
    res.writeHead(302, { location: PREFIX });
    res.end();
    return;
  }
  const file = await find(decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html');
  if (!file) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(await readFile(file));
}).listen(port, () => console.log(`serving ${roots.join(', ')} on http://localhost:${port}${PREFIX}`));
