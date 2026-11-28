/**
 * Particles, 2D. They are a picture, not part of the game: nothing here is read by the
 * simulation, saved or hashed. Births come from the tick, the events and the entity's
 * name alone, so a replay or a rewind draws the same dots.
 */
import type { World } from '../src/world.ts';

const ONE = 65536, MOST = 2000;
interface Source { x: number; y: number; c: Record<string, unknown> }
interface Dot { x: number; y: number; vx: number; vy: number; g: number; born: number; life: number; size: number; color: string }
export interface Particles {
  reset(): void;
  /** Call once at the start and once after every step. */
  update(w: World): void;
  draw(g: CanvasRenderingContext2D, w: World, scale: number, ox: number, oy: number): void;
}

/** 0..1 from a name and two numbers: the same dot every time. */
const noise = (name: string, a: number, b: number): number => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  h = Math.imul(h ^ a, 2246822519);
  h = Math.imul(h ^ b ^ (h >>> 15), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function makeParticles(): Particles {
  let dots: Dot[] = [], heard = 0;
  // Where each emitter was a tick ago: one that is gone this tick still bursts where it was.
  let before = new Map<string, Source>();

  const born = (w: World, name: string, s: Source, count: number, from: number): void => {
    const n = (f: string): number => (s.c[f] as number) / ONE;
    for (let k = from; k < from + count; k++) {
      const turn = (n('angle') + (noise(name, w.tick, k * 3) - 0.5) * n('spread')) * (Math.PI / 180);
      const v = n('speed') * (0.5 + noise(name, w.tick, k * 3 + 1) / 2);
      const life = n('life') * (0.7 + noise(name, w.tick, k * 3 + 2) * 0.3);
      dots.push({ x: s.x, y: s.y, vx: Math.cos(turn) * v, vy: Math.sin(turn) * v, g: n('gravity'), born: w.tick, life, size: n('size'), color: s.c.color as string });
    }
  };

  return {
    reset(): void {
      dots = [];
      heard = 0;
      before = new Map();
    },
    update(w: World): void {
      const now = new Map<string, Source>();
      for (const id of w.query('particles', 'pos')) {
        const p = w.get(id, 'pos')!, b = w.get(id, 'box');
        const x = ((p.x as number) + ((b?.w as number) ?? 0) / 2) / ONE, y = ((p.y as number) + ((b?.h as number) ?? 0) / 2) / ONE;
        now.set(w.names[id]!, { x, y, c: w.get(id, 'particles')! });
      }
      dots = dots.filter((d) => w.tick - d.born < d.life * w.hz);
      for (const [name, s] of w.tick > 0 ? now : []) {
        const rate = Math.max(0, s.c.rate as number);
        born(w, name, s, Math.floor((w.tick * rate) / w.hz) - Math.floor(((w.tick - 1) * rate) / w.hz), 0);
      }
      // A rewind or a network rollback takes events back.
      heard = Math.min(heard, w.events.length);
      const all = heard < w.events.length ? new Map([...before, ...now]) : null;
      for (; heard < w.events.length; heard++) {
        const ev = w.events[heard];
        for (const [name, s] of all!) {
          // An event that names nobody (a script's) is for every emitter that listens.
          if (s.c.on === ev.name && ((!ev.a && !ev.b) || ev.a === name || ev.b === name)) born(w, name, s, s.c.count as number, 1000 + heard * 1000);
        }
      }
      before = now;
      if (dots.length > MOST) dots.splice(0, dots.length - MOST);
    },
    draw(g, w, scale, ox, oy): void {
      for (const d of dots) {
        const t = (w.tick - d.born) / w.hz, side = Math.max(1, d.size * scale);
        if (t >= d.life) continue;
        g.globalAlpha = Math.max(0, 1 - t / d.life);
        g.fillStyle = d.color;
        g.fillRect((d.x + d.vx * t) * scale + ox - side / 2, (d.y + d.vy * t + (d.g * t * t) / 2) * scale + oy - side / 2, side, side);
      }
      g.globalAlpha = 1;
    },
  };
}
