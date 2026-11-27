export type FieldType = 'fx' | 'int' | 'str';
/** `def` undefined means the field is required. */
export interface Field { name: string; type: FieldType; def?: number | string }
/** `topic`: documented in `guide TOPIC`; the core guide only names it. */
/** The smallest edition that has a feature (docs/EDITIONS.md). Each contains the ones before it. */
export type Edition = 'lite' | 'standard' | 'ultra';
/** What an edition is measured on; a game's edition is the highest of its axes. */
export type Axis = 'drawing' | 'physics' | 'world' | 'network';
/** `needs`: set when the component is not in Lite: the axis it counts on and the edition that has it. */
export interface CompDef { name: string; doc: string; fields: Field[]; topic?: string; needs?: [Axis, Edition] }
export type Comp = Record<string, number | string>;
export interface GameEvent { tick: number; name: string; a: string; b: string }
export type System = (w: World) => void;

export const registry = new Map<string, CompDef>();

export function defineComponent(name: string, doc: string, fields: Field[] = [], topic?: string, needs?: [Axis, Edition]): void {
  const def: CompDef = { name, doc, fields };
  if (topic) def.topic = topic;
  if (needs && needs[1] !== 'lite') def.needs = needs;
  registry.set(name, def);
}

const f = (name: string, type: FieldType, def?: number | string): Field => ({ name, type, def });

defineComponent('pos', 'corner with the smallest x, y, z',
  [f('x', 'fx'), f('y', 'fx'), f('z', 'fx', 0)]);
defineComponent('vel', 'velocity in units/second', [f('x', 'fx', 0), f('y', 'fx', 0), f('z', 'fx', 0)]);
defineComponent('box', 'axis-aligned size on x, y and (3D) z; for collision and triggers', [f('w', 'fx'), f('h', 'fx'), f('d', 'fx', 65536)]);
defineComponent('solid', 'blocks entities that have pos+vel+box');
defineComponent('push', 'on a solid: movers shove it instead of stopping (one at a time; not along y under gravity)');
defineComponent('body', 'gets world gravity; carried by what it stands on. grounded and ride (its name) are set by the engine',
  [f('grounded', 'int', 0), f('ride', 'str', '')]);
defineComponent('ctrl', 'input-driven. jump=0: 4-way. jump>0: platformer, up jumps when grounded. plane=xz (3D): up/down walk along z, `a` jumps',
  [f('speed', 'fx'), f('jump', 'fx', 0), f('plane', 'str', 'xy')]);
defineComponent('pace', 'walks back and forth along axis (x, y or z) from min to max at speed; needs vel',
  [f('axis', 'str'), f('min', 'fx'), f('max', 'fx'), f('speed', 'fx')]);
defineComponent('tag', 'group label; refer to it as #name', [f('name', 'str')]);
defineComponent('trigger', 'emits event when target (entity name or #tag) starts overlapping. action: none, despawn-self, despawn-other, despawn:REF (name or #tag), load:FILE (event load; the scene ends and FILE opens); join with +',
  [f('target', 'str'), f('event', 'str'), f('action', 'str', 'none')]);
defineComponent('tiles', 'grid of cells at pos. solid: characters that block. spawn: CHAR:PREFAB (o:coin,@:hero), made entities on load. paint: CHAR:COLOR or, in 2D, CHAR:IMAGE (#:teal,.:grass.svg). plane=xz: a 3D floor plan (rows run along z), depth is the wall height',
  [f('size', 'fx', 65536), f('solid', 'str', '#'), f('spawn', 'str', ''), f('depth', 'fx', 65536), f('plane', 'str', 'xy'), f('paint', 'str', '')]);
defineComponent('sprite', 'glyph: character in the ASCII view. color: CSS color. image (2D): svg/png beside the scene. mesh (3D): .obj/.gltf/.glb, fitted to the box',
  [f('glyph', 'str', ''), f('color', 'str', 'white'), f('image', 'str', ''), f('mesh', 'str', '')]);
defineComponent('rot', 'turned angle degrees about axis (x, y, z) through the box centre, clockwise in 2D. spin: degrees/second. Collision ignores it',
  [f('angle', 'fx', 0), f('spin', 'fx', 0), f('axis', 'str', 'z')], 'view');
defineComponent('quat', '3D turn as a unit quaternion, instead of rot. sx sy sz: degrees/second about world axes',
  [f('x', 'fx', 0), f('y', 'fx', 0), f('z', 'fx', 0), f('w', 'fx', 65536), f('sx', 'fx', 0), f('sy', 'fx', 0), f('sz', 'fx', 0)], 'view', ['drawing', 'standard']);
defineComponent('rigid', 'needs world physics=rapier: falls, tumbles; blocks movers, who shove it. shape: box or ball',
  [f('shape', 'str', 'box'), f('density', 'fx', 65536), f('bounce', 'fx', 0), f('friction', 'fx', 32768)], 'physics', ['physics', 'standard']);
