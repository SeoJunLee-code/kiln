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

/** What `rigid` and `joint` accept. */
export const SHAPES = ['box', 'ball', 'capsule', 'cylinder', 'cone'];
export const JOINTS = ['fixed', 'ball', 'hinge', 'slider', 'rope', 'spring'];

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
defineComponent('body', 'gets world gravity; rides what it stands on. step=H: climbs ledges up to H. Engine-set: grounded, ride',
  [f('grounded', 'int', 0), f('ride', 'str', ''), f('step', 'fx', 0)]);
defineComponent('ctrl', 'input-driven. jump=0: 4-way (a body under gravity only walks). jump>0: platformer, up jumps when grounded. plane=xz (3D): up/down walk along z, `a` jumps. player: whose keys',
  [f('speed', 'fx'), f('jump', 'fx', 0), f('plane', 'str', 'xy'), f('player', 'int', 1)]);
defineComponent('pace', 'walks to and fro on axis (x, y or z), min to max, at speed; needs vel',
  [f('axis', 'str'), f('min', 'fx'), f('max', 'fx'), f('speed', 'fx')]);
defineComponent('nav', 'walks to `to` (name or #tag) around solids. Needs vel and box (guide nav)',
  [f('to', 'str'), f('speed', 'fx'), f('reach', 'fx', 0), f('plane', 'str', 'xy'), f('cell', 'fx', 65536), f('event', 'str', ''), f('on', 'int', 0), f('nx', 'fx', 0), f('ny', 'fx', 0), f('there', 'int', 0)], 'nav', ['world', 'standard']);
defineComponent('tag', 'group label; refer to it as #name', [f('name', 'str')]);
defineComponent('trigger', 'emits event when target (entity name or #tag) starts overlapping. action: none, despawn-self, despawn-other, despawn:REF (name or #tag), load:FILE (event load; the scene ends and FILE opens); join with +',
  [f('target', 'str'), f('event', 'str'), f('action', 'str', 'none')]);
defineComponent('tiles', 'grid of cells at pos. solid: characters that block. spawn: CHAR:PREFAB (o:coin,@:hero), spawned on load. paint: CHAR:COLOR or, in 2D, CHAR:IMAGE (#:teal,.:grass.svg). plane=xz: a 3D floor plan (rows run along z), depth is the wall height',
  [f('size', 'fx', 65536), f('solid', 'str', '#'), f('spawn', 'str', ''), f('depth', 'fx', 65536), f('plane', 'str', 'xy'), f('paint', 'str', '')]);
defineComponent('sprite', 'glyph: char in the ASCII view. color: CSS color. image (2D): svg/png beside the scene. mesh (3D): .obj/.gltf/.glb, fitted to the box',
  [f('glyph', 'str', ''), f('color', 'str', 'white'), f('image', 'str', ''), f('mesh', 'str', '')]);
defineComponent('rot', 'turned angle degrees about axis (x, y, z) through the box centre, clockwise in 2D. spin: degrees/second. Collision ignores it',
  [f('angle', 'fx', 0), f('spin', 'fx', 0), f('axis', 'str', 'z')], 'view');
defineComponent('quat', '3D turn as a unit quaternion, instead of rot. sx sy sz: degrees/second about world axes',
  [f('x', 'fx', 0), f('y', 'fx', 0), f('z', 'fx', 0), f('w', 'fx', 65536), f('sx', 'fx', 0), f('sy', 'fx', 0), f('sz', 'fx', 0)], 'view', ['drawing', 'standard']);
defineComponent('rigid', 'needs world physics=rapier: falls, tumbles; blocks movers, who shove it. shape: box, ball, capsule, cylinder or cone (the last three stand along y). damp, spin: share of speed and of turning lost each second. ccd=1: never passes through a thin wall however fast',
  [f('shape', 'str', 'box'), f('density', 'fx', 65536), f('bounce', 'fx', 0), f('friction', 'fx', 32768), f('damp', 'fx', 0), f('spin', 'fx', 0), f('ccd', 'int', 0)], 'physics', ['physics', 'standard']);
