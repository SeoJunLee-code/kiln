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

// A static host serves `.ts` with a non-script type, so built files are `.js` and say so in their imports.
const IMPORT = /((?:from|import)\s+')(\.\.?\/[^']+)\.ts'/g;
// `import('./x.ts')`: a part the player fetches only when a scene needs it.
const LAZY = /(import\(')(\.\.?\/[^']+)\.ts'/g;
const toJs = (code: string): string => stripTypeScriptTypes(code).replace(IMPORT, "$1$2.js'").replace(LAZY, "$1$2.js'");

/**
 * Engine modules a game may do without, and the part each belongs to. A game ships a
 * part only if it uses it (docs/EDITIONS.md, rule 4):
 *   3d    the two renderers: some scene or script has `eye`
 *   gltf  the glTF reader: a model file is in the game folder
 * Scripts can add components while the game runs, so the test is on what the folder
 * holds, not on what one scene says at tick 0.
 */
const PARTS: Record<string, string> = { 'web/gpu.ts': '3d', 'web/gl.ts': '3d', 'web/gltf.ts': 'gltf' };

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
  for (const f of readdirSync(gameDir).sort()) {
    const path = join(gameDir, f);
    if (!statSync(path).isFile()) continue;
    if (!ASSETS.test(f)) { skipped.push(f); continue; }
    if (/\.(gltf|glb)$/i.test(f)) parts.add('gltf');
    // `eye` as a component line in a scene, or as a quoted name in a script.
    if (/\.(kiln|ts)$/.test(f) && (f.endsWith('.ts') ? /['"`]eye['"`]/ : /^\s+eye(\s|$)/m).test(readFileSync(path, 'utf8'))) parts.add('3d');
    if (f.endsWith('.kiln')) scenes.push(f);
    if (f.endsWith('.ts')) put(`game/${f.replace(/\.ts$/, '.js')}`, toJs(readFileSync(path, 'utf8')));
    else { mkdirSync(join(outDir, 'game'), { recursive: true }); copyFileSync(path, join(outDir, 'game', f)); written.push(`game/${f}`); }
  }

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

  // A scene that names a physics backend needs that backend's adapter and its engine file.
  for (const name of new Set(scenes.map((f) => physicsOf(readFileSync(join(gameDir, f), 'utf8'))).filter((n) => n in BACKEND_FILES))) {
    parts.add(name);
    put(`engine/backends/${name}/index.js`, squeeze(toJs(readFileSync(join(ROOT, `backends/${name}/index.ts`), 'utf8'))));
    for (const rel of BACKEND_FILES[name]) {
      const from = join(ROOT, 'backends', name, rel);
      if (!existsSync(from)) throw new Error(`physics backend '${name}' is not installed (install it once: npm ci --prefix backends/${name})`);
      put(`engine/backends/${name}/${rel}`, readFileSync(from));
    }
  }

  put('index.html', readFileSync(join(ROOT, 'web/index.html'), 'utf8').replace('engine/web/player.ts', 'engine/web/player.js'));
  put('config.json', JSON.stringify({ scene: basename(sceneFile), input: false, built: true, scenes }));
  return { written, skipped, parts: [...parts].sort(), engineBytes };
}
