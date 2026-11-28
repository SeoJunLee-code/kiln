// Rules a scene states as lines: `timer`, `when`, and the action `reset:`.
//
// A part of its own: loaded when a game uses one of them, others do not carry it. The
// step in sim.ts calls in here at fixed places, so the order of a tick is the same as
// when this was written into it.
import { ONE } from './fx.ts';
import { parseScene, serialize } from './scene.ts';
import { TIMER, WHEN, act, find, rules } from './sim.ts';
import { registry } from './world.ts';
import type { World } from './world.ts';

/** Does any rule of this world put things back? Then the scene as it began has to be kept. */
function resets(w: World): boolean {
  for (const comp of ['trigger', 'button', 'timer', 'when']) {
    const m = w.comps.get(comp);
    if (m) for (const c of m.values()) if ((c.action as string).includes('reset:')) return true;
  }
  return false;
}

// Parsed origins, by their text. Not on the World: solve keeps a great many of those.
const ORIGINS = new Map<string, World>();

/**
 * Put `ref` (a name, a #tag, or `all`) back to what the scene held when its run began:
 * every component as it was, and whoever was despawned since is there again. With `all`,
 * what the scene did not begin with leaves, and a tally that counts `cause` keeps its
 * number: the life just lost stays lost.
 */
function restore(w: World, ref: string, cause: string): void {
  if (!w.origin) return;
  let o = ORIGINS.get(w.origin);
  if (!o) {
    if (ORIGINS.size >= 8) ORIGINS.clear();
    ORIGINS.set(w.origin, o = parseScene(w.origin, 'origin').world);
  }
  const all = ref === 'all';
  const from = all ? o.names.map((n, i) => (n == null ? -1 : i)).filter((i) => i >= 0) : o.match(ref);
  for (const oid of from) {
    const name = o.names[oid]!;
    let id = w.ids.get(name);
    if (id === undefined) id = w.spawn(name);
    for (const comp of registry.keys()) {
      const then = o.get(oid, comp), now = w.get(id, comp);
      if (all && comp === 'tally' && now && then && now.event === cause) continue;
      if (then) w.add(id, comp, { ...then });
      // A rigid body gained these two while running; back at its start it is at rest and unturned.
      else if (now && comp === 'vel' && o.has(oid, 'rigid')) w.add(id, comp, { x: 0, y: 0, z: 0 });
      else if (now && comp === 'quat' && o.has(oid, 'rigid')) w.add(id, comp, { x: 0, y: 0, z: 0, w: ONE, sx: 0, sy: 0, sz: 0 });
      else if (now) w.drop(id, comp);
    }
    // Whatever it overlapped it may meet again.
    if (w.overlaps.size) for (const k of [...w.overlaps]) if (k.split(':').includes(name)) w.overlaps.delete(k);
  }
  if (all) for (let id = 0; id < w.names.length; id++) {
    const name = w.names[id];
    if (name != null && !o.ids.has(name)) w.despawn(id);
  }
}

/** A timer counts ticks down; at zero it emits its event once (or, with loop, starts over). */
function timers(w: World): void {
  for (let n = 0, ids = find(w, TIMER); n < ids.length; n++) {
    const id = ids[n];
    const t = w.get(id, 'timer')!;
    if (!t.on) continue;
    if ((t.left as number) < 0) t.left = Math.max(1, Math.round(((t.seconds as number) * w.hz) / ONE));
    if (t.left === 0) continue;
    t.left = (t.left as number) - 1;
    if (t.left !== 0) continue;
    if (t.loop) t.left = -1;
    w.events.push({ tick: w.tick, name: t.event as string, a: w.names[id]!, b: '' });
    act(w, t.action as string, id, undefined, w.names[id]!, t.event as string);
  }
}

/** A `when` answers the events numbered from..end with its action. */
function answer(w: World, from: number, end: number): void {
  for (let n = 0, ids = find(w, WHEN); n < ids.length; n++) {
    const id = ids[n];
    const wh = w.get(id, 'when')!;
    for (let i = from; i < end; i++) if (w.events[i].name === wh.event) act(w, wh.action as string, id, undefined, w.names[id]!, wh.event as string);
  }
}

// The scene as its run began, kept only when a rule can ask to go back to it.
rules.begin = (w) => (resets(w) ? serialize(w) : '');
rules.timers = timers;
rules.answer = answer;
rules.restore = restore;
