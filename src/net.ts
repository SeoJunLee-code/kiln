// Network play by rollback: every peer runs the whole game and only inputs travel.
//
// The simulation is deterministic, so peers that apply the same inputs have the same state.
// A peer does not wait for the others: it assumes they still hold what they held, and when
// an input turns out different it goes back to that tick and runs forward again. Messages
// are small JSON values; any ordered transport carries them (see relay.ts). Peers compare
// state hashes now and then, so a game that is not deterministic is reported, not lived with.
//
// The rule for scripts is the one for saved states: what matters is in the world, not in a
// module's variables, since rolling back restores the world only.
import { freeLink, restoreLink, saveLink } from './physics.ts';
import type { SavedLink } from './physics.ts';
import { ACTIONS, hash, step } from './sim.ts';
import type { Comp, World } from './world.ts';

/** Input of player `p` for tick `t` (a bit per action, in the order of ACTIONS), or the hash of its state at `t`. */
export interface Message { p: number; t: number; k?: number; h?: string }

/** Ticks between hash comparisons. */
const CHECK = 30;

interface Snapshot {
  tick: number; hz: number; seed: number; g: number[]; names: (string | null)[]; ids: Map<string, number>;
  comps: Map<string, Map<number, Comp>>; pressed: Set<string>; overlaps: Set<string>; events: number; link: SavedLink | null;
}

const copyComps = (from: Map<string, Map<number, Comp>>): Map<string, Map<number, Comp>> => {
  const to = new Map<string, Map<number, Comp>>();
  for (const [name, m] of from) {
    const n = new Map<number, Comp>();
    for (const [id, d] of m) n.set(id, { ...d });
    to.set(name, n);
  }
  return to;
};

const save = (w: World): Snapshot => ({
  tick: w.tick, hz: w.hz, seed: w.seed, g: [w.gx, w.gy, w.gz], names: [...w.names], ids: new Map(w.ids), comps: copyComps(w.comps),
  pressed: new Set(w.pressed), overlaps: new Set(w.overlaps), events: w.events.length, link: saveLink(w),
});

function restore(w: World, s: Snapshot): void {
  freeLink(w);
  w.tick = s.tick; w.hz = s.hz; w.seed = s.seed; [w.gx, w.gy, w.gz] = s.g;
  w.names = [...s.names]; w.ids = new Map(s.ids); w.comps = copyComps(s.comps);
  w.pressed = new Set(s.pressed); w.overlaps = new Set(s.overlaps);
  w.events.length = s.events;
  restoreLink(w, s.link);
}

/** The name of a player's action in the world: player 1's are the plain ones. */
const named = (p: number, action: string): string => (p === 1 ? action : `${p}:${action}`);

export interface SessionOptions {
  /** Which player this peer is, from 1. */
  player: number;
  players: number;
  /** Ticks between pressing and acting. A little delay saves most rollbacks. */
  delay?: number;
  /** How many ticks this peer may run ahead of what it knows for certain. */
  window?: number;
}

export class Session {
  readonly world: World;
  readonly player: number;
  readonly players: number;
  readonly delay: number;
  readonly window: number;
  /** The tick at which this peer's state was found to differ from another's, or null. */
  desync: number | null = null;
  /** How many times the world was taken back, and how many ticks were run again. */
  rollbacks = 0;
  resimulated = 0;
  private readonly inputs: number[][];
  /** For each player, the ticks from 0 on whose input is known. */
  private readonly known: number[];
  private readonly used: number[][] = [];
  private readonly snapshots = new Map<number, Snapshot>();
  private readonly hashes = new Map<number, string>();
  private readonly theirs = new Map<number, string[]>();
  private dirty = Infinity;
  private nextCheck = CHECK;

  /** The world must be freshly loaded, the same on every peer. */
  constructor(world: World, options: SessionOptions) {
    this.world = world;
    this.player = options.player;
    this.players = options.players;
    this.delay = options.delay ?? 2;
    this.window = options.window ?? 30;
    // Nothing was pressed before the delay could pass: every peer knows that without a message.
    this.inputs = Array.from({ length: this.players }, () => new Array<number>(this.delay).fill(0));
    this.known = new Array<number>(this.players).fill(this.delay);
  }

  /** Ticks below this ran, or will run, with every player's real input. */
  get confirmed(): number {
    return Math.min(...this.known);
  }

