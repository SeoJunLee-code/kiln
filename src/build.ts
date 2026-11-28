import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { physicsOf } from './physics.ts';
import { squeeze } from './squeeze.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** What a game folder may contribute to a build. Anything else (dotfiles, notes, keys) stays out of the published folder. */
export const ASSETS = /^[^.][^/\\]*\.(kiln|input|ts|svg|png|jpe?g|webp|gif|obj|gltf|glb|bin|json|mp3|ogg|wav|txt)$/i;

// What a backend's adapter loads at run time, relative to backends/NAME: the engine itself and its license.
const BACKEND_FILES: Record<string, string[]> = {
  rapier: ['node_modules/@dimforge/rapier3d-deterministic-compat/dist/rapier.mjs', 'node_modules/@dimforge/rapier3d-deterministic-compat/LICENSE'],
};

/**
 * The files a glTF model names beside itself (buffers and images), as paths from the game
 * folder. Exporters put textures in a subfolder, which the top-level rule above does not
 * reach, so `build` and `play` take these from the model. A name that leaves the folder,
 * is hidden or is not buffer or image data is in `refused` and is never published.
 */
export function sidecars(name: string, bytes: Uint8Array | null): { files: string[]; refused: string[] } {
  const files: string[] = [], refused: string[] = [];
  let json: any;
  try {
    // A .glb starts with a 12-byte header, and its first chunk is the JSON.
    const view = new DataView(bytes!.buffer, bytes!.byteOffset, bytes!.byteLength);
    const glb = bytes!.length >= 20 && view.getUint32(0, true) === 0x46546c67;
    json = JSON.parse(new TextDecoder().decode(glb ? bytes!.subarray(20, 20 + view.getUint32(12, true)) : bytes!));
  } catch { return { files, refused }; } // `check` says what is wrong with the model
  for (const { uri } of [...(json?.buffers ?? []), ...(json?.images ?? [])]) {
    if (typeof uri !== 'string' || uri.startsWith('data:')) continue;
    let rel: string;
    try { rel = posix.normalize(decodeURIComponent(uri)); } catch { refused.push(uri); continue; }
    const ok = !/[\\:]/.test(rel) && !rel.startsWith('/') && !rel.split('/').some((s) => s.startsWith('.')) && /\.(bin|png|jpe?g|webp)$/i.test(rel);
    (ok ? files : refused).push(ok ? rel : uri);
  }
  return { files, refused };
}

// A static host serves `.ts` with a non-script type, so built files are `.js` and say so in their imports.
const IMPORT = /((?:from|import)\s+')(\.\.?\/[^']+)\.ts'/g;
// `import('./x.ts')`: a part the player fetches only when a scene needs it.
const LAZY = /(import\(')(\.\.?\/[^']+)\.ts'/g;
const toJs = (code: string): string => stripTypeScriptTypes(code).replace(IMPORT, "$1$2.js'").replace(LAZY, "$1$2.js'");

/**
 * Engine modules a game may do without, and the part each belongs to. A game ships a
 * part only if it uses it (docs/EDITIONS.md, rule 4):
 *   3d    the 3D view and the two renderers: some scene or script has `eye`
 *   gltf  the glTF reader: a model file is in the game folder
 *   audio samples and music: some scene or script has `sound`
 *   rigid the engine's side of a physics backend: some scene names one
 *   nav   path finding: some scene or script has `nav`
 *   net   network play: some scene's world has players=2 or more
 * Scripts can add components while the game runs, so the test is on what the folder
 * holds, not on what one scene says at tick 0.
 */
const PARTS: Record<string, string> = { 'web/view3.ts': '3d', 'web/gpu.ts': '3d', 'web/gl.ts': '3d', 'web/gltf.ts': 'gltf', 'web/audio.ts': 'audio', 'src/rigid.ts': 'rigid', 'src/nav.ts': 'nav', 'web/netplay.ts': 'net', 'web/inspect.ts': 'play only' };

/**
 * Write a folder that any static web host can serve: the player, the engine modules it
 * needs, and every file next to the scene (scenes, scripts, images).
 *   OUT/index.html, OUT/config.json, OUT/engine/..., OUT/game/...
 * Returns the paths written, relative to OUT, and the names of files it left out.
 */
