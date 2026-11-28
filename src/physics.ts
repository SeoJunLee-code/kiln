// Rigid bodies, through a backend. The engine does not solve rigid-body physics itself:
// an existing engine does, behind the small interface below, and this file keeps the
// scene's entities and the backend's bodies in step.
//
// This is the one place in the simulation where floats appear. A backend computes in
// floats (deterministically: the same build gives the same bits on every machine), and
// its results are rounded to fixed-point here before the rest of the engine sees them.
// This file is the part every build carries: what a backend is, how one is loaded, and the
// calls the rest of the engine makes. The work itself is in rigid.ts, which is loaded with
// the first backend, so a game without rigid bodies does not carry it.
import { KilnFail } from './scene.ts';
import type { World } from './world.ts';

/** A body as a backend sees it. Lengths in world units, `at` is the centre, `spin` in radians/second. */
export interface BodyDesc {
  kind: 'dynamic' | 'kinematic' | 'fixed';
  shape: string;
  /** Half the size on x, y, z. A ball uses the first as its radius; capsule, cylinder and cone stand along y. */
  half: number[];
  at: number[];
  /** Orientation as a quaternion x, y, z, w. */
  rot: number[];
  vel: number[];
  spin: number[];
  density: number;
  bounce: number;
  friction: number;
}

/** A tie between two bodies. Anchors and frames are in each body's own space. */
export interface JointDesc {
  kind: string;
  a: number;
  /** The other body's key, or null for a fixed point in the world. */
  b: number | null;
  anchorA: number[];
  anchorB: number[];
  /** Turns that take the x axis of each body to the joint's axis (fixed: that keep the two as they are). */
  frameA: number[];
  frameB: number[];
  length: number;
  stiff: number;
  damp: number;
}

/** One simulated world inside a backend. Bodies are named by integer keys the caller chooses. */
export interface BackendWorld {
  addBody(key: number, body: BodyDesc): void;
  /** Also removes the joints that hold it. */
  removeBody(key: number): void;
  addJoint(key: number, joint: JointDesc): void;
  removeJoint(key: number): void;
  /** Limits (none when min >= max) and a motor (none when power is 0) of a hinge or slider; hinges in radians. */
  driveJoint(key: number, min: number, max: number, motor: number, power: number): void;
  /** Where a kinematic body's centre should be after the next step. */
  moveKinematic(key: number, at: number[]): void;
  /**
   * How far an unturned box (half sizes, centre `at`) can go along the unit vector `dir`, up
   * to `max`, before it touches a dynamic body, and which body; null when nothing is in the way.
   * A box that already overlaps a body is stopped only if it is moving further in.
   */
  cast(half: number[], at: number[], dir: number[], max: number): { dist: number; key: number } | null;
  /** Change a dynamic body's motion by an impulse through its centre of mass. */
  push(key: number, impulse: number[]): void;
  /**
   * Put a dynamic body somewhere, turn it, or change its speed or spin, at once; null leaves
   * that part exactly as it is. `cast` has to see the body in its new place straight away.
   */
  place(key: number, at: number[] | null, rot: number[] | null, vel: number[] | null, spin: number[] | null): void;
  mass(key: number): number;
  step(): void;
  /**
   * What pressed on a kinematic body in the last step: for each dynamic body that touched it,
   * the impulse that body gave it (the body itself lost as much), lowest key first.
   */
  touching(key: number): { key: number; j: number[] }[];
  /** Centre (3), orientation (4), velocity (3), spin (3) of a body, written into `out`. */
  read(key: number, out: Float64Array): void;
  /** Hash of the exact state of every dynamic body: equal hash, identical state. */
  hash(): number;
  /** The whole state, restorable exactly, and its size in bytes. */
  save(): { bytes: number; state: unknown };
  free(): void;
}
export interface Backend {
  name: string;
  create(gravity: number[], dt: number): BackendWorld;
  /** A new world in a state that `save` returned. */
  restore(state: unknown): BackendWorld;
}

