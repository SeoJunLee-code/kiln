// The work behind physics.ts: keeps the scene's entities and the backend's
// bodies and joints in step. Loaded with the first backend, so a game without rigid bodies
// does not carry it. This is the one place in the simulation where floats appear.
import { ONE } from './fx.ts';
import type { Backend, BodyDesc, JointDesc, Link } from './physics.ts';
import type { Comp, World } from './world.ts';

const num = (c: Comp | undefined, f: string): number => ((c?.[f] as number | undefined) ?? 0) / ONE;
/** Float to fixed-point, kept inside what fixed-point can hold. */
const toFx = (x: number): number => Math.max(-2147483647, Math.min(2147483647, Math.round(x * ONE))) | 0;
const DEG = Math.PI / 180;
// Tile cells get keys below every entity id: map id and cell index packed into a negative number.
const cellKey = (map: number, index: number): number => -(map * 1048576 + index) - 1;

function describe(w: World, id: number, kind: BodyDesc['kind']): BodyDesc {
  const p = w.get(id, 'pos')!, b = w.get(id, 'box')!, r = w.get(id, 'rigid'), q = w.get(id, 'quat'), v = w.get(id, 'vel');
  const half = [num(b, 'w') / 2, num(b, 'h') / 2, num(b, 'd') / 2];
  return {
    kind, shape: (r?.shape as string | undefined) ?? 'box', half,
    at: [num(p, 'x') + half[0], num(p, 'y') + half[1], num(p, 'z') + half[2]],
    // Only a rigid body's turn counts: for everything else collision ignores rotation, here too.
    rot: kind === 'dynamic' && q ? [num(q, 'x'), num(q, 'y'), num(q, 'z'), num(q, 'w')] : [0, 0, 0, 1],
    vel: kind === 'dynamic' ? [num(v, 'x'), num(v, 'y'), num(v, 'z')] : [0, 0, 0],
    spin: kind === 'dynamic' ? [num(q, 'sx') * DEG, num(q, 'sy') * DEG, num(q, 'sz') * DEG] : [0, 0, 0],
    density: r ? num(r, 'density') : 1, bounce: r ? num(r, 'bounce') : 0, friction: r ? num(r, 'friction') : 0.5,
  };
}

/** The turn that takes the x axis to the x, y or z axis. */
const FRAMES: Record<string, number[]> = { x: [0, 0, 0, 1], y: [0, 0, Math.SQRT1_2, Math.SQRT1_2], z: [0, -Math.SQRT1_2, 0, Math.SQRT1_2] };
/** Quaternion product a b. */
const mul = (a: number[], b: number[]): number[] => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const inverse = (q: number[]): number[] => [-q[0], -q[1], -q[2], q[3]];
/** A world-space offset in the space of a body turned by `q`. */
const local = (q: number[], v: number[]): number[] => mul(mul(inverse(q), [v[0], v[1], v[2], 0]), q).slice(0, 3);

/** Where a joint's two ends are, in each body's own space, from where the bodies are now. */
function jointDesc(w: World, id: number, to: number | null): JointDesc {
  const j = w.get(id, 'joint')!, kind = j.kind as string;
  const pose = (e: number): { at: number[]; rot: number[] } => {
    const d = describe(w, e, w.has(e, 'rigid') ? 'dynamic' : 'fixed');
    const n = Math.hypot(d.rot[0], d.rot[1], d.rot[2], d.rot[3]) || 1;
    return { at: d.at, rot: d.rot.map((x) => x / n) };
  };
  const a = pose(id), b = to === null ? { at: [0, 0, 0], rot: [0, 0, 0, 1] } : pose(to);
  const offset = [num(j, 'x'), num(j, 'y'), num(j, 'z')];
  // A rope or a spring runs from this centre to the other end; everything else holds at one point.
  const tied = kind === 'rope' || kind === 'spring';
  const endA = tied ? a.at : a.at.map((x, i) => x + offset[i]);
  const endB = tied ? (to === null ? a.at : b.at).map((x, i) => x + offset[i]) : endA;
  const axis = kind === 'fixed' ? [0, 0, 0, 1] : FRAMES[j.axis as string];
  const dx = endA[0] - endB[0], dy = endA[1] - endB[1], dz = endA[2] - endB[2];
  return {
    kind, a: id, b: to,
    anchorA: local(a.rot, endA.map((x, i) => x - a.at[i])),
    anchorB: local(b.rot, endB.map((x, i) => x - b.at[i])),
    frameA: mul(inverse(a.rot), axis), frameB: mul(inverse(b.rot), axis),
    // Math.sqrt, not hypot: it rounds the same way everywhere.
    length: num(j, 'length') || Math.sqrt(dx * dx + dy * dy + dz * dz),
    stiff: num(j, 'stiff'), damp: num(j, 'damp'),
  };
}

