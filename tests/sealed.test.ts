// The sealed held-out specs may not change after their hashes were committed. This test
// reads only the bytes; nothing in the engine or its tests reads what the specs say.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const dir = new URL('../proof/compare/sealed/', import.meta.url)

test('sealed specs: every file still has the hash it was sealed with', () => {
  const lines = readFileSync(new URL('SEAL.sha256', dir), 'utf8').trim().split(/\r?\n/)
  assert.ok(lines.length >= 6, 'at least six sealed specs')
  for (const line of lines) {
    const [want, name] = line.trim().split(/\s+/)
    // Hash with LF line ends, so a checkout that turned them into CRLF still matches.
    const body = readFileSync(new URL(name, dir), 'utf8').replace(/\r\n/g, '\n')
    assert.equal(createHash('sha256').update(body).digest('hex'), want, `${name} was changed after sealing`)
  }
})
