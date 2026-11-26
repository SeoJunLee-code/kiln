// Rapier as Kiln's rigid-body backend. It is the deterministic WebAssembly build, pinned
// to one version: the same steps give the same bits on every machine, which is what lets
// a physics scene keep a state hash. See spikes/RESULTS.md for the test behind that.
//
// The package is the "compat" build (the WebAssembly is inside the module), so the same
// file loads under Node and in a browser. Its types are not used here: the core has no
// dependency to take them from, so Rapier's objects are `any`.
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import type { Backend, BackendWorld, BodyDesc } from '../../src/physics.ts';

await (RAPIER as any).init();
const R = RAPIER as any;

function fnv(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** `handles` maps the caller's keys to Rapier's body handles, in the order bodies were added. */
function wrap(world: any, handles: Map<number, number>): BackendWorld {
  const body = (key: number): any => world.getRigidBody(handles.get(key)!);
  return {
    addBody(key: number, b: BodyDesc): void {
      const desc = (b.kind === 'dynamic' ? R.RigidBodyDesc.dynamic() : b.kind === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.fixed())
        .setTranslation(b.at[0], b.at[1], b.at[2])
        .setRotation({ x: b.rot[0], y: b.rot[1], z: b.rot[2], w: b.rot[3] });
      if (b.kind === 'dynamic') desc.setLinvel(b.vel[0], b.vel[1], b.vel[2]).setAngvel({ x: b.spin[0], y: b.spin[1], z: b.spin[2] });
      const made = world.createRigidBody(desc);
      const shape = b.shape === 'ball' ? R.ColliderDesc.ball(b.half[0]) : R.ColliderDesc.cuboid(b.half[0], b.half[1], b.half[2]);
      // The bouncier of two touching things decides: `bounce=0.8` then means what it says on any floor.
      world.createCollider(shape.setDensity(b.density).setRestitution(b.bounce).setRestitutionCombineRule(R.CoefficientCombineRule.Max).setFriction(b.friction), made);
      handles.set(key, made.handle);
    },
    removeBody(key: number): void {
      const b = body(key);
      if (b) world.removeRigidBody(b);
      handles.delete(key);
    },
    moveKinematic(key: number, at: number[]): void {
      body(key).setNextKinematicTranslation({ x: at[0], y: at[1], z: at[2] });
    },
    step(): void { world.step(); },
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
      const snapshot: Uint8Array = world.takeSnapshot();
      return { bytes: snapshot.length, state: { snapshot, handles: new Map(handles) } };
    },
    free(): void { world.free(); },
  };
}

const backend: Backend = {
  name: 'rapier',
  create(gravity: number[], dt: number): BackendWorld {
    const world = new R.World({ x: gravity[0], y: gravity[1], z: gravity[2] });
    world.timestep = dt;
    return wrap(world, new Map());
  },
  restore(state: unknown): BackendWorld {
    const { snapshot, handles } = state as { snapshot: Uint8Array; handles: Map<number, number> };
    return wrap(R.World.restoreSnapshot(snapshot), new Map(handles));
  },
};
export default backend;
