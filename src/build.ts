import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** What a game folder may contribute to a build. Anything else (dotfiles, notes, keys) stays out of the published folder. */
export const ASSETS = /^[^.][^/\\]*\.(kiln|input|ts|svg|png|jpe?g|webp|gif|obj|gltf|glb|bin|json|mp3|ogg|wav|txt)$/i;

// A static host serves `.ts` with a non-script type, so built files are `.js` and say so in their imports.
const IMPORT = /((?:from|import)\s+')(\.\.?\/[^']+)\.ts'/g;
const toJs = (code: string): string => stripTypeScriptTypes(code).replace(IMPORT, "$1$2.js'");

/**
 * Write a folder that any static web host can serve: the player, the engine modules it
 * needs, and every file next to the scene (scenes, scripts, images).
 *   OUT/index.html, OUT/config.json, OUT/engine/..., OUT/game/...
 * Returns the paths written, relative to OUT, and the names of files it left out.
 */
export function build(sceneFile: string, outDir: string): { written: string[]; skipped: string[] } {
  const written: string[] = [];
  const put = (rel: string, data: string | Buffer): void => {
    const path = join(outDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    written.push(rel);
  };

  // Engine: only what the player imports, found by following imports after types are stripped.
  const todo = ['web/player.ts'], seen = new Set(todo);
  while (todo.length) {
    const rel = todo.pop()!;
    const js = stripTypeScriptTypes(readFileSync(join(ROOT, rel), 'utf8'));
    for (const m of js.matchAll(IMPORT)) {
      const dep = posix.normalize(posix.join(posix.dirname(rel), `${m[2]}.ts`));
      if (!seen.has(dep)) { seen.add(dep); todo.push(dep); }
    }
    put(`engine/${rel.replace(/\.ts$/, '.js')}`, js.replace(IMPORT, "$1$2.js'"));
  }

  const gameDir = dirname(resolve(sceneFile));
  const scenes: string[] = [];
  const skipped: string[] = [];
  for (const f of readdirSync(gameDir).sort()) {
    const path = join(gameDir, f);
    if (!statSync(path).isFile()) continue;
    if (!ASSETS.test(f)) { skipped.push(f); continue; }
    if (f.endsWith('.kiln')) scenes.push(f);
    if (f.endsWith('.ts')) put(`game/${f.replace(/\.ts$/, '.js')}`, toJs(readFileSync(path, 'utf8')));
    else { mkdirSync(join(outDir, 'game'), { recursive: true }); copyFileSync(path, join(outDir, 'game', f)); written.push(`game/${f}`); }
  }

  put('index.html', readFileSync(join(ROOT, 'web/index.html'), 'utf8').replace('engine/web/player.ts', 'engine/web/player.js'));
  put('config.json', JSON.stringify({ scene: basename(sceneFile), input: false, built: true, scenes }));
  return { written, skipped };
}
