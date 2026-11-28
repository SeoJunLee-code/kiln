// The judging script's pure parts: the check lists of the documents, the walk over the
// archive, the first scene of a Kiln game and the count of runs that passed.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checksFor, firstScene, isJudged, parseChecks, scanArchive, tally } from '../scripts/judge.ts'
import type { Results } from '../scripts/judge.ts'

const docs = fileURLToPath(new URL('../proof/compare', import.meta.url))

function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kiln-judge-test-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

test('judge: only the rows of the check table are read', () => {
  const md = '## Other\n| 9 | no | no |\n## Checks\n\n| # | Do | See |\n|---|---|---|\n| 1 | Start. | A grid. |\r\n## After\n| 2 | no | no |\n'
  assert.deepEqual(parseChecks(md), [{ n: 1, do: 'Start.', see: 'A grid.' }])
})

test('judge: every spec has its numbered checks, without gaps', () => {
  for (const [spec, count] of [['H1', 19], ['H2', 27], ['H3', 16], ['gemvault', 15]] as const) {
    const checks = checksFor(spec, docs)
    assert.deepEqual(checks.map((c) => c.n), Array.from({ length: count }, (_, i) => i + 1), spec)
    assert.ok(checks.every((c) => c.do && c.see), spec)
  }
  assert.match(checksFor('H2', docs)[14].see, /Level 4/)
})

test('judge: the archive walk takes counted game folders only', () => {
  const root = folder({
    'holdout/H1/kiln-1/game/main.kiln': '',
    'holdout/H1/godot-mcp-2/game/project.godot': '',
    'holdout/H1/godot-mcp-3-rerun-not-counted/game/project.godot': '',
    'holdout/H1/kiln-2-infra/game/main.kiln': '',
    'holdout/H1/kiln-3/SPEC.md': '',
    'holdout/H1/kiln-1.jsonl': '',
    'spread/godot1/game/project.godot': '',
    'spread/kiln1/game/level1.kiln': '',
  })
  try {
    const found = scanArchive(root)
    assert.deepEqual(found.map((t) => [t.id, t.setup, t.engine]), [
      ['H1/godot-mcp-2', 'godot-mcp', 'godot'],
      ['H1/kiln-1', 'kiln', 'kiln'],
      ['gemvault/godot1', 'godot', 'godot'],
      ['gemvault/kiln1', 'kiln', 'kiln'],
    ])
    assert.equal(found[3].log, join(root, 'spread-logs', 'kiln1.jsonl'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('judge: the first scene is the one the agent said, then level1, then the only one', () => {
  const root = folder({
    'menu/menu.kiln': '', 'menu/level1.kiln': '',
    'log.jsonl': `${JSON.stringify({ type: 'assistant' })}\n${JSON.stringify({ type: 'result', result: 'Start it:\n`node src/cli.ts play <path to>/game/menu.kiln`' })}\n`,
    'documented/main.kiln': '', 'documented/level1.kiln': '', 'documented/README.md': 'Run `node src/cli.ts play game/main.kiln`.',
    'one/game.kiln': '',
    'none/a.kiln': '', 'none/b.kiln': '',
  })
  try {
    assert.equal(firstScene(join(root, 'menu'), join(root, 'log.jsonl')), 'menu.kiln')
    assert.equal(firstScene(join(root, 'menu')), 'level1.kiln')
    assert.equal(firstScene(join(root, 'documented')), 'main.kiln')
    assert.equal(firstScene(join(root, 'one')), 'game.kiln')
    assert.equal(firstScene(join(root, 'none'), join(root, 'log.jsonl')), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('judge: a run passes only when every check passed', () => {
  const checks = [{ n: 1, do: 'a', see: 'b' }, { n: 2, do: 'c', see: 'd' }]
  const target = (name: string) => ({ id: `H1/${name}`, spec: 'H1' as const, name, setup: 'kiln', engine: 'kiln' as const, game: '', log: '' })
  const at = '2026-01-01T00:00:00.000Z'
  const results: Results = {
    'H1/a': { spec: 'H1', setup: 'kiln', checks: { 1: { verdict: 'pass', at }, 2: { verdict: 'pass', at } } },
    'H1/b': { spec: 'H1', setup: 'kiln', checks: { 1: { verdict: 'fail', at } } },
    'H1/c': { spec: 'H1', setup: 'kiln', checks: { 1: { verdict: 'pass', at }, 2: { verdict: 'skip', at } } },
  }
  assert.deepEqual(tally(['a', 'b', 'c', 'd'].map(target), results, () => checks), [{ spec: 'H1', setup: 'kiln', results: 4, passed: 1, failed: 1, open: 2 }])
  assert.equal(isJudged(results['H1/c'], checks), true)
  assert.equal(isJudged(results['H1/b'], checks), false)
})
