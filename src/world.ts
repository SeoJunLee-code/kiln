export type FieldType = 'fx' | 'int' | 'str';
/** `def` undefined means the field is required. */
export interface Field { name: string; type: FieldType; def?: number | string }
export interface CompDef { name: string; doc: string; fields: Field[] }
export type Comp = Record<string, number | string>;
export interface GameEvent { tick: number; name: string; a: string; b: string }
export type System = (w: World) => void;

export const registry = new Map<string, CompDef>();

export function defineComponent(name: string, doc: string, fields: Field[] = []): void {
  registry.set(name, { name, doc, fields });
}

const f = (name: string, type: FieldType, def?: number | string): Field => ({ name, type, def });

defineComponent('pos', 'top-left corner in world units', [f('x', 'fx'), f('y', 'fx')]);
defineComponent('vel', 'velocity in units/second', [f('x', 'fx', 0), f('y', 'fx', 0)]);
defineComponent('box', 'axis-aligned size; needed for collision and triggers', [f('w', 'fx'), f('h', 'fx')]);
defineComponent('solid', 'blocks entities that have pos+vel+box');
defineComponent('body', 'receives world gravity; grounded is engine-written state', [f('grounded', 'int', 0)]);
defineComponent('ctrl', 'input-driven. jump=0: 4-way (left/right/up/down). jump>0: platformer, up jumps when grounded',
  [f('speed', 'fx'), f('jump', 'fx', 0)]);
defineComponent('tag', 'group label; reference it elsewhere as #name', [f('name', 'str')]);
defineComponent('trigger', 'emits event when target (entity name or #tag) starts overlapping. action: none|despawn-self|despawn-other',
  [f('target', 'str'), f('event', 'str'), f('action', 'str', 'none')]);
defineComponent('sprite', 'appearance; glyph is the character used by the ASCII view',
  [f('glyph', 'str', ''), f('color', 'str', 'white')]);

export class World {
  tick = 0;
  hz = 60;
  gx = 0;
  gy = 0;
  /** index = entity id; null once despawned */
  names: (string | null)[] = [];
  ids = new Map<string, number>();
  comps = new Map<string, Map<number, Comp>>();
  pressed = new Set<string>();
  /** "triggerName:otherName" pairs currently overlapping */
  overlaps = new Set<string>();
  events: GameEvent[] = [];
  /** PRNG state; part of the saved and hashed state */
  seed = 0;
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
