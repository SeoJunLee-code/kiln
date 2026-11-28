// The tools of the person who supervises an agent, in a real browser: stepping through a run,
// looking into an entity. Without a browser on the machine these are skipped.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { findChrome, launch } from '../src/chrome.ts'
import type { Browser } from '../src/chrome.ts'
import { GPU_SWITCHES, openPlayer } from '../src/look.ts'
import { run } from '../src/run.ts'
import { serve } from '../src/serve.ts'
import { differences, differing } from '../web/compare.ts'

const ex = (name: string): string => fileURLToPath(new URL(`../examples/${name}`, import.meta.url))
const skip = findChrome() ? false : 'no Chrome or Edge on this machine'
let browser: Browser
before(async () => { if (!skip) browser = await launch({ args: GPU_SWITCHES }) })
after(async () => { if (!skip) await browser.close() })

const headless = (tick: number): string =>
  run(readFileSync(ex('platformer.kiln'), 'utf8'), { input: readFileSync(ex('platformer.input'), 'utf8'), ticks: tick }).hash

test('browser: a replay is stepped through, back and forward, to the headless states', { skip }, async () => {
  const player = await openPlayer(ex('platformer.kiln'), { inputFile: ex('platformer.input'), browser })
  try {
    const at = (code: string) => player.page.eval<[number, string]>(`(() => { ${code}; return [kiln.world.tick, kiln.hash()] })()`)
    assert.deepEqual(await at('kiln.seek(90)'), [90, headless(90)])
    assert.deepEqual(await at('kiln.seek(30)'), [30, headless(30)])
    assert.deepEqual(await at(`dispatchEvent(new KeyboardEvent('keydown', { key: '.' }))`), [31, headless(31)])
    assert.deepEqual(await at(`dispatchEvent(new KeyboardEvent('keydown', { key: ',' }))`), [30, headless(30)])
    assert.deepEqual(await at(`dispatchEvent(new KeyboardEvent('keydown', { key: '>' }))`), [40, headless(40)])
    // The panel's own controls: a button, and a tick typed in.
    assert.deepEqual(await at(`[...document.querySelectorAll('#inspect button')].find((b) => b.textContent === '-10').click()`), [30, headless(30)])
    assert.deepEqual(await at(`const g = document.getElementById('goto'); g.value = '75'; g.dispatchEvent(new Event('change'))`), [75, headless(75)])
    assert.deepEqual(player.page.errors(), [])
  } finally { await player.close() }
})

test('browser: live input recorded here survives a rewind; a new press in the past drops what followed', { skip }, async () => {
  const player = await openPlayer(ex('platformer.kiln'), { browser })
  try {
    const out = await player.page.eval<{ first: string; again: string; log: string; cut: string }>(`(() => {
      const key = (type, k) => dispatchEvent(new KeyboardEvent(type, { key: k }))
      kiln.runTo(10); key('keydown', 'ArrowRight'); kiln.runTo(40); key('keyup', 'ArrowRight'); kiln.runTo(60)
      const first = kiln.hash()
      kiln.seek(5); kiln.seek(60)
      const again = kiln.hash(), log = kiln.inputLog()
      kiln.seek(20); key('keydown', 'ArrowLeft')
      return { first, again, log, cut: kiln.inputLog() }
    })()`)
    assert.equal(out.again, out.first)
    assert.equal(out.log, '10 right down\n40 right up')
    assert.equal(out.cut, '10 right down\n20 left down')
    assert.deepEqual(player.page.errors(), [])
  } finally { await player.close() }
})

test('browser: an entity is looked into, chosen by name or by clicking it', { skip }, async () => {
  const player = await openPlayer(ex('platformer.kiln'), { inputFile: ex('platformer.input'), browser })
  try {
    const out = await player.page.eval<{ names: string[]; inside: string; clicked: string; later: string; marked: number }>(`new Promise((done) => {
      const pick = document.getElementById('entity'), inside = document.getElementById('inside')
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      ;(async () => {
        await frame()
        // The first click that lands on something chooses it.
        const view = document.getElementById('view'), box = view.getBoundingClientRect()
        for (let y = 5; y < box.height && !pick.value; y += 12) for (let x = 5; x < box.width && !pick.value; x += 12) {
          view.dispatchEvent(new PointerEvent('pointerdown', { clientX: box.left + x, clientY: box.top + y, bubbles: true }))
        }
        const clicked = pick.value
        const name = kiln.world.names[kiln.world.query('mover')[0] ?? kiln.world.query('vel')[0]]
        pick.value = name; pick.dispatchEvent(new Event('change'))
        await frame()
        const before = inside.textContent
        kiln.seek(30)
        done({ names: [...pick.options].map((o) => o.value), inside: before, clicked, later: inside.textContent, marked: inside.querySelectorAll('.pass').length })
      })()
    })`)
    assert.ok(out.names.length > 2)
    assert.ok(out.names.includes(out.clicked), `clicked '${out.clicked}'`)
    assert.match(out.inside, /pos /)
    assert.notEqual(out.later, out.inside)
    assert.ok(out.marked > 0, 'what the step changed is marked')
    assert.deepEqual(player.page.errors(), [])
  } finally { await player.close() }
})

