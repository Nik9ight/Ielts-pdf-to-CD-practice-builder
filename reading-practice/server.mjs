import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
// Folder scanned for practice PDFs. Defaults to the folder above this app; override with PDF_DIR=/path/to/pdfs.
const pdfDir = path.resolve(process.env.PDF_DIR || path.join(root, '..'));
const types = { '.html':'text/html', '.css':'text/css', '.mjs':'text/javascript', '.js':'text/javascript', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.bcmap':'application/octet-stream', '.ttf':'font/ttf', '.pfb':'application/octet-stream', '.pdf':'application/pdf' };
const headers = { 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'" };

async function findPdfs(dir, depth = 0) {
  if (depth > 3) return [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await findPdfs(full, depth + 1));
    else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
      const stat = await fs.stat(full);
      found.push({ id: path.relative(pdfDir, full).split(path.sep).join('/'), name: entry.name, folder: path.relative(pdfDir, dir).split(path.sep).join('/'), size: stat.size });
    }
  }
  return found;
}

function send(res, status, body, type) {
  res.writeHead(status, { ...headers, ...(type ? { 'Content-Type': type } : {}) });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/api/library') {
      const pdfs = (await findPdfs(pdfDir)).sort((a, b) => a.id.localeCompare(b.id));
      send(res, 200, JSON.stringify({ folder: pdfDir, pdfs }), 'application/json');
      return;
    }
    if (pathname === '/api/pdf') {
      const file = path.resolve(pdfDir, url.searchParams.get('id') || '');
      if (!file.startsWith(pdfDir + path.sep) || !/\.pdf$/i.test(file)) { send(res, 403); return; }
      send(res, 200, await fs.readFile(file), 'application/pdf');
      return;
    }
    const relative = pathname.startsWith('/vendor/') ? 'node_modules/pdfjs-dist/' + pathname.slice(8) : 'dist/' + (pathname === '/' ? 'index.html' : pathname.slice(1));
    const file = path.resolve(root, relative);
    const allowed = pathname.startsWith('/vendor/') ? path.join(root, 'node_modules/pdfjs-dist') : path.join(root, 'dist');
    if (!file.startsWith(allowed + path.sep)) { send(res, 403); return; }
    send(res, 200, await fs.readFile(file), types[path.extname(file)] || 'application/octet-stream');
  } catch { send(res, 404, 'Not found'); }
});
server.listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => {
  console.log('Reading Practice is ready at http://127.0.0.1:' + server.address().port);
  console.log('Practice PDFs are read from ' + pdfDir);
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'The app may already be running. Open http://127.0.0.1:4173' : error.message); process.exitCode = 1; });