defineComponent('impulse', 'on a rigid: one shove (mass x speed), then removed', [f('x', 'fx', 0), f('y', 'fx', 0), f('z', 'fx', 0)], 'physics', ['physics', 'standard']);
defineComponent('force', 'on a rigid: a push every tick', [f('x', 'fx', 0), f('y', 'fx', 0), f('z', 'fx', 0)], 'physics', ['physics', 'standard']);
defineComponent('eye', '3D view: a camera at this entity plus the offset, looking at it; ignored headless',
  [f('x', 'fx'), f('y', 'fx'), f('z', 'fx'), f('fov', 'int', 55)], 'view');
defineComponent('anim', '2D: the sprite image is FRAMES pictures side by side, shown in turn. idle=N: the first N while still, the rest while moving. face: 1 right, -1 left (drawn mirrored); the engine sets it from vel x',
  [f('frames', 'int'), f('fps', 'int', 8), f('idle', 'int', 0), f('face', 'int', 1)], 'view');
defineComponent('label','text drawn above the entity in 2D; _ is a space', [f('text', 'str'), f('color', 'str', 'white')], 'view');
defineComponent('tally', 'a number that counts: n changes by `by` each time the event is emitted (a score; n=3 by=-1: lives). A label on the same entity shows n where it has %',
  [f('event', 'str'), f('n', 'int', 0), f('by', 'int', 1)], 'levels');
defineComponent('keep', 'what: component names joined by commas. When a load: opens this scene, this entity takes them from the entity of the same name in the scene that was left, if that one keeps them too',
  [f('what', 'str')], 'levels');
defineComponent('camera', '2D view: follows this entity, shows w x h units; ignored headless', [f('w', 'fx'), f('h', 'fx')], 'view');

export class World {
  tick = 0;
  hz = 60;
  gx = 0;
  gy = 0;
  gz = 0;
  /** index = entity id; null once despawned */
  names: (string | null)[] = [];
  ids = new Map<string, number>();
  comps = new Map<string, Map<number, Comp>>();
  pressed = new Set<string>();
  /** "triggerName:otherName" pairs currently overlapping */
  overlaps = new Set<string>();
  events: GameEvent[] = [];
  /** Pairs a trigger caught in the last step, with their tags. Lives one step and is not state: it lets
   *  an expect see a contact whose trigger removed one side in the same step. */
  met: { a: string; at: string; b: string; bt: string }[] = [];
  /** PRNG state; part of the saved and hashed state */
  seed = 0;
  /** Name of the rigid-body backend the scene asked for, or '' */
  physics = '';
  /** The backend's side of this world while it runs (see physics.ts); not part of the saved text */
  link: unknown = undefined;
  /** script systems: `pre` run before physics, `post` after triggers */
  pre: System[] = [];
  post: System[] = [];

  /** Is an input action currently held? */
  on(action: string): boolean {
    return this.pressed.has(action);
  }

  /** Deterministic random uint32 (xorshift32). The only randomness scripts may use. */
  rand(): number {
    let s = this.seed || 0x9e3779b9;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s | 0;
    return s >>> 0;
  }

  emit(name: string, a = '', b = ''): void {
    this.events.push({ tick: this.tick, name, a, b });
  }

  spawn(name: string): number {
    if (this.ids.has(name)) throw new Error(`duplicate entity '${name}'`);
    const id = this.names.length;
    this.names.push(name);
    this.ids.set(name, id);
    return id;
  }

  despawn(id: number): void {
    const n = this.names[id];
    if (n == null) return;
    this.names[id] = null;
    this.ids.delete(n);
    for (const m of this.comps.values()) m.delete(id);
    for (const k of [...this.overlaps]) if (k.split(':').includes(n)) this.overlaps.delete(k);
  }

  add(id: number, comp: string, data: Comp): Comp {
    let m = this.comps.get(comp);
    if (!m) this.comps.set(comp, (m = new Map()));
    m.set(id, data);
    return data;
  }

  /** Take a component off an entity. */
  drop(id: number, comp: string): void {
    this.comps.get(comp)?.delete(id);
  }

  get(id: number, comp: string): Comp | undefined {
    return this.comps.get(comp)?.get(id);
  }

  has(id: number, comp: string): boolean {
    return this.comps.get(comp)?.has(id) ?? false;
  }

  /** Entity ids having all listed components, ascending (deterministic order). */
  query(...cs: string[]): number[] {
    const first = this.comps.get(cs[0]);
    if (!first) return [];
    const out: number[] = [];
    for (const id of first.keys()) if (cs.every((c) => this.has(id, c))) out.push(id);
    return out.sort((a, b) => a - b);
  }

  /** Resolve an entity name or #tag to ids. */
  match(ref: string): number[] {
    if (ref.startsWith('#')) {
      const t = ref.slice(1);
      return this.query('tag').filter((id) => this.get(id, 'tag')!.name === t);
    }
    const id = this.ids.get(ref);
    return id === undefined ? [] : [id];
  }
}