export function build(sceneFile: string, outDir: string): { written: string[]; skipped: string[]; parts: string[]; engineBytes: number } {
  const written: string[] = [];
  let engineBytes = 0;
  const put = (rel: string, data: string | Buffer): void => {
    const path = join(outDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    written.push(rel);
    if (rel.startsWith('engine/')) engineBytes += Buffer.byteLength(data);
  };

  const gameDir = dirname(resolve(sceneFile));
  const scenes: string[] = [];
  const skipped: string[] = [];
  const parts = new Set<string>();
  const copy = (rel: string): void => {
    if (written.includes(`game/${rel}`)) return;
    mkdirSync(dirname(join(outDir, 'game', rel)), { recursive: true });
    copyFileSync(join(gameDir, rel), join(outDir, 'game', rel));
    written.push(`game/${rel}`);
  };
  for (const f of readdirSync(gameDir).sort()) {
    const path = join(gameDir, f);
    if (!statSync(path).isFile()) continue;
    if (!ASSETS.test(f)) { skipped.push(f); continue; }
    if (/\.(gltf|glb)$/i.test(f)) parts.add('gltf');
    // `eye` as a component line in a scene, or as a quoted name in a script.
    if (/\.(kiln|ts)$/.test(f) && (f.endsWith('.ts') ? /['"`]eye['"`]/ : /^\s+eye(\s|$)/m).test(readFileSync(path, 'utf8'))) parts.add('3d');
    if (/\.(kiln|ts)$/.test(f) && (f.endsWith('.ts') ? /['"`]sound['"`]/ : /^\s+sound(\s|$)/m).test(readFileSync(path, 'utf8'))) parts.add('audio');
    if (/\.(kiln|ts)$/.test(f) && (f.endsWith('.ts') ? /['"`]nav['"`]/ : /^\s+nav(\s|$)/m).test(readFileSync(path, 'utf8'))) parts.add('nav');
    if (f.endsWith('.kiln')) scenes.push(f);
    if (f.endsWith('.kiln') && /^world\b.*\splayers=([2-9]|[1-9]\d)\b/m.test(readFileSync(path, 'utf8'))) parts.add('net');
    if (f.endsWith('.ts')) put(`game/${f.replace(/\.ts$/, '.js')}`, toJs(readFileSync(path, 'utf8')));
    else copy(f);
    if (/\.(gltf|glb)$/i.test(f)) for (const rel of sidecars(f, readFileSync(path)).files) if (rel.includes('/') && existsSync(join(gameDir, rel))) copy(rel);
  }

  // A scene that names a physics backend ships it, and the engine's side of it.
  const backends = new Set(scenes.map((f) => physicsOf(readFileSync(join(gameDir, f), 'utf8'))).filter((n) => n in BACKEND_FILES));
  for (const name of backends) { parts.add(name); parts.add('rigid'); }

  // Engine: what the player imports, found by following imports after types are stripped;
  // of the parts it fetches later, only the ones this game uses. Engine files go out
  // squeezed (no comments, no indentation); a game's own scripts go out as written.
  const todo = ['web/player.ts'], seen = new Set(todo);
  while (todo.length) {
    const rel = todo.pop()!;
    const js = stripTypeScriptTypes(readFileSync(join(ROOT, rel), 'utf8'));
    for (const m of [...js.matchAll(IMPORT), ...js.matchAll(LAZY)]) {
      const dep = posix.normalize(posix.join(posix.dirname(rel), `${m[2]}.ts`));
      if (seen.has(dep) || (dep in PARTS && !parts.has(PARTS[dep]))) continue;
      seen.add(dep);
      todo.push(dep);
    }
    put(`engine/${rel.replace(/\.ts$/, '.js')}`, squeeze(js.replace(IMPORT, "$1$2.js'").replace(LAZY, "$1$2.js'")));
  }

  for (const name of backends) {
    put(`engine/backends/${name}/index.js`, squeeze(toJs(readFileSync(join(ROOT, `backends/${name}/index.ts`), 'utf8'))));
    for (const rel of BACKEND_FILES[name]) {
      const from = join(ROOT, 'backends', name, rel);
      if (!existsSync(from)) throw new Error(`physics backend '${name}' is not installed (install it once: npm ci --prefix backends/${name})`);
      put(`engine/backends/${name}/${rel}`, readFileSync(from));
    }
  }

  put('index.html', readFileSync(join(ROOT, 'web/index.html'), 'utf8').replace('engine/web/player.ts', 'engine/web/player.js'));
  put('config.json', JSON.stringify({ scene: basename(sceneFile), input: false, built: true, scenes, nav: parts.has('nav') }));
  parts.delete('rigid'); // it is the backend's other half, not a part of its own
  return { written, skipped, parts: [...parts].sort(), engineBytes };
}
