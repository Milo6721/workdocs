// Lokalny serwer do testów: node dev-server.js  ->  http://localhost:3000
// Czyta klucz z pliku .env.local (patrz .env.example). Nie jest potrzebny na Vercelu.
const http = require('http');
const fs = require('fs');
const path = require('path');

try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* brak .env.local */ }

const handler = require('./api/ai.js');
const types = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/ai') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 200000) req.destroy(); });
    req.on('end', () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = null; }
      handler(req, res);
    });
    return;
  }
  const file = path.join(__dirname, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[\\/])+/, ''));
  if (!file.startsWith(__dirname) || /[\\/]\.env/.test(file)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(3000, () => console.log('Work Docs: http://localhost:3000'));
