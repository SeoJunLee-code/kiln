import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, resolve, sep } from 'node:path';
import { ASSETS } from './build.ts';
import { fileURLToPath } from 'node:url';

const TYPES: Record<string, string> = {
  html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml',
  gltf: 'model/gltf+json', glb: 'model/gltf-binary', bin: 'application/octet-stream',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg',
};
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The game as it was: the folder of another scene file, or this game at a git revision. */
function earlier(before: string, sceneFile: string): { scene: string; read: (rel: string) => Buffer | null } {
  if (/\.kiln$/.test(before) && existsSync(before)) {
    const dir = resolve(dirname(before));
    return { scene: basename(before), read: (rel) => { try { return readFileSync(resolve(dir, rel)); } catch { return null; } } };
  }
  const dir = resolve(dirname(sceneFile)), scene = basename(sceneFile);
  const read = (rel: string): Buffer | null => {
    try { return execFileSync('git', ['-C', dir, 'show', `${before}:./${rel}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 << 20 }); } catch { return null; }
  };
  // A revision is never an option of git.
  if (before.startsWith('-') || !read(scene)) throw new Error(`E K001 --before '${before}' is neither a scene file nor a git revision that has ${scene}`);
  return { scene, read };
}

/**
 * Serve the web player for one scene. There is no build step: engine and game
 * `.ts` files are type-stripped on request and loaded by the browser as modules.
 *   /            player page
 *   /engine/...  files under the kiln folder (src/, web/)
 *   /game/...    files next to the scene (the scene itself and its scripts)
 *   /input       the input script given with --input, if any
 * With `before` (a scene file, or a git revision of this one):
 *   /compare     the two side by side (web/compare.html)
 *   /before/...  the same pages and files as above, for the game as it was
 */
export function serve(sceneFile: string, inputFile: string | undefined, port: number, before?: string): Promise<{ port: number; close: () => void }> {
  const gameDir = resolve(dirname(sceneFile));
  const scenes = readdirSync(gameDir).filter((f) => f.endsWith('.kiln')).sort();
  const config = JSON.stringify({ scene: basename(sceneFile), input: !!inputFile, scenes });

  const old = before === undefined ? undefined : earlier(before, sceneFile);
  const send = (res: import('node:http').ServerResponse, status: number, type: string, body: string | Buffer): void => {
    res.writeHead(status, { 'content-type': /^(image\/(png|jpeg|webp|gif)|audio\/\w+|model\/gltf-binary|application\/octet-stream)$/.test(type) ? type : `${type}; charset=utf-8`, 'cache-control': 'no-store' });
    res.end(body);
  };
  const file = (res: import('node:http').ServerResponse, base: string, rel: string): void => {
    const path = resolve(base, rel);
    if (path !== base && !path.startsWith(base + sep)) return send(res, 403, 'text/plain', 'outside the served folder');
    let data: Buffer;
    try { data = readFileSync(path); } catch { return send(res, 404, 'text/plain', `not found: ${rel}`); }
    typed(res, path, data);
  };
  const typed = (res: import('node:http').ServerResponse, path: string, data: Buffer): void => {
    if (path.endsWith('.ts')) return send(res, 200, 'text/javascript', stripTypeScriptTypes(data.toString('utf8')));
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    send(res, 200, TYPES[ext] ?? 'text/plain', data);
  };

  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (old && path === '/compare') return file(res, ROOT, 'web/compare.html');
    if (old && path.startsWith('/before/')) {
      path = path.slice(7);
      if (path === '/config.json') return send(res, 200, 'application/json', JSON.stringify({ scene: old.scene, input: !!inputFile, scenes: [old.scene] }));
      if (path.startsWith('/game/')) {
        const rel = path.slice(6);
        if (!ASSETS.test(rel) || rel.split(/[\\/]/).includes('..')) return send(res, 403, 'text/plain', 'not a game asset');
        const data = old.read(rel);
        return data ? typed(res, rel, data) : send(res, 404, 'text/plain', `not found: ${rel}`);
      }
    }
    if (path === '/') return file(res, ROOT, 'web/index.html');
    if (path === '/config.json') return send(res, 200, 'application/json', config);
    if (path === '/input' && inputFile) return file(res, dirname(resolve(inputFile)), basename(inputFile));
    if (path.startsWith('/engine/')) return file(res, ROOT, path.slice(8));
    if (path.startsWith('/game/')) {
      // Same rule as `build`: only game assets, never dotfiles or stray files next to the scene.
      if (!ASSETS.test(path.slice(6))) return send(res, 403, 'text/plain', 'not a game asset');
      return file(res, gameDir, path.slice(6));
    }
    send(res, 404, 'text/plain', 'not found');
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok({ port: (server.address() as import('node:net').AddressInfo).port, close: () => { server.close(); server.closeAllConnections(); } }));
  });
}
