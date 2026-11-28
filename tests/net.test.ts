// Network play: peers that exchange only inputs end up with the same game.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.ts';
import { command } from '../src/commands.ts';
import { Session } from '../src/net.ts';
import type { Message } from '../src/net.ts';
import { loadBackend } from '../src/physics.ts';
import { relay } from '../src/relay.ts';
import { run } from '../src/run.ts';
import { KilnFail, parseScene, serialize } from '../src/scene.ts';
import { hash, parseInput } from '../src/sim.ts';

const SCENE = `world players=3 seed=7
entity red
  pos 0 0
  box 1 1
  vel
  ctrl 6
  tag runner
entity blue
  pos 6 0
  box 1 1
  vel
  ctrl 6 player=2
  tag runner
entity green
  pos 3 5
  box 1 1
  vel
  ctrl 6 player=3
  tag runner
entity coin
  pos 3 0
  box 1 1
  trigger #runner got despawn-self
`;

// A small linear congruential generator: the test's own dice, the same every run.
const dice = (seed: number): (() => number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

/** Three sessions that pass messages through a network that delays each by up to `lag` rounds. */
function play(scene: string, rounds: number, lag: number, meddle?: (round: number, sessions: Session[]) => void): Session[] {
  const sessions = [1, 2, 3].map((player) => new Session(parseScene(scene).world, { player, players: 3 }));
  const random = dice(11), mail: { due: number; to: number; m: Message }[] = [];
  const held = [0, 0, 0];
  // Messages from one peer to another keep their order, as on a socket.
  const last = new Map<string, number>();
  const post = (round: number, from: number, m: Message | null): void => {
    if (!m) return;
    for (let to = 0; to < 3; to++) {
      if (to === from) continue;
      const due = Math.max(last.get(`${from} ${to}`) ?? 0, round + Math.floor(random() * (lag + 1)));
      last.set(`${from} ${to}`, due);
      mail.push({ due, to, m });
    }
  };
  for (let round = 0; round < rounds + 4 * lag + 40; round++) {
    for (let i = mail.findIndex((x) => x.due <= round); i >= 0; i = mail.findIndex((x) => x.due <= round)) {
      const [x] = mail.splice(i, 1);
      sessions[x.to].receive(x.m);
    }
    sessions.forEach((s, i) => {
      if (round < rounds && random() < 0.1) held[i] = Math.floor(random() * 16);
      if (s.world.tick >= rounds) s.settle();
      else {
        post(round, i, s.local(held[i]));
        s.advance();
      }
      post(round, i, s.check());
    });
    meddle?.(round, sessions);
  }
  return sessions;
}

test('net: three peers over a slow network reach one state, which the recorded input reproduces', () => {
  const sessions = play(SCENE, 400, 8);
  const [a, b, c] = sessions.map((s) => s.world);
  assert.deepEqual(sessions.map((s) => [s.world.tick, s.desync]), [[400, null], [400, null], [400, null]]);
  assert.ok(sessions[0].rollbacks > 10, `only ${sessions[0].rollbacks} rollbacks: the test did not test`);
  assert.equal(hash(b), hash(a));
  assert.equal(hash(c), hash(a));
  // The same inputs headless, without any network: the same state, events and all.
  const replay = run(SCENE, { input: sessions[0].inputText(), ticks: 400 });
  assert.equal(replay.hash, hash(a));
  assert.deepEqual(replay.world.events.map((e) => `${e.tick} ${e.name} ${e.a}`), a.events.map((e) => `${e.tick} ${e.name} ${e.a}`));
});

test('net: a peer too far ahead waits, and a state that drifts is reported', () => {
  const alone = new Session(parseScene(SCENE).world, { player: 1, players: 3, window: 20 });
  for (let t = 0; t < 100; t++) { alone.local(2); alone.advance(); }
  assert.equal(alone.world.tick, 22);
  assert.equal(alone.local(2), null);
  // Nonsense from the wire is dropped.
  for (const bad of [{ p: 1, t: 0, k: 1 }, { p: 9, t: 5, k: 1 }, { p: 2, t: -1, k: 1 }, { p: 2, t: 1e9, k: 1 }, { p: 2, t: 5, k: 999 }]) alone.receive(bad as Message);
  assert.equal(alone.confirmed, 2);
  // One peer's world is changed behind its back: the hashes stop agreeing.
  const sessions = play(SCENE, 200, 3, (round, s) => { if (round === 70) s[1].world.seed++; });
  assert.ok(sessions.some((s) => s.desync !== null), 'nobody noticed');
});

const root = fileURLToPath(new URL('..', import.meta.url));
const skip = existsSync(join(root, 'backends/rapier/node_modules')) ? false : 'the rapier backend is not installed';

test('net: rolling back restores rigid bodies and joints exactly', { skip }, async () => {
  await loadBackend('rapier');
  let scene = `world players=3 gravity=0,30 physics=rapier\nentity floor\n  pos -20 5\n  box 40 1\n  solid\n`;
  for (let p = 1; p <= 3; p++) scene += `entity p${p}\n  pos ${p * 4 - 8} 4\n  box 1 1\n  vel\n  ctrl 5 player=${p}\n`;
  for (let i = 0; i < 8; i++) scene += `entity r${i}\n  pos ${(i % 4) * 3 - 6} ${-i}\n  box 1 1\n  rigid ${i % 2 ? 'ball' : 'box'}\n`;
  scene += 'entity swing\n  pos 2 0\n  box 1 1\n  rigid\n  joint hinge world -2 0\n';
  const sessions = play(scene, 150, 6);
  assert.deepEqual(sessions.map((s) => s.desync), [null, null, null]);
  assert.ok(sessions[0].resimulated > 0);
  assert.equal(hash(sessions[1].world), hash(sessions[0].world));
  assert.equal(run(scene, { input: sessions[2].inputText(), ticks: 150 }).hash, hash(sessions[0].world));
});

test('net: players in the world line, input names and mistakes', async () => {
  assert.match(serialize(parseScene(SCENE).world), /^world hz=60 gravity=0,0 seed=7 players=3\n/);
  assert.throws(() => parseScene('world players=65\n'), KilnFail);
  assert.throws(() => parseScene('entity a\n  ctrl 5 player=0\n'), KilnFail);
  assert.deepEqual([...parseInput('0 2:left down\n0 1:a down\n').get(0)!], [['2:left', true], ['a', true]]);
  assert.throws(() => parseInput('0 2:fly down\n'), KilnFail);
  const lint = (await command('check', { scene: 'entity a\n  pos 0 0\n  box 1 1\n  vel\n  ctrl 5 player=2\n' })).text;
  assert.match(lint, /^W K324 /m);
  assert.match((await command('check', { scene: SCENE })).text, /network standard: players=3/);
  // Only a game for several players carries the network part.
  const dir = mkdtempSync(join(tmpdir(), 'kiln-net-'));
  writeFileSync(join(dir, 'game.kiln'), SCENE);
  const built = build(join(dir, 'game.kiln'), mkdtempSync(join(tmpdir(), 'kiln-net-out-')));
  assert.ok(built.parts.includes('net') && built.written.includes('engine/web/netplay.js') && built.written.includes('engine/src/net.js'));
  const help = spawnSync(process.execPath, [join(root, 'src/cli.ts')], { encoding: 'utf8' }).stdout;
  assert.match(help, /relay /);
});

test('net: the relay numbers players, starts when full and passes messages on', async () => {
  const server = await relay(0);
  const url = `ws://127.0.0.1:${server.port}/relay?room=a&players=2`;
  const open = () => {
    const socket = new WebSocket(url), got: Record<string, unknown>[] = [], waiting: (() => void)[] = [];
    socket.onmessage = (e) => { got.push(JSON.parse(e.data as string)); waiting.splice(0).forEach((f) => f()); };
    const next = async (n: number) => { while (got.length < n) await new Promise<void>((ok) => waiting.push(ok)); return got; };
    return { socket, next };
  };
  try {
    const one = open();
    assert.deepEqual((await one.next(1))[0], { you: 1 });
    const two = open();
    assert.deepEqual(await two.next(2), [{ you: 2 }, { start: true }]);
    await one.next(2);
    const third = open();
    assert.deepEqual(await third.next(1), [{ full: true }]);
    // The sender cannot say who it is, and cannot smuggle other fields through.
    two.socket.send(JSON.stringify({ p: 1, t: 4, k: 3, you: 9 }));
    assert.deepEqual((await one.next(3))[2], { p: 2, t: 4, k: 3 });
    two.socket.close();
    assert.deepEqual((await one.next(4))[3], { left: 2 });
    one.socket.close();
    third.socket.close();
  } finally { server.close(); }
});
