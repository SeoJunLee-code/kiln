import type { Diag, Scene } from './scene.ts';
import { suggest } from './scene.ts';

// A component that does nothing unless these are on the same entity.
const NEEDS: Record<string, string[]> = {
  vel: ['pos'],
  box: ['pos'],
  solid: ['pos', 'box'],
  body: ['pos', 'vel'],
  ctrl: ['vel'],
  pace: ['pos', 'vel'],
  push: ['solid', 'box'],
  trigger: ['pos', 'box'],
  tiles: ['pos'],
  sprite: ['pos', 'box'],
  label: ['pos'],
  camera: ['pos'],
  eye: ['pos'],
  rot: ['pos', 'box'],
  quat: ['pos', 'box'],
};

/**
 * Mistakes that are not errors: the scene loads and runs, but part of it silently does
 * nothing. Each is a warning with a code, the entity, and what to add.
 * `exists` answers whether a file next to the scene is there; without it, file checks are skipped.
 */
export function lint(scene: Scene, file: string, exists?: (name: string) => boolean): Diag[] {
  const w = scene.world, out: Diag[] = [];
  const warn = (code: string, msg: string, hint?: string): void => void out.push({ code, file, line: 0, msg, hint });

  w.names.forEach((name, id) => {
    if (name == null) return;
    for (const [comp, needs] of Object.entries(NEEDS)) {
      if (!w.has(id, comp)) continue;
      const missing = needs.filter((n) => !w.has(id, n));
      if (missing.length) warn('K310', `'${name}' has '${comp}' but no ${missing.map((m) => `'${m}'`).join(' or ')}, so it does nothing`, `add ${missing.join(', ')} to '${name}'`);
    }
    const tr = w.get(id, 'trigger');
    if (tr) {
      const refs = [tr.target as string, ...(tr.action as string).split('+').filter((a) => a.startsWith('despawn:')).map((a) => a.slice(8))];
      for (const ref of refs) {
        if (!w.match(ref).length) warn('K311', `trigger on '${name}' refers to '${ref}', which matches no entity`, ref.startsWith('#') ? 'no entity has that tag' : suggest(ref, w.ids.keys()));
      }
      for (const a of (tr.action as string).split('+')) {
        if (a.startsWith('load:') && exists && !exists(a.slice(5))) warn('K312', `trigger on '${name}' loads '${a.slice(5)}', which is not next to the scene`);
      }
    }
    const sp = w.get(id, 'sprite');
    for (const field of ['image', 'mesh']) {
      const f = sp?.[field] as string | undefined;
      if (f && exists && !exists(f)) warn('K312', `sprite on '${name}' uses ${field} '${f}', which is not next to the scene`);
    }
    if (w.has(id, 'ctrl') && w.get(id, 'ctrl')!.plane === 'xz' && !w.query('eye').length) {
      warn('K313', `'${name}' walks on the x/z plane but nothing has 'eye', so the player will draw it in 2D`, `add 'eye 0 -8 9' to '${name}'`);
    }
  });

  if (!w.query('ctrl').length && scene.expects.some((e) => /^(reach|gone|event)\b/.test(e.text))) {
    warn('K314', `nothing has 'ctrl', so input cannot affect the scene and solve has nothing to steer`);
  }
  if (!scene.expects.length) warn('K300', `no expect lines: nothing says what "working" means`, 'add e.g. expect reach hero exit by 600');
  return out;
}

export const fmtWarn = (d: Diag): string => `W ${d.code} ${d.file} ${d.msg}${d.hint ? ` (hint: ${d.hint})` : ''}`;