// A small change an agent might make: the hero starts further right and a coin is gone.
const changed = (): { dir: string; before: string; after: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-before-'))
  const was = 'world gravity=0,0\nentity hero\n  pos 1 1\n  vel 2 0\n  box 1 1\nentity coin\n  pos 9 1\n  box 1 1\nexpect at 60 hero.pos.x > 2\n'
  writeFileSync(join(dir, 'old.kiln'), was)
  writeFileSync(join(dir, 'new.kiln'), was.replace('pos 1 1', 'pos 4 1').replace('entity coin\n  pos 9 1\n  box 1 1\n', ''))
  return { dir, before: join(dir, 'old.kiln'), after: join(dir, 'new.kiln') }
}

test('compare: what differs is said by entity and component, and values alone are not news', () => {
  const g = changed()
  const world = (file: string, ticks: number) => run(readFileSync(file, 'utf8'), { ticks }).world
  const diff = differences(world(g.before, 0), world(g.after, 0))
  assert.deepEqual(diff, ['~ hero', '    - pos 1 1', '    + pos 4 1', '- coin'])
  assert.equal(differing(diff), differing(differences(world(g.before, 30), world(g.after, 30))))
  assert.deepEqual(differences(world(g.before, 5), world(g.before, 5)), [])
})

test('play --before: a revision that does not have the scene is an error, as is an option', async () => {
  const g = changed()
  await assert.rejects(async () => serve(g.after, undefined, 0, 'HEAD'), /E K001/)
  await assert.rejects(async () => serve(g.after, undefined, 0, '--output=x'), /E K001/)
})

test('play --before: the game at a git revision is served beside the game as it is', async () => {
  const g = changed()
  const git = (...args: string[]) => execFileSync('git', ['-C', g.dir, '-c', 'user.name=t', '-c', 'user.email=t@t.test', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('add', 'new.kiln')
  git('commit', '-qm', 'first')
  const first = readFileSync(g.after, 'utf8')
  writeFileSync(g.after, first.replace('pos 4 1', 'pos 6 1'))
  const server = await serve(g.after, undefined, 0, 'HEAD')
  try {
    const get = async (path: string) => { const r = await fetch(`http://127.0.0.1:${server.port}${path}`); return [r.status, await r.text()] as const }
    assert.equal((await get('/before/game/new.kiln'))[1], first)
    assert.match((await get('/game/new.kiln'))[1], /pos 6 1/)
    assert.equal((await get('/compare'))[0], 200)
    assert.equal((await get('/before/'))[0], 200)
    assert.equal((await get('/before/engine/web/player.ts'))[0], 200)
    assert.equal((await get('/before/game/..%2f..%2fsecret.kiln'))[0], 403)
  } finally { server.close() }
})

test('browser: before and after are stepped together and what differs is listed', { skip }, async () => {
  const g = changed()
  const server = await serve(g.after, undefined, 0, g.before)
  try {
    const page = await browser.open(`http://127.0.0.1:${server.port}/compare`, { width: 1100, height: 700 })
    const out = await page.eval<{ at0: string; tick: string; diff: string; was: string; is: string; errors: string }>(`new Promise((done) => {
      const text = (id) => document.getElementById(id).textContent
      const poll = () => {
        if (!window.compare) return setTimeout(poll, 30)
        const at0 = text('diff')
        compare.go(60)
        done({ at0, tick: text('tick'), diff: text('diff'), was: text('was'), is: text('is'), errors: [...document.querySelectorAll('iframe')].map((f) => f.contentDocument.getElementById('error').textContent).join('') })
      }
      poll()
    })`)
    assert.match(out.at0, /\+ pos 4 1[\s\S]*- coin/)
    assert.equal(out.tick, 'tick 60')
    assert.match(out.diff, /~ hero[\s\S]*- coin/)
    assert.notEqual(out.diff, out.at0)
    assert.match(out.was, /^pass /)
    assert.match(out.is, /^pass /)
    assert.equal(out.errors, '')
    assert.deepEqual(page.errors(), [])
  } finally { server.close() }
})
