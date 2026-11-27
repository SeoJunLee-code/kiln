import type { Diag, Scene } from './scene.ts';
import { paintOf, suggest } from './scene.ts';
import { registry } from './world.ts';

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
  anim: ['sprite'],
  label: ['pos'],
  camera: ['pos'],
  eye: ['pos'],
  rot: ['pos', 'box'],
  quat: ['pos', 'box'],
  rigid: ['pos', 'box'],
  impulse: ['rigid'],
  force: ['rigid'],
};

/**
 * Mistakes that are not errors: the scene loads and runs, but part of it silently does
 * nothing. Each is a warning with a code, the entity, and what to add.
 * `exists` answers whether a file next to the scene is there; without it, file checks are skipped.
 * `text` is the scene as written, for what parsing does not keep (comments).
 */
export function lint(scene: Scene, file: string, exists?: (name: string) => boolean, text = ''): Diag[] {
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
    if (w.has(id, 'rigid') && !w.physics) warn('K316', `'${name}' has 'rigid' but the world has no physics backend, so it does nothing`, 'add physics=rapier to the world line');
    const sp = w.get(id, 'sprite');
    for (const field of ['image', 'mesh']) {
      const f = sp?.[field] as string | undefined;
      if (f && exists && !exists(f)) warn('K312', `sprite on '${name}' uses ${field} '${f}', which is not next to the scene`);
    }
    const an = w.get(id, 'anim');
    if (an && sp) {
      const n = an.frames as number, idle = an.idle as number;
      if (n < 1 || (an.fps as number) < 1 || idle < 0 || idle >= n) warn('K320', `anim on '${name}' has frames=${n} fps=${an.fps} idle=${idle}: frames and fps start at 1, and idle must leave at least one frame for moving`, 'e.g. anim 4 idle=1');
      else if (!sp.image) warn('K321', `'${name}' has 'anim' but its sprite has no image, so there are no frames to show`, `add image=SHEET.png to the sprite of '${name}'`);
      else if (idle && !w.has(id, 'vel')) warn('K322',`anim on '${name}' has idle=${idle} but '${name}' has no 'vel', so it never shows the moving frames`, `add vel to '${name}', or drop idle`);
      if (w.query('eye').length) warn('K323', `'${name}' has 'anim', but the scene is drawn in 3D, where sprites are boxes or meshes`);
    }
    for (const k of String(w.get(id, 'keep')?.what ?? '').split(',').filter(Boolean)) {
      if (!w.has(id, k) || k === 'tiles') warn('K324', `'${name}' keeps '${k}', ${k === 'tiles' ? 'which cannot be carried to another scene' : registry.has(k) ? `but has no '${k}'` : 'which is not a component'}, so nothing is carried`, k === 'tiles' ? undefined : registry.has(k) ? `add ${k} to '${name}'` : suggest(k, registry.keys()));
    }
    const so = w.get(id, 'sound');
    if (so) {
      if (id !== w.query('sound')[0]) warn('K327', `'${name}' has 'sound', but '${w.names[w.query('sound')[0]]}' has one already and only the first is used`, 'put every EVENT:FILE pair on one sound line');
      const emitted = new Set(['load', ...w.query('trigger').map((t) => w.get(t, 'trigger')!.event as string)]);
      const files = (so.on as string).split(',').filter(Boolean).map((pair) => {
        const [event, file, more] = pair.split(':');
        if (!event || !file || more !== undefined) return void warn('K325', `sound on '${name}' has '${pair}', which is not EVENT:FILE, so it plays nothing`, 'e.g. sound coin:coin.wav,hit:hit.wav');
        if (!scene.uses.length && !emitted.has(event)) warn('K326', `sound on '${name}' plays '${file}' on '${event}', which no trigger here emits`, suggest(event, emitted));
        return file;
      });
      for (const file of [...files, so.music as string]) {
        if (!file) continue;
        if (!/\.(wav|mp3|ogg)$/i.test(file)) warn('K325', `sound on '${name}' uses '${file}', which is not a .wav, .mp3 or .ogg file`);
        else if (exists && !exists(file)) warn('K312', `sound on '${name}' uses '${file}', which is not next to the scene`);
      }
    }
    const tl = w.get(id, 'tiles');
    if (tl?.paint) for (const [ch, [, image]] of paintOf(tl.paint as string)) {
      if (!(tl.rows as string).includes(ch)) warn('K317', `tiles on '${name}' paints '${ch}', which is in none of its rows`);
      if (!image) continue;
      if (exists && !exists(image)) warn('K312', `tiles on '${name}' paints '${ch}' with image '${image}', which is not next to the scene`);
      if (w.query('eye').length) warn('K318', `tiles on '${name}' paints '${ch}' with an image, but the scene is drawn in 3D, where only colors show`, `use a color, e.g. ${ch}:teal`);
    }
    if (w.has(id, 'ctrl') && w.get(id, 'ctrl')!.plane === 'xz' && !w.query('eye').length) {
      warn('K313', `'${name}' walks on the x/z plane but nothing has 'eye', so the player will draw it in 2D`, `add 'eye 0 -8 9' to '${name}'`);
    }
  });

  // A comment that starts where a component's first text value would go was probably meant
  // as the value: `sprite # red` has no glyph. (A tiles line keeps its '#', see parseScene.)
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s+([\w-]+)\s+#(?![\w-])/.exec(raw), first = m && m[1] !== 'tiles' ? registry.get(m[1])?.fields[0] : undefined;
    if (first?.type === 'str' && first.def !== undefined) {
      warn('K319', `line ${i + 1}: '#' after '${m![1]}' starts a comment, so ${first.name} is empty`, `for the character '#' write ${first.name}=#; put a comment on its own line`);
    }
  });
  if (!w.query('ctrl').length && scene.expects.some((e) => /^(reach|gone|event)\b/.test(e.text))) {
    warn('K314', `nothing has 'ctrl', so input cannot affect the scene and solve has nothing to steer`);
  }
  if (!scene.expects.length) warn('K300', `no expect lines: nothing says what "working" means`, 'add e.g. expect reach hero exit by 600');
  return out;
}

export const fmtWarn = (d: Diag): string => `W ${d.code} ${d.file} ${d.msg}${d.hint ? ` (hint: ${d.hint})` : ''}`;
