// Games whose way depends on more than where the hero stands: a button only a script reads, a
// platform that is away or here, a floor that goes. What `solve` may not leave out or merge.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { command } from '../src/commands.ts'

async function solved(scene: string, scripts: Record<string, string> = {}): Promise<{ input: string; states: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-solve-'))
  const file = join(dir, 'level.kiln')
  writeFileSync(file, scene)
  for (const [name, text] of Object.entries(scripts)) writeFileSync(join(dir, name), text)
  const s = await command('solve', { file })
  assert.equal(s.code, 0, s.text)
  const lines = s.text.trimEnd().split('\n')
  const input = lines.slice(0, -1).join('\n') + '\n'
  const r = await command('test', { file, input })
  assert.equal(r.code, 0, r.text)
  return { input, states: Number(/states=(\d+)/.exec(lines.at(-1)!)![1]) }
}

const FLIP = `export default (k) => {
  k.component('flip', 'turns gravity over on a new press of a while standing', [{ name: 'was', type: 'int', def: 0 }]);
  k.system((w) => {
    for (const id of w.query('flip', 'vel')) {
      const f = w.get(id, 'flip'), now = w.on('a') ? 1 : 0;
      if (now && !f.was && w.get(id, 'vel').y === 0) w.gy = -w.gy;
      f.was = now;
    }
  });
};
`

test('solve: a button that only a script reads is pressed', async () => {
  const r = await solved(`use flip.ts
world gravity=0,20
entity hero
  pos 2 7
  vel
  box 1 1
  body
  ctrl 5
  flip
entity floor
  pos 0 8
  box 14 1
  solid
entity ceiling
  pos 0 0
  box 14 1
  solid
entity goal
  pos 10 1
  box 1 1
expect reach hero goal by 400
`, { 'flip.ts': FLIP })
  assert.match(r.input, / a down/)
})

test('solve: a platform that is away is waited for', async () => {
  // The hero is penned against a wall on a ledge of its own width: nothing to do but wait for
  // the ferry. Waiting must not look like a state already seen while only the ferry moves.
  await solved(`world gravity=0,20
entity hero
  pos 1 7
  vel
  box 1 1
  body
  ctrl 4
entity wall
  pos 0 3
  box 1 6
  solid
entity left
  pos 1 8
  box 1 1
  solid
entity right
  pos 18 8
  box 4 1
  solid
entity ferry
  pos 12 8
  vel
  box 3 1
  solid
  pace x 2 15 3
entity pit
  pos 0 12
  box 22 1
  trigger hero fell
entity flag
  pos 20 7
  box 1 1
expect reach hero flag by 1500
expect never hero pit
`)
})

// Floors with the way down at alternating ends, cut into a left and a right map.
const ZIGZAG = [
  '########################################',
  ...Array(3).fill('#......................................#'),
  '##################################....##',
  ...Array(3).fill('#......................................#'),
  '##....##################################',
  ...Array(3).fill('#......................................#'),
  '########################################',
]

test('solve: a jumping game is steered round its floors, across maps side by side', async () => {
  const half = (name: string, x: number, from: number) =>
    `entity ${name}\n  pos ${x} 0\n  tiles 1\n${ZIGZAG.map((row) => `    ${row.slice(from, from + 20)}\n`).join('')}`
  const r = await solved(`world gravity=0,30
${half('west', 0, 0)}${half('east', 20, 20)}entity hero
  pos 3 3
  vel
  box 0.8 0.8
  body
  ctrl 8 12
entity flag
  pos 4 11
  box 1 1
expect reach hero flag by 3000
`)
  // 8,019 states with the straight line to the flag, 592 with the way round.
  assert.ok(r.states < 2000, `states ${r.states}`)
})

test('a body with no jump walks and falls: the keys do not hold it up', async () => {
  const scene = (extra: string) => `world gravity=0,30
entity hero
  pos 1 1
  vel
  box 1 1
${extra}  ctrl 4
expect at 60 hero.pos.y > 10
expect at 60 hero.pos.x > 4
`
  const input = '0 right down\n0 up down\n'
  assert.equal((await command('test', { scene: scene('  body\n'), input })).code, 0)
  // Without a body it is the 4-way mover it was: up is up.
  assert.equal((await command('test', { scene: scene(''), input })).code, 1)
})