/** Make the backend's joints say what the components say. */
function jointSync(w: World, link: Link): void {
  const { world, kinds, joints } = link;
  for (const id of joints.keys()) {
    if (w.names[id] != null && w.has(id, 'joint')) continue;
    world.removeJoint(id);
    joints.delete(id);
  }
  for (const id of w.query('joint')) {
    const j = w.get(id, 'joint')!;
    const to = j.to === 'world' ? null : w.ids.get(j.to as string);
    const made = `${j.kind} ${j.to} ${j.x} ${j.y} ${j.z} ${j.axis} ${j.length} ${j.stiff} ${j.damp}`;
    let tie = joints.get(id);
    if (tie && (tie.made !== made || tie.to !== to)) { world.removeJoint(id); joints.delete(id); tie = undefined; }
    if (kinds.get(id) !== 'dynamic' || to === undefined || (to !== null && (to === id || !kinds.has(to)))) continue;
    if (!tie) {
      world.addJoint(id, jointDesc(w, id, to));
      joints.set(id, tie = { made, drive: '0 0 0 0', to });
    }
    const drive = `${j.min} ${j.max} ${j.motor} ${j.power}`;
    if (tie.drive !== drive && (j.kind === 'hinge' || j.kind === 'slider')) {
      const k = j.kind === 'hinge' ? DEG : 1;
      world.driveJoint(id, num(j, 'min') * k, num(j, 'max') * k, num(j, 'motor') * k, num(j, 'power'));
      joints.set(id, { made, drive, to });
    }
  }
}

/** Which kind of body an entity is, if any. */
function kindOf(w: World, id: number): BodyDesc['kind'] | null {
  if (w.has(id, 'rigid')) return 'dynamic';
  // Whatever the fixed-point core moves is a body the backend cannot move; walls just stand.
  if (w.has(id, 'vel') || w.has(id, 'push')) return 'kinematic';
  return w.has(id, 'solid') ? 'fixed' : null;
}

const out = new Float64Array(13), scratch = new Float64Array(13);

/**
 * Bring the backend's bodies in line with the scene's entities: called by `step` before the
 * fixed-point movers move, so that they can ask where the rigid bodies are.
 */
