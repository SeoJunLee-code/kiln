// Rapier as Kiln's rigid-body backend. It is the deterministic WebAssembly build, pinned
// to one version: the same steps give the same bits on every machine, which is what lets
// a physics scene keep a state hash. See spikes/RESULTS.md for the test behind that.
//
// The package is the "compat" build (the WebAssembly is inside the module), so the same
// file loads under Node and in a browser. Its types are not used here: the core has no
// dependency to take them from, so Rapier's objects are `any`.
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import type { Backend, BackendWorld, BodyDesc, JointDesc } from '../../src/physics.ts';

await (RAPIER as any).init();
const R = RAPIER as any;

function fnv(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const UNTURNED = { x: 0, y: 0, z: 0, w: 1 }, STILL = { x: 0, y: 0, z: 0 };
/** The key of the body that stands for the world in joints; below every entity and tile key. */
const GROUND = Number.MIN_SAFE_INTEGER;
const vec = (v: number[]): { x: number; y: number; z: number } => ({ x: v[0], y: v[1], z: v[2] });
const quat = (q: number[]): { x: number; y: number; z: number; w: number } => ({ x: q[0], y: q[1], z: q[2], w: q[3] });

/** A joint in Rapier's world and the keys of the two bodies it holds. */
interface Held { handle: number; a: number; b: number }

function colliderOf(b: BodyDesc): any {
  const [hx, hy, hz] = b.half;
  if (b.shape === 'ball') return R.ColliderDesc.ball(hx);
  // A capsule's height includes its round ends.
  if (b.shape === 'capsule') return R.ColliderDesc.capsule(Math.max(0, hy - hx), hx);
  if (b.shape === 'cylinder') return R.ColliderDesc.cylinder(hy, hx);
  if (b.shape === 'cone') return R.ColliderDesc.cone(hy, hx);
  return R.ColliderDesc.cuboid(hx, hy, hz);
}

/**
 * `handles` maps the caller's keys to Rapier's body handles, in the order bodies were added.
 * `fresh` holds the dynamic bodies added since the last step: Rapier's scene queries only
 * see a body once a step has run, so a cast asks those few one by one.
 */
function wrap(world: any, handles: Map<number, number>, fresh: Set<number>, joints: Map<number, Held>): BackendWorld {
  const body = (key: number): any => world.getRigidBody(handles.get(key)!);
  const keys = new Map<number, number>();
  for (const [key, handle] of handles) keys.set(handle, key);
  // Bodies have been put somewhere since their colliders were last brought to them.
  let moved = false;
  const settle = (): void => {
    if (moved) world.propagateModifiedBodyPositionsToColliders();
    moved = false;
  };
  // How far a body's shape reaches from its centre, at most.
  const reach = new Map<number, number>();
  const reachOf = (key: number): number => {
    let r = reach.get(key);
    if (r === undefined) {
      const s = body(key).collider(0).shape;
      reach.set(key, r = s.halfExtents ? Math.hypot(s.halfExtents.x, s.halfExtents.y, s.halfExtents.z) : s.radius + (s.halfHeight ?? 0));
    }
    return r!;
  };
  return {
    addBody(key: number, b: BodyDesc): void {
      const desc = (b.kind === 'dynamic' ? R.RigidBodyDesc.dynamic() : b.kind === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.fixed())
        .setTranslation(b.at[0], b.at[1], b.at[2])
        .setRotation({ x: b.rot[0], y: b.rot[1], z: b.rot[2], w: b.rot[3] });
      if (b.kind === 'dynamic') desc.setSoftCcdPrediction(1).setLinvel(b.vel[0], b.vel[1], b.vel[2]).setAngvel({ x: b.spin[0], y: b.spin[1], z: b.spin[2] });
      const made = world.createRigidBody(desc);
      const shape = colliderOf(b);
      // The bouncier of two touching things decides: `bounce=0.8` then means what it says on any floor.
      world.createCollider(shape.setDensity(b.density).setRestitution(b.bounce).setRestitutionCombineRule(R.CoefficientCombineRule.Max).setFriction(b.friction), made);
      handles.set(key, made.handle);
      keys.set(made.handle, key);
      if (b.kind === 'dynamic') fresh.add(key);
    },
    removeBody(key: number): void {
      const b = body(key);
      if (b) world.removeRigidBody(b);
      keys.delete(handles.get(key)!);
      handles.delete(key);
      fresh.delete(key);
      reach.delete(key);
      for (const [id, j] of joints) if (j.a === key || j.b === key) joints.delete(id);
    },
    addJoint(key: number, j: JointDesc): void {
      if (j.b === null && !handles.has(GROUND)) handles.set(GROUND, world.createRigidBody(R.RigidBodyDesc.fixed()).handle);
      // The other body is Rapier's first, so that angles, distances and motors read as this one's.
      const a = vec(j.anchorB), b = vec(j.anchorA), along = { x: 1, y: 0, z: 0 };
      const data = j.kind === 'fixed' ? R.JointData.fixed(a, quat(j.frameB), b, quat(j.frameA))
        : j.kind === 'ball' ? R.JointData.spherical(a, b)
        : j.kind === 'hinge' ? R.JointData.revolute(a, b, along)
        : j.kind === 'slider' ? R.JointData.prismatic(a, b, along)
        : j.kind === 'rope' ? R.JointData.rope(j.length, a, b)
        : R.JointData.spring(j.length, j.stiff, j.damp, a, b);
      const made = world.createImpulseJoint(data, body(j.b ?? GROUND), body(j.a), true);
      if (j.kind === 'hinge' || j.kind === 'slider') { made.setFrameX1(quat(j.frameB)); made.setFrameX2(quat(j.frameA)); }
      // Two bodies that are joined overlap as a rule; they do not push each other apart.
      made.setContactsEnabled(false);
      joints.set(key, { handle: made.handle, a: j.a, b: j.b ?? GROUND });
    },
    removeJoint(key: number): void {
      const j = joints.get(key);
      if (!j) return;
      world.removeImpulseJoint(world.getImpulseJoint(j.handle), true);
      joints.delete(key);
    },
    driveJoint(key: number, min: number, max: number, motor: number, power: number): void {
      const held = joints.get(key)!, joint = world.getImpulseJoint(held.handle);
      // Setting limits turns them on; with an empty range there are none, so they are set wide open.
      joint.setLimits(min < max ? min : -1e9, min < max ? max : 1e9);
      joint.configureMotorVelocity(motor, power > 0 ? 1e4 : 0);
      joint.setMotorMaxForce(power > 0 ? power : 0);
      body(held.a).wakeUp();
    },
    cast(half: number[], at: number[], dir: number[], max: number): { dist: number; key: number } | null {
      settle();
      const shape = new R.Cuboid(half[0], half[1], half[2]);
      const from = { x: at[0], y: at[1], z: at[2] }, along = { x: dir[0], y: dir[1], z: dir[2] };
      // Not stopping at a penetration: a box that overlaps a body may still move out of it.
      const hit = world.castShape(from, UNTURNED, along, shape, 0, max, false, R.QueryFilterFlags.ONLY_DYNAMIC);
      let found = hit ? { dist: hit.time_of_impact as number, key: keys.get(hit.collider.parent().handle)! } : null;
      if (!fresh.size) return found;
      // The space the box sweeps through. A fresh body too far from it to touch is not asked:
      // a script that moves every body every tick makes all of them fresh.
      const lo = [0, 0, 0], hi = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        lo[i] = at[i] - half[i] + Math.min(0, dir[i] * max);
        hi[i] = at[i] + half[i] + Math.max(0, dir[i] * max);
      }
      for (const key of fresh) {
        const b = body(key), c = b.translation();
        const dx = Math.max(lo[0] - c.x, 0, c.x - hi[0]), dy = Math.max(lo[1] - c.y, 0, c.y - hi[1]), dz = Math.max(lo[2] - c.z, 0, c.z - hi[2]);
        // The margin is far above what 32-bit floats lose at these sizes.
        const r = reachOf(key) + 0.01 + (Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z)) * 1e-5;
        if (dx * dx + dy * dy + dz * dz > r * r) continue;
        const h = b.collider(0).castShape(STILL, shape, from, UNTURNED, along, 0, max, false);
        if (h && (!found || h.time_of_impact < found.dist)) found = { dist: h.time_of_impact, key };
      }
      return found;
    },
    push(key: number, impulse: number[]): void {
      body(key).applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, true);
    },
    place(key: number, at: number[] | null, rot: number[] | null, vel: number[] | null, spin: number[] | null): void {
      const b = body(key);
      if (at) b.setTranslation({ x: at[0], y: at[1], z: at[2] }, true);
      if (rot) b.setRotation({ x: rot[0], y: rot[1], z: rot[2], w: rot[3] }, true);
      if (vel) b.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
      if (spin) b.setAngvel({ x: spin[0], y: spin[1], z: spin[2] }, true);
      if (at || rot) {
        // Until the next step the scene queries look for the body where it was. Moving its
        // collider (before the next cast, once for all that moved) and asking it directly,
        // as for a new body, makes a cast see it here.
        moved = true;
        fresh.add(key);
      }
    },
    mass(key: number): number { return body(key).mass(); },
    moveKinematic(key: number, at: number[]): void {
      body(key).setNextKinematicTranslation({ x: at[0], y: at[1], z: at[2] });
    },
    step(): void { world.step(); fresh.clear(); moved = false; },
    touching(key: number): { key: number; j: number[] }[] {
      const mine = body(key).collider(0), others: any[] = [], found: { key: number; j: number[] }[] = [];
      world.contactPairsWith(mine, (other: any) => { if (other.parent()?.isDynamic()) others.push(other); });
      for (const other of others) {
        const j = [0, 0, 0];
        world.contactPair(mine, other, (m: any, flipped: boolean) => {
          // The normal points from the pair's first collider to its second; `flipped` says ours is the second.
          const n = m.normal(), sign = flipped ? 1 : -1;
          for (let i = 0; i < m.numContacts(); i++) {
            const k = m.contactImpulse(i) * sign;
            j[0] += n.x * k; j[1] += n.y * k; j[2] += n.z * k;
          }
        });
        if (j[0] !== 0 || j[1] !== 0 || j[2] !== 0) found.push({ key: keys.get(other.parent().handle)!, j });
      }
      return found.sort((a, b) => a.key - b.key);
    },
    read(key: number, out: Float64Array): void {
      const b = body(key), p = b.translation(), r = b.rotation(), v = b.linvel(), w = b.angvel();
      out[0] = p.x; out[1] = p.y; out[2] = p.z;
      out[3] = r.x; out[4] = r.y; out[5] = r.z; out[6] = r.w;
      out[7] = v.x; out[8] = v.y; out[9] = v.z;
      out[10] = w.x; out[11] = w.y; out[12] = w.z;
    },
    hash(): number {
      // The 32-bit values the engine holds, for every dynamic body in the order they were added.
      const values: number[] = [];
      for (const handle of handles.values()) {
        const b = world.getRigidBody(handle);
        if (!b.isDynamic()) continue;
        const p = b.translation(), r = b.rotation(), v = b.linvel(), w = b.angvel();
        values.push(p.x, p.y, p.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z, w.x, w.y, w.z);
      }
      return fnv(new Uint8Array(new Float32Array(values).buffer));
    },
    save(): { bytes: number; state: unknown } {
      settle();
      const snapshot: Uint8Array = world.takeSnapshot();
      return { bytes: snapshot.length, state: { snapshot, handles: new Map(handles), fresh: new Set(fresh), joints: new Map(joints) } };
    },
    free(): void { world.free(); },
  };
}

const backend: Backend = {
  name: 'rapier',
  create(gravity: number[], dt: number): BackendWorld {
    const world = new R.World({ x: gravity[0], y: gravity[1], z: gravity[2] });
    world.timestep = dt;
    return wrap(world, new Map(), new Set(), new Map());
  },
  restore(state: unknown): BackendWorld {
    const { snapshot, handles, fresh, joints } = state as { snapshot: Uint8Array; handles: Map<number, number>; fresh: Set<number>; joints: Map<number, Held> };
    return wrap(R.World.restoreSnapshot(snapshot), new Map(handles), new Set(fresh), new Map(joints));
  },
};
export default backend;