export const BACKENDS = ['rapier'];
const loaded = new Map<string, Backend>();
let rigid: typeof import('./rigid.ts') | undefined;

/** The backend a scene's world line asks for, or '' for none. */
export const physicsOf = (sceneText: string): string => /^world\b.*\sphysics=([\w-]+)/m.exec(sceneText)?.[1] ?? '';

/**
 * Load a backend so that scenes can use it. Backends are optional packages in
 * backends/NAME with their own pinned dependency; the core never imports one unasked.
 */
export async function loadBackend(name: string, file = 'scene'): Promise<void> {
  if (!name || loaded.has(name) || !BACKENDS.includes(name)) return;
  try {
    rigid ??= await import('./rigid.ts');
    // Same extension as this module: .ts from source, .js in a built folder.
    const ext = import.meta.url.slice(import.meta.url.lastIndexOf('.'));
    loaded.set(name, (await import(new URL(`../backends/${name}/index${ext}`, import.meta.url).href)).default as Backend);
  } catch (e) {
    throw new KilnFail([{
      code: 'K130', file, line: 0, msg: `physics backend '${name}' could not be loaded: ${(e as Error).message.split('\n')[0]}`,
      hint: `install it once: npm ci --prefix backends/${name}`,
    }]);
  }
}

/** What ties a world to its backend world: which entity is which kind of body, and which tile maps are in. */
export interface Link {
  world: BackendWorld; kinds: Map<number, string>; maps: Set<number>;
  /** Joints in the backend, by the entity that has the component. */
  joints: Map<number, Tie>;
  /** What the last step read from the backend for each rigid body, so that the next tick need not ask again. Not saved. */
  seen: Map<number, Float64Array>;
}
/** What a joint in the backend was made from: a change of `made` needs a new joint, of `drive` does not. */
export interface Tie { made: string; drive: string; to: number | null }
export interface SavedLink { bytes: number; state: unknown; kinds: Map<number, string>; maps: Set<number>; joints: Map<number, Tie> }

function backendOf(w: World): Backend {
  const backend = loaded.get(w.physics);
  if (!backend) throw new KilnFail([{ code: 'K130', file: 'scene', line: 0, msg: `physics backend '${w.physics}' is not loaded`, hint: `install it once: npm ci --prefix backends/${w.physics}` }]);
  return backend;
}

/** Called by `step` before the movers move: bring the backend's bodies in line with the entities. */
export function physicsSync(w: World): void {
  const backend = w.link ? null : backendOf(w);
  rigid!.sync(w, backend);
}
export const physicsSweep = (w: World, cur: number[], size: number[], a: number, want: number, pace: number): { go: number; id: number } | null =>
  rigid!.sweep(w, cur, size, a, want, pace);
export const physicsStep = (w: World, nudge: (id: number, a: number, want: number) => number): void => rigid!.advance(w, nudge);

/** The backend's exact state as 8 hex digits, or '' when the world has no physics running. */
export const physicsHash = (w: World): string => {
  const link = w.link as Link | undefined;
  return link ? (link.world.hash() >>> 0).toString(16).padStart(8, '0') : '';
};
/** The physics state of a world, for putting back later; null before physics has started. */
export function saveLink(w: World): SavedLink | null {
  const link = w.link as Link | undefined;
  if (!link) return null;
  return { ...link.world.save(), kinds: new Map(link.kinds), maps: new Set(link.maps), joints: new Map(link.joints) };
}
/** Give a world the physics state that was saved from another copy of it (null: not started). */
export function restoreLink(w: World, saved: SavedLink | null): void {
  w.link = saved ? { world: backendOf(w).restore(saved.state), kinds: new Map(saved.kinds), maps: new Set(saved.maps), joints: new Map(saved.joints), seen: new Map() } : undefined;
}
/** Release a world's backend memory. A backend lives outside the garbage collector. */
export function freeLink(w: World): void {
  (w.link as Link | undefined)?.world.free();
  w.link = undefined;
}