export function sync(w: World, backend: Backend | null): void {
  let link = w.link as Link | undefined;
  if (!link) {
    w.link = link = { world: backend!.create([w.gx / ONE, w.gy / ONE, w.gz / ONE], 1 / w.hz), kinds: new Map(), maps: new Set(), joints: new Map(), seen: new Map() };
  }
  const { world, kinds, maps, joints, seen } = link;

  // Bodies follow entities: gone or changed ones leave, new ones enter, always in id order.
  for (const [id, kind] of kinds) {
    if (w.names[id] == null || !w.has(id, 'pos') || !w.has(id, 'box') || kindOf(w, id) !== kind) {
      world.removeBody(id); kinds.delete(id); seen.delete(id);
      // The backend let go of the joints that held it.
      for (const [owner, tie] of joints) if (owner === id || tie.to === id) joints.delete(owner);
    }
  }
  // A rigid body's components mirror the backend. Where one no longer says what the backend
  // says, something (a script, usually) wrote to it since the last step, and the body follows:
  // that is how a body is put somewhere or given a speed. Parts nobody wrote keep their exact value.
  for (const [id, kind] of kinds) {
    if (kind !== 'dynamic') continue;
    // Nothing has touched the backend since the last step wrote the mirror, so what it read then still holds.
    let out = seen.get(id);
    if (!out) world.read(id, out = scratch);
    const p = w.get(id, 'pos')!, b = w.get(id, 'box')!, q = w.get(id, 'quat'), v = w.get(id, 'vel');
    const hw = (b.w as number) >> 1, hh = (b.h as number) >> 1, hd = (b.d as number) >> 1;
    const at = p.x !== ((toFx(out[0]) - hw) | 0) || p.y !== ((toFx(out[1]) - hh) | 0) || p.z !== ((toFx(out[2]) - hd) | 0)
      ? [((p.x as number) + hw) / ONE, ((p.y as number) + hh) / ONE, ((p.z as number) + hd) / ONE] : null;
    let rot: number[] | null = null, spin: number[] | null = null;
    if (q) {
      if (q.x !== toFx(out[3]) || q.y !== toFx(out[4]) || q.z !== toFx(out[5]) || q.w !== toFx(out[6])) {
        const n = Math.hypot(num(q, 'x'), num(q, 'y'), num(q, 'z'), num(q, 'w'));
        // A quaternion of length 0 is no direction at all: the body keeps the turn it has.
        if (n > 0) rot = [num(q, 'x') / n, num(q, 'y') / n, num(q, 'z') / n, num(q, 'w') / n];
      }
      if (q.sx !== toFx(out[10] / DEG) || q.sy !== toFx(out[11] / DEG) || q.sz !== toFx(out[12] / DEG)) spin = [num(q, 'sx') * DEG, num(q, 'sy') * DEG, num(q, 'sz') * DEG];
    }
    const vel = v && (v.x !== toFx(out[7]) || v.y !== toFx(out[8]) || v.z !== toFx(out[9])) ? [num(v, 'x'), num(v, 'y'), num(v, 'z')] : null;
    if (at || rot || vel || spin) world.place(id, at, rot, vel, spin);
  }
  for (const id of w.query('pos', 'box')) {
    const kind = kindOf(w, id);
    if (!kind || kinds.has(id)) continue;
    if (kind === 'dynamic') {
      // A rigid body's motion is mirrored into these, so they have to exist.
      if (!w.has(id, 'vel')) w.add(id, 'vel', { x: 0, y: 0, z: 0 });
      if (!w.has(id, 'quat')) w.add(id, 'quat', { x: 0, y: 0, z: 0, w: ONE, sx: 0, sy: 0, sz: 0 });
    }
    world.addBody(id, describe(w, id, kind));
    kinds.set(id, kind);
  }
  for (const m of w.query('tiles', 'pos')) {
    if (maps.has(m)) continue;
    maps.add(m);
    const t = w.get(m, 'tiles')!, p = w.get(m, 'pos')!, size = num(t, 'size'), depth = num(t, 'depth'), flat = t.plane === 'xz';
    (t.rows as string).split('\n').forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (!(t.solid as string).includes(row[c])) continue;
        const x = num(p, 'x') + (c + 0.5) * size;
        world.addBody(cellKey(m, r * 4096 + c), {
          kind: 'fixed', shape: 'box', rot: [0, 0, 0, 1], vel: [0, 0, 0], spin: [0, 0, 0], density: 1, bounce: 0, friction: 0.5,
          half: flat ? [size / 2, depth / 2, size / 2] : [size / 2, size / 2, depth / 2],
          at: flat ? [x, num(p, 'y') + depth / 2, num(p, 'z') + (r + 0.5) * size] : [x, num(p, 'y') + (r + 0.5) * size, num(p, 'z') + depth / 2],
        });
      }
    });
  }
  jointSync(w, link);
}

const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/** The gap a mover keeps to a rigid body, in fixed-point: 1/128 of a unit. */
const SKIN = ONE >> 7;

/**
 * A mover's box (corner `cur`, `size`) wants to go `want` along axis `a`, all in fixed-point;
 * `pace` is what it would cover this tick with nothing in its way. If a rigid body is in the
 * way, returns how far it can go instead and which entity stopped it, and gives that body a
 * shove: the two meet like lumps of clay (the body ends up no faster than the mover),
 * weighted by their masses, the mover's being its box volume.
 */
