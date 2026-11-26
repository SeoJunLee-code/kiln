import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Serve the web player for one scene. There is no build step: engine and game
 * `.ts` files are type-stripped on request and loaded by the browser as modules.
 *   /            player page
 *   /engine/...  files under the kiln folder (src/, web/)
 *   /game/...    files next to the scene (the scene itself and its scripts)
 *   /input       the input script given with --input, if any
 */
export function serve(sceneFile: string, inputFile: string | undefined, port: number): Promise<{ port: number; close: () => void }> {
  const gameDir = resolve(dirname(sceneFile));
  const config = JSON.stringify({ scene: basename(sceneFile), input: !!inputFile });

  const send = (res: import('node:http').ServerResponse, status: number, type: string, body: string): void => {
    res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
    res.end(body);
  };
  const file = (res: import('node:http').ServerResponse, base: string, rel: string): void => {
    const path = resolve(base, rel);
    if (path !== base && !path.startsWith(base + sep)) return send(res, 403, 'text/plain', 'outside the served folder');
    let text: string;
    try { text = readFileSync(path, 'utf8'); } catch { return send(res, 404, 'text/plain', `not found: ${rel}`); }
    if (path.endsWith('.ts')) return send(res, 200, 'text/javascript', stripTypeScriptTypes(text));
    send(res, 200, path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'text/plain', text);
  };

  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/') return file(res, ROOT, 'web/index.html');
    if (path === '/config.json') return send(res, 200, 'application/json', config);
    if (path === '/input' && inputFile) return file(res, dirname(resolve(inputFile)), basename(inputFile));
    if (path.startsWith('/engine/')) return file(res, ROOT, path.slice(8));
    if (path.startsWith('/game/')) return file(res, gameDir, path.slice(6));
    send(res, 404, 'text/plain', 'not found');
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok({ port: (server.address() as import('node:net').AddressInfo).port, close: () => { server.close(); server.closeAllConnections(); } }));
  });
}
