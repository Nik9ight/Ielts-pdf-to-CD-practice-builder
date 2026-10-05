import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html':'text/html', '.css':'text/css', '.mjs':'text/javascript', '.js':'text/javascript', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.bcmap':'application/octet-stream', '.ttf':'font/ttf', '.pfb':'application/octet-stream' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname.startsWith('/vendor/') ? 'node_modules/pdfjs-dist/'+pathname.slice(8) : 'dist/'+(pathname === '/' ? 'index.html' : pathname.slice(1));
    const file = path.resolve(root, relative);
    const allowed = pathname.startsWith('/vendor/') ? path.join(root,'node_modules/pdfjs-dist') : path.join(root,'dist');
    if (!file.startsWith(allowed+path.sep)) { res.writeHead(403).end(); return; }
    const data = await fs.readFile(file);
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'"});
    res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => console.log('Reading Practice is ready at http://127.0.0.1:'+server.address().port));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'The app may already be running. Open http://127.0.0.1:4173' : error.message); process.exitCode = 1; });
