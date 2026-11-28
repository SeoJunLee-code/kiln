// `kiln play SCENE --before OLD`: the game as it was beside the game as it is, stepped together
// with the same input, and what differs between the two worlds at that tick, as scene text.
import type { World } from '../src/world.ts'
import { entityText } from './inspect.ts'

/** What differs between two worlds, matched by entity name: one line per difference. */
export function differences(before: World, after: World): string[] {
  const out: string[] = []
  const names = (w: World): string[] => w.names.filter((n) => n != null) as string[]
  const had = new Set(names(before))
  for (const name of names(after)) {
    if (!had.delete(name)) {
      out.push(`+ ${name}`)
      continue
    }
    const was = entityText(before, before.ids.get(name)!), is = entityText(after, after.ids.get(name)!)
    const gone = was.filter((l) => !is.includes(l)), came = is.filter((l) => !was.includes(l))
    if (gone.length || came.length) out.push(`~ ${name}`, ...gone.map((l) => `    - ${l}`), ...came.map((l) => `    + ${l}`))
  }
  for (const name of had) out.push(`- ${name}`)
  const world = (w: World): string => `hz=${w.hz} gravity=${w.gx},${w.gy},${w.gz} physics=${w.physics || 'core'}`
  if (world(before) !== world(after)) out.unshift(`~ world`, `    - ${world(before)}`, `    + ${world(after)}`)
  return out
}

/** Which entities and which of their components differ, without the values. */
export function differing(diff: string[]): string {
  let name = ''
  const out = new Set<string>()
  for (const line of diff) {
    if (!line.startsWith(' ')) {
      name = line.slice(2)
      if (!line.startsWith('~')) out.add(line)
    } else out.add(`${name} ${line.trim().split(/\s+/)[1]}`)
  }
  return [...out].sort().join('\n')
}

interface Side { world: World; hash: () => string; seek: (tick: number) => void; expects: () => string[] }

// The page part. Left out when a test or a tool imports `differences` alone.
const frames = typeof document === 'undefined' ? null : document.querySelectorAll('iframe')
if (frames?.length === 2) {
  const $ = (id: string): HTMLElement => document.getElementById(id)!
  const ready = (frame: HTMLIFrameElement): Promise<Side> => new Promise((done) => {
    const poll = (): void => {
      const side = (frame.contentWindow as unknown as { kiln?: Side }).kiln, page = frame.contentDocument
      if (!side || !page) return void setTimeout(poll, 30)
      // Only the game view: the panels are this page's.
      const style = page.createElement('style')
      style.textContent = 'aside { display: none } body { grid-template-columns: 1fr !important; grid-template-rows: 1fr !important }'
      page.head.append(style)
      done(side)
    }
    poll()
  })
  const [before, after] = await Promise.all([...frames].map(ready))
  let tick = 0, playing = 0
  const show = (): void => {
    before.seek(tick)
    after.seek(tick)
    // A side stops where its scene loads another, so it may be behind.
    $('tick').textContent = `tick ${tick}` + (before.world.tick < tick ? ` (before ended at ${before.world.tick})` : '') + (after.world.tick < tick ? ` (after ended at ${after.world.tick})` : '')
    const diff = differences(before.world, after.world)
    $('diff').textContent = diff.join('\n') || 'the two worlds are the same'
    for (const [id, side] of [['was', before], ['is', after]] as const) $(id).textContent = side.expects().join('\n') || '(no expect lines)'
  }
  const go = (t: number): void => {
    tick = Math.max(0, t)
    show()
  }
  const stop = (): void => {
    cancelAnimationFrame(playing)
    playing = 0
    $('play').textContent = 'Play'
  }
  $('play').onclick = () => {
    if (playing) return stop()
    $('play').textContent = 'Stop'
    let last = performance.now(), acc = 0
    const frame = (now: number): void => {
      acc += Math.min(now - last, 250) * after.world.hz / 1000
      last = now
      const n = Math.floor(acc)
      acc -= n
      if (n) go(tick + n)
      playing = requestAnimationFrame(frame)
    }
    playing = requestAnimationFrame(frame)
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-by]')) b.onclick = () => { stop(); go(tick + Number(b.dataset.by)) }
  const at = $('goto') as HTMLInputElement
  at.onchange = () => { stop(); if (/^\d+$/.test(at.value)) go(+at.value); at.blur() }
  addEventListener('keydown', (e) => {
    const by = ({ ',': -1, '.': 1, '<': -10, '>': 10 } as Record<string, number>)[e.key]
    if (by && !(e.target instanceof HTMLInputElement)) { stop(); go(tick + by) }
  })
  // On to the next tick where something else differs: another entity or another component.
  // Values that already differ may go on changing without stopping here.
  $('first').onclick = () => {
    stop()
    const kinds = (): string => differing(differences(before.world, after.world))
    const same = kinds()
    for (let t = tick + 1; t <= tick + 3600; t++) {
      before.seek(t)
      after.seek(t)
      if (kinds() !== same) return go(t)
    }
    show()
    $('tick').textContent += ': nothing else differs in the next 3600 ticks'
  }
  show()
  Object.assign(window, { compare: { go, tick: () => tick } })
}