export function sweep(w: World, cur: number[], size: number[], a: number, want: number, pace: number): { go: number; id: number } | null {
  const { world } = w.link as Link;
  const sign = want > 0 ? 1 : -1, half = [size[0] / ONE / 2, size[1] / ONE / 2, size[2] / ONE / 2];
  const hit = world.cast(half, [cur[0] / ONE + half[0], cur[1] / ONE + half[1], cur[2] / ONE + half[2]], AXES[a].map((x) => x * sign), (want * sign) / ONE);
  if (!hit) return null;
  // The mover stops a hair short of the body. A solver lets a pressed body give a little
  // (into a wall, say) and spring back; a mover that followed it all the way would end up inside it.
  const go = Math.max(0, Math.floor(hit.dist * ONE) - SKIN);
  if (go >= want * sign) return null;
  world.read(hit.key, out);
  const closing = ((pace * w.hz) / ONE - out[7 + a]) * sign;
  // A mover that is only being moved aside (pace 0) does not strike what it comes up against.
  if (pace !== 0 && closing > 0) {
    const mine = half[0] * half[1] * half[2] * 8, its = world.mass(hit.key);
    world.push(hit.key, AXES[a].map((x) => (x * sign * closing * mine * its) / (mine + its)));
  }
  return { go: go * sign, id: hit.key };
}

/**
 * One tick of rigid-body physics: called by `step` after the fixed-point movers have moved.
 * `nudge` moves a mover along one axis by up to a fixed-point distance, stopping at whatever
 * is in its way, and returns how far it went.
 */
export function advance(w: World, nudge: (id: number, a: number, want: number) => number): void {
  const { world, kinds, seen } = w.link as Link;
  for (const [id, kind] of kinds) {
    if (kind !== 'kinematic') continue;
    const p = w.get(id, 'pos')!, b = w.get(id, 'box')!;
    world.moveKinematic(id, [num(p, 'x') + num(b, 'w') / 2, num(p, 'y') + num(b, 'h') / 2, num(p, 'z') + num(b, 'd') / 2]);
  }
  // Pushes that the scene or a script asked for: a force every tick, an impulse once.
  for (const id of w.query('force')) {
    const f = w.get(id, 'force')!;
    if (kinds.get(id) === 'dynamic') world.push(id, [num(f, 'x') / w.hz, num(f, 'y') / w.hz, num(f, 'z') / w.hz]);
  }
  for (const id of w.query('impulse')) {
    if (kinds.get(id) !== 'dynamic') continue;
    const j = w.get(id, 'impulse')!;
    world.push(id, [num(j, 'x'), num(j, 'y'), num(j, 'z')]);
    w.drop(id, 'impulse');
  }
  world.step();

  // Bodies move the movers they ran into. To the backend a mover has no mass to speak of: it
  // is a wall that walks, and a body that hits it loses all its speed towards it. Here the
  // mover takes its share of that blow, as if it weighed its box's volume, and is moved by
  // what the share amounts to in one tick; the body gets back what the mover did not take.
  // A mover that cannot give way (its back to a wall, its feet on the floor) takes nothing,
  // and the blow stays what the backend made of it.
  for (const [id, kind] of kinds) {
    if (kind !== 'kinematic' || w.has(id, 'solid') || !w.has(id, 'vel')) continue;
    const b = w.get(id, 'box')!, mine = num(b, 'w') * num(b, 'h') * num(b, 'd');
    for (const t of world.touching(id)) {
      const its = world.mass(t.key), back = [0, 0, 0];
      let moved = false;
      for (let a = 0; a < 3; a++) {
        const want = toFx(t.j[a] / (mine + its) / w.hz);
        if (want === 0) continue;
        const went = nudge(id, a, want);
        if (went === 0) continue;
        back[a] = (t.j[a] * its * went) / ((mine + its) * want);
        moved = true;
      }
      if (moved) world.push(t.key, back);
    }
  }

  // The backend's result, rounded to fixed-point, becomes what the rest of the engine sees.
  for (const [id, kind] of kinds) {
    if (kind !== 'dynamic') continue;
    let out = seen.get(id);
    if (!out) seen.set(id, out = new Float64Array(13));
    world.read(id, out);
    const p = w.get(id, 'pos')!, b = w.get(id, 'box')!, q = w.get(id, 'quat')!, v = w.get(id, 'vel')!;
    p.x = (toFx(out[0]) - ((b.w as number) >> 1)) | 0; p.y = (toFx(out[1]) - ((b.h as number) >> 1)) | 0; p.z = (toFx(out[2]) - ((b.d as number) >> 1)) | 0;
    q.x = toFx(out[3]); q.y = toFx(out[4]); q.z = toFx(out[5]); q.w = toFx(out[6]);
    v.x = toFx(out[7]); v.y = toFx(out[8]); v.z = toFx(out[9]);
    q.sx = toFx(out[10] / DEG); q.sy = toFx(out[11] / DEG); q.sz = toFx(out[12] / DEG);
  }
}