  /** Say what this player holds now. Returns what to send, or null when this tick was already said (stalled). */
  local(keys: number): Message | null {
    const t = this.world.tick + this.delay;
    if (this.inputs[this.player - 1][t] !== undefined) return null;
    this.record(this.player, t, keys);
    return { p: this.player, t, k: keys };
  }

  /** Take a message from another peer. One that makes no sense is dropped. */
  receive(m: Message): void {
    const { p, t, k, h } = m;
    if (!Number.isInteger(p) || p < 1 || p > this.players || p === this.player || !Number.isInteger(t) || t < 0 || t > this.world.tick + 8 * this.window + this.delay) return;
    if (typeof h === 'string') {
      if (!this.theirs.has(t)) this.theirs.set(t, []);
      this.theirs.get(t)!.push(h);
      this.compare(t);
    } else if (Number.isInteger(k) && k! >= 0 && k! < 1 << ACTIONS.length && this.inputs[p - 1][t] === undefined) {
      this.record(p, t, k!);
      if (t < this.world.tick && this.used[t][p - 1] !== k) this.dirty = Math.min(this.dirty, t);
    }
  }

  private record(p: number, t: number, keys: number): void {
    const list = this.inputs[p - 1];
    list[t] = keys;
    while (list[this.known[p - 1]] !== undefined) this.known[p - 1]++;
  }

  /** What player `p` holds at tick `t`: what they said, or what they last said. */
  private guess(p: number, t: number): number {
    return this.inputs[p - 1][t] ?? this.inputs[p - 1][this.known[p - 1] - 1] ?? 0;
  }

  /** Bring the past up to date with what has arrived, without running a new tick. */
  settle(): void {
    if (this.dirty === Infinity) return;
    const target = this.world.tick, from = this.dirty;
    this.dirty = Infinity;
    restore(this.world, this.snapshots.get(from)!);
    this.rollbacks++;
    this.resimulated += target - from;
    while (this.world.tick < target) this.simulate();
  }

  /**
   * Run one tick. False when this peer is already as far ahead of the others as it may be:
   * call again after more has arrived.
   */
  advance(): boolean {
    this.settle();
    if (this.world.tick - this.confirmed >= this.window) return false;
    this.simulate();
    for (const t of this.snapshots.keys()) if (t < Math.min(this.confirmed, this.world.tick - 1)) this.snapshots.delete(t);
    return true;
  }

  private simulate(): void {
    const w = this.world, t = w.tick;
    this.snapshots.set(t, save(w));
    if (t % CHECK === 0) this.hashes.set(t, hash(w));
    const keys = this.used[t] = Array.from({ length: this.players }, (_, i) => this.guess(i + 1, t));
    const changes: [string, boolean][] = [];
    keys.forEach((mask, i) => ACTIONS.forEach((action, bit) => {
      const name = named(i + 1, action), down = (mask & (1 << bit)) !== 0;
      if (w.pressed.has(name) !== down) changes.push([name, down]);
    }));
    step(w, new Map([[t, changes]]));
  }

  /** A hash to send, once the state it is of can no longer change; null when there is none yet. */
  check(): Message | null {
    const t = this.nextCheck, h = this.hashes.get(t);
    if (h === undefined || t > this.confirmed || this.dirty !== Infinity) return null;
    this.nextCheck += CHECK;
    this.compare(t);
    return { p: this.player, t, h };
  }

  private compare(t: number): void {
    // Only what both sides are sure of: our own is final once it has been sent.
    if (t >= this.nextCheck) return;
    const mine = this.hashes.get(t);
    if (mine !== undefined && this.theirs.get(t)?.some((h) => h !== mine)) this.desync ??= t;
  }

  /** The confirmed part of the session as an input script: replaying it alone gives the same states. */
  inputText(): string {
    const lines: string[] = [], was = new Array<number>(this.players).fill(0);
    for (let t = 0; t < Math.min(this.confirmed, this.world.tick); t++) {
      for (let p = 1; p <= this.players; p++) {
        const now = this.inputs[p - 1][t];
        ACTIONS.forEach((action, bit) => {
          if ((now ^ was[p - 1]) & (1 << bit)) lines.push(`${t} ${named(p, action)} ${now & (1 << bit) ? 'down' : 'up'}`);
        });
        was[p - 1] = now;
      }
    }
    return lines.map((l) => `${l}\n`).join('');
  }
}

/** The bit mask of a set of held actions, as `Session.local` wants it. */
export const maskOf = (held: { has(action: string): boolean }): number => ACTIONS.reduce((m, action, bit) => (held.has(action) ? m | (1 << bit) : m), 0);