defineComponent('joint', 'on a rigid: ties it to the entity `to` (or world). kind: fixed, ball, hinge, slider, rope, spring (guide joints)',
  [f('kind', 'str'), f('to', 'str'), f('x', 'fx', 0), f('y', 'fx', 0), f('z', 'fx', 0), f('axis', 'str', 'z'), f('min', 'fx', 0), f('max', 'fx', 0), f('motor', 'fx', 0), f('power', 'fx', 0), f('length', 'fx', 0), f('stiff', 'fx', 0), f('damp', 'fx', 0)], 'joints', ['physics', 'standard']);
defineComponent('impulse', 'on a rigid: one shove (mass x speed), then removed. ox oy oz: where it lands, from the centre; off the centre it also turns the body', [f('x', 'fx', 0), f('y', 'fx', 0), f('z', 'fx', 0), f('ox', 'fx', 0), f('oy', 'fx', 0), f('oz', 'fx', 0)], 'physics', ['physics', 'standard']);
defineComponent('force', 'on a rigid: a push every tick; ox oy oz as for impulse', [f('x', 'fx', 0), f('y', 'fx', 0), f('z', 'fx', 0), f('ox', 'fx', 0), f('oy', 'fx', 0), f('oz', 'fx', 0)], 'physics', ['physics', 'standard']);
defineComponent('drive', 'on a rigid: the keys push it (a ball that is rolled, not placed). power: the force. plane=xz: up/down along z; xy: along y. top: no push beyond this speed (0: none). Pair with rigid damp= so it slows by itself',
  [f('power', 'fx'), f('plane', 'str', 'xz'), f('top', 'fx', 0), f('player', 'int', 1)], 'physics', ['physics', 'standard']);
defineComponent('eye', '3D view: a camera at this entity plus the offset, looking at it; ignored headless',
  [f('x', 'fx'), f('y', 'fx'), f('z', 'fx'), f('fov', 'int', 55)], 'view');
defineComponent('light', '3D: point light at the middle of the entity, reaching range units. WebGPU; the 32 nearest the view',
  [f('color', 'str', 'white'), f('range', 'fx', 6 * 65536), f('power', 'fx', 65536)], 'view', ['drawing', 'standard']);
defineComponent('clip', '3D: play glTF animation NAME from tick FROM; speed<0 reverses',
  [f('name', 'str'), f('speed', 'fx', 65536), f('from', 'int', 0), f('loop', 'int', 1)], 'view', ['drawing', 'standard']);
defineComponent('particles', '2D: small squares from the middle of the box, rate a second and/or count at once on EVENT. angle: degrees, 0 right, 90 down',
  [f('rate', 'int', 0), f('on', 'str', ''), f('count', 'int', 12), f('life', 'fx', 39322), f('speed', 'fx', 3 * 65536), f('angle', 'fx', 270 * 65536), f('spread', 'fx', 360 * 65536), f('gravity', 'fx', 0), f('size', 'fx', 9830), f('color', 'str', 'white')], 'view');
defineComponent('anim', '2D: the sprite image is FRAMES pictures side by side, shown in turn. idle=N: the first N while still, the rest while moving. face: 1 right, -1 left (drawn mirrored); the engine sets it from vel x',
  [f('frames', 'int'), f('fps', 'int', 8), f('idle', 'int', 0), f('face', 'int', 1)], 'view');
defineComponent('label','text drawn above the entity in 2D; _ is a space. In 3D only with pin', [f('text', 'str'), f('color', 'str', 'white')], 'view');
defineComponent('tally', 'a number that counts: n changes by `by` each time the event is emitted (a score; n=3 by=-1: lives). A label on the same entity shows n where it has %. then=EVENT: emitted when n reaches hit (lives at 0: then=dead)',
  [f('event', 'str'), f('n', 'int', 0), f('by', 'int', 1), f('hit', 'int', 0), f('then', 'str', '')], 'levels');
