// Local stand-in for Vercel: serves public/ and runs api/*.js handlers with
// an in-memory store. Usage: HOST_PIN=1234 npm run dev
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

async function runApi(req, res, name) {
  const mod = await import(join(ROOT, 'api', `${name}.js`));
  const handler = mod[req.method];
  if (!handler) return send(res, 405, 'text/plain', 'Method not allowed');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === 'GET' ? undefined : Buffer.concat(chunks),
  });
  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function send(res, status, type, body) {
  // Never cached, so an edited file shows up on the next reload.
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

async function serveStatic(res, pathname) {
  const clean = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const withExt = extname(clean) ? clean : `${clean}.html`;
  try {
    const file = await readFile(join(ROOT, 'public', withExt));
    send(res, 200, TYPES[extname(withExt)] ?? 'application/octet-stream', file);
  } catch {
    send(res, 404, 'text/plain', 'Not found');
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    const api = pathname.match(/^\/api\/([a-z]+)$/);
    await (api ? runApi(req, res, api[1]) : serveStatic(res, pathname));
  } catch (error) {
    console.error(error);
    send(res, 500, 'text/plain', 'Dev server error');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
