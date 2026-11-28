// The scoreboard is the roadmap, so its counts are read from its own tables: a row
// without an edition, or a summary that no longer matches the rows, fails here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const text = readFileSync(new URL('../docs/PARITY.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const EDITIONS = ['all', 'Lite', 'Lite?', 'Standard', 'Ultra', '—']
const STATUSES = ['full', 'part', 'works', 'none', 'number'] as const
type Status = (typeof STATUSES)[number]

const status = (cell: string): Status => {
  if (cell.startsWith('**gated**')) return /^\*\*gated\*\*\s*\(/.test(cell) ? 'part' : 'full'
  if (cell.startsWith('works')) return 'works'
  if (cell.startsWith('none')) return 'none'
  assert.match(cell, /^\d/, `unknown status "${cell}"`)
  return 'number'
}

/** Every feature row of every table that has a Kiln column. */
const rows = () => {
  const found: { name: string; edition: string; status: Status }[] = []
  let kiln = -1
  for (const line of text.split('\n')) {
    const cells = line.startsWith('|') ? line.slice(1, -1).split('|').map(c => c.trim()) : null
    if (!cells) kiln = -1
    else if (cells[0] === 'Feature') {
      assert.equal(cells[1], 'Edition', `a table without an edition column: ${line}`)
      kiln = cells.indexOf('Kiln')
    } else if (kiln >= 0 && !cells[0].startsWith('---')) found.push({ name: cells[0], edition: cells[1], status: status(cells[kiln]) })
  }
  return found
}

const count = (list: ReturnType<typeof rows>) => STATUSES.map(s => list.filter(r => r.status === s).length)

test('every row of the scoreboard names its edition', () => {
  const all = rows()
  assert.ok(all.length > 50)
  for (const r of all) assert.ok(EDITIONS.includes(r.edition), `${r.name}: edition "${r.edition}"`)
})

test('the counts written above the tables are the counts of the rows', () => {
  const all = rows()
  const [full, part, works, none, number] = count(all)
  const said = text.match(/(\d+) rows: \*\*(\d+) gated in full, (\d+) gated in part, (\d+) works,\s+(\d+) none\*\*/)
  assert.ok(said, 'the summary sentence is missing')
  assert.deepEqual(said.slice(1).map(Number), [all.length, full, part, works, none])
  assert.equal(number, 1)
  for (const edition of EDITIONS) {
    const line = text.split('\n').find(l => l.startsWith(`| ${edition} |`) && /^\|[^|]+\|(\s*\d+\s*\|){6}$/.test(l))
    assert.ok(line, `no count line for ${edition}`)
    const of = all.filter(r => r.edition === edition)
    assert.deepEqual(line.split('|').slice(2, -1).map(Number), [...count(of), of.length], edition)
  }
})