defineComponent('timer', 'counts seconds down, then emits event and does action (as trigger). loop=1: again and again. A label on the same entity shows the seconds left where it has %. left (ticks) is set by the engine; on=0 holds it',
  [f('seconds', 'fx'), f('event', 'str'), f('action', 'str', 'none'), f('loop', 'int', 0), f('left', 'int', -1), f('on', 'int', 1)], 'rules');
defineComponent('when', 'does action each time event is emitted, by anything: a trigger, a button, a timer, a tally, a script. action as trigger, also emit:EVENT and reset:REF',
  [f('event', 'str'), f('action', 'str')], 'rules');
defineComponent('keep', 'what: component names joined by commas. When a load: opens this scene, this entity takes them from the entity of the same name in the scene that was left, if that one keeps them too',
  [f('what', 'str')], 'levels');
defineComponent('sound', 'on: EVENT:FILE pairs, the file plays when the event is emitted. music loops. vol, mvol: 0..1. Browser only, never state the game reads',
  [f('on', 'str', ''), f('music', 'str', ''), f('vol', 'fx', 65536), f('mvol', 'fx', 32768)], 'audio');
defineComponent('button', 'a click or tap on its box, or pressing the action `key`, emits event and does action (as trigger: despawn-self, despawn:REF, load:FILE). key: a b or enter. Its label is drawn inside the box. In 3D it needs pin',
  [f('event', 'str'), f('action', 'str', 'none'), f('key', 'str', '')], 'ui');
defineComponent('pin', 'drawn at a place on the screen instead of at pos (2D, and over a 3D view: the score, a menu). where: top-left top top-right left center right bottom-left bottom bottom-right. dx dy: offset; 1 = a twelfth of the shorter side of the view',
  [f('where', 'str', 'center'), f('dx', 'fx', 0), f('dy', 'fx', 0)], 'ui');
defineComponent('camera', '2D view: follows this entity, shows w x h units; ignored headless', [f('w', 'fx'), f('h', 'fx')], 'view');

export class World {
  tick = 0;
  hz = 60;
  /** How many play at once; above 1 the game can be played over a network (src/net.ts). */
  players = 1;
  gx = 0;
  gy = 0;
  gz = 0;
  /** index = entity id; null once despawned */
  names: (string | null)[] = [];
  ids = new Map<string, number>();
  comps = new Map<string, Map<number, Comp>>();
  /** Counts the changes to who has which component, so an answer to a query can be kept until
   *  one. Whoever replaces `comps` or writes to its maps directly raises it. Not state. */
  version = 0;
  pressed = new Set<string>();
  /** "triggerName:otherName" pairs currently overlapping */
  overlaps = new Set<string>();
  events: GameEvent[] = [];
  /** Pairs a trigger caught in the last step, with their tags. Lives one step and is not state: it lets
   *  an expect see a contact whose trigger removed one side in the same step. */
  met: { a: string; at: string; b: string; bt: string }[] = [];
  /** PRNG state; part of the saved and hashed state */
  seed = 0;
  /** The scene as this run began, as text, once a rule can put things back to it (`reset:`);
   *  '' when none can, undefined until the first step decides. State: saved and hashed. */
  origin: string | undefined = undefined;
  /** Name of the rigid-body backend the scene asked for, or '' */
  physics = '';
  /** The backend's side of this world while it runs (see physics.ts); not part of the saved text */
  link: unknown = undefined;
  /** script systems: `pre` run before physics, `post` after triggers */
  pre: System[] = [];
  post: System[] = [];

  /** Is an input action currently held, by player 1 or the one given? */
  on(action: string, player = 1): boolean {
    return this.pressed.has(player === 1 ? action : `${player}:${action}`);
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
    this.version++;
    for (const k of [...this.overlaps]) if (k.split(':').includes(n)) this.overlaps.delete(k);
  }

  add(id: number, comp: string, data: Comp): Comp {
    let m = this.comps.get(comp);
    if (!m) this.comps.set(comp, (m = new Map()));
    if (!m.has(id)) this.version++;
    m.set(id, data);
    return data;
  }

  /** Take a component off an entity. */
  drop(id: number, comp: string): void {
    if (this.comps.get(comp)?.delete(id)) this.version++;
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
